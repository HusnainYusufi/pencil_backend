import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../../common/helpers/date.js';
import { Decimal, formatAmount, sumMoney } from '../../../common/helpers/money.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { FiscalYear } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
import { SystemAccount } from '../chart-of-accounts/system-accounts.js';
import { PostingService } from '../journals/posting.service.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { BooksRepository } from '../repositories/books.repository.js';
import { FiscalRepository, type FiscalYearWithPeriods } from '../repositories/fiscal.repository.js';
import { JournalsRepository } from '../repositories/journals.repository.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';
import { FiscalCalendarService } from './fiscal-calendar.service.js';
import { buildClosingEntry, mirrorLines } from './year-end.js';

export interface YearEndBlocker {
  code: 'YEAR_CLOSED' | 'YEAR_OPEN' | 'YEAR_NOT_ENDED' | 'EARLIER_YEAR_OPEN' | 'LATER_YEAR_CLOSED' | 'DRAFTS_IN_YEAR' | 'BOOKS_LOCKED' | 'NO_RETAINED_EARNINGS';
  message: string;
  [detail: string]: unknown;
}

/**
 * Year-end close, the way an auditor expects it:
 *  - only after the year has ended, in order, with no drafts left inside;
 *  - a real closing entry (source CLOSING, dated on the last day) moves every
 *    income-statement balance into retained earnings, per branch / cost
 *    centre; every month and the year are then closed;
 *  - reopening needs a reason, is blocked behind a lock date, and posts the
 *    mirror of the closing entry, so the ledger keeps the full trail
 *    (close -> reopen -> re-close) instead of deleting anything.
 */
@Injectable()
export class YearEndService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly fiscal: FiscalRepository,
    private readonly calendar: FiscalCalendarService,
    private readonly ledger: LedgerRepository,
    private readonly journals: JournalsRepository,
    private readonly accounts: AccountsRepository,
    private readonly books: BooksRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  /** What closing would do, and what blocks it: shown before the user confirms. */
  async preview(yearId: string) {
    const year = await this.requireYear(yearId);
    const [blockers, summary] = await Promise.all([this.closeBlockers(year), this.summary(year)]);
    return { yearId: year.id, name: year.name, status: year.status, blockers, ...summary };
  }

  async close(yearId: string) {
    const result = await this.db.transaction(async () => {
      await this.fiscal.lockYear(yearId);
      const year = await this.requireYear(yearId);
      const blockers = await this.closeBlockers(year);
      if (blockers.length > 0) throw this.blocked(`Fiscal year ${year.name} cannot be closed yet`, blockers);

      const { baseCurrency } = await this.accounting.profile();
      const retainedEarnings = (await this.accounts.findBySystemKey(SystemAccount.RETAINED_EARNINGS))!;
      const memo = `Year-end closing ${year.name}`;
      const plan = buildClosingEntry(await this.ledger.profitAndLossBalances(year.startDate, year.endDate), retainedEarnings.id, memo);

      let closingEntryId: string | null = null;
      let closingNumber: string | null = null;
      if (plan.lines.length > 0) {
        const draft = await this.journals.createDraft(
          {
            date: year.endDate,
            source: 'CLOSING',
            memo,
            currency: baseCurrency,
            totalAmount: plan.total.toFixed(4),
            createdById: this.userId(),
          },
          plan.lines,
        );
        await this.posting.postDraft(draft.id);
        closingEntryId = draft.id;
        closingNumber = (await this.journals.findDetail(draft.id))?.number ?? null;
      }

      const userId = this.userId();
      await this.fiscal.closeOpenPeriods(year.id, userId);
      await this.fiscal.setYearStatus(year.id, { status: 'CLOSED', closedById: userId, closingEntryId });
      await this.calendar.ensureYearAfter(year);
      await this.audit.record({
        action: 'fiscal_year.closed',
        entityType: 'fiscal_year',
        entityId: year.id,
        metadata: { name: year.name, profit: formatAmount(plan.profit, baseCurrency), closingEntry: closingNumber },
      });
      return { closingNumber };
    });
    return { ...(await this.preview(yearId)), closingEntryNumber: result.closingNumber };
  }

  async reopen(yearId: string, reason: string) {
    await this.db.transaction(async () => {
      await this.fiscal.lockYear(yearId);
      const year = await this.requireYear(yearId);
      const blockers = await this.reopenBlockers(year);
      if (blockers.length > 0) throw this.blocked(`Fiscal year ${year.name} cannot be reopened`, blockers);

      // Open the year first: the ledger only accepts the reversal into an open year.
      await this.fiscal.setYearStatus(year.id, { status: 'OPEN', closedById: null, closingEntryId: null });

      let reversalNumber: string | null = null;
      if (year.closingEntryId) {
        const closing = (await this.journals.findDetail(year.closingEntryId))!;
        const lines = mirrorLines(
          closing.lines.map((l) => ({
            accountId: l.accountId,
            debit: new Decimal(l.debit.toString()),
            credit: new Decimal(l.credit.toString()),
            description: l.description,
            branchId: l.branchId,
            costCenterId: l.costCenterId,
            contactId: l.contactId,
            taxCodeId: l.taxCodeId,
            taxRole: l.taxRole,
            taxBase: l.taxBase ? new Decimal(l.taxBase.toString()) : null,
          })),
        );
        const draft = await this.journals.createDraft(
          {
            date: year.endDate,
            source: 'CLOSING',
            reference: closing.number,
            memo: `Reopening ${year.name}: reverses ${closing.number}`,
            currency: closing.currency,
            totalAmount: sumMoney(lines.map((l) => l.debit)).toFixed(4),
            reversalOfId: closing.id,
            createdById: this.userId(),
          },
          lines,
        );
        await this.posting.postDraft(draft.id);
        reversalNumber = (await this.journals.findDetail(draft.id))?.number ?? null;
      }

      await this.audit.record({
        action: 'fiscal_year.reopened',
        entityType: 'fiscal_year',
        entityId: year.id,
        metadata: { name: year.name, reason, closingReversal: reversalNumber },
      });
    });
    return this.preview(yearId);
  }

  private async closeBlockers(year: FiscalYearWithPeriods): Promise<YearEndBlocker[]> {
    if (year.status === 'CLOSED') return [{ code: 'YEAR_CLOSED', message: `${year.name} is already closed` }];
    const [earlierOpen, drafts, retainedEarnings, today] = await Promise.all([
      this.fiscal.yearsBefore(year.startDate, 'OPEN'),
      this.journals.countDrafts({ from: year.startDate, to: year.endDate }),
      this.accounts.findBySystemKey(SystemAccount.RETAINED_EARNINGS),
      this.accounting.today(),
    ]);
    const blockers: YearEndBlocker[] = [];
    if (today <= year.endDate) {
      blockers.push({ code: 'YEAR_NOT_ENDED', message: `${year.name} ends on ${formatDateOnly(year.endDate)}`, endDate: formatDateOnly(year.endDate) });
    }
    for (const earlier of earlierOpen) {
      blockers.push({ code: 'EARLIER_YEAR_OPEN', message: `Close ${earlier.name} first`, yearId: earlier.id, name: earlier.name });
    }
    if (drafts > 0) {
      blockers.push({ code: 'DRAFTS_IN_YEAR', message: `${drafts} draft entries are dated in ${year.name}; post or delete them`, count: drafts });
    }
    if (!retainedEarnings) {
      blockers.push({ code: 'NO_RETAINED_EARNINGS', message: 'The retained earnings system account is missing' });
    }
    return blockers;
  }

  private async reopenBlockers(year: FiscalYear): Promise<YearEndBlocker[]> {
    if (year.status === 'OPEN') return [{ code: 'YEAR_OPEN', message: `${year.name} is open` }];
    const [laterClosed, { lockDate, taxLockDate }] = await Promise.all([
      this.fiscal.yearsAfter(year.startDate, 'CLOSED'),
      this.books.get(),
    ]);
    const blockers: YearEndBlocker[] = [];
    for (const later of laterClosed) {
      blockers.push({ code: 'LATER_YEAR_CLOSED', message: `Reopen ${later.name} first`, yearId: later.id, name: later.name });
    }
    const lockedThrough = [lockDate, taxLockDate].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
    if (lockedThrough && lockedThrough >= year.endDate) {
      blockers.push({
        code: 'BOOKS_LOCKED',
        message: `The books are locked through ${formatDateOnly(lockedThrough)}; move the lock date back first`,
        lockedThrough: formatDateOnly(lockedThrough),
      });
    }
    return blockers;
  }

  /** Revenue, expenses and profit of the year, before closing. */
  private async summary(year: FiscalYear) {
    const { baseCurrency } = await this.accounting.profile();
    const [balances, accounts] = await Promise.all([
      this.ledger.profitAndLossBalances(year.startDate, year.endDate),
      this.accounts.list({ includeInactive: true }),
    ]);
    const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
    // A closed year's balances already include its closing entry; report the pre-closing figures.
    const closing = year.closingEntryId ? await this.journals.findDetail(year.closingEntryId) : null;
    const closingNet = new Map<string, Decimal>();
    for (const line of closing?.lines ?? []) {
      const net = new Decimal(line.debit.toString()).minus(line.credit.toString());
      closingNet.set(line.accountId, (closingNet.get(line.accountId) ?? new Decimal(0)).plus(net));
    }
    const netOf = (type: 'REVENUE' | 'EXPENSE') => {
      const ids = new Set([...balances.map((b) => b.accountId), ...closingNet.keys()].filter((id) => typeOf.get(id) === type));
      return sumMoney(
        [...ids].map((id) =>
          sumMoney(balances.filter((b) => b.accountId === id).map((b) => b.net)).minus(closingNet.get(id) ?? 0),
        ),
      );
    };
    const revenue = netOf('REVENUE').negated();
    const expenses = netOf('EXPENSE');
    return {
      startDate: formatDateOnly(year.startDate),
      endDate: formatDateOnly(year.endDate),
      currency: baseCurrency,
      revenue: formatAmount(revenue, baseCurrency),
      expenses: formatAmount(expenses, baseCurrency),
      profit: formatAmount(revenue.minus(expenses), baseCurrency),
      closingEntryId: year.closingEntryId,
    };
  }

  private async requireYear(id: string): Promise<FiscalYearWithPeriods> {
    const year = await this.fiscal.findYearById(id);
    if (!year) throw AppException.notFound('Fiscal year', id);
    return year;
  }

  private blocked(message: string, blockers: YearEndBlocker[]): AppException {
    return new AppException(ErrorCode.YEAR_END_BLOCKED, message, { blockers });
  }

  private userId(): string | null {
    return this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null;
  }
}
