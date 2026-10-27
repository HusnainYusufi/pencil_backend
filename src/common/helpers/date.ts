/**
 * Date helpers. Persist instants in UTC (timestamptz); convert to a tenant's
 * zone (Asia/Riyadh, Asia/Amman) only for business dates and display.
 */

const DAY_MS = 86_400_000;

export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);
export const addMinutes = (date: Date, minutes: number): Date => addMs(date, minutes * 60_000);
export const addDays = (date: Date, days: number): Date => addMs(date, days * DAY_MS);

/** Calendar-month arithmetic, clamped to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export const isPast = (date: Date, now: Date = new Date()): boolean => date.getTime() <= now.getTime();

/** Business date (YYYY-MM-DD) of an instant in the given IANA zone. */
export function toLocalDate(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

/** Umm al-Qura Hijri calendar date (official in KSA) of an instant in a zone. */
export function toHijri(date: Date, timeZone = 'Asia/Riyadh'): HijriDate {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '', 10);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
