/**
 * ZATCA QR code: base64 of TLV records (1-byte tag, 1-byte length, value).
 * Tags 1-5 are the Phase 1 fields; 6-9 add the cryptographic stamp.
 */
export interface QrFields {
  sellerName: string;
  vatNumber: string;
  /** ISO timestamp of issue. */
  timestamp: string;
  total: string;
  vatTotal: string;
  /** Phase 2 only. */
  invoiceHash?: string;
  signature?: string;
  publicKey?: Buffer;
  /** Simplified invoices only: ZATCA's signature over the certificate. */
  certificateSignature?: Buffer;
}

function record(tag: number, value: Buffer): Buffer {
  if (value.length > 255) throw new Error(`QR tag ${tag} is too long (${value.length} bytes)`);
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export function buildQr(fields: QrFields): string {
  const utf8 = (s: string) => Buffer.from(s, 'utf8');
  const records = [
    record(1, utf8(fields.sellerName)),
    record(2, utf8(fields.vatNumber)),
    record(3, utf8(fields.timestamp)),
    record(4, utf8(fields.total)),
    record(5, utf8(fields.vatTotal)),
  ];
  if (fields.invoiceHash) records.push(record(6, utf8(fields.invoiceHash)));
  if (fields.signature) records.push(record(7, utf8(fields.signature)));
  if (fields.publicKey) records.push(record(8, fields.publicKey));
  if (fields.certificateSignature) records.push(record(9, fields.certificateSignature));
  return Buffer.concat(records).toString('base64');
}

/** Decodes a QR payload (tests, and showing what ZATCA stamped on a cleared invoice). */
export function parseQr(payload: string): Map<number, Buffer> {
  const buf = Buffer.from(payload, 'base64');
  const out = new Map<number, Buffer>();
  for (let i = 0; i < buf.length; ) {
    const tag = buf[i]!;
    const length = buf[i + 1]!;
    out.set(tag, buf.subarray(i + 2, i + 2 + length));
    i += 2 + length;
  }
  return out;
}
