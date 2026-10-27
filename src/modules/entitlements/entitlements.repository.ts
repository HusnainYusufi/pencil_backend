import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { FeatureType, SubscriptionStatus } from '../../generated/prisma/enums.js';

export interface FeatureGrant {
  featureKey: string;
  type: FeatureType;
  enabled: boolean;
  limitValue: number | null;
}

export interface TenantEntitlementSource {
  planCode: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  planFeatures: FeatureGrant[];
  overrides: FeatureGrant[];
}

@Injectable()
export class EntitlementsRepository extends BaseRepository {
  async loadForTenant(tenantId: string, now = new Date()): Promise<TenantEntitlementSource> {
    const [subscription, overrides] = await Promise.all([
      this.client.subscription.findUnique({
        where: { tenantId },
        select: {
          status: true,
          plan: {
            select: {
              code: true,
              features: {
                select: { featureKey: true, enabled: true, limitValue: true, feature: { select: { type: true } } },
              },
            },
          },
        },
      }),
      this.client.tenantFeatureOverride.findMany({
        where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { featureKey: true, enabled: true, limitValue: true, feature: { select: { type: true } } },
      }),
    ]);

    const toGrant = (row: {
      featureKey: string;
      enabled: boolean;
      limitValue: number | null;
      feature: { type: FeatureType };
    }): FeatureGrant => ({
      featureKey: row.featureKey,
      type: row.feature.type,
      enabled: row.enabled,
      limitValue: row.limitValue,
    });

    return {
      planCode: subscription?.plan.code ?? null,
      subscriptionStatus: subscription?.status ?? null,
      planFeatures: subscription?.plan.features.map(toGrant) ?? [],
      overrides: overrides.map(toGrant),
    };
  }
}
