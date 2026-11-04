import { formatDateOnly } from '../../common/helpers/date.js';
import { Decimal, formatAmount } from '../../common/helpers/money.js';
import type { PurchaseBillDetail, PurchaseBillSummary, SupplierPaymentDetail } from './purchases.repositories.js';

const money = (v: { toString(): string }, c: string) => formatAmount(v.toString(), c);
const date = (d: Date | null) => (d ? formatDateOnly(d) : null);

export function toPurchaseSummary(b: PurchaseBillSummary) {
  const c = b.currency;
  const balance = new Decimal(b.total.toString()).minus(b.amountPaid.toString()).minus(b.amountCredited.toString());
  return {
    id: b.id,
    type: b.type,
    status: b.status,
    number: b.number,
    supplierReference: b.supplierReference,
    contact: b.contact,
    billDate: date(b.billDate),
    dueDate: date(b.dueDate),
    currency: c,
    taxTotal: money(b.taxTotal, c),
    total: money(b.total, c),
    amountPaid: money(b.amountPaid, c),
    amountCredited: money(b.amountCredited, c),
    balanceDue: formatAmount(balance, c),
    postedAt: b.postedAt,
    createdAt: b.createdAt,
  };
}

export function toPurchaseDetail(b: PurchaseBillDetail) {
  const c = b.currency;
  return {
    ...toPurchaseSummary({ ...b, contact: b.contact && { id: b.contact.id, name: b.contact.name, nameAr: b.contact.nameAr } }),
    pricesIncludeTax: b.pricesIncludeTax,
    reason: b.reason,
    notes: b.notes,
    subtotal: money(b.subtotal, c),
    discountTotal: money(b.discountTotal, c),
    taxableAmount: money(b.taxableAmount, c),
    supplier: b.supplier,
    paidFrom: b.paidFrom,
    originalBill: b.originalBill && { id: b.originalBill.id, number: b.originalBill.number, billDate: date(b.originalBill.billDate), total: money(b.originalBill.total, c) },
    adjustments: b.adjustments.map((a) => ({ id: a.id, type: a.type, number: a.number, status: a.status, billDate: date(a.billDate), total: money(a.total, c) })),
    payments: b.allocations.map((a) => ({ id: a.payment.id, number: a.payment.number, date: date(a.payment.date), amount: money(a.amount, c) })),
    journalEntry: b.journalEntry,
    voidedAt: b.voidedAt,
    voidReason: b.voidReason,
    lines: b.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      description: l.description,
      quantity: new Decimal(l.quantity.toString()).toFixed(),
      unitPrice: new Decimal(l.unitPrice.toString()).toFixed(),
      discount: money(l.discount, c),
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
      taxPercent: new Decimal(l.taxPercent.toString()).toFixed(2),
      account: l.account,
      costCenter: l.costCenter,
      netAmount: money(l.netAmount, c),
      taxAmount: money(l.taxAmount, c),
      totalAmount: money(l.totalAmount, c),
    })),
  };
}

export function toSupplierPayment(p: SupplierPaymentDetail) {
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
      bill: { id: a.bill.id, number: a.bill.number, supplierReference: a.bill.supplierReference, billDate: date(a.bill.billDate), total: money(a.bill.total, c) },
      amount: money(a.amount, c),
    })),
    voidedAt: p.voidedAt,
    createdAt: p.createdAt,
  };
}
