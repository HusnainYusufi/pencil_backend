import { Injectable } from '@nestjs/common';
import { parseDateOnly } from '../../../common/helpers/date.js';
import { Decimal, minorUnits, sumMoney } from '../../../common/helpers/money.js';
import type { Page } from '../../../common/helpers/pagination.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import { AccountingContext } from '../../accounting/accounting-context.service.js';
import { SystemAccount } from '../../accounting/chart-of-accounts/system-accounts.js';
import { PostingService } from '../../accounting/journals/posting.service.js';
import { AccountsRepository } from '../../accounting/repositories/accounts.repository.js';
import { NumberSeriesRepository } from '../../accounting/repositories/number-series.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { ContactsRepository } from '../../contacts/contacts.repository.js';
import { SalesInvoicesRepository } from '../invoices/sales-invoices.repository.js';
import type { CreateCustomerPaymentDto, CustomerPaymentsQueryDto } from '../sales.dto.js';
import { CustomerPaymentsRepository, type CustomerPaymentDetail } from './customer-payments.repository.js';

const PREFIX = 'RCPT';
const RECEIVING_SUBTYPES = new Set(['CASH', 'BANK']);

const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

/**
 * Money received from a customer, allocated in full to their open invoices
 * and debit notes. Posting: Dr Cash/Bank, Cr Accounts receivable.
 * A payment is voided (reversing entry, allocations released), never edited.
 */
@Injectable()
export class CustomerPaymentService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly payments: CustomerPaymentsRepository,
    private readonly invoices: SalesInvoicesRepository,
    private readonly contacts: ContactsRepository,
    private readonly accounts: AccountsRepository,
    private readonly numbers: NumberSeriesRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(query: CustomerPaymentsQueryDto): Promise<Page<CustomerPaymentDetail>> {
    return this.payments.list({
      ...query,
      from: query.from ? parseDateOnly(query.from) : undefined,
      to: query.to ? parseDateOnly(query.to) : undefined,
    });
  }

  async get(id: string): Promise<CustomerPaymentDetail> {
    const payment = await this.payments.findDetail(id);
    if (!payment) throw AppException.notFound('Customer payment', id);
    return payment;
  }

  async create(dto: CreateCustomerPaymentDto): Promise<CustomerPaymentDetail> {
    const { baseCurrency: currency } = await this.accounting.profile();
    const scale = minorUnits(currency);
    const amount = new Decimal(dto.amount);
    if (!amount.greaterThan(0)) throw invalid('amount', 'amount must be greater than 0');
    if (amount.decimalPlaces() > scale) throw invalid('amount', `amount allows at most ${scale} decimals for ${currency}`);

    const invoiceIds = dto.allocations.map((a) => a.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) throw invalid('allocations', 'allocate to each document once');
    const allocated = sumMoney(dto.allocations.map((a) => a.amount));
    if (!allocated.equals(amount)) {
      throw invalid('allocations', `allocations (${allocated.toFixed(scale)}) must equal the amount received (${amount.toFixed(scale)})`);
    }

    const id = await this.db.transaction(async () => {
      const contact = await this.contacts.findById(dto.contactId);
      if (!contact) throw AppException.notFound('Contact', dto.contactId);
      const account = await this.accounts.findById(dto.accountId);
      if (!account) throw AppException.notFound('Account', dto.accountId);
      if (account.isGroup || !account.isActive || !RECEIVING_SUBTYPES.has(account.subtype)) {
        throw invalid('accountId', 'receive into an active cash or bank account');
      }
      const receivable = await this.accounts.findBySystemKey(SystemAccount.ACCOUNTS_RECEIVABLE);
      if (!receivable) throw AppException.notFound('Accounts receivable account');

      for (const [i, allocation] of dto.allocations.entries()) {
        const invoice = await this.invoices.findDetail(allocation.invoiceId);
        if (!invoice) throw AppException.notFound('Sales document', allocation.invoiceId);
        if (invoice.status !== 'ISSUED' || invoice.type === 'CREDIT_NOTE') {
          throw invalid(`allocations[${i}].invoiceId`, 'payments settle issued invoices and debit notes');
        }
        if (invoice.contactId !== contact.id) throw invalid(`allocations[${i}].invoiceId`, 'the document belongs to another customer');
        const value = new Decimal(allocation.amount);
        if (!value.greaterThan(0)) throw invalid(`allocations[${i}].amount`, 'amount must be greater than 0');
        if (!(await this.invoices.adjustSettlement(invoice.id, 'amount_paid', value.toFixed(4)))) {
          const due = new Decimal(invoice.total.toString()).minus(invoice.amountPaid.toString()).minus(invoice.amountCredited.toString());
          throw new AppException(ErrorCode.ALLOCATION_EXCEEDS_BALANCE, `${invoice.number} has ${due.toFixed(scale)} left to pay`, {
            field: `allocations[${i}].amount`,
            invoiceId: invoice.id,
            balanceDue: due.toFixed(scale),
          });
        }
      }

      const date = parseDateOnly(dto.date);
      const year = date.getUTCFullYear();
      const number = `${PREFIX}-${year}-${String(await this.numbers.next(PREFIX, year)).padStart(6, '0')}`;
      const payment = await this.payments.create(
        {
          number,
          contactId: contact.id,
          date,
          currency,
          amount: amount.toFixed(4),
          method: dto.method ?? 'CASH',
          accountId: account.id,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          createdById: this.userId(),
        },
        dto.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: new Decimal(a.amount).toFixed(4) })),
      );
      const journal = await this.posting.postDocument({
        date,
        source: 'CUSTOMER_PAYMENT',
        sourceId: payment.id,
        reference: number,
        memo: `Payment ${number} · ${contact.name}`.slice(0, 1000),
        currency,
        lines: [
          { accountId: account.id, debit: amount.toFixed(scale), description: number },
          { accountId: receivable.id, credit: amount.toFixed(scale), description: number },
        ],
      });
      await this.payments.setJournal(payment.id, journal.id);
      await this.audit.record({
        action: 'customer_payment.created',
        entityType: 'customer_payment',
        entityId: payment.id,
        metadata: { number, amount: amount.toFixed(scale) },
      });
      return payment.id;
    });
    return this.get(id);
  }

  async void(id: string): Promise<CustomerPaymentDetail> {
    await this.db.transaction(async () => {
      const payment = await this.get(id);
      if (payment.status !== 'POSTED') throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'This payment is already void');
      for (const allocation of payment.allocations) {
        if (!(await this.invoices.adjustSettlement(allocation.invoiceId, 'amount_paid', new Decimal(allocation.amount.toString()).negated().toFixed(4)))) {
          throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, `Could not release the allocation on ${allocation.invoice.number}`);
        }
      }
      await this.posting.postReversal(payment.journalEntryId!, await this.accounting.today(), `Void of payment ${payment.number}`);
      if (!(await this.payments.markVoid(id, this.userId()))) {
        throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The payment changed concurrently');
      }
      await this.audit.record({ action: 'customer_payment.voided', entityType: 'customer_payment', entityId: id });
    });
    return this.get(id);
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
