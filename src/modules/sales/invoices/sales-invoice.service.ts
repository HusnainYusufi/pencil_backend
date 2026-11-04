import { Injectable, Logger } from '@nestjs/common';
import { addDays, parseDateOnly } from '../../../common/helpers/date.js';
import { Decimal, minorUnits } from '../../../common/helpers/money.js';
import type { Page } from '../../../common/helpers/pagination.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { Contact, Prisma } from '../../../generated/prisma/client.js';
import type { SalesDocumentType } from '../../../generated/prisma/enums.js';
import { AccountingContext } from '../../accounting/accounting-context.service.js';
import { SystemAccount } from '../../accounting/chart-of-accounts/system-accounts.js';
import type { JournalLineInput } from '../../accounting/journals/journal-rules.js';
import { PostingService } from '../../accounting/journals/posting.service.js';
import { AccountsRepository } from '../../accounting/repositories/accounts.repository.js';
import { NumberSeriesRepository } from '../../accounting/repositories/number-series.repository.js';
import { AuditService } from '../../audit/audit.service.js';
import { ContactsRepository } from '../../contacts/contacts.repository.js';
import { EInvoicingService } from '../../einvoicing/einvoicing.service.js';
import type { EInvoiceRequest, PartySnapshot } from '../../einvoicing/einvoicing.types.js';
import { buyerFromContact, sellerFromTenant } from '../../einvoicing/party.js';
import { TaxRatesRepository } from '../../tax/tax-rates.repository.js';
import { TenantsRepository } from '../../tenancy/repositories/tenants.repository.js';
import type { CreateSalesInvoiceDto, SalesInvoicesQueryDto, UpdateSalesInvoiceDto, VoidSalesInvoiceDto } from '../sales.dto.js';
import { calculateInvoice, type CalcLineInput, type InvoiceCalculation } from './invoice-calc.js';
import {
  SalesInvoicesRepository,
  type SalesInvoiceDetail,
  type SalesInvoiceHeader,
  type SalesInvoiceLineRow,
  type SalesInvoiceSummary,
} from './sales-invoices.repository.js';

export const DOCUMENT_PREFIX: Readonly<Record<SalesDocumentType, string>> = {
  INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

const DOCUMENT_LABEL: Readonly<Record<SalesDocumentType, string>> = {
  INVOICE: 'Invoice',
  CREDIT_NOTE: 'Credit note',
  DEBIT_NOTE: 'Debit note',
};

const invalid = (field: string, message: string) =>
  new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field, errors: [message] }]);

const formatNumber = (prefix: string, year: number, sequence: number) => `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;

/**
 * Sales documents: DRAFT (editable) -> ISSUED (numbered, posted, e-invoiced,
 * immutable) -> VOID (only when no authority accepted it and nothing is
 * settled). Corrections of accepted documents are credit / debit notes.
 *
 * Posting (invoice / debit note; a credit note mirrors it):
 *   Dr Accounts receivable      total
 *     Cr Revenue (per line)     net
 *     Cr Output tax (per rate)  tax
 */
@Injectable()
export class SalesInvoiceService {
  private readonly logger = new Logger(SalesInvoiceService.name);

  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly invoices: SalesInvoicesRepository,
    private readonly contacts: ContactsRepository,
    private readonly taxRates: TaxRatesRepository,
    private readonly accounts: AccountsRepository,
    private readonly numbers: NumberSeriesRepository,
    private readonly posting: PostingService,
    private readonly tenants: TenantsRepository,
    private readonly einvoicing: EInvoicingService,
    private readonly audit: AuditService,
  ) {}

  list(query: SalesInvoicesQueryDto): Promise<Page<SalesInvoiceSummary>> {
    return this.invoices.list({
      ...query,
      from: query.from ? parseDateOnly(query.from) : undefined,
      to: query.to ? parseDateOnly(query.to) : undefined,
    });
  }

  async get(id: string): Promise<SalesInvoiceDetail> {
    const doc = await this.invoices.findDetail(id);
    if (!doc) throw AppException.notFound('Sales document', id);
    return doc;
  }

  async create(dto: CreateSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    const type = dto.type ?? 'INVOICE';
    const id = await this.db.transaction(async () => {
      const { header, lines } = await this.prepare(dto, type);
      const created = await this.invoices.createDraft({ ...header, type, createdById: this.userId() }, lines);
      await this.audit.record({ action: 'sales_invoice.created', entityType: 'sales_invoice', entityId: created.id, metadata: { type } });
      return created.id;
    });
    return dto.issue ? this.issue(id) : this.get(id);
  }

  async update(id: string, dto: UpdateSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    await this.db.transaction(async () => {
      const current = await this.get(id);
      if (current.status !== 'DRAFT') throw this.notEditable(current);
      const { header, lines } = await this.prepare(dto, current.type);
      if (!(await this.invoices.replaceDraft(id, header, lines))) throw this.notEditable(current);
      await this.audit.record({ action: 'sales_invoice.updated', entityType: 'sales_invoice', entityId: id });
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const current = await this.get(id);
      if (!(await this.invoices.deleteDraft(id))) throw this.notEditable(current);
      await this.audit.record({ action: 'sales_invoice.deleted', entityType: 'sales_invoice', entityId: id });
    });
  }

  /**
   * Issues a draft in one transaction: number, ledger posting, e-invoice
   * signature (when the company is onboarded) and credit application. The
   * authority submission happens after commit; failures are retried.
   */
  async issue(id: string): Promise<SalesInvoiceDetail> {
    let einvoiceId: string | null = null;
    await this.db.transaction(async () => {
      const doc = await this.get(id);
      if (doc.status !== 'DRAFT') throw this.notEditable(doc);
      const profile = await this.accounting.profile();
      const tenant = await this.tenants.findById(profile.tenantId);
      if (!tenant) throw AppException.notFound('Tenant');

      if (doc.contact && !doc.contact.isActive) throw invalid('contactId', 'the customer is inactive');
      const original = doc.originalInvoiceId ? await this.get(doc.originalInvoiceId) : null;
      if (original) this.assertAdjustable(original, doc.contactId, doc.kind);

      const calc = this.recalculate(doc);
      if (!calc.total.greaterThan(0)) throw invalid('lines', 'the document total must be greater than zero');
      if (doc.type === 'CREDIT_NOTE' && original) {
        const alreadyCredited = new Decimal(await this.invoices.creditedTotal(original.id, doc.id));
        const remaining = new Decimal(original.total.toString()).minus(alreadyCredited);
        if (calc.total.greaterThan(remaining)) {
          throw invalid('lines', `the credit exceeds what remains creditable on ${original.number} (${remaining.toFixed(minorUnits(doc.currency))})`);
        }
      }

      const year = doc.issueDate.getUTCFullYear();
      const prefix = DOCUMENT_PREFIX[doc.type];
      const number = formatNumber(prefix, year, await this.numbers.next(prefix, year));
      const issuedAt = new Date();
      const seller = sellerFromTenant(tenant);
      const buyer = doc.contact ? buyerFromContact(doc.contact, tenant.country) : null;

      const journal = await this.posting.postDocument({
        date: doc.issueDate,
        source: 'SALES_INVOICE',
        sourceId: doc.id,
        reference: number,
        memo: `${DOCUMENT_LABEL[doc.type]} ${number}${buyer ? ` · ${buyer.name}` : ''}`.slice(0, 1000),
        currency: doc.currency,
        lines: await this.journalLines(doc, calc, number),
      });

      const einvoice = await this.einvoicing.prepare(this.toEInvoiceRequest(doc, calc, number, issuedAt, seller, buyer, original));
      einvoiceId = einvoice.documentId;

      const issued = await this.invoices.markIssued(doc.id, {
        number,
        issuedAt,
        issuedById: this.userId(),
        seller: seller as unknown as Prisma.InputJsonValue,
        buyer: (buyer ?? undefined) as unknown as Prisma.InputJsonValue,
        journalEntryId: journal.id,
        qrCode: einvoice.qr,
      });
      if (!issued) throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The document was issued or changed concurrently');

      if (doc.type === 'CREDIT_NOTE' && original) {
        const open = new Decimal(original.total.toString()).minus(original.amountPaid.toString()).minus(original.amountCredited.toString());
        const applied = Decimal.min(open, calc.total);
        if (applied.greaterThan(0)) {
          await this.invoices.adjustSettlement(original.id, 'amount_credited', applied.toFixed(4));
          await this.invoices.adjustSettlement(doc.id, 'amount_credited', applied.toFixed(4));
        }
      }

      await this.audit.record({
        action: 'sales_invoice.issued',
        entityType: 'sales_invoice',
        entityId: doc.id,
        metadata: { number, total: calc.total.toFixed(minorUnits(doc.currency)), einvoice: einvoiceId !== null },
      });
    });

    if (einvoiceId) {
      await this.einvoicing.submit(einvoiceId).catch((error: unknown) => {
        this.logger.error(`e-invoice submission for ${id} failed: ${(error as Error).message}`);
      });
    }
    return this.get(id);
  }

  /**
   * Cancels an issued document with a reversing journal. Allowed only while
   * nothing depends on it: no authority acceptance (pending or rejected only
   * after rejection), no payments, credits or adjustment notes.
   */
  async void(id: string, dto: VoidSalesInvoiceDto): Promise<SalesInvoiceDetail> {
    await this.db.transaction(async () => {
      const doc = await this.get(id);
      if (doc.status !== 'ISSUED') throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Only issued documents can be voided');
      if (doc.einvoice && doc.einvoice.status !== 'REJECTED') {
        throw new AppException(
          ErrorCode.DOCUMENT_NOT_VOIDABLE,
          doc.einvoice.status === 'PENDING'
            ? 'This document is awaiting the tax authority; void it only if it is rejected'
            : 'The tax authority accepted this document; issue a credit note instead',
        );
      }
      if (doc.adjustments.some((a) => a.status === 'ISSUED')) {
        throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Credit or debit notes reference this document; void them first');
      }
      if (new Decimal(doc.amountPaid.toString()).greaterThan(0)) {
        throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Payments are allocated to this document; void them first');
      }
      const credited = new Decimal(doc.amountCredited.toString());
      if (credited.greaterThan(0)) {
        if (doc.type !== 'CREDIT_NOTE' || !doc.originalInvoiceId) {
          throw new AppException(ErrorCode.DOCUMENT_NOT_VOIDABLE, 'Credit notes are applied to this document; void them first');
        }
        // Release this credit note's application from the original invoice.
        await this.invoices.adjustSettlement(doc.originalInvoiceId, 'amount_credited', credited.negated().toFixed(4));
        await this.invoices.adjustSettlement(doc.id, 'amount_credited', credited.negated().toFixed(4));
      }

      await this.posting.postReversal(doc.journalEntryId!, await this.accounting.today(), `Void of ${doc.number}`);
      if (!(await this.invoices.markVoid(doc.id, { voidedById: this.userId(), voidReason: dto.reason }))) {
        throw new AppException(ErrorCode.CONCURRENT_MODIFICATION, 'The document changed concurrently');
      }
      await this.audit.record({ action: 'sales_invoice.voided', entityType: 'sales_invoice', entityId: doc.id, metadata: { reason: dto.reason } });
    });
    return this.get(id);
  }

  /** The signed e-invoice XML (the authority-stamped copy once cleared). */
  async xml(id: string): Promise<{ filename: string; xml: string }> {
    const doc = await this.get(id);
    const einvoice = await this.einvoicing.findForInvoice(id);
    if (!einvoice) throw AppException.notFound('E-invoice for document', id);
    return { filename: `${doc.number ?? doc.id}.xml`, xml: einvoice.clearedXml ?? einvoice.xml };
  }

  async retrySubmission(id: string): Promise<SalesInvoiceDetail> {
    await this.get(id);
    await this.einvoicing.retryForInvoice(id);
    return this.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async prepare(
    dto: UpdateSalesInvoiceDto,
    type: SalesDocumentType,
  ): Promise<{ header: SalesInvoiceHeader; lines: SalesInvoiceLineRow[] }> {
    const { baseCurrency } = await this.accounting.profile();
    const currency = dto.currency ?? baseCurrency;
    if (currency !== baseCurrency) {
      throw invalid('currency', `documents are in the base currency (${baseCurrency}); multi-currency is coming`);
    }

    let contact: Contact | null = null;
    if (dto.contactId) {
      contact = await this.contacts.findById(dto.contactId);
      if (!contact) throw AppException.notFound('Contact', dto.contactId);
      if (!contact.isActive || !contact.isCustomer) throw invalid('contactId', 'choose an active customer');
    }
    const kind = dto.kind ?? (contact?.type === 'BUSINESS' ? 'STANDARD' : 'SIMPLIFIED');
    if (kind === 'STANDARD' && !contact) throw invalid('contactId', 'tax (standard) invoices need a customer');

    if (type === 'INVOICE') {
      if (dto.originalInvoiceId) throw invalid('originalInvoiceId', 'only credit and debit notes reference an invoice');
    } else {
      if (!dto.originalInvoiceId) throw invalid('originalInvoiceId', 'credit and debit notes must reference the original invoice');
      if (!dto.reason) throw invalid('reason', 'credit and debit notes need a reason');
      const original = await this.invoices.findDetail(dto.originalInvoiceId);
      if (!original) throw AppException.notFound('Original invoice', dto.originalInvoiceId);
      this.assertAdjustable(original, dto.contactId ?? null, kind);
    }

    const issueDate = parseDateOnly(dto.issueDate);
    const dueDate = dto.dueDate
      ? parseDateOnly(dto.dueDate)
      : contact?.paymentTermsDays != null
        ? addDays(issueDate, contact.paymentTermsDays)
        : null;
    if (dueDate && dueDate < issueDate) throw invalid('dueDate', 'the due date cannot be before the issue date');
    const supplyDate = dto.supplyDate ? parseDateOnly(dto.supplyDate) : issueDate;

    // Tax rates and accounts.
    const rateIds = [...new Set(dto.lines.map((l) => l.taxRateId))];
    const rates = new Map((await this.taxRates.findManyByIds(rateIds)).map((r) => [r.id, r]));
    dto.lines.forEach((l, i) => {
      const rate = rates.get(l.taxRateId);
      if (!rate) throw invalid(`lines[${i}].taxRateId`, 'tax rate not found');
      if (!rate.isActive) throw invalid(`lines[${i}].taxRateId`, 'tax rate is inactive');
    });
    const salesAccount = await this.accounts.findBySystemKey(SystemAccount.SALES);
    if (!salesAccount) throw AppException.notFound('Sales account');
    const accountOf = (i: number) => dto.lines[i]!.accountId ?? salesAccount.id;
    await this.posting.assertPostable(
      dto.lines.map((l, i) => ({
        lineNo: i + 1,
        accountId: accountOf(i),
        debit: new Decimal(0),
        credit: new Decimal(0),
        description: null,
        branchId: dto.branchId ?? null,
        costCenterId: l.costCenterId ?? null,
      })),
    );

    const calc = calculateInvoice(
      dto.lines.map((l): CalcLineInput => {
        const rate = rates.get(l.taxRateId)!;
        return {
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          tax: {
            accountId: rate.accountId,
            category: rate.category,
            percent: rate.rate.toString(),
            exemptionCode: rate.exemptionCode,
            exemptionReason: rate.exemptionReason,
          },
        };
      }),
      currency,
      dto.pricesIncludeTax ?? false,
    );

    const header: SalesInvoiceHeader = {
      kind,
      contactId: contact?.id ?? null,
      issueDate,
      dueDate,
      supplyDate,
      currency,
      pricesIncludeTax: dto.pricesIncludeTax ?? false,
      paymentMeans: dto.paymentMeans ?? 'CREDIT',
      originalInvoiceId: dto.originalInvoiceId ?? null,
      reason: dto.reason ?? null,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
      terms: dto.terms ?? null,
      branchId: dto.branchId ?? null,
      subtotal: calc.subtotal.toFixed(4),
      discountTotal: calc.discountTotal.toFixed(4),
      taxableAmount: calc.taxableAmount.toFixed(4),
      taxTotal: calc.taxTotal.toFixed(4),
      total: calc.total.toFixed(4),
    };
    const lines: SalesInvoiceLineRow[] = dto.lines.map((l, i) => {
      const rate = rates.get(l.taxRateId)!;
      const c = calc.lines[i]!;
      return {
        lineNo: i + 1,
        description: l.description.trim(),
        quantity: l.quantity,
        unitCode: l.unitCode ?? 'PCE',
        unitPrice: l.unitPrice,
        discount: l.discount ?? '0',
        taxRateId: rate.id,
        taxCategory: rate.category,
        taxPercent: rate.rate,
        exemptionCode: rate.exemptionCode,
        exemptionReason: rate.exemptionReason,
        accountId: accountOf(i),
        costCenterId: l.costCenterId ?? null,
        netAmount: c.netAmount.toFixed(4),
        taxAmount: c.taxAmount.toFixed(4),
        totalAmount: c.totalAmount.toFixed(4),
      };
    });
    return { header, lines };
  }

  /** A note may adjust only an issued invoice of the same customer and kind. */
  private assertAdjustable(original: SalesInvoiceDetail, contactId: string | null, kind: string): void {
    if (original.type !== 'INVOICE' || original.status !== 'ISSUED') {
      throw invalid('originalInvoiceId', 'credit and debit notes must reference an issued invoice');
    }
    if ((original.contactId ?? null) !== (contactId ?? null)) {
      throw invalid('contactId', 'a note must be for the same customer as its invoice');
    }
    if (original.kind !== kind) throw invalid('kind', 'a note must be of the same kind (standard / simplified) as its invoice');
  }

  /** Recomputes amounts from the stored lines (the source of truth at issue). */
  private recalculate(doc: SalesInvoiceDetail): InvoiceCalculation {
    return calculateInvoice(
      doc.lines.map((l) => ({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discount: l.discount.toString(),
        tax: {
          accountId: l.taxRate.accountId,
          category: l.taxCategory,
          percent: l.taxPercent.toString(),
          exemptionCode: l.exemptionCode,
          exemptionReason: l.exemptionReason,
        },
      })),
      doc.currency,
      doc.pricesIncludeTax,
    );
  }

  private async journalLines(doc: SalesInvoiceDetail, calc: InvoiceCalculation, number: string): Promise<JournalLineInput[]> {
    const receivable = await this.accounts.findBySystemKey(SystemAccount.ACCOUNTS_RECEIVABLE);
    if (!receivable) throw AppException.notFound('Accounts receivable account');
    const scale = minorUnits(doc.currency);
    const credit = doc.type !== 'CREDIT_NOTE';
    const side = (amount: Decimal) =>
      credit ? { credit: amount.toFixed(scale) } : { debit: amount.toFixed(scale) };
    const counterSide = (amount: Decimal) =>
      credit ? { debit: amount.toFixed(scale) } : { credit: amount.toFixed(scale) };

    const revenue = new Map<string, { accountId: string; costCenterId: string | null; amount: Decimal }>();
    doc.lines.forEach((line, i) => {
      const key = `${line.accountId}|${line.costCenterId ?? ''}`;
      const entry = revenue.get(key) ?? { accountId: line.accountId, costCenterId: line.costCenterId, amount: new Decimal(0) };
      entry.amount = entry.amount.plus(calc.lines[i]!.netAmount);
      revenue.set(key, entry);
    });
    const tax = new Map<string, Decimal>();
    for (const subtotal of calc.subtotals) {
      for (const part of subtotal.byAccount) tax.set(part.accountId, (tax.get(part.accountId) ?? new Decimal(0)).plus(part.amount));
    }

    const branchId = doc.branchId ?? undefined;
    return [
      { accountId: receivable.id, ...counterSide(calc.total), description: number, branchId },
      ...[...revenue.values()]
        .filter((r) => r.amount.greaterThan(0))
        .map((r) => ({ accountId: r.accountId, ...side(r.amount), description: number, branchId, costCenterId: r.costCenterId ?? undefined })),
      ...[...tax.entries()]
        .filter(([, amount]) => amount.greaterThan(0))
        .map(([accountId, amount]) => ({ accountId, ...side(amount), description: number, branchId })),
    ];
  }

  private toEInvoiceRequest(
    doc: SalesInvoiceDetail,
    calc: InvoiceCalculation,
    number: string,
    issuedAt: Date,
    seller: PartySnapshot,
    buyer: PartySnapshot | null,
    original: SalesInvoiceDetail | null,
  ): EInvoiceRequest {
    return {
      invoiceId: doc.id,
      uuid: doc.uuid,
      type: doc.type,
      kind: doc.kind,
      number,
      issueDate: doc.issueDate,
      issuedAt,
      supplyDate: doc.supplyDate,
      currency: doc.currency,
      billingReference: original?.number ?? null,
      reason: doc.reason,
      paymentMeans: doc.paymentMeans,
      notes: doc.notes,
      seller,
      buyer,
      lines: doc.lines.map((l, i) => {
        const c = calc.lines[i]!;
        return {
          lineNo: l.lineNo,
          description: l.description,
          quantity: c.quantity,
          unitCode: l.unitCode,
          unitPriceNet: c.unitPriceNet,
          discount: c.discount,
          netAmount: c.netAmount,
          taxAmount: c.taxAmount,
          category: l.taxCategory,
          percent: new Decimal(l.taxPercent.toString()),
        };
      }),
      subtotals: calc.subtotals.map((s) => ({
        category: s.category,
        percent: s.percent,
        exemptionCode: s.exemptionCode,
        exemptionReason: s.exemptionReason,
        taxableAmount: s.taxableAmount,
        taxAmount: s.taxAmount,
      })),
      taxableAmount: calc.taxableAmount,
      taxTotal: calc.taxTotal,
      total: calc.total,
    };
  }

  private notEditable(doc: { number: string | null; status: string }): AppException {
    return new AppException(
      ErrorCode.DOCUMENT_NOT_EDITABLE,
      `Sales document ${doc.number ?? ''} is ${doc.status.toLowerCase()}; issued documents are corrected with credit or debit notes`.replace('  ', ' '),
    );
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
