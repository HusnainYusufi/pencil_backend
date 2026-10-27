import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy (default 256 bits). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison (avoids timing side channels). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Deterministic JSON (sorted object keys), for hashing request payloads.
 * Not a general serializer: functions/undefined are dropped like JSON does.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}
