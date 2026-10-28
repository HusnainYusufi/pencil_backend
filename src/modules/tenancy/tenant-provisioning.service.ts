import { Injectable } from '@nestjs/common';
import { COUNTRY_PROFILES } from '../../common/constants/countries.js';
import { addDays, addMonths } from '../../common/helpers/date.js';
import { randomAlphanumeric, slugify } from '../../common/helpers/string.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { CountryCode, Tenant } from '../../generated/prisma/client.js';
import { OWNER_ROLE_KEY } from '../access/system-roles.js';
import { AuditService } from '../audit/audit.service.js';
import { PlansRepository } from '../catalog/plans.repository.js';
import { MembershipsRepository } from './repositories/memberships.repository.js';
import { RolesRepository } from './repositories/roles.repository.js';
import { SubscriptionsRepository } from './repositories/subscriptions.repository.js';
import { TenantsRepository } from './repositories/tenants.repository.js';
import { TenantProvisioningHooks } from './provisioning-hooks.js';
import { assertValidTaxNumber } from './tax-number.js';

export interface CompanyProfileInput {
  legalName: string;
  tradeName?: string;
  country: CountryCode;
  taxNumber?: string;
  commercialRegistration?: string;
  locale?: string;
}

export interface ProvisionTenantInput {
  company: CompanyProfileInput;
  ownerUserId: string;
  /** Defaults to the first active public plan. */
  planCode?: string;
}

/**
 * Creates a ready-to-use company in ONE transaction: tenant, system roles,
 * owner membership and subscription (trial when the plan has trial days).
 * Shared by self-service signup and pencil_admin onboarding.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly tenants: TenantsRepository,
    private readonly roles: RolesRepository,
    private readonly memberships: MembershipsRepository,
    private readonly subscriptions: SubscriptionsRepository,
    private readonly plans: PlansRepository,
    private readonly audit: AuditService,
    private readonly hooks: TenantProvisioningHooks,
  ) {}

  /** Must run under system scope (`db.asSystem`): the tenant does not exist yet. */
  provision(input: ProvisionTenantInput): Promise<Tenant> {
    if (!this.ctx.bypassRls) {
      throw new Error('TenantProvisioningService.provision() requires system scope (Db.asSystem)');
    }
    assertValidTaxNumber(input.company.country, input.company.taxNumber, 'company.taxNumber');

    return this.db.transaction(async () => {
      const plan = input.planCode
        ? await this.plans.findByCode(input.planCode)
        : await this.plans.findDefaultForSignup();
      if (!plan || !plan.isActive) {
        throw new AppException(ErrorCode.BAD_REQUEST, input.planCode ? `Plan '${input.planCode}' is not available` : 'No plan is available for signup');
      }

      const profile = COUNTRY_PROFILES[input.company.country];
      const tenant = await this.tenants.create({
        slug: this.generateSlug(input.company.tradeName ?? input.company.legalName),
        legalName: input.company.legalName.trim(),
        tradeName: input.company.tradeName?.trim(),
        country: input.company.country,
        baseCurrency: profile.currency,
        timezone: profile.timezone,
        locale: input.company.locale ?? profile.defaultLocale,
        taxNumber: input.company.taxNumber,
        commercialRegistration: input.company.commercialRegistration,
      });

      const roleIds = await this.roles.createSystemRoles(tenant.id);
      await this.memberships.create({
        tenantId: tenant.id,
        userId: input.ownerUserId,
        roleId: roleIds.get(OWNER_ROLE_KEY)!,
        status: 'ACTIVE',
      });

      const now = new Date();
      const trial = plan.trialDays > 0;
      await this.subscriptions.create({
        tenantId: tenant.id,
        planId: plan.id,
        status: trial ? 'TRIALING' : 'ACTIVE',
        billingInterval: 'MONTHLY',
        currency: profile.currency,
        trialEndsAt: trial ? addDays(now, plan.trialDays) : null,
        currentPeriodStart: now,
        currentPeriodEnd: trial ? addDays(now, plan.trialDays) : addMonths(now, 1),
      });

      for (const hook of this.hooks.list()) {
        await hook.onTenantProvisioned({
          id: tenant.id,
          country: tenant.country,
          baseCurrency: tenant.baseCurrency,
          timezone: tenant.timezone,
          fiscalYearStartMonth: tenant.fiscalYearStartMonth,
          taxNumber: tenant.taxNumber,
        });
      }

      await this.audit.record({
        action: 'tenant.provisioned',
        tenantId: tenant.id,
        entityType: 'tenant',
        entityId: tenant.id,
        metadata: { plan: plan.code, country: tenant.country, ownerUserId: input.ownerUserId },
      });
      return tenant;
    });
  }

  /** Human-friendly prefix + random suffix (Arabic names fall back to "company"). */
  private generateSlug(name: string): string {
    const base = slugify(name, 40) || 'company';
    return `${base}-${randomAlphanumeric(5)}`;
  }
}
