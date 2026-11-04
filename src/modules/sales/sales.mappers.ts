import { formatDateOnly } from '../../common/helpers/date.js';
import { Decimal, formatAmount } from '../../common/helpers/money.js';
import type { CustomerPaymentDetail } from './payments/customer-payments.repository.js';
import type { SalesInvoiceDetail, SalesInvoiceSummary } from './invoices/sales-invoices.repository.js';

/** API shapes: dates `YYYY-MM-DD`, money as fixed-scale strings in the document currency. */
const money = (value: { toString(): string }, currency: string) => formatAmount(value.toString(), currency);
const date = (value: Date | null) => (value ? formatDateOnly(value) : null);

function balanceDue(doc: { total: { toString(): string }; amountPaid: { toString(): string }; amountCredited: { toString(): string } }) {
  return new Decimal(doc.total.toString()).minus(doc.amountPaid.toString()).minus(doc.amountCredited.toString());
}

export function toSalesInvoiceSummary(doc: SalesInvoiceSummary) {
  const c = doc.currency;
  return {
    id: doc.id,
    type: doc.type,
    kind: doc.kind,
    status: doc.status,
    number: doc.number,
    contact: doc.contact,
    issueDate: date(doc.issueDate),
    dueDate: date(doc.dueDate),
    currency: c,
    taxTotal: money(doc.taxTotal, c),
    total: money(doc.total, c),
    amountPaid: money(doc.amountPaid, c),
    amountCredited: money(doc.amountCredited, c),
    balanceDue: formatAmount(balanceDue(doc), c),
    einvoiceStatus: doc.einvoice?.status ?? null,
    reference: doc.reference,
    issuedAt: doc.issuedAt,
    createdAt: doc.createdAt,
  };
}

export function toSalesInvoiceDetail(doc: SalesInvoiceDetail) {
  const c = doc.currency;
  return {
    ...toSalesInvoiceSummary({ ...doc, contact: doc.contact && { id: doc.contact.id, name: doc.contact.name, nameAr: doc.contact.nameAr }, einvoice: doc.einvoice && { status: doc.einvoice.status } }),
    uuid: doc.uuid,
    supplyDate: date(doc.supplyDate),
    pricesIncludeTax: doc.pricesIncludeTax,
    paymentMeans: doc.paymentMeans,
    reason: doc.reason,
    notes: doc.notes,
    terms: doc.terms,
    branch: doc.branch,
    subtotal: money(doc.subtotal, c),
    discountTotal: money(doc.discountTotal, c),
    taxableAmount: money(doc.taxableAmount, c),
    seller: doc.seller,
    buyer: doc.buyer,
    /** QR to print: the authority-stamped one when available. */
    qrCode: doc.einvoice?.qr ?? doc.qrCode,
    originalInvoice: doc.originalInvoice && {
      id: doc.originalInvoice.id,
      number: doc.originalInvoice.number,
      issueDate: date(doc.originalInvoice.issueDate),
      total: money(doc.originalInvoice.total, c),
    },
    adjustments: doc.adjustments.map((a) => ({ id: a.id, type: a.type, number: a.number, status: a.status, issueDate: date(a.issueDate), total: money(a.total, c) })),
    payments: doc.allocations.map((a) => ({ id: a.payment.id, number: a.payment.number, date: date(a.payment.date), amount: money(a.amount, c) })),
    journalEntry: doc.journalEntry,
    einvoice: doc.einvoice && {
      provider: doc.einvoice.provider,
      submissionType: doc.einvoice.submissionType,
      status: doc.einvoice.status,
      icv: doc.einvoice.icv,
      invoiceHash: doc.einvoice.invoiceHash,
      warnings: doc.einvoice.warnings,
      errors: doc.einvoice.errors,
      attempts: doc.einvoice.attempts,
      lastAttemptAt: doc.einvoice.lastAttemptAt,
      nextAttemptAt: doc.einvoice.nextAttemptAt,
      acceptedAt: doc.einvoice.acceptedAt,
    },
    voidedAt: doc.voidedAt,
    voidReason: doc.voidReason,
    lines: doc.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      description: l.description,
      quantity: new Decimal(l.quantity.toString()).toFixed(),
      unitCode: l.unitCode,
      unitPrice: new Decimal(l.unitPrice.toString()).toFixed(),
      discount: money(l.discount, c),
      taxRate: { id: l.taxRate.id, code: l.taxRate.code, name: l.taxRate.name, nameAr: l.taxRate.nameAr },
      taxCategory: l.taxCategory,
      taxPercent: new Decimal(l.taxPercent.toString()).toFixed(2),
      exemptionCode: l.exemptionCode,
      account: l.account,
      costCenter: l.costCenter,
      netAmount: money(l.netAmount, c),
      taxAmount: money(l.taxAmount, c),
      totalAmount: money(l.totalAmount, c),
    })),
    updatedAt: doc.updatedAt,
  };
}

export function toCustomerPayment(p: CustomerPaymentDetail) {
  const c = p.currency;
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    date: date(p.date),
    contact: p.contact,
    account: p.account,
    currency: c,
    amount: money(p.amount, c),
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    journalEntry: p.journalEntry,
    allocations: p.allocations.map((a) => ({
      invoice: { id: a.invoice.id, number: a.invoice.number, type: a.invoice.type, issueDate: date(a.invoice.issueDate), total: money(a.invoice.total, c) },
      amount: money(a.amount, c),
    })),
    voidedAt: p.voidedAt,
    createdAt: p.createdAt,
  };
}
