import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { CountryCode, SubscriptionStatus, TenantStatus } from '../../generated/prisma/enums.js';

/** Cross-tenant aggregates for the platform overview (global tables only). */
@Injectable()
export class PlatformStatsRepository extends BaseRepository {
  async tenantsByStatus(): Promise<Array<{ status: TenantStatus; count: number }>> {
    const rows = await this.client.tenant.groupBy({ by: ['status'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  async tenantsByCountry(): Promise<Array<{ country: CountryCode; count: number }>> {
    const rows = await this.client.tenant.groupBy({ by: ['country'], _count: { _all: true } });
    return rows.map((r) => ({ country: r.country, count: r._count._all }));
  }

  async subscriptionsByStatus(): Promise<Array<{ status: SubscriptionStatus; count: number }>> {
    const rows = await this.client.subscription.groupBy({ by: ['status'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  async tenantsByPlan(): Promise<Array<{ planId: string; code: string; name: string; count: number }>> {
    const [plans, counts] = await Promise.all([
      this.client.plan.findMany({ select: { id: true, code: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      this.client.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);
    const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
    return plans.map((p) => ({ planId: p.id, code: p.code, name: p.name, count: byPlan.get(p.id) ?? 0 }));
  }

  /** New tenants per UTC day for the last `days` days (zero-filled). */
  async signupsPerDay(days: number): Promise<Array<{ date: string; count: number }>> {
    const rows = await this.inScope(
      (client) => client.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT gs::date AS day, COUNT(t.id) AS count
        FROM generate_series((now() AT TIME ZONE 'utc')::date - ${days - 1}::int, (now() AT TIME ZONE 'utc')::date, interval '1 day') AS gs
        LEFT JOIN tenants t ON (t.created_at AT TIME ZONE 'utc')::date = gs::date
        GROUP BY gs ORDER BY gs`,
    );
    return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  recentTenants(limit: number) {
    return this.client.tenant.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        country: true,
        status: true,
        createdAt: true,
        subscription: { select: { status: true, plan: { select: { code: true, name: true } } } },
      },
    });
  }
}
