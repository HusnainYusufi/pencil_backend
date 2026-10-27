import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { TenantFeatureOverride } from '../../generated/prisma/client.js';

@Injectable()
export class FeatureOverridesRepository extends BaseRepository {
  listForTenant(tenantId: string): Promise<TenantFeatureOverride[]> {
    return this.client.tenantFeatureOverride.findMany({ where: { tenantId }, orderBy: { featureKey: 'asc' } });
  }

  upsert(
    tenantId: string,
    featureKey: string,
    data: { enabled: boolean; limitValue: number | null; reason?: string; expiresAt: Date | null; createdById: string },
  ): Promise<TenantFeatureOverride> {
    return this.client.tenantFeatureOverride.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      create: { tenantId, featureKey, ...data },
      update: data,
    });
  }

  async delete(tenantId: string, featureKey: string): Promise<boolean> {
    const { count } = await this.client.tenantFeatureOverride.deleteMany({ where: { tenantId, featureKey } });
    return count > 0;
  }
}
