import { createHash, createPrivateKey, sign } from 'node:crypto';
import { formatAmount } from '../../../common/helpers/money.js';
import { inspectCertificate, normalizeCertificate, type CertificateInfo } from './certificate.js';
import { buildQr } from './qr.js';
import { buildInvoiceTree } from './ubl-invoice.js';
import { el, raw, serialize, text, XML_DECLARATION, type XmlNode } from './xml.js';
import type { SignedZatcaInvoice, ZatcaInvoice, ZatcaSigningIdentity } from './zatca.types.js';

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const C14N11 = 'http://www.w3.org/2006/12/xml-c14n11';
const XPATH = 'http://www.w3.org/TR/1999/REC-xpath-19991116';

/**
 * The canonical invoice ZATCA hashes: the document without ext:UBLExtensions,
 * cac:Signature and the QR reference, C14N, no XML declaration. Our writer
 * emits canonical XML, so this string is exactly the transform's output.
 */
export function canonicalInvoice(invoice: ZatcaInvoice): string {
  return serialize(buildInvoiceTree(invoice, { signatureReference: false }));
}

/** base64(SHA-256(canonical invoice)): the invoice hash and the next PIH. */
export const hashInvoice = (invoice: ZatcaInvoice): string =>
  createHash('sha256').update(canonicalInvoice(invoice), 'utf8').digest('base64');

/**
 * ZATCA signs the invoice hash bytes (ECDSA secp256k1 over SHA-256 of the
 * hash), not the canonical SignedInfo; the validator expects exactly this.
 */
export function signHash(invoiceHash: string, privateKeyPem: string): string {
  return sign('sha256', Buffer.from(invoiceHash, 'base64'), createPrivateKey(privateKeyPem)).toString('base64');
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * xades:SignedProperties in ZATCA's exact layout. ZATCA validates its digest
 * against this whitespace-preserving form, so the same layout is used for the
 * digest (`forDigest`: namespaces declared on the elements, as ZATCA's own SDK
 * hashes it) and inside the document (namespaces inherited from ancestors).
 * Indentation is significant: do not reformat.
 */
export function signedPropertiesXml(signingTime: string, cert: CertificateInfo, forDigest: boolean): string {
  const xades = forDigest ? ` xmlns:xades="${XADES}"` : '';
  const ds = forDigest ? ` xmlns:ds="${DS}"` : '';
  return (
    `<xades:SignedProperties${xades} Id="xadesSignedProperties">\n` +
    `                                    <xades:SignedSignatureProperties>\n` +
    `                                        <xades:SigningTime>${signingTime}</xades:SigningTime>\n` +
    `                                        <xades:SigningCertificate>\n` +
    `                                            <xades:Cert>\n` +
    `                                                <xades:CertDigest>\n` +
    `                                                    <ds:DigestMethod${ds} Algorithm="${SHA256}"/>\n` +
    `                                                    <ds:DigestValue${ds}>${cert.digest}</ds:DigestValue>\n` +
    `                                                </xades:CertDigest>\n` +
    `                                                <xades:IssuerSerial>\n` +
    `                                                    <ds:X509IssuerName${ds}>${escapeXml(cert.issuerName)}</ds:X509IssuerName>\n` +
    `                                                    <ds:X509SerialNumber${ds}>${cert.serialNumber}</ds:X509SerialNumber>\n` +
    `                                                </xades:IssuerSerial>\n` +
    `                                            </xades:Cert>\n` +
    `                                        </xades:SigningCertificate>\n` +
    `                                    </xades:SignedSignatureProperties>\n` +
    `                                </xades:SignedProperties>`
  );
}

/** base64(hex(sha256(SignedProperties))), ZATCA's digest encoding. */
export const signedPropertiesDigest = (signingTime: string, cert: CertificateInfo): string =>
  Buffer.from(createHash('sha256').update(signedPropertiesXml(signingTime, cert, true), 'utf8').digest('hex')).toString('base64');

function signatureExtension(args: {
  invoiceHash: string;
  signature: string;
  certificate: string;
  cert: CertificateInfo;
  signingTime: string;
}): XmlNode {
  const transform = (xpath: string) =>
    el('ds:Transform', { Algorithm: XPATH }, text('ds:XPath', xpath));
  const signedProperties = raw(signedPropertiesXml(args.signingTime, args.cert, false));

  return el(
    'ext:UBLExtensions',
    {},
    el(
      'ext:UBLExtension',
      {},
      text('ext:ExtensionURI', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
      el(
        'ext:ExtensionContent',
        {},
        el(
          'sig:UBLDocumentSignatures',
          {
            'xmlns:sig': 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
            'xmlns:sac': 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
            'xmlns:sbc': 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
          },
          el(
            'sac:SignatureInformation',
            {},
            text('cbc:ID', 'urn:oasis:names:specification:ubl:signature:1'),
            text('sbc:ReferencedSignatureID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
            el(
              'ds:Signature',
              { 'xmlns:ds': DS, Id: 'signature' },
              el(
                'ds:SignedInfo',
                {},
                el('ds:CanonicalizationMethod', { Algorithm: C14N11 }),
                el('ds:SignatureMethod', { Algorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256' }),
                el(
                  'ds:Reference',
                  { Id: 'invoiceSignedData', URI: '' },
                  el(
                    'ds:Transforms',
                    {},
                    transform('not(//ancestor-or-self::ext:UBLExtensions)'),
                    transform('not(//ancestor-or-self::cac:Signature)'),
                    transform("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
                    el('ds:Transform', { Algorithm: C14N11 }),
                  ),
                  el('ds:DigestMethod', { Algorithm: SHA256 }),
                  text('ds:DigestValue', args.invoiceHash),
                ),
                el(
                  'ds:Reference',
                  { Type: 'http://www.w3.org/2000/09/xmldsig#SignatureProperties', URI: '#xadesSignedProperties' },
                  el('ds:DigestMethod', { Algorithm: SHA256 }),
                  text('ds:DigestValue', signedPropertiesDigest(args.signingTime, args.cert)),
                ),
              ),
              text('ds:SignatureValue', args.signature),
              el('ds:KeyInfo', {}, el('ds:X509Data', {}, text('ds:X509Certificate', args.certificate))),
              el(
                'ds:Object',
                {},
                el('xades:QualifyingProperties', { 'xmlns:xades': XADES, Target: 'signature' }, signedProperties),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** `YYYY-MM-DDTHH:mm:ss` (UTC, no zone suffix) as in ZATCA's samples. */
const signingTimestamp = (date: Date): string => date.toISOString().slice(0, 19);

/**
 * Produces the signed (cryptographically stamped) invoice: hash, ECDSA
 * signature, XAdES extension and the Phase 2 QR code.
 */
export function signInvoice(
  invoice: ZatcaInvoice,
  identity: ZatcaSigningIdentity,
  signingTime: Date = new Date(),
): SignedZatcaInvoice {
  const certificate = normalizeCertificate(identity.certificate);
  const cert = inspectCertificate(certificate);
  const invoiceHash = hashInvoice(invoice);
  const signature = signHash(invoiceHash, identity.privateKeyPem);

  const qr = buildQr({
    sellerName: invoice.seller.name,
    vatNumber: invoice.seller.vatNumber ?? '',
    timestamp: `${invoice.issueDate}T${invoice.issueTime}`,
    total: formatAmount(invoice.totals.taxInclusive, invoice.currency),
    vatTotal: formatAmount(invoice.totals.taxAmount, invoice.currency),
    invoiceHash,
    signature,
    publicKey: cert.publicKey,
    certificateSignature: invoice.kind === 'SIMPLIFIED' ? cert.signature : undefined,
  });

  const extensions = signatureExtension({
    invoiceHash,
    signature,
    certificate,
    cert,
    signingTime: signingTimestamp(signingTime),
  });
  const xml = XML_DECLARATION + serialize(buildInvoiceTree(invoice, { extensions, qr, signatureReference: true }));
  return { xml, invoiceHash, qr, signature };
}

/** Phase 1 QR (tags 1-5) for invoices issued without an onboarded EGS unit. */
export function phaseOneQr(invoice: Pick<ZatcaInvoice, 'seller' | 'issueDate' | 'issueTime' | 'totals' | 'currency'>): string {
  return buildQr({
    sellerName: invoice.seller.name,
    vatNumber: invoice.seller.vatNumber ?? '',
    timestamp: `${invoice.issueDate}T${invoice.issueTime}`,
    total: formatAmount(invoice.totals.taxInclusive, invoice.currency),
    vatTotal: formatAmount(invoice.totals.taxAmount, invoice.currency),
  });
}
