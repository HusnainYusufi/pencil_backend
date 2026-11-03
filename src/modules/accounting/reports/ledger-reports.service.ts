import { Injectable } from '@nestjs/common';
import { formatDateOnly, parseDateOnly } from '../../../common/helpers/date.js';
import { Decimal, formatAmount, sumMoney } from '../../../common/helpers/money.js';
import { buildCursorPage, decodeCursor } from '../../../common/helpers/pagination.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { Account } from '../../../generated/prisma/client.js';
import { AccountingContext } from '../accounting-context.service.js';
import { isProfitAndLoss, SystemAccount } from '../chart-of-accounts/system-accounts.js';
import type { AccountStatementQueryDto, TrialBalanceQueryDto } from '../dto/reports.dto.js';
import { fiscalYearContaining } from '../fiscal/fiscal-calendar.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { FiscalRepository } from '../repositories/fiscal.repository.js';
import { LedgerRepository, type SourceFilter } from '../repositories/ledger.repository.js';

interface Amounts {
  debit: string;
  credit: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: Account['type'];
  parentId: string | null;
  isGroup: boolean;
  depth: number;
  opening: Amounts;
  movement: Amounts;
  closing: Amounts;
}

const ZERO = new Decimal(0);

@Injectable()
export class LedgerReportsService {
  constructor(
    private readonly accounting: AccountingContext,
    private readonly accounts: AccountsRepository,
    private readonly fiscal: FiscalRepository,
    private readonly ledger: LedgerRepository,
  ) {}

  /**
   * Trial balance for [from, to] inside one fiscal year.
   *  - Income-statement accounts start the year at zero. Closed years were
   *    moved to retained earnings by their closing entry; the result of any
   *    earlier year that was never closed is added to retained earnings'
   *    opening balance here, so the report balances either way.
   *  - Opening balances (cut-over) always show in the Opening column.
   *  - By default the year-end closing entry is left out ("before closing");
   *    `includeClosing` gives the post-closing trial balance.
   */
  async trialBalance(query: TrialBalanceQueryDto) {
    const { from, to, fiscalYearStart, toYearStart, currency } = await this.resolveRange(query.from, query.to);
    if (fiscalYearStart.getTime() !== toYearStart.getTime()) throw this.crossYear();
    const includeClosing = query.includeClosing ?? false;
    const [accounts, sums] = await Promise.all([
      this.accounts.list({ includeInactive: true }),
      this.ledger.accountTotals({ fiscalYearStart, from, to, includeClosing, branchId: query.branchId, costCenterId: query.costCenterId }),
    ]);
    const totalsById = new Map(sums.map((t) => [t.accountId, t]));
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const priorYearsProfit = sumMoney(
      accounts.filter((a) => isProfitAndLoss(a.type)).map((a) => totalsById.get(a.id)?.beforeYear ?? ZERO),
    );

    // Net figures (debit - credit) per account, then rolled up the tree.
    const net = new Map<string, { opening: Decimal; debit: Decimal; credit: Decimal }>();
    const add = (id: string, opening: Decimal, debit: Decimal, credit: Decimal) => {
      const current = net.get(id) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
      net.set(id, { opening: current.opening.plus(opening), debit: current.debit.plus(debit), credit: current.credit.plus(credit) });
    };
    for (const account of accounts) {
      if (account.isGroup) continue;
      const t = totalsById.get(account.id);
      let opening = isProfitAndLoss(account.type) ? (t?.yearToFrom ?? ZERO) : (t?.beforeYear ?? ZERO).plus(t?.yearToFrom ?? ZERO);
      if (account.systemKey === SystemAccount.RETAINED_EARNINGS) opening = opening.plus(priorYearsProfit);
      const debit = t?.periodDebit ?? ZERO;
      const credit = t?.periodCredit ?? ZERO;
      for (let node: Account | undefined = account; node; node = node.parentId ? byId.get(node.parentId) : undefined) {
        add(node.id, opening, debit, credit);
      }
    }

    const depthOf = (a: Account): number => (a.parentId && byId.get(a.parentId) ? depthOf(byId.get(a.parentId)!) + 1 : 0);
    const split = (value: Decimal): Amounts =>
      value.isNegative()
        ? { debit: formatAmount(0, currency), credit: formatAmount(value.negated(), currency) }
        : { debit: formatAmount(value, currency), credit: formatAmount(0, currency) };

    const rows: TrialBalanceRow[] = accounts
      .filter((a) => {
        const n = net.get(a.id);
        const nonZero = n && !(n.opening.isZero() && n.debit.isZero() && n.credit.isZero());
        return query.includeZero ? a.isActive || nonZero : nonZero;
      })
      .map((a) => {
        const n = net.get(a.id) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          nameAr: a.nameAr,
          type: a.type,
          parentId: a.parentId,
          isGroup: a.isGroup,
          depth: depthOf(a),
          opening: split(n.opening),
          movement: { debit: formatAmount(n.debit, currency), credit: formatAmount(n.credit, currency) },
          closing: split(n.opening.plus(n.debit).minus(n.credit)),
        };
      });

    // Totals over postable accounts only (groups would double count).
    const leaf = rows.filter((r) => !r.isGroup);
    const total = (pick: (r: TrialBalanceRow) => string) => formatAmount(sumMoney(leaf.map(pick)), currency);
    const totals = {
      opening: { debit: total((r) => r.opening.debit), credit: total((r) => r.opening.credit) },
      movement: { debit: total((r) => r.movement.debit), credit: total((r) => r.movement.credit) },
      closing: { debit: total((r) => r.closing.debit), credit: total((r) => r.closing.credit) },
    };
    return {
      from: formatDateOnly(from),
      to: formatDateOnly(to),
      currency,
      includeClosing,
      /** Result of earlier years never closed, included in retained earnings' opening. */
      unclosedPriorResult: formatAmount(priorYearsProfit.negated(), currency),
      rows,
      totals,
      balanced: totals.closing.debit === totals.closing.credit && totals.movement.debit === totals.movement.credit,
    };
  }

  /** Account statement (general ledger for one account) with running balance. */
  async accountStatement(accountId: string, query: AccountStatementQueryDto) {
    const account = await this.accounts.findById(accountId);
    if (!account) throw AppException.notFound('Account', accountId);
    if (account.isGroup) {
      throw new AppException(ErrorCode.ACCOUNT_NOT_POSTABLE, 'Statements are available for postable accounts');
    }
    const { from, to, fiscalYearStart, toYearStart, currency } = await this.resolveRange(query.from, query.to);
    const profitAndLoss = isProfitAndLoss(account.type);
    // Income-statement balances restart every year: a range across years has no single opening.
    if (profitAndLoss && fiscalYearStart.getTime() !== toYearStart.getTime()) throw this.crossYear();
    const dims = { branchId: query.branchId, costCenterId: query.costCenterId };
    const openingFrom = profitAndLoss ? fiscalYearStart : undefined;
    const dayAfterTo = new Date(to.getTime() + 86_400_000);
    // Opening balances are reported as opening; closing entries can be hidden.
    const activity: SourceFilter = {
      excludeSources: query.includeClosing === false ? ['OPENING_BALANCE', 'CLOSING'] : ['OPENING_BALANCE'],
    };
    const isRetainedEarnings = account.systemKey === SystemAccount.RETAINED_EARNINGS;

    const cursor = query.cursor ? decodeCursor<{ d: string; i: string }>(query.cursor) : null;
    if (query.cursor && !cursor) throw new AppException(ErrorCode.BAD_REQUEST, 'Invalid cursor');
    const after = cursor ? { date: parseDateOnly(cursor.d), id: cursor.i } : undefined;

    const [openingBefore, openingInRange, unclosed, periodNet, beforePage, rows] = await Promise.all([
      this.ledger.netBalance(accountId, { from: openingFrom, before: from, ...dims }),
      this.ledger.netBalance(accountId, { from, before: dayAfterTo, onlySources: ['OPENING_BALANCE'], ...dims }),
      // Retained earnings carries the result of earlier years never closed (as the trial balance does).
      isRetainedEarnings ? this.ledger.unclosedResultBefore(fiscalYearStart, dims) : Promise.resolve(ZERO),
      this.ledger.netBalance(accountId, { from, before: dayAfterTo, ...activity, ...dims }),
      after ? this.ledger.netBeforeCursor(accountId, { from, to, ...activity, ...dims }, after) : Promise.resolve(ZERO),
      this.ledger.listForAccount(accountId, { from, to, ...activity, ...dims }, { after, limit: query.limit }),
    ]);
    const opening = openingBefore.plus(openingInRange).plus(unclosed);

    const page = buildCursorPage(rows, query.limit, (r) => ({ d: formatDateOnly(r.date), i: r.id }));
    let running = opening.plus(beforePage);
    const items = page.items.map((r) => {
      const debit = new Decimal(r.debit.toString());
      const credit = new Decimal(r.credit.toString());
      running = running.plus(debit).minus(credit);
      return {
        id: r.id,
        date: formatDateOnly(r.date),
        journalEntryId: r.journalEntryId,
        number: r.journalEntry.number,
        source: r.journalEntry.source,
        reference: r.journalEntry.reference,
        description: r.description,
        branch: r.branch?.code ?? null,
        costCenter: r.costCenter?.code ?? null,
        debit: formatAmount(debit, currency),
        credit: formatAmount(credit, currency),
        balance: formatAmount(running, currency),
      };
    });

    return {
      account: { id: account.id, code: account.code, name: account.name, nameAr: account.nameAr, type: account.type },
      from: formatDateOnly(from),
      to: formatDateOnly(to),
      currency,
      /** Signed: positive = debit balance, negative = credit balance. */
      openingBalance: formatAmount(opening, currency),
      /** Part of the opening balance that is earlier years' unclosed result (retained earnings only). */
      unclosedPriorResult: isRetainedEarnings ? formatAmount(unclosed, currency) : null,
      closingBalance: formatAmount(opening.plus(periodNet), currency),
      items,
      nextCursor: page.nextCursor,
    };
  }

  /** Defaults: from = start of the fiscal year containing `to`; to = today. */
  private async resolveRange(fromInput?: string, toInput?: string) {
    const profile = await this.accounting.profile();
    const to = toInput ? parseDateOnly(toInput) : await this.accounting.today();
    const yearOf = async (date: Date) => {
      const year = await this.fiscal.findYearForDate(date);
      return year ? year.startDate : fiscalYearContaining(date, profile.fiscalYearStartMonth).start;
    };
    const from = fromInput ? parseDateOnly(fromInput) : await yearOf(to);
    if (from > to) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'from', errors: ['from must be on or before to'] },
      ]);
    }
    const [fiscalYearStart, toYearStart] = await Promise.all([yearOf(from), yearOf(to)]);
    return { from, to, fiscalYearStart, toYearStart, currency: profile.baseCurrency };
  }

  private crossYear(): AppException {
    return new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
      { field: 'from', errors: ['from and to must be in the same fiscal year'] },
    ]);
  }
}
