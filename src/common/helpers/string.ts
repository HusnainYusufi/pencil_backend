import { randomBytes } from 'node:crypto';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** ASCII slug; returns '' for text with no Latin letters/digits (e.g. Arabic). */
export function slugify(input: string, maxLength = 48): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Lower-case alphanumeric random string (unbiased). */
export function randomAlphanumeric(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 252 = 7 * 36: reject the tail to keep the distribution uniform.
      if (byte < 252 && out.length < length) out += ALPHABET[byte % 36];
    }
  }
  return out;
}

/** e.g. "ahmad@example.com" -> "a***d@example.com" for logs and audit trails. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${local[0] ?? ''}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
