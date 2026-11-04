import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization } from 'xml-crypto';
import { inspectCertificate } from './certificate.js';
import { buildComplianceSamples } from './compliance-samples.js';
import { buildCsr, CERTIFICATE_TEMPLATE } from './csr.js';
import { bitString, children, contextTag, integer, oid, readNode, sequence, set, tlv, utf8 } from './der.js';
import { parseQr } from './qr.js';
import { canonicalInvoice, hashInvoice, phaseOneQr, signInvoice } from './signing.js';
import { extractQr } from './zatca-mapper.js';
import { FIRST_PREVIOUS_HASH, type ZatcaInvoice } from './zatca.types.js';

/** Minimal self-signed X.509 (ECDSA secp256k1) so signing can be tested offline. */
function selfSignedCertificate(privateKey: KeyObject): string {
  const name = sequence(
    set(sequence(oid('0.9.2342.19200300.100.1.25'), tlv(0x16, Buffer.from('local')))),
    set(sequence(oid('0.9.2342.19200300.100.1.25'), tlv(0x16, Buffer.from('gov')))),
    set(sequence(oid('2.5.4.3'), utf8('Test-SubCA'))),
  );
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const time = (s: string) => tlv(0x17, Buffer.from(s, 'ascii'));
  const tbs = sequence(
    contextTag(0, integer(2)),
    tlv(0x02, Buffer.from([0x01, 0x2c])),
    algorithm,
    name,
    sequence(time('260101000000Z'), time('360101000000Z')),
    name,
    createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
  );
  return sequence(tbs, algorithm, bitString(sign('sha256', tbs, privateKey))).toString('base64');
}

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const identity = {
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  certificate: selfSignedCertificate(privateKey),
};

const seller = {
  name: 'شركة القلم & Co <Test>',
  vatNumber: '399999999900003',
  idScheme: 'CRN',
  idValue: '1010010000',
  address: { street: 'King Fahd Rd', buildingNumber: '1234', district: 'Al Olaya', city: 'Riyadh', postalCode: '12345', country: 'SA' },
};

const invoice = (overrides: Partial<ZatcaInvoice> = {}): ZatcaInvoice => ({
  documentType: 'INVOICE',
  kind: 'SIMPLIFIED',
  number: 'INV-2026-000001',
  uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12',
  issueDate: '2026-11-04',
  issueTime: '10:15:00',
  currency: 'SAR',
  icv: 1,
  previousHash: FIRST_PREVIOUS_HASH,
  supplyDate: '2026-11-04',
  paymentMeansCode: '10',
  seller,
  buyer: null,
  lines: [
    { id: 1, name: 'Tuition fee "term 1"', quantity: '1', unitCode: 'PCE', unitPrice: '1000', discount: '0', netAmount: '1000', taxAmount: '0', taxCategory: 'Z', taxPercent: '0' },
    { id: 2, name: 'Books', quantity: '2', unitCode: 'PCE', unitPrice: '50', discount: '10', netAmount: '90', taxAmount: '13.50', taxCategory: 'S', taxPercent: '15' },
  ],
  taxSubtotals: [
    { category: 'Z', percent: '0', taxableAmount: '1000', taxAmount: '0', exemptionReasonCode: 'VATEX-SA-EDU', exemptionReason: 'Private education to citizen' },
    { category: 'S', percent: '15', taxableAmount: '90', taxAmount: '13.50' },
  ],
  totals: { lineExtension: '1090', taxExclusive: '1090', taxAmount: '13.50', taxInclusive: '1103.50', allowanceTotal: '0', prepaid: '0', payable: '1103.50' },
  ...overrides,
});

/** What ZATCA's validator hashes: the transforms of the signature reference, then C14N. */
function independentHash(xml: string): { canonical: string; hash: string } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement!;
  type El = ReturnType<typeof root.getElementsByTagName>[number];
  const drop = (predicate: (el: El) => boolean) => {
    for (const el of Array.from(root.getElementsByTagName('*'))) if (predicate(el)) el.parentNode?.removeChild(el);
  };
  drop((el) => el.tagName === 'ext:UBLExtensions');
  drop((el) => el.tagName === 'cac:Signature');
  drop(
    (el) =>
      el.tagName === 'cac:AdditionalDocumentReference' &&
      Array.from(el.childNodes).some((c) => (c as El).tagName === 'cbc:ID' && c.textContent === 'QR'),
  );
  const canonical = new C14nCanonicalization().process(root as unknown as Node, {});
  return { canonical, hash: createHash('sha256').update(canonical, 'utf8').digest('base64') };
}

describe('ZATCA e-invoice', () => {
  it('hashes exactly what an independent C14N of the signed document produces', () => {
    for (const kind of ['SIMPLIFIED', 'STANDARD'] as const) {
      const unsigned = invoice({ kind, buyer: kind === 'STANDARD' ? { ...seller, name: 'Buyer LLC', vatNumber: '399999999800003' } : null });
      const signed = signInvoice(unsigned, identity);
      const independent = independentHash(signed.xml);
      expect(independent.canonical).toBe(canonicalInvoice(unsigned));
      expect(signed.invoiceHash).toBe(independent.hash);
      expect(hashInvoice(unsigned)).toBe(signed.invoiceHash);
    }
  });

  it('signs the invoice hash with the device key', () => {
    const signed = signInvoice(invoice(), identity);
    const ok = verify('sha256', Buffer.from(signed.invoiceHash, 'base64'), createPublicKey(privateKey), Buffer.from(signed.signature, 'base64'));
    expect(ok).toBe(true);
    expect(signed.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Invoice')).toBe(true);
    expect(signed.xml).toContain(`<ds:SignatureValue>${signed.signature}</ds:SignatureValue>`);
  });

  it('writes SignedProperties in the whitespace layout ZATCA hashes (reporting rejects anything else)', () => {
    const xml = signInvoice(invoice(), identity).xml;
    expect(xml).toContain('<xades:SignedProperties Id="xadesSignedProperties">\n                                    <xades:SignedSignatureProperties>\n');
    expect(xml).toContain('<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n');
  });

  it('escapes text and keeps Arabic as UTF-8', () => {
    const xml = signInvoice(invoice(), identity).xml;
    expect(xml).toContain('شركة القلم &amp; Co &lt;Test&gt;');
    expect(xml).toContain('Tuition fee "term 1"');
  });

  it('encodes the Phase 2 QR (TLV) with the stamp; tag 9 only on simplified invoices', () => {
    const simplified = signInvoice(invoice(), identity);
    const tags = parseQr(simplified.qr);
    expect(tags.get(1)!.toString('utf8')).toBe(seller.name);
    expect(tags.get(2)!.toString()).toBe('399999999900003');
    expect(tags.get(3)!.toString()).toBe('2026-11-04T10:15:00');
    expect(tags.get(4)!.toString()).toBe('1103.50');
    expect(tags.get(5)!.toString()).toBe('13.50');
    expect(tags.get(6)!.toString()).toBe(simplified.invoiceHash);
    expect(tags.get(7)!.toString()).toBe(simplified.signature);
    expect(tags.get(8)!.equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))).toBe(true);
    expect(tags.has(9)).toBe(true);
    expect(extractQr(simplified.xml)).toBe(simplified.qr);

    const standard = signInvoice(invoice({ kind: 'STANDARD' }), identity);
    expect(parseQr(standard.qr).has(9)).toBe(false);
    expect([...parseQr(phaseOneQr(invoice())).keys()]).toEqual([1, 2, 3, 4, 5]);
  });

  it('chains compliance documents through the previous invoice hash', () => {
    const samples = buildComplianceSamples({ seller, kinds: ['STANDARD', 'SIMPLIFIED'], identity, issueDate: '2026-11-04', issueTime: '09:00:00' });
    expect(samples).toHaveLength(6);
    expect(samples[0]!.invoice.previousHash).toBe(FIRST_PREVIOUS_HASH);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.invoice.icv).toBe(i + 1);
      expect(samples[i]!.invoice.previousHash).toBe(samples[i - 1]!.signed.invoiceHash);
    }
    expect(samples[1]!.signed.xml).toContain('<cbc:InvoiceTypeCode name="0100000">381</cbc:InvoiceTypeCode>');
    expect(samples[1]!.signed.xml).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>CHK-STD-INV-1</cbc:ID>');
  });

  it('builds a CSR signed by the device key with the environment template', () => {
    const pem = buildCsr(
      {
        commonName: 'Pencil-EGS-1',
        organizationUnit: 'Main',
        organizationName: 'Test Co',
        vatNumber: '399999999900003',
        egsSerial: '1-Pencil|2-1.0|3-abc',
        invoiceTypes: '1100',
        location: 'RRRD2929',
        industry: 'Education',
      },
      'SIMULATION',
      privateKey,
    );
    const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
    const [info, , signature] = children(readNode(der));
    expect(verify('sha256', info!.raw, createPublicKey(privateKey), signature!.value.subarray(1))).toBe(true);
    expect(der.includes(Buffer.from(CERTIFICATE_TEMPLATE.SIMULATION))).toBe(true);
    expect(der.includes(Buffer.from('1-Pencil|2-1.0|3-abc'))).toBe(true);
  });

  it('reads issuer, serial and signature from the certificate', () => {
    const info = inspectCertificate(identity.certificate);
    expect(info.issuerName).toBe('CN=Test-SubCA, DC=gov, DC=local');
    expect(info.serialNumber).toBe('300');
    expect(info.signature.length).toBeGreaterThan(60);
  });
});
