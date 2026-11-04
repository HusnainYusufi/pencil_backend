/**
 * Provider-level model of a ZATCA (FATOORA) e-invoice. Amounts are decimal
 * strings already rounded to the document currency; the XML builder only
 * formats them. Nothing here depends on Nest or the database.
 */

export type ZatcaEnvironment = 'SANDBOX' | 'SIMULATION' | 'PRODUCTION';

/** UNTDID 1001 subset used by ZATCA. */
export type ZatcaDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
/** Standard = B2B tax invoice (cleared); simplified = B2C (reported). */
export type ZatcaInvoiceKind = 'STANDARD' | 'SIMPLIFIED';
/** UNCL 5305: standard, zero-rated, exempt, out of scope. */
export type ZatcaTaxCategory = 'S' | 'Z' | 'E' | 'O';

export interface ZatcaAddress {
  street?: string | null;
  buildingNumber?: string | null;
  /** Plot / additional number of the national address. */
  additionalNumber?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  region?: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export interface ZatcaParty {
  name: string;
  vatNumber?: string | null;
  /** Other identification: CRN, MOM, MLS, 700, SAG, NAT, GCC, IQA, PAS, OTH, TIN. */
  idScheme?: string | null;
  idValue?: string | null;
  address?: ZatcaAddress | null;
}

export interface ZatcaLine {
  id: number;
  name: string;
  quantity: string;
  /** UN/ECE rec 20 unit code, e.g. PCE. */
  unitCode: string;
  /** Net unit price (tax exclusive). */
  unitPrice: string;
  /** Line allowance (discount) amount, tax exclusive. */
  discount: string;
  /** qty x price - discount. */
  netAmount: string;
  taxAmount: string;
  taxCategory: ZatcaTaxCategory;
  /** e.g. "15.00". */
  taxPercent: string;
}

export interface ZatcaTaxSubtotal {
  category: ZatcaTaxCategory;
  percent: string;
  taxableAmount: string;
  taxAmount: string;
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
}

export interface ZatcaTotals {
  lineExtension: string;
  taxExclusive: string;
  taxAmount: string;
  taxInclusive: string;
  allowanceTotal: string;
  prepaid: string;
  payable: string;
}

export interface ZatcaInvoice {
  documentType: ZatcaDocumentType;
  kind: ZatcaInvoiceKind;
  /** Seller's invoice number (cbc:ID). */
  number: string;
  uuid: string;
  /** YYYY-MM-DD and HH:mm:ss in the seller's time zone. */
  issueDate: string;
  issueTime: string;
  currency: string;
  /** Invoice counter value: gapless per EGS unit. */
  icv: number;
  /** Previous invoice hash (base64). */
  previousHash: string;
  /** Required on standard invoices (KSA-5). */
  supplyDate?: string | null;
  /** Credit / debit notes: the original invoice number. */
  billingReference?: string | null;
  /** Credit / debit notes: reason for issuance (KSA-10). */
  reason?: string | null;
  /** UNTDID 4461: 10 cash, 30 credit, 42 bank transfer, 48 card, 1 not defined. */
  paymentMeansCode: string;
  note?: string | null;
  seller: ZatcaParty;
  buyer?: ZatcaParty | null;
  lines: ZatcaLine[];
  taxSubtotals: ZatcaTaxSubtotal[];
  totals: ZatcaTotals;
}

/** Everything the signature needs from the EGS unit's certificate. */
export interface ZatcaSigningIdentity {
  privateKeyPem: string;
  /** Base64 DER certificate (as issued by ZATCA, no PEM armour). */
  certificate: string;
}

export interface SignedZatcaInvoice {
  xml: string;
  /** Base64 SHA-256 of the canonical invoice. Becomes the next PIH. */
  invoiceHash: string;
  /** Base64 TLV QR payload. */
  qr: string;
  signature: string;
}

/** PIH of the very first invoice of an EGS unit: base64(hex(sha256("0"))). */
export const FIRST_PREVIOUS_HASH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
