import { formatDateOnly } from '../../../common/helpers/date.js';
import type { FieldError } from '../../../core/http/validation.js';
import type { PaymentMeans, TaxCategory } from '../../../generated/prisma/enums.js';
import type { EInvoiceRequest, PartySnapshot } from '../einvoicing.types.js';
import type { ZatcaInvoice, ZatcaParty, ZatcaTaxCategory } from './zatca.types.js';

const CATEGORY: Readonly<Record<TaxCategory, ZatcaTaxCategory>> = {
  STANDARD: 'S',
  ZERO_RATED: 'Z',
  EXEMPT: 'E',
  OUT_OF_SCOPE: 'O',
};

/** UNTDID 4461. */
const PAYMENT_MEANS: Readonly<Record<PaymentMeans, string>> = {
  CASH: '10',
  CREDIT: '30',
  BANK_TRANSFER: '42',
  CARD: '48',
  OTHER: '1',
};

/** Exemptions that require the buyer's national ID (BR-KSA-49). */
const NATIONAL_ID_EXEMPTIONS = new Set(['VATEX-SA-EDU', 'VATEX-SA-HEA']);
const SELLER_ID_SCHEMES = new Set(['CRN', 'MOM', 'MLS', '700', 'SAG', 'OTH']);

/** `HH:mm:ss` of an instant in a time zone. */
export function localTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

function toParty(p: PartySnapshot): ZatcaParty {
  return {
    name: p.name,
    vatNumber: p.vatNumber,
    idScheme: p.idScheme,
    idValue: p.idNumber,
    address: p.address,
  };
}

export function toZatcaInvoice(
  req: EInvoiceRequest,
  chain: { icv: number; previousHash: string },
  timeZone: string,
): ZatcaInvoice {
  const money = (d: { toFixed(): string }) => d.toFixed();
  return {
    documentType: req.type,
    kind: req.kind,
    number: req.number,
    uuid: req.uuid,
    issueDate: formatDateOnly(req.issueDate),
    issueTime: localTime(req.issuedAt, timeZone),
    currency: req.currency,
    icv: chain.icv,
    previousHash: chain.previousHash,
    supplyDate: req.supplyDate ? formatDateOnly(req.supplyDate) : null,
    billingReference: req.billingReference,
    reason: req.reason,
    paymentMeansCode: PAYMENT_MEANS[req.paymentMeans],
    note: req.notes,
    seller: toParty(req.seller),
    buyer: req.buyer ? toParty(req.buyer) : null,
    lines: req.lines.map((l) => ({
      id: l.lineNo,
      name: l.description,
      quantity: l.quantity.toFixed(),
      unitCode: l.unitCode,
      unitPrice: l.unitPriceNet.toFixed(),
      discount: money(l.discount),
      netAmount: money(l.netAmount),
      taxAmount: money(l.taxAmount),
      taxCategory: CATEGORY[l.category],
      taxPercent: l.percent.toFixed(2),
    })),
    taxSubtotals: req.subtotals.map((s) => ({
      category: CATEGORY[s.category],
      percent: s.percent.toFixed(2),
      taxableAmount: money(s.taxableAmount),
      taxAmount: money(s.taxAmount),
      exemptionReasonCode: s.exemptionCode,
      exemptionReason: s.exemptionReason,
    })),
    totals: {
      lineExtension: money(req.taxableAmount),
      taxExclusive: money(req.taxableAmount),
      taxAmount: money(req.taxTotal),
      taxInclusive: money(req.total),
      allowanceTotal: '0',
      prepaid: '0',
      payable: money(req.total),
    },
  };
}

/** Company-profile requirements for ZATCA (checked at onboarding and on every document). */
export function validateSellerForZatca(s: PartySnapshot): FieldError[] {
  const errors: FieldError[] = [];
  const need = (value: unknown, field: string, message: string) => {
    if (value === null || value === undefined || value === '') errors.push({ field, errors: [message] });
  };
  need(s.vatNumber, 'company.taxNumber', 'the company VAT number is required for ZATCA e-invoicing');
  if (s.vatNumber && !/^3\d{13}3$/.test(s.vatNumber)) errors.push({ field: 'company.taxNumber', errors: ['VAT number must be 15 digits starting and ending with 3'] });
  if (!s.idScheme || !SELLER_ID_SCHEMES.has(s.idScheme) || !s.idNumber) {
    errors.push({ field: 'company.commercialRegistration', errors: ['the commercial registration number is required for ZATCA e-invoicing'] });
  }
  need(s.address?.street, 'company.addressStreet', 'street is required');
  need(s.address?.district, 'company.addressDistrict', 'district is required');
  need(s.address?.city, 'company.addressCity', 'city is required');
  if (!/^\d{4}$/.test(s.address?.buildingNumber ?? '')) errors.push({ field: 'company.addressBuildingNumber', errors: ['building number must be 4 digits'] });
  if (!/^\d{5}$/.test(s.address?.postalCode ?? '')) errors.push({ field: 'company.addressPostalCode', errors: ['postal code must be 5 digits'] });
  return errors;
}

/**
 * ZATCA business rules we can check before signing, reported as field errors
 * the user can fix (company profile, customer card or the document).
 */
export function validateForZatca(req: EInvoiceRequest): FieldError[] {
  const errors: FieldError[] = validateSellerForZatca(req.seller);
  const need = (value: unknown, field: string, message: string) => {
    if (value === null || value === undefined || value === '') errors.push({ field, errors: [message] });
  };

  if (req.type !== 'INVOICE') {
    need(req.billingReference, 'originalInvoiceId', 'credit and debit notes must reference the original invoice');
    need(req.reason, 'reason', 'credit and debit notes need a reason');
  }

  const b = req.buyer;
  if (req.kind === 'STANDARD') {
    need(req.supplyDate, 'supplyDate', 'the supply date is required on tax invoices');
    if (!b) {
      errors.push({ field: 'contactId', errors: ['tax invoices need a customer'] });
    } else {
      if (!b.vatNumber && !(b.idScheme && b.idNumber)) {
        errors.push({ field: 'customer.taxNumber', errors: ['the customer needs a VAT number or another identification (e.g. CRN)'] });
      }
      if ((b.address?.country ?? 'SA') === 'SA') {
        need(b.address?.street, 'customer.addressStreet', 'customer street is required');
        need(b.address?.buildingNumber, 'customer.addressBuildingNumber', 'customer building number is required');
        need(b.address?.district, 'customer.addressDistrict', 'customer district is required');
        need(b.address?.city, 'customer.addressCity', 'customer city is required');
        need(b.address?.postalCode, 'customer.addressPostalCode', 'customer postal code is required');
      } else {
        need(b.address?.city, 'customer.addressCity', 'customer city is required');
      }
    }
  }

  if (req.subtotals.some((t) => t.exemptionCode && NATIONAL_ID_EXEMPTIONS.has(t.exemptionCode)) && b?.idScheme !== 'NAT') {
    errors.push({ field: 'customer.idNumber', errors: ['private education / healthcare zero-rating needs the customer national ID (NAT)'] });
  }
  for (const t of req.subtotals) {
    if (t.category !== 'STANDARD' && (!t.exemptionCode || !t.exemptionReason)) {
      errors.push({ field: 'lines', errors: [`${t.category} lines need a ZATCA exemption code and reason on their tax rate`] });
    }
  }
  if (req.currency !== 'SAR') errors.push({ field: 'currency', errors: ['ZATCA e-invoices are issued in SAR'] });
  if (!req.total.greaterThan(0)) errors.push({ field: 'lines', errors: ['the document total must be greater than zero'] });
  return errors;
}

/** The QR ZATCA stamped on a cleared invoice. */
export function extractQr(xml: string): string | null {
  const match = /<cbc:ID>\s*QR\s*<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(xml);
  return match?.[1]?.trim() ?? null;
}
