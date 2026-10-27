import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../../common/helpers/date.js';
import { Decimal } from '../../../common/helpers/money.js';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import { Prisma } from '../../../generated/prisma/client.js';

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
  description: string | null;
}

export interface DimensionFilter {
  branchId?: string;
  costCenterId?: string;
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
        description: r.description,
      })),
    });
  }

  /**
   * One pass over the ledger up to `to`, bucketed so the service can apply
   * the year-end rule (P&L accounts restart each fiscal year) without
   * closing entries. Served by the (tenant_id, account_id, date) index.
   */
  async accountTotals(params: { fiscalYearStart: Date; from: Date; to: Date } & DimensionFilter): Promise<AccountTotalsRow[]> {
    const tenantId = this.tenantId;
    const fyStart = formatDateOnly(params.fiscalYearStart);
    const from = formatDateOnly(params.from);
    const to = formatDateOnly(params.to);
    const rows = await this.inScope(
      (client) => client.$queryRaw<
        Array<{ account_id: string; before_year: unknown; year_to_from: unknown; period_debit: unknown; period_credit: unknown }>
      >`
        SELECT l.account_id,
               SUM(l.debit - l.credit) FILTER (WHERE l.date < ${fyStart}::date)                              AS before_year,
               SUM(l.debit - l.credit) FILTER (WHERE l.date >= ${fyStart}::date AND l.date < ${from}::date) AS year_to_from,
               SUM(l.debit)  FILTER (WHERE l.date >= ${from}::date)                                         AS period_debit,
               SUM(l.credit) FILTER (WHERE l.date >= ${from}::date)                                         AS period_credit
        FROM ledger_entries l
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

  /** Net (debit - credit) of an account over [from, before) with optional dimensions. */
  async netBalance(accountId: string, range: { from?: Date; before: Date } & DimensionFilter): Promise<Decimal> {
    const result = await this.client.ledgerEntry.aggregate({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { ...(range.from && { gte: range.from }), lt: range.before },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
      },
      _sum: { debit: true, credit: true },
    });
    return toDecimal(result._sum.debit).minus(toDecimal(result._sum.credit));
  }

  /** Net of the account's postings inside [from, to] that sort before the keyset cursor. */
  async netBeforeCursor(
    accountId: string,
    range: { from: Date; to: Date } & DimensionFilter,
    cursor: { date: Date; id: string },
  ): Promise<Decimal> {
    const result = await this.client.ledgerEntry.aggregate({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { gte: range.from, lte: range.to },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
        OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lte: cursor.id } }],
      },
      _sum: { debit: true, credit: true },
    });
    return toDecimal(result._sum.debit).minus(toDecimal(result._sum.credit));
  }

  /** Account postings in date order (keyset pagination on date, id). */
  listForAccount(
    accountId: string,
    range: { from: Date; to: Date } & DimensionFilter,
    page: { after?: { date: Date; id: string }; limit: number },
  ) {
    return this.client.ledgerEntry.findMany({
      where: {
        tenantId: this.tenantId,
        accountId,
        date: { gte: range.from, lte: range.to },
        ...(range.branchId && { branchId: range.branchId }),
        ...(range.costCenterId && { costCenterId: range.costCenterId }),
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
