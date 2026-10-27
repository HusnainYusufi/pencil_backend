import { Injectable } from '@nestjs/common';
import { addMonths } from '../../common/helpers/date.js';
import type { Page } from '../../common/helpers/pagination.js';
import { normalizeEmail } from '../../common/helpers/string.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { AccessCache } from '../../core/security/access-cache.js';
import type { TenantFeatureOverride } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { FeaturesRepository } from '../catalog/features.repository.js';
import { PlansRepository } from '../catalog/plans.repository.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { UsersRepository } from '../identity/users.repository.js';
import { SubscriptionsRepository } from '../tenancy/repositories/subscriptions.repository.js';
import { TenantsRepository, type TenantAdminView } from '../tenancy/repositories/tenants.repository.js';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service.js';
import type {
  ChangeSubscriptionDto,
  FeatureOverrideDto,
  OnboardTenantDto,
  TenantsQueryDto,
  UpdateTenantStatusDto,
} from './dto/platform.dto.js';
import { FeatureOverridesRepository } from './feature-overrides.repository.js';

/**
 * Tenant lifecycle operations for pencil_admin. Runs in platform scope (RLS
 * bypass set by AuthGuard); every mutation is audited and invalidates the
 * caches that depend on it.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly tenants: TenantsRepository,
    private readonly subscriptions: SubscriptionsRepository,
    private readonly users: UsersRepository,
    private readonly plans: PlansRepository,
    private readonly features: FeaturesRepository,
    private readonly overrides: FeatureOverridesRepository,
    private readonly provisioning: TenantProvisioningService,
    private readonly passwords: PasswordService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly accessCache: AccessCache,
  ) {}

  list(query: TenantsQueryDto): Promise<Page<TenantAdminView>> {
    return this.tenants.list(query);
  }

  async get(id: string) {
    const tenant = await this.tenants.findAdminView(id);
    if (!tenant) throw AppException.notFound('Tenant', id);
    const [entitlements, overrides] = await Promise.all([
      this.entitlements.getForTenant(id),
      this.overrides.listForTenant(id),
    ]);
    return { ...tenant, entitlements: entitlements.toJSON(), overrides };
  }

  /** Sales-assisted onboarding: attaches an existing user or creates one. */
  async onboard(dto: OnboardTenantDto): Promise<TenantAdminView> {
    const email = normalizeEmail(dto.owner.email);
    const existing = await this.users.findByEmail(email);
    if (!existing && !dto.owner.password) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'owner.password', errors: ['owner.password is required for a new user'] },
      ]);
    }
    const passwordHash = existing ? null : await this.passwords.hash(dto.owner.password!);

    const tenantId = await this.db.transaction(async () => {
      const ownerId =
        existing?.id ??
        (await this.users.create({ email, passwordHash: passwordHash!, fullName: dto.owner.fullName.trim() })).id;
      const tenant = await this.provisioning.provision({
        company: dto.company,
        ownerUserId: ownerId,
        planCode: dto.planCode,
      });
      return tenant.id;
    });
    return (await this.tenants.findAdminView(tenantId))!;
  }

  async setStatus(id: string, dto: UpdateTenantStatusDto): Promise<TenantAdminView> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw AppException.notFound('Tenant', id);
    if (dto.status !== 'ACTIVE' && !dto.reason) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [
        { field: 'reason', errors: ['reason is required when suspending or archiving'] },
      ]);
    }

    await this.db.transaction(async () => {
      await this.tenants.update(id, {
        status: dto.status,
        suspendedAt: dto.status === 'ACTIVE' ? null : new Date(),
        suspensionReason: dto.status === 'ACTIVE' ? null : dto.reason,
      });
      await this.audit.record({
        action: `tenant.status_changed`,
        tenantId: id,
        entityType: 'tenant',
        entityId: id,
        metadata: { from: tenant.status, to: dto.status, reason: dto.reason ?? null },
      });
    });
    this.accessCache.invalidateTenant(id);
    return (await this.tenants.findAdminView(id))!;
  }

  async changeSubscription(tenantId: string, dto: ChangeSubscriptionDto): Promise<TenantAdminView> {
    const [subscription, plan] = await Promise.all([
      this.subscriptions.findByTenant(tenantId),
      this.plans.findByCode(dto.planCode),
    ]);
    if (!subscription) throw AppException.notFound('Subscription for tenant', tenantId);
    if (!plan) throw AppException.notFound('Plan', dto.planCode);

    const now = new Date();
    const status = dto.status ?? (subscription.status === 'TRIALING' ? 'ACTIVE' : subscription.status);
    const currentPeriodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : subscription.currentPeriodEnd;
    const periodRestarts = status === 'ACTIVE' && subscription.status !== 'ACTIVE' && !dto.currentPeriodEnd;

    await this.db.transaction(async () => {
      await this.subscriptions.update(tenantId, {
        planId: plan.id,
        status,
        billingInterval: dto.billingInterval ?? subscription.billingInterval,
        ...(periodRestarts
          ? {
              currentPeriodStart: now,
              currentPeriodEnd: addMonths(now, (dto.billingInterval ?? subscription.billingInterval) === 'YEARLY' ? 12 : 1),
            }
          : { currentPeriodEnd }),
        ...(status === 'CANCELED' && { canceledAt: now }),
      });
      await this.audit.record({
        action: 'subscription.changed',
        tenantId,
        entityType: 'subscription',
        entityId: subscription.id,
        metadata: { fromPlanId: subscription.planId, toPlan: plan.code, fromStatus: subscription.status, toStatus: status },
      });
    });
    this.entitlements.invalidate(tenantId);
    this.accessCache.invalidateTenant(tenantId);
    return (await this.tenants.findAdminView(tenantId))!;
  }

  async setFeatureOverride(tenantId: string, featureKey: string, dto: FeatureOverrideDto): Promise<TenantFeatureOverride> {
    const [tenant, feature] = await Promise.all([this.tenants.findById(tenantId), this.features.findByKey(featureKey)]);
    if (!tenant) throw AppException.notFound('Tenant', tenantId);
    if (!feature) throw AppException.notFound('Feature', featureKey);
    if (feature.type === 'BOOLEAN' && dto.limitValue != null) {
      throw new AppException(ErrorCode.BAD_REQUEST, `Feature '${featureKey}' is a boolean feature; limitValue is not allowed`);
    }
    const admin = this.ctx.requirePlatformAdmin();

    const override = await this.db.transaction(async () => {
      const result = await this.overrides.upsert(tenantId, featureKey, {
        enabled: dto.enabled,
        limitValue: dto.limitValue ?? null,
        reason: dto.reason,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: admin.adminId,
      });
      await this.audit.record({
        action: 'entitlement.override_set',
        tenantId,
        entityType: 'feature',
        entityId: featureKey,
        metadata: { enabled: dto.enabled, limitValue: dto.limitValue ?? null, expiresAt: dto.expiresAt ?? null },
      });
      return result;
    });
    this.entitlements.invalidate(tenantId);
    return override;
  }

  async removeFeatureOverride(tenantId: string, featureKey: string): Promise<void> {
    await this.db.transaction(async () => {
      if (!(await this.overrides.delete(tenantId, featureKey))) {
        throw AppException.notFound('Feature override', featureKey);
      }
      await this.audit.record({ action: 'entitlement.override_removed', tenantId, entityType: 'feature', entityId: featureKey });
    });
    this.entitlements.invalidate(tenantId);
  }
}
