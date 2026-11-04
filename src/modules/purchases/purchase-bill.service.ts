import { Injectable } from '@nestjs/common';
import { addDays, parseDateOnly } from '../../common/helpers/date.js';
import { Decimal, minorUnits } from '../../common/helpers/money.js';
import type { Page } from '../../common/helpers/pagination.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { Contact, Prisma } from '../../generated/prisma/client.js';
import type { PurchaseDocumentType } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { SystemAccount } from '../accounting/chart-of-accounts/system-accounts.js';
import type { JournalLineInput } from '../accounting/journals/journal-rules.js';
import { PostingService } from '../accounting/journals/posting.service.js';
import { AccountsRepository } from '../accounting/repositories/accounts.repository.js';
import { NumberSeriesRepository } from '../accounting/repositories/number-series.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { ContactsRepository } from '../contacts/contacts.repository.js';
import { calculateInvoice, type InvoiceCalculation } from '../sales/invoices/invoice-calc.js';
import { TaxRatesRepository } from '../tax/tax-rates.repository.js';
import type { PurchaseBillsQueryDto, UpdatePurchaseBillDto, VoidPurchaseBillDto, CreatePurchaseBillDto } from './purchases.dto.js';
import {
  PurchaseBillsRepository,
  type PurchaseBillDetail,
  type PurchaseBillHeader,
  type PurchaseBillLineRow,
  type PurchaseBillSummary,
} from './purchases.repositories.js';

export const PURCHASE_PREFIX: Readonly<Record<PurchaseDocumentType, string>> = { BILL: 'BILL', CREDIT_NOTE: 'VCN', EXPENSE: 'EXP' };
const LABEL: Readonly<Record<PurchaseDocumentType, string>> = { BILL: 'Bill', CREDIT_NOTE: 'Supplier credit', EXPENSE: 'Expense' };
const PAYING_SUBTYPES = new Set(['CASH', 'BANK']);

const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

/**
 * Purchase documents: DRAFT -> POSTED (numbered, in the ledger) -> VOID
 * (reversing entry; only while nothing is paid or credited).
 *
 *   Bill:     Dr expense/asset (net), Dr VAT input (tax), Cr accounts payable
 *   Expense:  same debits, Cr the paying cash/bank account (settled at once)
 *   Credit:   mirror of a bill, applied to it
 * Input tax always lands on the system `vat_input` account (recoverable VAT).
 */
@Injectable()
export class PurchaseBillService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly bills: PurchaseBillsRepository,
    private readonly contacts: ContactsRepository,
    private readonly taxRates: TaxRatesRepository,
    private readonly accounts: AccountsRepository,
    private readonly numbers: NumberSeriesRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(query: PurchaseBillsQueryDto): Promise<Page<PurchaseBillSummary>> {
    return this.bills.list({
      ...query,
      from: query.from ? parseDateOnly(query.from) : undefined,
      to: query.to ? parseDateOnly(query.to) : undefined,
    });
  }

  async get(id: string): Promise<PurchaseBillDetail> {
    const bill = await this.bills.findDetail(id);
    if (!bill) throw AppException.notFound('Purchase document', id);
    return bill;
  }

  async create(dto: CreatePurchaseBillDto): Promise<PurchaseBillDetail> {
    const type = dto.type ?? 'BILL';
    const id = await this.db.transaction(async () => {
      const { header, lines } = await this.prepare(dto, type);
      const created = await this.bills.createDraft({ ...header, type, createdById: this.userId() }, lines);
      await this.audit.record({ action: 'purchase.created', entityType: 'purchase_bill', entityId: created.id, metadata: { type } });
      return created.id;
    });
    return dto.post ? this.post(id) : this.get(id);
  }

  async update(id: string, dto: UpdatePurchaseBillDto): Promise<PurchaseBillDetail> {
    await this.db.transaction(async () => {
      const current = await this.get(id);
      if (current.status !== 'DRAFT') throw this.notEditable();
      const { header, lines } = await this.prepare(dto, current.type);
      if (!(await this.bills.replaceDraft(id, header, lines))) throw this.notEditable();
      await this.audit.record({ action: 'purchase.updated', entityType: 'purchase_bill', entityId: id });
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.get(id);
      if (!(await this.bills.deleteDraft(id))) throw this.notEditable();
      await this.audit.record({ action: 'purchase.deleted', entityType: 'purchase_bill', entityId: id });
    });
  }

  async post(id: string): Promise<PurchaseBillDetail> {
    await this.db.transaction(async () => {
      const doc = await this.get(id);
      if (doc.status !== 'DRAFT') throw this.notEditable();
      if (doc.contact && !doc.contact.isActive) throw invalid('contactId', 'the supplier is inactive');
      const original = doc.originalBillId ? await this.get(doc.originalBillId) : null;
      if (original) this.assertCreditable(original, doc.contactId);

      const calc = this.recalculate(doc);
      if (!calc.total.greaterThan(0)) throw invalid('lines', 'the document total must be greater than zero');
      if (doc.type === 'CREDIT_NOTE' && original) {
        const remaining = new Decimal(original.total.toString()).minus(await this.bills.creditedTotal(original.id, doc.id));
        if (calc.total.greaterThan(remaining)) throw invalid('lines', `the credit exceeds what remains on ${original.number}`);
      }

      const year = doc.billDate.getUTCFullYear();
      const prefix = PURCHASE_PREFIX[doc.type];
      const number = `${prefix}-${year}-${String(await this.numbers.next(prefix, year)).padStart(6, '0')}`;
      const journal = await this.posting.postDocument({
        date: doc.billDate,
        source: 'PURCHASE_BILL',
        sourceId: doc.id,
        reference: doc.supplierReference ?? number,
        memo: `${LABEL[doc.type]} ${number}${doc.contact ? ` · ${doc.contact.name}` : ''}`.slice(0, 1000),
        currency: doc.currency,
        lines: await this.journalLines(doc, calc, number),
      });

      const supplier = doc.contact ? { name: doc.contact.name, nameAr: doc.contact.nameAr, vatNumber: doc.contact.taxNumber } : null;
      const posted = await this.bills.markPosted(doc.id, {
        number,
        postedAt: new Date(),
        postedById: this.userId(),
        journalEntryId: journal.id,
        supplier: (supplier ?? undefined) as Prisma.InputJsonValue | undefined,
        ...(doc.type === 'EXPENSE' && { amountPaid: calc.total.toFixed(4) }),
      });
      if (!posted) throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The document was posted or changed concurrently');

      if (doc.type === 'CREDIT_NOTE' && original) {
        const open = new Decimal(original.total.toString()).minus(original.amountPaid.toString()).minus(original.amountCredited.toString());
        const applied = Decimal.min(open, calc.total);
        if (applied.greaterThan(0)) {
          await this.bills.adjustSettlement(original.id, 'amount_credited', applied.toFixed(4));
          await this.bills.adjustSettlement(doc.id, 'amount_credited', applied.toFixed(4));
        }
      }
      await this.audit.record({ action: 'purchase.posted', entityType: 'purchase_bill', entityId: doc.id, metadata: { number } });
    });
    return this.get(id);
  }

  async void(id: string, dto: VoidPurchaseBillDto): Promise<PurchaseBillDetail> {
    await this.db.transaction(async () => {
      const doc = await this.get(id);
      if (doc.status !== 'POSTED') throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Only posted documents can be voided');
      if (doc.adjustments.some((a) => a.status === 'POSTED')) {
        throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Supplier credits reference this bill; void them first');
      }
      if (doc.type === 'BILL' && new Decimal(doc.amountPaid.toString()).greaterThan(0)) {
        throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Payments are allocated to this bill; void them first');
      }
      const credited = new Decimal(doc.amountCredited.toString());
      if (credited.greaterThan(0)) {
        if (doc.type !== 'CREDIT_NOTE' || !doc.originalBillId) {
          throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Supplier credits are applied to this bill; void them first');
        }
        await this.bills.adjustSettlement(doc.originalBillId, 'amount_credited', credited.negated().toFixed(4));
        await this.bills.adjustSettlement(doc.id, 'amount_credited', credited.negated().toFixed(4));
      }
      await this.posting.postReversal(doc.journalEntryId!, await this.accounting.today(), `Void of ${doc.number}`);
      if (!(await this.bills.markVoid(doc.id, { voidedById: this.userId(), voidReason: dto.reason }))) {
        throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The document changed concurrently');
      }
      await this.audit.record({ action: 'purchase.voided', entityType: 'purchase_bill', entityId: doc.id, metadata: { reason: dto.reason } });
    });
    return this.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async prepare(dto: UpdatePurchaseBillDto, type: PurchaseDocumentType): Promise<{ header: PurchaseBillHeader; lines: PurchaseBillLineRow[] }> {
    const { baseCurrency } = await this.accounting.profile();
    const currency = dto.currency ?? baseCurrency;
    if (currency !== baseCurrency) throw invalid('currency', `documents are in the base currency (${baseCurrency}); multi-currency is coming`);

    let contact: Contact | null = null;
    if (dto.contactId) {
      contact = await this.contacts.findById(dto.contactId);
      if (!contact) throw AppException.notFound('Contact', dto.contactId);
      if (!contact.isActive || !contact.isSupplier) throw invalid('contactId', 'choose an active supplier');
    } else if (type !== 'EXPENSE') {
      throw invalid('contactId', 'bills and supplier credits need a supplier');
    }

    if (type === 'CREDIT_NOTE') {
      if (!dto.originalBillId) throw invalid('originalBillId', 'a supplier credit must reference the bill');
      const original = await this.bills.findDetail(dto.originalBillId);
      if (!original) throw AppException.notFound('Bill', dto.originalBillId);
      this.assertCreditable(original, dto.contactId ?? null);
    } else if (dto.originalBillId) {
      throw invalid('originalBillId', 'only supplier credits reference a bill');
    }

    let paidFromAccountId: string | null = null;
    if (type === 'EXPENSE') {
      if (!dto.paidFromAccountId) throw invalid('paidFromAccountId', 'choose the cash or bank account that paid');
      const paidFrom = await this.accounts.findById(dto.paidFromAccountId);
      if (!paidFrom || paidFrom.isGroup || !paidFrom.isActive || !PAYING_SUBTYPES.has(paidFrom.subtype)) {
        throw invalid('paidFromAccountId', 'choose an active cash or bank account');
      }
      paidFromAccountId = paidFrom.id;
    }

    const billDate = parseDateOnly(dto.billDate);
    const dueDate =
      type !== 'BILL'
        ? null
        : dto.dueDate
          ? parseDateOnly(dto.dueDate)
          : contact?.paymentTermsDays != null
            ? addDays(billDate, contact.paymentTermsDays)
            : null;
    if (dueDate && dueDate < billDate) throw invalid('dueDate', 'the due date cannot be before the bill date');

    const rates = new Map((await this.taxRates.findManyByIds([...new Set(dto.lines.map((l) => l.taxRateId))])).map((r) => [r.id, r]));
    dto.lines.forEach((l, i) => {
      const rate = rates.get(l.taxRateId);
      if (!rate || !rate.isActive) throw invalid(`lines[${i}].taxRateId`, 'tax rate not found or inactive');
    });
    await this.posting.assertPostable(
      dto.lines.map((l, i) => ({
        lineNo: i + 1,
        accountId: l.accountId,
        debit: new Decimal(0),
        credit: new Decimal(0),
        description: null,
        branchId: dto.branchId ?? null,
        costCenterId: l.costCenterId ?? null,
      })),
    );

    const inputTax = await this.inputTaxAccountId();
    const calc = calculateInvoice(
      dto.lines.map((l) => {
        const rate = rates.get(l.taxRateId)!;
        return {
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          tax: { accountId: inputTax, category: rate.category, percent: rate.rate.toString(), exemptionCode: rate.exemptionCode, exemptionReason: rate.exemptionReason },
        };
      }),
      currency,
      dto.pricesIncludeTax ?? false,
    );

    return {
      header: {
        contactId: contact?.id ?? null,
        supplierReference: dto.supplierReference ?? null,
        billDate,
        dueDate,
        currency,
        pricesIncludeTax: dto.pricesIncludeTax ?? false,
        originalBillId: dto.originalBillId ?? null,
        paidFromAccountId,
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
        branchId: dto.branchId ?? null,
        subtotal: calc.subtotal.toFixed(4),
        discountTotal: calc.discountTotal.toFixed(4),
        taxableAmount: calc.taxableAmount.toFixed(4),
        taxTotal: calc.taxTotal.toFixed(4),
        total: calc.total.toFixed(4),
      },
      lines: dto.lines.map((l, i) => {
        const rate = rates.get(l.taxRateId)!;
        const c = calc.lines[i]!;
        return {
          lineNo: i + 1,
          description: l.description.trim(),
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount ?? '0',
          taxRateId: rate.id,
          taxCategory: rate.category,
          taxPercent: rate.rate,
          exemptionCode: rate.exemptionCode,
          accountId: l.accountId,
          costCenterId: l.costCenterId ?? null,
          netAmount: c.netAmount.toFixed(4),
          taxAmount: c.taxAmount.toFixed(4),
          totalAmount: c.totalAmount.toFixed(4),
        };
      }),
    };
  }

  private assertCreditable(original: PurchaseBillDetail, contactId: string | null): void {
    if (original.type !== 'BILL' || original.status !== 'POSTED') throw invalid('originalBillId', 'a supplier credit must reference a posted bill');
    if (original.contactId !== contactId) throw invalid('contactId', 'a supplier credit must be for the same supplier as its bill');
  }

  private recalculate(doc: PurchaseBillDetail): InvoiceCalculation {
    return calculateInvoice(
      doc.lines.map((l) => ({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discount: l.discount.toString(),
        tax: { accountId: 'input', category: l.taxCategory, percent: l.taxPercent.toString(), exemptionCode: l.exemptionCode, exemptionReason: null },
      })),
      doc.currency,
      doc.pricesIncludeTax,
    );
  }

  private async journalLines(doc: PurchaseBillDetail, calc: InvoiceCalculation, number: string): Promise<JournalLineInput[]> {
    const scale = minorUnits(doc.currency);
    const debitSide = doc.type !== 'CREDIT_NOTE';
    const expenseSide = (amount: Decimal) => (debitSide ? { debit: amount.toFixed(scale) } : { credit: amount.toFixed(scale) });
    const counterSide = (amount: Decimal) => (debitSide ? { credit: amount.toFixed(scale) } : { debit: amount.toFixed(scale) });

    const counterAccount =
      doc.type === 'EXPENSE' ? doc.paidFromAccountId! : (await this.accounts.findBySystemKey(SystemAccount.ACCOUNTS_PAYABLE))?.id;
    if (!counterAccount) throw AppException.notFound('Accounts payable account');

    const byAccount = new Map<string, { accountId: string; costCenterId: string | null; amount: Decimal }>();
    doc.lines.forEach((line, i) => {
      const key = `${line.accountId}|${line.costCenterId ?? ''}`;
      const entry = byAccount.get(key) ?? { accountId: line.accountId, costCenterId: line.costCenterId, amount: new Decimal(0) };
      entry.amount = entry.amount.plus(calc.lines[i]!.netAmount);
      byAccount.set(key, entry);
    });
    const branchId = doc.branchId ?? undefined;
    return [
      ...[...byAccount.values()]
        .filter((e) => e.amount.greaterThan(0))
        .map((e) => ({ accountId: e.accountId, ...expenseSide(e.amount), description: number, branchId, costCenterId: e.costCenterId ?? undefined })),
      ...(calc.taxTotal.greaterThan(0) ? [{ accountId: await this.inputTaxAccountId(), ...expenseSide(calc.taxTotal), description: number, branchId }] : []),
      { accountId: counterAccount, ...counterSide(calc.total), description: number, branchId },
    ];
  }

  private async inputTaxAccountId(): Promise<string> {
    const account = await this.accounts.findBySystemKey(SystemAccount.VAT_INPUT);
    if (!account) throw AppException.notFound('VAT input account');
    return account.id;
  }

  private notEditable(): AppException {
    return new AppException(ErrorCode.DOCUMENT_NOT_EDITABLE, 'Posted documents cannot be changed; void or credit them instead');
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
