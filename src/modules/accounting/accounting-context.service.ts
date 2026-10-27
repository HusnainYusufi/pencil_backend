import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { todayIn } from '../../common/helpers/date.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { TenantsRepository } from '../tenancy/repositories/tenants.repository.js';

export interface AccountingProfile {
  tenantId: string;
  country: CountryCode;
  baseCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
}

/** The current tenant's accounting settings (cached; base currency never changes). */
@Injectable()
export class AccountingContext {
  private readonly cache = new LRUCache<string, AccountingProfile>({ max: 10_000, ttl: 5 * 60_000 });

  constructor(
    private readonly ctx: RequestContext,
    private readonly tenants: TenantsRepository,
  ) {}

  async profile(): Promise<AccountingProfile> {
    const tenantId = this.ctx.requireTenantId();
    const cached = this.cache.get(tenantId);
    if (cached) return cached;
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw AppException.notFound('Tenant');
    const profile: AccountingProfile = {
      tenantId,
      country: tenant.country,
      baseCurrency: tenant.baseCurrency,
      timezone: tenant.timezone,
      fiscalYearStartMonth: tenant.fiscalYearStartMonth,
    };
    this.cache.set(tenantId, profile);
    return profile;
  }

  /** Today's business date in the tenant's time zone. */
  async today(): Promise<Date> {
    return todayIn((await this.profile()).timezone);
  }
}
