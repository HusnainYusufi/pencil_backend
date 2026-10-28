import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../../common/helpers/date.js';
import { Decimal } from '../../../common/helpers/money.js';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import { Prisma, type JournalSource, type TaxRole } from '../../../generated/prisma/client.js';

export interface LedgerRowInput {
  journalEntryId: string;
  journalLineId: string;
  accountId: string;
  fiscalPeriodId: string;
  date: Date;
  debit: Decimal;
  credit: Decimal;
  currency: string;
  txnDebit: Decimal;
  txnCredit: Decimal;
  branchId: string | null;
  costCenterId: string | null;
  contactId: string | null;
  taxCodeId: string | null;
  taxRole: TaxRole | null;
  taxBase: Decimal | null;
  description: string | null;
}

export interface DimensionFilter {
  branchId?: string;
  costCenterId?: string;
}

/**
 * Which postings a statement query reads: opening balances are reported as
 * opening (never as activity), and year-end closing entries can be left out
 * for "before closing" figures.
 */
export interface SourceFilter {
  excludeSources?: JournalSource[];
  onlySources?: JournalSource[];
}

const sourceWhere = (filter: SourceFilter): Prisma.LedgerEntryWhereInput =>
  filter.onlySources
    ? { journalEntry: { source: { in: filter.onlySources } } }
    : filter.excludeSources?.length
      ? { journalEntry: { source: { notIn: filter.excludeSources } } }
      : {};

/** One row per income-statement account and dimension, for the closing entry. */
export interface ProfitAndLossBalance {
  accountId: string;
  branchId: string | null;
  costCenterId: string | null;
  /** debit - credit over the year. */
  net: Decimal;
}

/** Per-account sums used by the trial balance (base currency, debit - credit). */
export interface AccountTotalsRow {
  accountId: string;
  beforeYear: Decimal;
  yearToFrom: Decimal;
  periodDebit: Decimal;
  periodCredit: Decimal;
}

const toDecimal = (value: unknown): Decimal => new Decimal(value === null || value === undefined ? 0 : String(value));

@Injectable()
export class LedgerRepository extends TenantScopedRepository {
  async insert(rows: LedgerRowInput[]): Promise<void> {
    const tenantId = this.tenantId;
    await this.client.ledgerEntry.createMany({
      data: rows.map((r) => ({
        tenantId,
        journalEntryId: r.journalEntryId,
        journalLineId: r.journalLineId,
        accountId: r.accountId,
        fiscalPeriodId: r.fiscalPeriodId,
        date: r.date,
        debit: r.debit.toFixed(4),
        credit: r.credit.toFixed(4),
        currency: r.currency,
        txnDebit: r.txnDebit.toFixed(4),
        txnCredit: r.txnCredit.toFixed(4),
        branchId: r.branchId,
        costCenterId: r.costCenterId,
        contactId: r.contactId,
        taxCodeId: r.taxCodeId,
        taxRole: r.taxRole,
        taxBase: r.taxBase?.toFixed(4) ?? null,
        description: r.description,
      })),
    });
  }

  /**
   * One pass over the ledger up to `to`, bucketed for the trial balance:
   *  - before_year:  everything before the fiscal year (balance-sheet history;
   *                  for P&L accounts only years that were never closed);
   *  - year_to_from: this year before `from`, plus opening balances dated in
   *                  the range (opening balances are never "activity");
   *  - period_*:     activity in [from, to], optionally without the year-end
   *                  closing entries ("before closing" trial balance).
   */
  async accountTotals(
    params: { fiscalYearStart: Date; from: Date; to: Date; includeClosing: boolean } & DimensionFilter,
  ): Promise<AccountTotalsRow[]> {
    const tenantId = this.tenantId;
    const fyStart = formatDateOnly(params.fiscalYearStart);
    const from = formatDateOnly(params.from);
    const to = formatDateOnly(params.to);
    const activity = params.includeClosing
      ? Prisma.sql`l.date >= ${from}::date AND je.source <> 'OPENING_BALANCE'`
      : Prisma.sql`l.date >= ${from}::date AND je.source NOT IN ('OPENING_BALANCE', 'CLOSING')`;
    const rows = await this.inScope(
      (client) => client.$queryRaw<
        Array<{ account_id: string; before_year: unknown; year_to_from: unknown; period_debit: unknown; period_credit: unknown }>
      >`
        SELECT l.account_id,
               SUM(l.debit - l.credit) FILTER (WHERE l.date < ${fyStart}::date) AS before_year,
               SUM(l.debit - l.credit) FILTER (
                 WHERE l.date >= ${fyStart}::date AND (l.date < ${from}::date OR je.source = 'OPENING_BALANCE')
               ) AS year_to_from,
               SUM(l.debit)  FILTER (WHERE ${activity}) AS period_debit,
               SUM(l.credit) FILTER (WHERE ${activity}) AS period_credit
        FROM ledger_entries l
        JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE l.tenant_id = ${tenantId}::uuid
          AND l.date <= ${to}::date
          ${params.branchId ? Prisma.sql`AND l.branch_id = ${params.branchId}::uuid` : Prisma.empty}
          ${params.costCenterId ? Prisma.sql`AND l.cost_center_id = ${params.costCenterId}::uuid` : Prisma.empty}
        GROUP BY l.account_id`,
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      beforeYear: toDecimal(r.before_year),
      yearToFrom: toDecimal(r.year_to_from),
      periodDebit: toDecimal(r.period_debit),
      periodCredit: toDecimal(r.period_credit),
    }));
  }

  /**
   * Income-statement balances of [start, end] per account, branch and cost
   * centre: what the year-end closing entry must zero out. Uses every posting
   * in the year, including an earlier closing entry and its reversal (they
   * cancel), so re-closing after a reopen is always exact.
   */
  async profitAndLossBalances(start: Date, end: Date): Promise<ProfitAndLossBalance[]> {
    const tenantId = this.tenantId;
    const rows = await this.inScope(
      (client) => client.$queryRaw<Array<{ account_id: string; branch_id: string | null; cost_center_id: string | null; net: unknown }>>`
        SELECT l.account_id, l.branch_id, l.cost_center_id, SUM(l.debit - l.credit) AS net
        FROM ledger_entries l
        JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${tenantId}::uuid
          AND l.date BETWEEN ${formatDateOnly(start)}::date AND ${formatDateOnly(end)}::date
          AND a.type IN ('REVENUE', 'EXPENSE')
        GROUP BY l.account_id, l.branch_id, l.cost_center_id
        HAVING SUM(l.debit - l.credit) <> 0
        ORDER BY l.account_id, l.branch_id NULLS FIRST, l.cost_center_id NULLS FIRST`,
    );
    return rows.map((r) => ({ accountId: r.account_id, branchId: r.branch_id, costCenterId: r.cost_center_id, net: toDecimal(r.net) }));
  }

  /**
   * Net income-statement result of everything before `date` that was never
   * closed into retained earnings (closed years net to zero by construction).
   */
  async unclosedResultBefore(date: Date, dims: DimensionFilter = {}): Promise<Decimal> {
    const tenantId = this.tenantId;
    const [row] = await this.inScope(
      (client) => client.$queryRaw<Array<{ net: unknown }>>`
        SELECT SUM(l.debit - l.credit) AS net
        FROM ledger_entries l
        JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${tenantId}::uuid
          AND l.date < ${formatDateOnly(date)}::date
          AND a.type IN ('REVENUE', 'EXPENSE')
          ${dims.branchId ? Prisma.sql`AND l.branch_id = ${dims.branchId}::uuid` : Prisma.empty}
          ${dims.costCenterId ? Prisma.sql`AND l.cost_center_id = ${dims.costCenterId}::uuid` : Prisma.empty}`,
    );
    return toDecimal(row?.net);
  }

  /** All-time net balance of an account (debit - credit). */
  async balance(accountId: string): Promise<Decimal> {
    const result = await this.client.ledgerEntry.aggregate({
      where: { tenantId: this.tenantId, accountId },
      _sum: { debit: true, credit: true },
    });
    return toDecimal(result._sum.debit).minus(toDecimal(result._sum.credit));
  }

  /** Net (debit - credit) of an account over [from, before) with optional dimensions and sources. */
  async netBalance(accountId: string, range: { from?: Date; before: Date } & DimensionFilter & SourceFilter): Promise<Decimal> {
    const result = await this.client.ledgerEntry.aggregate({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { ...(range.from && { gte: range.from }), lt: range.before },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
        ...sourceWhere(range),
      },
      _sum: { debit: true, credit: true },
    });
    return toDecimal(result._sum.debit).minus(toDecimal(result._sum.credit));
  }

  /** Net of the account's postings inside [from, to] that sort before the keyset cursor. */
  async netBeforeCursor(
    accountId: string,
    range: { from: Date; to: Date } & DimensionFilter & SourceFilter,
    cursor: { date: Date; id: string },
  ): Promise<Decimal> {
    const result = await this.client.ledgerEntry.aggregate({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { gte: range.from, lte: range.to },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
        ...sourceWhere(range),
        OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lte: cursor.id } }],
      },
      _sum: { debit: true, credit: true },
    });
    return toDecimal(result._sum.debit).minus(toDecimal(result._sum.credit));
  }

  /** Account postings in date order (keyset pagination on date, id). */
  listForAccount(
    accountId: string,
    range: { from: Date; to: Date } & DimensionFilter & SourceFilter,
    page: { after?: { date: Date; id: string }; limit: number },
  ) {
    return this.client.ledgerEntry.findMany({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { gte: range.from, lte: range.to },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
        ...sourceWhere(range),
        ...(page.after && {
          OR: [{ date: { gt: page.after.date } }, { date: page.after.date, id: { gt: page.after.id } }],
        }),
      },
      include: {
        journalEntry: { select: { id: true, number: true, reference: true, memo: true, source: true, sourceId: true } },
        branch: { select: { code: true } },
        costCenter: { select: { code: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
    });
  }
}
