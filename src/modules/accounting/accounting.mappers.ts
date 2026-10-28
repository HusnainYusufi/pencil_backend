import { formatDateOnly } from '../../common/helpers/date.js';
import { formatAmount } from '../../common/helpers/money.js';
import type { FiscalPeriod, JournalEntry } from '../../generated/prisma/client.js';
import type { FiscalYearWithPeriods } from './repositories/fiscal.repository.js';
import type { JournalEntryDetail } from './repositories/journals.repository.js';

/**
 * API shapes: business dates as `YYYY-MM-DD`, money as fixed-scale strings in
 * the document currency (never JS numbers).
 */
export function toJournalSummary(entry: JournalEntry) {
  return {
    id: entry.id,
    number: entry.number,
    date: formatDateOnly(entry.date),
    status: entry.status,
    source: entry.source,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reference: entry.reference,
    memo: entry.memo,
    currency: entry.currency,
    totalAmount: formatAmount(entry.totalAmount.toString(), entry.currency),
    reversalOfId: entry.reversalOfId,
    postedAt: entry.postedAt,
    createdAt: entry.createdAt,
  };
}

export function toJournalDetail(entry: JournalEntryDetail) {
  const link = (e: { id: string; number: string | null; date: Date } | null) =>
    e ? { id: e.id, number: e.number, date: formatDateOnly(e.date) } : null;
  return {
    ...toJournalSummary(entry),
    exchangeRate: entry.exchangeRate.toString(),
    fiscalPeriodId: entry.fiscalPeriodId,
    createdById: entry.createdById,
    postedById: entry.postedById,
    updatedAt: entry.updatedAt,
    reversalOf: link(entry.reversalOf),
    reversedBy: link(entry.reversedBy),
    lines: entry.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      account: line.account,
      description: line.description,
      debit: formatAmount(line.debit.toString(), entry.currency),
      credit: formatAmount(line.credit.toString(), entry.currency),
      branch: line.branch,
      costCenter: line.costCenter,
      contact: line.contact,
      taxCode: line.taxCode,
      taxRole: line.taxRole,
      taxBase: line.taxBase ? formatAmount(line.taxBase.toString(), entry.currency) : null,
    })),
  };
}

export function toFiscalPeriod(period: FiscalPeriod) {
  return {
    id: period.id,
    number: period.number,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    status: period.status,
    closedAt: period.closedAt,
  };
}

export function toFiscalYear(year: FiscalYearWithPeriods) {
  return {
    id: year.id,
    name: year.name,
    startDate: formatDateOnly(year.startDate),
    endDate: formatDateOnly(year.endDate),
    status: year.status,
    closedAt: year.closedAt,
    closingEntryId: year.closingEntryId,
    periods: year.periods.map(toFiscalPeriod),
  };
}
