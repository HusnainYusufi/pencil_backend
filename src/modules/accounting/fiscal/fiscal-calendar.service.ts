import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../../common/helpers/date.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { FiscalPeriod } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
import { BooksRepository } from '../repositories/books.repository.js';
import {
  FiscalRepository,
  type FiscalPeriodWithYear,
  type FiscalYearWithPeriods,
} from '../repositories/fiscal.repository.js';
import { fiscalYearContaining, fiscalYearName, monthlyPeriods, nextFiscalYear, type DateRange } from './fiscal-calendar.js';

@Injectable()
export class FiscalCalendarService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly fiscal: FiscalRepository,
    private readonly accounting: AccountingContext,
    private readonly books: BooksRepository,
    private readonly audit: AuditService,
  ) {}

  listYears(): Promise<FiscalYearWithPeriods[]> {
    return this.fiscal.listYears();
  }

  /** Opens the fiscal year after the latest one (or the current one if none exist). */
  async createNextYear(): Promise<FiscalYearWithPeriods> {
    return this.db.transaction(async () => {
      const latest = await this.fiscal.latestYear();
      const range = latest
        ? nextFiscalYear({ start: latest.startDate, end: latest.endDate })
        : fiscalYearContaining(await this.accounting.today(), (await this.accounting.profile()).fiscalYearStartMonth);
      const year = await this.createYear(range);
      await this.audit.record({ action: 'fiscal_year.created', entityType: 'fiscal_year', entityId: year.id, metadata: { name: year.name } });
      return year;
    });
  }

  /** Creates the fiscal year following `year` unless it already exists. */
  async ensureYearAfter(year: { startDate: Date; endDate: Date }): Promise<void> {
    const next = nextFiscalYear({ start: year.startDate, end: year.endDate });
    if (!(await this.fiscal.findYearStarting(next.start))) await this.createYear(next);
  }

  /**
   * The open period a posting dated `date` belongs to, share-locked until the
   * posting commits (a concurrent close waits). Posting into the year right
   * after the latest one opens that year automatically, so January's first
   * invoice never fails on a missing calendar. Year-end closing entries
   * (`closing`) may land in a closed month of a still-open year.
   */
  async resolveOpenPeriod(date: Date, options: { closing?: boolean } = {}): Promise<FiscalPeriodWithYear> {
    let period = await this.fiscal.findPeriodForDate(date);
    if (!period) {
      const latest = await this.fiscal.latestYear();
      if (latest && date > latest.endDate) {
        const next = nextFiscalYear({ start: latest.startDate, end: latest.endDate });
        if (date <= next.end) {
          await this.createYear(next);
          period = await this.fiscal.findPeriodForDate(date);
        }
      }
    }
    if (!period) {
      throw new AppException(
        ErrorCode.FISCAL_PERIOD_NOT_FOUND,
        `No fiscal year covers ${formatDateOnly(date)}; create the fiscal year first`,
        { date: formatDateOnly(date) },
      );
    }
    const locked = this.db.inTransaction ? await this.fiscal.lockPeriodForPosting(period.id) : null;
    const periodStatus = locked?.periodStatus ?? period.status;
    const yearStatus = locked?.yearStatus ?? period.fiscalYear.status;
    if ((periodStatus === 'CLOSED' && !options.closing) || yearStatus === 'CLOSED') {
      throw new AppException(
        ErrorCode.FISCAL_PERIOD_CLOSED,
        `The period ${formatDateOnly(period.startDate)}..${formatDateOnly(period.endDate)} is closed`,
        { periodId: period.id, fiscalYear: period.fiscalYear.name, period: period.number },
      );
    }
    return period;
  }

  /** Months close in order: an earlier open month would otherwise still change. */
  async closePeriod(id: string): Promise<FiscalPeriod> {
    return this.db.transaction(async () => {
      const period = await this.fiscal.findPeriodById(id);
      if (!period) throw AppException.notFound('Fiscal period', id);
      if (period.status === 'CLOSED') return period;
      const year = await this.fiscal.findYearById(period.fiscalYearId);
      const earlierOpen = year?.periods.find((p) => p.number < period.number && p.status === 'OPEN');
      if (earlierOpen) {
        throw new AppException(ErrorCode.PERIOD_CLOSE_BLOCKED, `Close ${formatDateOnly(earlierOpen.startDate)}..${formatDateOnly(earlierOpen.endDate)} first`, {
          openPeriodId: earlierOpen.id,
          period: earlierOpen.number,
        });
      }
      const updated = await this.fiscal.setPeriodStatus(id, 'CLOSED', this.ctx.requireUser().userId);
      await this.audit.record({
        action: 'fiscal_period.closed',
        entityType: 'fiscal_period',
        entityId: id,
        metadata: { fiscalYear: period.fiscalYear.name, period: period.number },
      });
      return updated;
    });
  }

  /**
   * Reopening a month changes figures people may have relied on: it needs a
   * reason (audit log), an open year, and must not reach behind a lock date.
   */
  async reopenPeriod(id: string, reason: string): Promise<FiscalPeriod> {
    return this.db.transaction(async () => {
      const period = await this.fiscal.findPeriodById(id);
      if (!period) throw AppException.notFound('Fiscal period', id);
      if (period.fiscalYear.status === 'CLOSED') {
        throw new AppException(ErrorCode.FISCAL_PERIOD_CLOSED, `Fiscal year ${period.fiscalYear.name} is closed; reopen the year first`);
      }
      if (period.status === 'OPEN') return period;
      const { lockDate, taxLockDate } = await this.books.get();
      const lockedThrough = [lockDate, taxLockDate].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
      if (lockedThrough && period.startDate <= lockedThrough) {
        throw new AppException(ErrorCode.BOOKS_LOCKED, `The books are locked through ${formatDateOnly(lockedThrough)}`, {
          lockedThrough: formatDateOnly(lockedThrough),
        });
      }
      const updated = await this.fiscal.setPeriodStatus(id, 'OPEN', this.ctx.requireUser().userId);
      await this.audit.record({
        action: 'fiscal_period.reopened',
        entityType: 'fiscal_period',
        entityId: id,
        metadata: { fiscalYear: period.fiscalYear.name, period: period.number, reason },
      });
      return updated;
    });
  }

  private async createYear(range: DateRange): Promise<FiscalYearWithPeriods> {
    const profile = await this.accounting.profile();
    return this.fiscal.createYear(profile.tenantId, { ...range, name: fiscalYearName(range) }, monthlyPeriods(range));
  }
}
