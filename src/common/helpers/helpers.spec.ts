import { safeEqual, sha256Hex, stableStringify } from './crypto.js';
import { addMonths, toHijri, toLocalDate } from './date.js';
import { buildCursorPage, buildPage, decodeCursor, encodeCursor, toSkipTake } from './pagination.js';
import { maskEmail, normalizeEmail, randomAlphanumeric, slugify } from './string.js';

describe('crypto helpers', () => {
  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      stableStringify({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('compares in constant time and hashes deterministically', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(sha256Hex('pencil')).toHaveLength(64);
  });
});

describe('date helpers', () => {
  it('clamps month arithmetic to month end', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('derives business dates in the tenant zone', () => {
    // 22:30 UTC is already the next day in Riyadh (UTC+3).
    expect(toLocalDate(new Date('2026-03-01T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-03-02');
  });

  it('converts to the Umm al-Qura Hijri calendar', () => {
    // 1 Ramadan 1447 AH = 18 Feb 2026.
    expect(toHijri(new Date('2026-02-18T12:00:00Z'))).toEqual({ year: 1447, month: 9, day: 1 });
  });
});

describe('string helpers', () => {
  it('normalizes and masks emails', () => {
    expect(normalizeEmail('  Ahmad@Example.COM ')).toBe('ahmad@example.com');
    expect(maskEmail('ahmad@example.com')).toBe('a***d@example.com');
  });

  it('slugifies latin text and returns empty for Arabic-only names', () => {
    expect(slugify('Al Noor Trading Co.')).toBe('al-noor-trading-co');
    expect(slugify('شركة النور')).toBe('');
  });

  it('generates lowercase alphanumerics', () => {
    expect(randomAlphanumeric(12)).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe('pagination helpers', () => {
  it('builds offset pages', () => {
    expect(toSkipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(buildPage(['a'], 41, { page: 1, pageSize: 20 }).meta.totalPages).toBe(3);
  });

  it('round-trips cursors and rejects garbage', () => {
    expect(decodeCursor(encodeCursor({ id: 'x', n: 1 }))).toEqual({ id: 'x', n: 1 });
    expect(decodeCursor('%%%not-base64')).toBeNull();
  });

  it('splits the look-ahead row off keyset pages', () => {
    const page = buildCursorPage([{ id: '3' }, { id: '2' }, { id: '1' }], 2, (r) => ({ id: r.id }));
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)).toEqual({ id: '2' });
    expect(buildCursorPage([{ id: '1' }], 2, (r) => ({ id: r.id })).nextCursor).toBeNull();
  });
});
