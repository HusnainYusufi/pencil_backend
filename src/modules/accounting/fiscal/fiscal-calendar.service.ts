import { Injectable } from '@nestjs/common';
import { formatDateOnly } from '../../../common/helpers/date.js';
import { RequestContext } from '../../../core/context/request-context.service.js';
import { Db } from '../../../core/database/db.service.js';
import { AppException } from '../../../core/errors/app.exception.js';
import { ErrorCode } from '../../../core/errors/error-codes.js';
import type { FiscalPeriod } from '../../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import { AccountingContext } from '../accounting-context.service.js';
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

  /**
   * The open period a posting dated `date` belongs to. Posting into the
   * year right after the latest one opens that year automatically, so
   * January's first invoice never fails on a missing calendar.
   */
  async resolveOpenPeriod(date: Date): Promise<FiscalPeriodWithYear> {
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
    if (period.status === 'CLOSED' || period.fiscalYear.status === 'CLOSED') {
      throw new AppException(
        ErrorCode.FISCAL_PERIOD_CLOSED,
        `The period ${formatDateOnly(period.startDate)}..${formatDateOnly(period.endDate)} is closed`,
        { periodId: period.id, fiscalYear: period.fiscalYear.name, period: period.number },
      );
    }
    return period;
  }

  async closePeriod(id: string): Promise<FiscalPeriod> {
    return this.setStatus(id, 'CLOSED');
  }

  async reopenPeriod(id: string): Promise<FiscalPeriod> {
    return this.setStatus(id, 'OPEN');
  }

  private async setStatus(id: string, status: 'OPEN' | 'CLOSED'): Promise<FiscalPeriod> {
    return this.db.transaction(async () => {
      const period = await this.fiscal.findPeriodById(id);
      if (!period) throw AppException.notFound('Fiscal period', id);
      if (status === 'OPEN' && period.fiscalYear.status === 'CLOSED') {
        throw new AppException(ErrorCode.FISCAL_PERIOD_CLOSED, `Fiscal year ${period.fiscalYear.name} is closed`);
      }
      if (period.status === status) return period;
      const updated = await this.fiscal.setPeriodStatus(id, status, this.ctx.requireUser().userId);
      await this.audit.record({
        action: status === 'CLOSED' ? 'fiscal_period.closed' : 'fiscal_period.reopened',
        entityType: 'fiscal_period',
        entityId: id,
        metadata: { fiscalYear: period.fiscalYear.name, period: period.number },
      });
      return updated;
    });
  }

  private async createYear(range: DateRange): Promise<FiscalYearWithPeriods> {
    const profile = await this.accounting.profile();
    return this.fiscal.createYear(profile.tenantId, { ...range, name: fiscalYearName(range) }, monthlyPeriods(range));
  }
}
