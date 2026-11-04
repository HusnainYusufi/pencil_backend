import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { bitString, contextTag, integer, octetString, oid, printable, sequence, set, utf8 } from './der.js';
import type { ZatcaEnvironment } from './zatca.types.js';

/** ZATCA certificate template per environment (the CSR must name it). */
export const CERTIFICATE_TEMPLATE: Readonly<Record<ZatcaEnvironment, string>> = {
  SANDBOX: 'TSTZATCA-Code-Signing',
  SIMULATION: 'PREZATCA-Code-Signing',
  PRODUCTION: 'ZATCA-Code-Signing',
};

const OID = {
  countryName: '2.5.4.6',
  organizationName: '2.5.4.10',
  organizationalUnitName: '2.5.4.11',
  commonName: '2.5.4.3',
  surname: '2.5.4.4',
  title: '2.5.4.12',
  businessCategory: '2.5.4.15',
  registeredAddress: '2.5.4.26',
  userId: '0.9.2342.19200300.100.1.1',
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  certificateTemplateName: '1.3.6.1.4.1.311.20.2',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
} as const;

export interface CsrSubject {
  /** Unique EGS name, e.g. `Pencil-EGS-<id>`. */
  commonName: string;
  /** Branch / unit name; must be the 10-digit TIN for VAT groups. */
  organizationUnit: string;
  organizationName: string;
  /** 15-digit VAT registration number. */
  vatNumber: string;
  /** EGS serial: `1-<solution>|2-<model>|3-<serial>`. */
  egsSerial: string;
  /** 4-digit invoice-type flags: standard, simplified, (reserved), (reserved). */
  invoiceTypes: string;
  /** Short national address of the branch, e.g. `RRRD2929`. */
  location: string;
  industry: string;
  countryCode?: string;
}

export interface GeneratedCsr {
  /** PKCS#8 PEM (secp256k1); encrypt before storing. */
  privateKeyPem: string;
  csrPem: string;
}

const rdn = (type: string, value: Buffer) => set(sequence(oid(type), value));

export function toPem(label: string, der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/** Builds the ZATCA CSR (PKCS#10, ECDSA secp256k1 / SHA-256). */
export function buildCsr(subject: CsrSubject, environment: ZatcaEnvironment, privateKey: KeyObject): string {
  if (privateKey.asymmetricKeyType !== 'ec') throw new Error('ZATCA keys must be EC (secp256k1)');
  const publicKeyInfo = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  const name = sequence(
    rdn(OID.countryName, printable(subject.countryCode ?? 'SA')),
    rdn(OID.organizationalUnitName, utf8(subject.organizationUnit)),
    rdn(OID.organizationName, utf8(subject.organizationName)),
    rdn(OID.commonName, utf8(subject.commonName)),
  );

  const directoryName = sequence(
    rdn(OID.surname, utf8(subject.egsSerial)),
    rdn(OID.userId, utf8(subject.vatNumber)),
    rdn(OID.title, utf8(subject.invoiceTypes)),
    rdn(OID.registeredAddress, utf8(subject.location)),
    rdn(OID.businessCategory, utf8(subject.industry)),
  );
  // GeneralNames ::= SEQUENCE OF GeneralName; directoryName is [4], explicit because Name is a CHOICE.
  const subjectAltName = sequence(contextTag(4, directoryName));

  const extensions = sequence(
    sequence(oid(OID.certificateTemplateName), octetString(printable(CERTIFICATE_TEMPLATE[environment]))),
    sequence(oid(OID.subjectAltName), octetString(subjectAltName)),
  );
  const attributes = contextTag(0, sequence(oid(OID.extensionRequest), set(extensions)));

  const info = sequence(integer(0), name, publicKeyInfo, attributes);
  const signature = sign('sha256', info, privateKey);
  return toPem('CERTIFICATE REQUEST', sequence(info, sequence(oid(OID.ecdsaWithSha256)), bitString(signature)));
}

/** New secp256k1 key pair and CSR for an EGS unit. */
export function generateCsr(subject: CsrSubject, environment: ZatcaEnvironment): GeneratedCsr {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    csrPem: buildCsr(subject, environment, privateKey),
  };
}
