import { randomUUID } from 'node:crypto';
import { hashInvoice, signInvoice } from './signing.js';
import type {
  SignedZatcaInvoice,
  ZatcaDocumentType,
  ZatcaInvoice,
  ZatcaInvoiceKind,
  ZatcaParty,
  ZatcaSigningIdentity,
} from './zatca.types.js';
import { FIRST_PREVIOUS_HASH } from './zatca.types.js';

export interface ComplianceSample {
  label: string;
  invoice: ZatcaInvoice;
  signed: SignedZatcaInvoice;
}

const SAMPLE_BUYER: ZatcaParty = {
  name: 'Compliance Check Buyer',
  vatNumber: '399999999800003',
  address: {
    street: 'Prince Sultan',
    buildingNumber: '2322',
    district: 'Al-Murabba',
    city: 'Riyadh',
    postalCode: '23333',
    country: 'SA',
  },
};

/**
 * The documents ZATCA requires before it issues a production CSID: one
 * invoice, credit note and debit note per invoice kind the unit is
 * onboarded for. They run on their own throwaway ICV/PIH chain.
 */
export function buildComplianceSamples(args: {
  seller: ZatcaParty;
  kinds: readonly ZatcaInvoiceKind[];
  identity: ZatcaSigningIdentity;
  issueDate: string;
  issueTime: string;
}): ComplianceSample[] {
  const samples: ComplianceSample[] = [];
  let previousHash = FIRST_PREVIOUS_HASH;
  let icv = 0;

  for (const kind of args.kinds) {
    const prefix = kind === 'STANDARD' ? 'STD' : 'SMP';
    const invoiceNumber = `CHK-${prefix}-INV-1`;
    const types: ZatcaDocumentType[] = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
    for (const documentType of types) {
      icv += 1;
      const invoice: ZatcaInvoice = {
        documentType,
        kind,
        number: documentType === 'INVOICE' ? invoiceNumber : `CHK-${prefix}-${documentType === 'CREDIT_NOTE' ? 'CN' : 'DN'}-1`,
        uuid: randomUUID(),
        issueDate: args.issueDate,
        issueTime: args.issueTime,
        currency: 'SAR',
        icv,
        previousHash,
        supplyDate: args.issueDate,
        billingReference: documentType === 'INVOICE' ? null : invoiceNumber,
        reason: documentType === 'INVOICE' ? null : 'Compliance check adjustment',
        paymentMeansCode: '10',
        seller: args.seller,
        buyer: kind === 'STANDARD' ? SAMPLE_BUYER : null,
        lines: [
          {
            id: 1,
            name: 'Compliance check item',
            quantity: '1',
            unitCode: 'PCE',
            unitPrice: '100.00',
            discount: '0',
            netAmount: '100.00',
            taxAmount: '15.00',
            taxCategory: 'S',
            taxPercent: '15',
          },
        ],
        taxSubtotals: [{ category: 'S', percent: '15', taxableAmount: '100.00', taxAmount: '15.00' }],
        totals: {
          lineExtension: '100.00',
          taxExclusive: '100.00',
          taxAmount: '15.00',
          taxInclusive: '115.00',
          allowanceTotal: '0',
          prepaid: '0',
          payable: '115.00',
        },
      };
      const signed = signInvoice(invoice, args.identity);
      previousHash = hashInvoice(invoice);
      samples.push({ label: `${kind.toLowerCase()} ${documentType.toLowerCase().replace('_', ' ')}`, invoice, signed });
    }
  }
  return samples;
}
