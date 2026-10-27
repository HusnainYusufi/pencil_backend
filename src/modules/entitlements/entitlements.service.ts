import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { EntitlementsRepository, type FeatureGrant } from './entitlements.repository.js';

export interface EntitlementValue {
  enabled: boolean;
  /** LIMIT features: max allowed, `null` = unlimited. BOOLEAN features: null. */
  limit: number | null;
}

/** Effective, immutable entitlements of one tenant (plan + overrides). */
export class Entitlements {
  constructor(
    readonly planCode: string | null,
    private readonly values: ReadonlyMap<string, EntitlementValue>,
  ) {}

  has(featureKey: string): boolean {
    return this.values.get(featureKey)?.enabled === true;
  }

  /** 0 when the feature is not granted; `null` when unlimited. */
  limit(featureKey: string): number | null {
    const value = this.values.get(featureKey);
    if (!value?.enabled) return 0;
    return value.limit;
  }

  toJSON(): Record<string, EntitlementValue> {
    return Object.fromEntries(this.values);
  }
}

@Injectable()
export class EntitlementsService {
  private readonly cache = new LRUCache<string, Entitlements>({ max: 10_000, ttl: 60_000 });

  constructor(private readonly repository: EntitlementsRepository) {}

  async getForTenant(tenantId: string): Promise<Entitlements> {
    const cached = this.cache.get(tenantId);
    if (cached) return cached;

    const source = await this.repository.loadForTenant(tenantId);
    const values = new Map<string, EntitlementValue>();
    const apply = (grant: FeatureGrant) =>
      values.set(grant.featureKey, {
        enabled: grant.enabled,
        limit: grant.type === 'LIMIT' ? grant.limitValue : null,
      });
    source.planFeatures.forEach(apply);
    source.overrides.forEach(apply); // overrides win

    const entitlements = new Entitlements(source.planCode, values);
    this.cache.set(tenantId, entitlements);
    return entitlements;
  }

  /** Throws unless `currentUsage + adding` stays within the tenant's limit. */
  async assertWithinLimit(tenantId: string, featureKey: string, currentUsage: number, adding = 1): Promise<void> {
    const entitlements = await this.getForTenant(tenantId);
    if (!entitlements.has(featureKey)) {
      throw new AppException(ErrorCode.FEATURE_NOT_AVAILABLE, 'Your plan does not include this feature', {
        feature: featureKey,
      });
    }
    const limit = entitlements.limit(featureKey);
    if (limit !== null && currentUsage + adding > limit) {
      throw new AppException(ErrorCode.PLAN_LIMIT_REACHED, 'Your plan limit has been reached', {
        feature: featureKey,
        limit,
        current: currentUsage,
      });
    }
  }

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}
