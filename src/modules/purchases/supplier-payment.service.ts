import { Injectable } from '@nestjs/common';
import { parseDateOnly } from '../../common/helpers/date.js';
import { Decimal, minorUnits, sumMoney } from '../../common/helpers/money.js';
import type { Page } from '../../common/helpers/pagination.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { SystemAccount } from '../accounting/chart-of-accounts/system-accounts.js';
import { PostingService } from '../accounting/journals/posting.service.js';
import { AccountsRepository } from '../accounting/repositories/accounts.repository.js';
import { NumberSeriesRepository } from '../accounting/repositories/number-series.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { ContactsRepository } from '../contacts/contacts.repository.js';
import type { CreateSupplierPaymentDto, SupplierPaymentsQueryDto } from './purchases.dto.js';
import { PurchaseBillsRepository, SupplierPaymentsRepository, type SupplierPaymentDetail } from './purchases.repositories.js';

const PREFIX = 'PAY';
const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

/** Money paid to a supplier, fully allocated to open bills: Dr payable, Cr cash/bank. */
@Injectable()
export class SupplierPaymentService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly payments: SupplierPaymentsRepository,
    private readonly bills: PurchaseBillsRepository,
    private readonly contacts: ContactsRepository,
    private readonly accounts: AccountsRepository,
    private readonly numbers: NumberSeriesRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(query: SupplierPaymentsQueryDto): Promise<Page<SupplierPaymentDetail>> {
    return this.payments.list(query);
  }

  async get(id: string): Promise<SupplierPaymentDetail> {
    const payment = await this.payments.findDetail(id);
    if (!payment) throw AppException.notFound('Supplier payment', id);
    return payment;
  }

  async create(dto: CreateSupplierPaymentDto): Promise<SupplierPaymentDetail> {
    const { baseCurrency: currency } = await this.accounting.profile();
    const scale = minorUnits(currency);
    const amount = new Decimal(dto.amount);
    if (!amount.greaterThan(0) || amount.decimalPlaces() > scale) throw invalid('amount', `amount must be positive with at most ${scale} decimals`);
    if (new Set(dto.allocations.map((a) => a.billId)).size !== dto.allocations.length) throw invalid('allocations', 'allocate to each bill once');
    if (!sumMoney(dto.allocations.map((a) => a.amount)).equals(amount)) throw invalid('allocations', 'allocations must equal the amount paid');

    const id = await this.db.transaction(async () => {
      const contact = await this.contacts.findById(dto.contactId);
      if (!contact) throw AppException.notFound('Contact', dto.contactId);
      const account = await this.accounts.findById(dto.accountId);
      if (!account || account.isGroup || !account.isActive || !['CASH', 'BANK'].includes(account.subtype)) {
        throw invalid('accountId', 'pay from an active cash or bank account');
      }
      const payable = await this.accounts.findBySystemKey(SystemAccount.ACCOUNTS_PAYABLE);
      if (!payable) throw AppException.notFound('Accounts payable account');

      for (const [i, a] of dto.allocations.entries()) {
        const bill = await this.bills.findDetail(a.billId);
        if (!bill) throw AppException.notFound('Bill', a.billId);
        if (bill.status !== 'POSTED' || bill.type !== 'BILL') throw invalid(`allocations[${i}].billId`, 'payments settle posted bills');
        if (bill.contactId !== contact.id) throw invalid(`allocations[${i}].billId`, 'the bill belongs to another supplier');
        if (!(await this.bills.adjustSettlement(bill.id, 'amount_paid', new Decimal(a.amount).toFixed(4)))) {
          const due = new Decimal(bill.total.toString()).minus(bill.amountPaid.toString()).minus(bill.amountCredited.toString());
          throw new AppException(ErrorCode.ALLOCATION_EXCEEDS_BALANCE, `${bill.number} has ${due.toFixed(scale)} left to pay`, {
            field: `allocations[${i}].amount`,
            billId: bill.id,
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
          method: dto.method ?? 'BANK_TRANSFER',
          accountId: account.id,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          createdById: this.userId(),
        },
        dto.allocations.map((a) => ({ billId: a.billId, amount: new Decimal(a.amount).toFixed(4) })),
      );
      const journal = await this.posting.postDocument({
        date,
        source: 'SUPPLIER_PAYMENT',
        sourceId: payment.id,
        reference: number,
        memo: `Supplier payment ${number} · ${contact.name}`.slice(0, 1000),
        currency,
        lines: [
          { accountId: payable.id, debit: amount.toFixed(scale), description: number },
          { accountId: account.id, credit: amount.toFixed(scale), description: number },
        ],
      });
      await this.payments.setJournal(payment.id, journal.id);
      await this.audit.record({ action: 'supplier_payment.created', entityType: 'supplier_payment', entityId: payment.id, metadata: { number } });
      return payment.id;
    });
    return this.get(id);
  }

  async void(id: string): Promise<SupplierPaymentDetail> {
    await this.db.transaction(async () => {
      const payment = await this.get(id);
      if (payment.status !== 'POSTED') throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'This payment is already void');
      for (const a of payment.allocations) {
        if (!(await this.bills.adjustSettlement(a.billId, 'amount_paid', new Decimal(a.amount.toString()).negated().toFixed(4)))) {
          throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, `Could not release the allocation on ${a.bill.number}`);
        }
      }
      await this.posting.postReversal(payment.journalEntryId!, await this.accounting.today(), `Void of payment ${payment.number}`);
      if (!(await this.payments.markVoid(id, this.userId()))) throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The payment changed concurrently');
      await this.audit.record({ action: 'supplier_payment.voided', entityType: 'supplier_payment', entityId: id });
    });
    return this.get(id);
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
