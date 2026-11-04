import { createHash, X509Certificate } from 'node:crypto';
import { children, DER_TAG, readNode } from './der.js';

export interface CertificateInfo {
  /** `CN=..., DC=...` in the order ZATCA's validator expects. */
  issuerName: string;
  /** Decimal serial number. */
  serialNumber: string;
  /** SubjectPublicKeyInfo DER (QR tag 8). */
  publicKey: Buffer;
  /** The issuing CA's signature over the certificate (QR tag 9). */
  signature: Buffer;
  /** base64(hex(sha256(base64 certificate))) as used in xades:CertDigest. */
  digest: string;
  validTo: Date;
}

/** Strips PEM armour / whitespace: ZATCA works with the bare base64 DER. */
export const normalizeCertificate = (certificate: string): string =>
  certificate.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

export function inspectCertificate(certificate: string): CertificateInfo {
  const base64 = normalizeCertificate(certificate);
  const der = Buffer.from(base64, 'base64');
  const x509 = new X509Certificate(der);

  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
  const [, , signatureValue] = children(readNode(der));
  if (!signatureValue || signatureValue.tag !== DER_TAG.BIT_STRING) throw new Error('Certificate has no signature value');

  return {
    issuerName: x509.issuer.split('\n').reverse().join(', '),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKey: x509.publicKey.export({ type: 'spki', format: 'der' }),
    signature: signatureValue.value.subarray(1),
    digest: Buffer.from(createHash('sha256').update(base64).digest('hex')).toString('base64'),
    validTo: new Date(x509.validTo),
  };
}
