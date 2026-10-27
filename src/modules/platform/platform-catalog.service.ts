import { Injectable } from '@nestjs/common';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import type { Feature } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { FeaturesRepository } from '../catalog/features.repository.js';
import { PlansRepository, type PlanDetail } from '../catalog/plans.repository.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import type {
  CreateFeatureDto,
  CreatePlanDto,
  PlanFeatureDto,
  PlanPriceDto,
  UpdateFeatureDto,
  UpdatePlanDto,
} from './dto/platform.dto.js';

/** Plans, prices and features: what each tier sells. */
@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly db: Db,
    private readonly plans: PlansRepository,
    private readonly features: FeaturesRepository,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  listFeatures(): Promise<Feature[]> {
    return this.features.list();
  }

  async createFeature(dto: CreateFeatureDto): Promise<Feature> {
    return this.db.transaction(async () => {
      const feature = await this.features.create(dto);
      await this.audit.record({ action: 'catalog.feature_created', tenantId: null, entityType: 'feature', entityId: feature.key });
      return feature;
    });
  }

  async updateFeature(key: string, dto: UpdateFeatureDto): Promise<Feature> {
    if (!(await this.features.findByKey(key))) throw AppException.notFound('Feature', key);
    return this.features.update(key, dto);
  }

  listPlans(includeInactive: boolean): Promise<PlanDetail[]> {
    return this.plans.list({ includeInactive });
  }

  async getPlan(id: string): Promise<PlanDetail> {
    const plan = await this.plans.findById(id);
    if (!plan) throw AppException.notFound('Plan', id);
    return plan;
  }

  async createPlan(dto: CreatePlanDto): Promise<PlanDetail> {
    const features = await this.validateFeatures(dto.features);
    const prices = this.validatePrices(dto.prices);
    const { features: _f, prices: _p, ...plan } = dto;
    return this.db.transaction(async () => {
      const created = await this.plans.create(plan, features, prices);
      await this.audit.record({ action: 'catalog.plan_created', tenantId: null, entityType: 'plan', entityId: created.id, metadata: { code: created.code } });
      return created;
    });
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<PlanDetail> {
    await this.getPlan(id);
    return this.db.transaction(async () => {
      const updated = await this.plans.update(id, dto);
      await this.audit.record({ action: 'catalog.plan_updated', tenantId: null, entityType: 'plan', entityId: id, metadata: { changes: Object.keys(dto) } });
      return updated;
    });
  }

  /** Changes entitlements of every tenant on the plan (effective within the cache TTL, immediately on this node). */
  async replacePlanFeatures(id: string, input: PlanFeatureDto[]): Promise<PlanDetail> {
    await this.getPlan(id);
    const features = await this.validateFeatures(input);
    await this.db.transaction(async () => {
      await this.plans.replaceFeatures(id, features);
      await this.audit.record({ action: 'catalog.plan_features_replaced', tenantId: null, entityType: 'plan', entityId: id, metadata: { features: features.map((f) => f.featureKey) } });
    });
    this.entitlements.invalidate();
    return this.getPlan(id);
  }

  async replacePlanPrices(id: string, input: PlanPriceDto[]): Promise<PlanDetail> {
    await this.getPlan(id);
    const prices = this.validatePrices(input);
    await this.db.transaction(async () => {
      await this.plans.replacePrices(id, prices);
      await this.audit.record({ action: 'catalog.plan_prices_replaced', tenantId: null, entityType: 'plan', entityId: id });
    });
    return this.getPlan(id);
  }

  private async validateFeatures(input: PlanFeatureDto[]) {
    const keys = input.map((f) => f.featureKey);
    if (new Set(keys).size !== keys.length) {
      throw new AppException(ErrorCode.BAD_REQUEST, 'Duplicate featureKey in features');
    }
    const known = new Map((await this.features.findByKeys(keys)).map((f) => [f.key, f]));
    const errors: string[] = [];
    for (const f of input) {
      const feature = known.get(f.featureKey);
      if (!feature) errors.push(`Unknown feature '${f.featureKey}'`);
      else if (feature.type === 'BOOLEAN' && f.limitValue != null) {
        errors.push(`'${f.featureKey}' is a boolean feature; limitValue is not allowed`);
      }
    }
    if (errors.length > 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Request validation failed', [{ field: 'features', errors }]);
    }
    return input.map((f) => ({ featureKey: f.featureKey, enabled: f.enabled, limitValue: f.limitValue ?? null }));
  }

  private validatePrices(input: PlanPriceDto[]) {
    const keys = input.map((p) => `${p.currency}:${p.interval}`);
    if (new Set(keys).size !== keys.length) {
      throw new AppException(ErrorCode.BAD_REQUEST, 'Duplicate currency/interval in prices');
    }
    return input.map((p) => ({ currency: p.currency, interval: p.interval, amount: p.amount }));
  }
}
