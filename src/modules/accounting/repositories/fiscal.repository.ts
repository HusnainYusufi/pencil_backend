import { Injectable } from '@nestjs/common';
import { TenantScopedRepository } from '../../../core/database/base.repository.js';
import type { FiscalPeriod, FiscalStatus, FiscalYear, Prisma } from '../../../generated/prisma/client.js';
import type { DateRange } from '../fiscal/fiscal-calendar.js';

export type FiscalYearWithPeriods = Prisma.FiscalYearGetPayload<{ include: { periods: true } }>;
export type FiscalPeriodWithYear = Prisma.FiscalPeriodGetPayload<{ include: { fiscalYear: true } }>;

@Injectable()
export class FiscalRepository extends TenantScopedRepository {
  listYears(): Promise<FiscalYearWithPeriods[]> {
    return this.client.fiscalYear.findMany({
      where: { tenantId: this.tenantId },
      include: { periods: { orderBy: { number: 'asc' } } },
      orderBy: { startDate: 'desc' },
    });
  }

  latestYear(): Promise<FiscalYear | null> {
    return this.client.fiscalYear.findFirst({ where: { tenantId: this.tenantId }, orderBy: { startDate: 'desc' } });
  }

  earliestYear(): Promise<FiscalYear | null> {
    return this.client.fiscalYear.findFirst({ where: { tenantId: this.tenantId }, orderBy: { startDate: 'asc' } });
  }

  findPeriodForDate(date: Date): Promise<FiscalPeriodWithYear | null> {
    return this.client.fiscalPeriod.findFirst({
      where: { tenantId: this.tenantId, startDate: { lte: date }, endDate: { gte: date } },
      include: { fiscalYear: true },
    });
  }

  findYearForDate(date: Date): Promise<FiscalYear | null> {
    return this.client.fiscalYear.findFirst({
      where: { tenantId: this.tenantId, startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  findYearById(id: string): Promise<FiscalYearWithPeriods | null> {
    return this.client.fiscalYear.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { periods: { orderBy: { number: 'asc' } } },
    });
  }

  /** Row-locks a fiscal year for the rest of the transaction (year-end close / reopen). */
  async lockYear(id: string): Promise<void> {
    const tenantId = this.tenantId;
    await this.inScope(
      (client) => client.$queryRaw`SELECT id FROM fiscal_years WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`,
    );
  }

  /**
   * Share-locks a period and its year while a posting is written: a
   * concurrent close waits for this transaction, then sees the posting.
   * Returns the statuses as of the lock.
   */
  async lockPeriodForPosting(periodId: string): Promise<{ periodStatus: FiscalStatus; yearStatus: FiscalStatus }> {
    const tenantId = this.tenantId;
    const [row] = await this.inScope(
      (client) => client.$queryRaw<Array<{ period_status: FiscalStatus; year_status: FiscalStatus }>>`
        SELECT p.status::text AS period_status, y.status::text AS year_status
        FROM fiscal_periods p JOIN fiscal_years y ON y.id = p.fiscal_year_id
        WHERE p.id = ${periodId}::uuid AND p.tenant_id = ${tenantId}::uuid
        FOR SHARE OF p, y`,
    );
    return { periodStatus: row!.period_status, yearStatus: row!.year_status };
  }

  yearsBefore(startDate: Date, status: FiscalStatus): Promise<FiscalYear[]> {
    return this.client.fiscalYear.findMany({
      where: { tenantId: this.tenantId, startDate: { lt: startDate }, status },
      orderBy: { startDate: 'asc' },
    });
  }

  yearsAfter(startDate: Date, status: FiscalStatus): Promise<FiscalYear[]> {
    return this.client.fiscalYear.findMany({
      where: { tenantId: this.tenantId, startDate: { gt: startDate }, status },
      orderBy: { startDate: 'asc' },
    });
  }

  findYearStarting(startDate: Date): Promise<FiscalYear | null> {
    return this.client.fiscalYear.findFirst({ where: { tenantId: this.tenantId, startDate } });
  }

  async closeOpenPeriods(fiscalYearId: string, userId: string | null): Promise<number> {
    const { count } = await this.client.fiscalPeriod.updateMany({
      where: { tenantId: this.tenantId, fiscalYearId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });
    return count;
  }

  setYearStatus(
    id: string,
    data: { status: FiscalStatus; closedById: string | null; closingEntryId: string | null },
  ): Promise<FiscalYear> {
    return this.client.fiscalYear.update({
      where: { id, tenantId: this.tenantId },
      data: { ...data, closedAt: data.status === 'CLOSED' ? new Date() : null },
    });
  }

  findPeriodById(id: string): Promise<FiscalPeriodWithYear | null> {
    return this.client.fiscalPeriod.findFirst({ where: { id, tenantId: this.tenantId }, include: { fiscalYear: true } });
  }

  setPeriodStatus(id: string, status: FiscalStatus, userId: string | null): Promise<FiscalPeriod> {
    const closing = status === 'CLOSED';
    return this.client.fiscalPeriod.update({
      where: { id, tenantId: this.tenantId },
      data: { status, closedAt: closing ? new Date() : null, closedById: closing ? userId : null },
    });
  }

  /** `tenantId` explicit so provisioning (system scope) can use it too. */
  createYear(
    tenantId: string,
    year: DateRange & { name: string },
    periods: Array<DateRange & { number: number }>,
  ): Promise<FiscalYearWithPeriods> {
    return this.client.fiscalYear.create({
      data: {
        tenantId,
        name: year.name,
        startDate: year.start,
        endDate: year.end,
        periods: {
          createMany: {
            data: periods.map((p) => ({ tenantId, number: p.number, startDate: p.start, endDate: p.end })),
          },
        },
      },
      include: { periods: { orderBy: { number: 'asc' } } },
    });
  }
}
