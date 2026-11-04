/**
 * Minimal ASN.1 DER encoder/reader: just what CSR generation and certificate
 * inspection need. Kept in-house to avoid a crypto dependency for ~100 lines.
 */

const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, value: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);

export const sequence = (...items: Buffer[]): Buffer => tlv(TAG.SEQUENCE, Buffer.concat(items));
/** DER SET OF: members sorted by their encoding. */
export const set = (...items: Buffer[]): Buffer => tlv(TAG.SET, Buffer.concat([...items].sort(Buffer.compare)));
export const utf8 = (value: string): Buffer => tlv(TAG.UTF8_STRING, Buffer.from(value, 'utf8'));
export const printable = (value: string): Buffer => tlv(TAG.PRINTABLE_STRING, Buffer.from(value, 'ascii'));
export const octetString = (value: Buffer): Buffer => tlv(TAG.OCTET_STRING, value);
export const bitString = (value: Buffer): Buffer => tlv(TAG.BIT_STRING, Buffer.concat([Buffer.from([0]), value]));
/** Context-specific constructed tag `[n]`. */
export const contextTag = (n: number, value: Buffer): Buffer => tlv(0xa0 | n, value);

export function integer(value: number): Buffer {
  if (value < 0 || value > 0x7f) throw new Error('integer(): only small non-negative values are supported');
  return tlv(TAG.INTEGER, Buffer.from([value]));
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) throw new Error(`Invalid OID ${dotted}`);
  const bytes: number[] = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i]! |= 0x80;
    bytes.push(...chunk);
  }
  return tlv(TAG.OID, Buffer.from(bytes));
}

export interface DerNode {
  tag: number;
  /** Full encoding (header + value). */
  raw: Buffer;
  value: Buffer;
}

/** Reads one TLV at `offset`. */
export function readNode(buf: Buffer, offset = 0): DerNode & { end: number } {
  const tag = buf[offset];
  let length = buf[offset + 1];
  if (tag === undefined || length === undefined) throw new Error('DER: truncated input');
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Error('DER: unsupported length encoding');
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | buf[offset + 2 + i]!;
    header += count;
  }
  const end = offset + header + length;
  if (end > buf.length) throw new Error('DER: length exceeds input');
  return { tag, raw: buf.subarray(offset, end), value: buf.subarray(offset + header, end), end };
}

/** Children of a constructed node (SEQUENCE / SET / context tag). */
export function children(node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  for (let offset = 0; offset < node.value.length; ) {
    const child = readNode(node.value, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

export const DER_TAG = TAG;
