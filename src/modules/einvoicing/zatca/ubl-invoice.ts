import { Decimal, formatAmount } from '../../../common/helpers/money.js';
import { el, text, type XmlChild, type XmlNode } from './xml.js';
import type { ZatcaAddress, ZatcaInvoice, ZatcaParty, ZatcaTaxCategory } from './zatca.types.js';

export const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
} as const;

const TYPE_CODE = { INVOICE: '388', CREDIT_NOTE: '381', DEBIT_NOTE: '383' } as const;
/** KSA-2 transaction flags (7 positions); only the first two vary here. */
const SUBTYPE = { STANDARD: '0100000', SIMPLIFIED: '0200000' } as const;

export interface UblParts {
  /** Signature extension; omitted for hashing. */
  extensions?: XmlNode | null;
  /** QR payload; omitted for hashing. */
  qr?: string | null;
  /** Include the static cac:Signature block (omitted for hashing). */
  signatureReference: boolean;
}

/**
 * The UBL 2.1 invoice tree for ZATCA. Element order follows the UBL schema
 * sequence, which ZATCA validates strictly.
 */
export function buildInvoiceTree(invoice: ZatcaInvoice, parts: UblParts): XmlNode {
  const cur = invoice.currency;
  const amount = (name: string, value: string) => el(name, { currencyID: cur }, formatAmount(value, cur));
  const isNote = invoice.documentType !== 'INVOICE';

  return el(
    'Invoice',
    { xmlns: NS.invoice, 'xmlns:cac': NS.cac, 'xmlns:cbc': NS.cbc, 'xmlns:ext': NS.ext },
    parts.extensions,
    text('cbc:ProfileID', 'reporting:1.0'),
    text('cbc:ID', invoice.number),
    text('cbc:UUID', invoice.uuid),
    text('cbc:IssueDate', invoice.issueDate),
    text('cbc:IssueTime', invoice.issueTime),
    text('cbc:InvoiceTypeCode', TYPE_CODE[invoice.documentType], { name: SUBTYPE[invoice.kind] }),
    text('cbc:Note', invoice.note),
    text('cbc:DocumentCurrencyCode', cur),
    text('cbc:TaxCurrencyCode', cur),
    isNote && invoice.billingReference
      ? el('cac:BillingReference', {}, el('cac:InvoiceDocumentReference', {}, text('cbc:ID', invoice.billingReference)))
      : null,
    el('cac:AdditionalDocumentReference', {}, text('cbc:ID', 'ICV'), text('cbc:UUID', invoice.icv)),
    el(
      'cac:AdditionalDocumentReference',
      {},
      text('cbc:ID', 'PIH'),
      el('cac:Attachment', {}, text('cbc:EmbeddedDocumentBinaryObject', invoice.previousHash, { mimeCode: 'text/plain' })),
    ),
    parts.qr
      ? el(
          'cac:AdditionalDocumentReference',
          {},
          text('cbc:ID', 'QR'),
          el('cac:Attachment', {}, text('cbc:EmbeddedDocumentBinaryObject', parts.qr, { mimeCode: 'text/plain' })),
        )
      : null,
    parts.signatureReference
      ? el(
          'cac:Signature',
          {},
          text('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
          text('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
        )
      : null,
    el('cac:AccountingSupplierParty', {}, party(invoice.seller, true)),
    el('cac:AccountingCustomerParty', {}, invoice.buyer ? party(invoice.buyer, false) : null),
    invoice.supplyDate ? el('cac:Delivery', {}, text('cbc:ActualDeliveryDate', invoice.supplyDate)) : null,
    el(
      'cac:PaymentMeans',
      {},
      text('cbc:PaymentMeansCode', invoice.paymentMeansCode),
      isNote ? text('cbc:InstructionNote', invoice.reason) : null,
    ),
    el('cac:TaxTotal', {}, amount('cbc:TaxAmount', invoice.totals.taxAmount)),
    el(
      'cac:TaxTotal',
      {},
      amount('cbc:TaxAmount', invoice.totals.taxAmount),
      ...invoice.taxSubtotals.map((s) =>
        el(
          'cac:TaxSubtotal',
          {},
          amount('cbc:TaxableAmount', s.taxableAmount),
          amount('cbc:TaxAmount', s.taxAmount),
          taxCategory('cac:TaxCategory', s.category, s.percent, s.exemptionReasonCode, s.exemptionReason, true),
        ),
      ),
    ),
    el(
      'cac:LegalMonetaryTotal',
      {},
      amount('cbc:LineExtensionAmount', invoice.totals.lineExtension),
      amount('cbc:TaxExclusiveAmount', invoice.totals.taxExclusive),
      amount('cbc:TaxInclusiveAmount', invoice.totals.taxInclusive),
      amount('cbc:AllowanceTotalAmount', invoice.totals.allowanceTotal),
      amount('cbc:PrepaidAmount', invoice.totals.prepaid),
      amount('cbc:PayableAmount', invoice.totals.payable),
    ),
    ...invoice.lines.map((line) =>
      el(
        'cac:InvoiceLine',
        {},
        text('cbc:ID', line.id),
        text('cbc:InvoicedQuantity', new Decimal(line.quantity).toFixed(), { unitCode: line.unitCode }),
        amount('cbc:LineExtensionAmount', line.netAmount),
        new Decimal(line.discount).greaterThan(0)
          ? el(
              'cac:AllowanceCharge',
              {},
              text('cbc:ChargeIndicator', 'false'),
              text('cbc:AllowanceChargeReasonCode', '95'),
              text('cbc:AllowanceChargeReason', 'Discount'),
              amount('cbc:Amount', line.discount),
            )
          : null,
        el(
          'cac:TaxTotal',
          {},
          amount('cbc:TaxAmount', line.taxAmount),
          amount('cbc:RoundingAmount', new Decimal(line.netAmount).plus(line.taxAmount).toFixed()),
        ),
        el(
          'cac:Item',
          {},
          text('cbc:Name', line.name),
          taxCategory('cac:ClassifiedTaxCategory', line.taxCategory, line.taxPercent, null, null, false),
        ),
        el('cac:Price', {}, el('cbc:PriceAmount', { currencyID: cur }, new Decimal(line.unitPrice).toFixed())),
      ),
    ),
  );
}

function taxCategory(
  name: string,
  category: ZatcaTaxCategory,
  percent: string,
  exemptionCode: string | null | undefined,
  exemptionReason: string | null | undefined,
  withSchemeIds: boolean,
): XmlNode {
  const schemeId = (scheme: string): Record<string, string> =>
    withSchemeIds ? { schemeID: scheme, schemeAgencyID: '6' } : {};
  return el(
    name,
    {},
    text('cbc:ID', category, schemeId('UN/ECE 5305')),
    // Out-of-scope supplies carry no rate (EN 16931 BR-O-05 / BR-O-10).
    category === 'O' ? null : text('cbc:Percent', new Decimal(percent).toFixed(2)),
    category === 'S' ? null : text('cbc:TaxExemptionReasonCode', exemptionCode),
    category === 'S' ? null : text('cbc:TaxExemptionReason', exemptionReason),
    el('cac:TaxScheme', {}, text('cbc:ID', 'VAT', schemeId('UN/ECE 5153'))),
  );
}

function party(p: ZatcaParty, isSeller: boolean): XmlNode {
  return el(
    'cac:Party',
    {},
    p.idScheme && p.idValue ? el('cac:PartyIdentification', {}, text('cbc:ID', p.idValue, { schemeID: p.idScheme })) : null,
    p.address ? address(p.address) : null,
    isSeller || p.vatNumber
      ? el('cac:PartyTaxScheme', {}, text('cbc:CompanyID', p.vatNumber), el('cac:TaxScheme', {}, text('cbc:ID', 'VAT')))
      : null,
    el('cac:PartyLegalEntity', {}, text('cbc:RegistrationName', p.name)),
  );
}

function address(a: ZatcaAddress): XmlNode {
  const fields: XmlChild[] = [
    text('cbc:StreetName', a.street),
    text('cbc:BuildingNumber', a.buildingNumber),
    text('cbc:PlotIdentification', a.additionalNumber),
    text('cbc:CitySubdivisionName', a.district),
    text('cbc:CityName', a.city),
    text('cbc:PostalZone', a.postalCode),
    text('cbc:CountrySubentity', a.region),
    el('cac:Country', {}, text('cbc:IdentificationCode', a.country)),
  ];
  return el('cac:PostalAddress', {}, ...fields);
}
