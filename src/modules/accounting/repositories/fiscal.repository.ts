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
