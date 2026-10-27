import { endOfMonth, formatDateOnly } from '../../../common/helpers/date.js';

export interface DateRange {
  start: Date;
  end: Date;
}

/** Fiscal year (date-only, inclusive) containing `date` for a given start month. */
export function fiscalYearContaining(date: Date, startMonth: number): DateRange {
  const month = date.getUTCMonth() + 1;
  const startYear = month >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return {
    start: new Date(Date.UTC(startYear, startMonth - 1, 1)),
    end: new Date(Date.UTC(startYear + 1, startMonth - 1, 0)),
  };
}

/** The fiscal year immediately after `previous`. */
export function nextFiscalYear(previous: DateRange): DateRange {
  const start = new Date(previous.end.getTime() + 86_400_000);
  return { start, end: new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0)) };
}

/** Calendar-month periods covering the year (12 for a regular year). */
export function monthlyPeriods(year: DateRange): Array<DateRange & { number: number }> {
  const periods: Array<DateRange & { number: number }> = [];
  let cursor = year.start;
  for (let n = 1; cursor <= year.end; n++) {
    const end = endOfMonth(cursor) < year.end ? endOfMonth(cursor) : year.end;
    periods.push({ number: n, start: cursor, end });
    cursor = new Date(end.getTime() + 86_400_000);
  }
  return periods;
}

/** "FY 2026" for calendar years, "FY 2026/27" otherwise. */
export function fiscalYearName(year: DateRange): string {
  const startYear = year.start.getUTCFullYear();
  const endYear = year.end.getUTCFullYear();
  return startYear === endYear ? `FY ${startYear}` : `FY ${startYear}/${String(endYear).slice(-2)}`;
}

export const describeRange = (range: DateRange): string =>
  `${formatDateOnly(range.start)}..${formatDateOnly(range.end)}`;
