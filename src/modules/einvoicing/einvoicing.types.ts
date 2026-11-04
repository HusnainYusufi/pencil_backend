import type { Decimal } from '../../common/helpers/money.js';
import type {
  ContactType,
  InvoiceKind,
  PaymentMeans,
  SalesDocumentType,
  TaxCategory,
} from '../../generated/prisma/enums.js';

/**
 * Contract between document modules (sales today) and e-invoicing. Country
 * neutral: each provider maps it to its authority's format.
 */

export interface PartyAddress {
  street: string | null;
  buildingNumber: string | null;
  additionalNumber: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/** A party as printed on a document (frozen on the document at issue). */
export interface PartySnapshot {
  type: ContactType;
  name: string;
  nameAr: string | null;
  vatNumber: string | null;
  /** CRN, NAT, PAS, ... */
  idScheme: string | null;
  idNumber: string | null;
  address: PartyAddress | null;
  email: string | null;
  phone: string | null;
}

export interface EInvoiceLine {
  lineNo: number;
  description: string;
  quantity: Decimal;
  unitCode: string;
  unitPriceNet: Decimal;
  discount: Decimal;
  netAmount: Decimal;
  taxAmount: Decimal;
  category: TaxCategory;
  percent: Decimal;
}

export interface EInvoiceSubtotal {
  category: TaxCategory;
  percent: Decimal;
  exemptionCode: string | null;
  exemptionReason: string | null;
  taxableAmount: Decimal;
  taxAmount: Decimal;
}

export interface EInvoiceRequest {
  invoiceId: string;
  uuid: string;
  type: SalesDocumentType;
  kind: InvoiceKind;
  number: string;
  issueDate: Date;
  /** Exact issue instant (the time printed and signed). */
  issuedAt: Date;
  supplyDate: Date | null;
  currency: string;
  /** Credit / debit notes. */
  billingReference: string | null;
  reason: string | null;
  paymentMeans: PaymentMeans;
  notes: string | null;
  seller: PartySnapshot;
  buyer: PartySnapshot | null;
  lines: EInvoiceLine[];
  subtotals: EInvoiceSubtotal[];
  taxableAmount: Decimal;
  taxTotal: Decimal;
  total: Decimal;
}

export interface EInvoicePreparation {
  /** QR payload to print, if the country uses one. */
  qr: string | null;
  /** Submission record when the document goes to an authority. */
  documentId: string | null;
}
