import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { BillingInterval, Prisma } from '../../generated/prisma/client.js';

const PLAN_DETAIL = {
  prices: { orderBy: [{ currency: 'asc' }, { interval: 'asc' }] },
  features: { orderBy: { featureKey: 'asc' } },
} satisfies Prisma.PlanInclude;

export type PlanDetail = Prisma.PlanGetPayload<{ include: typeof PLAN_DETAIL }>;

export interface PlanFeatureInput {
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
}

export interface PlanPriceInput {
  currency: string;
  interval: BillingInterval;
  amount: string;
}

@Injectable()
export class PlansRepository extends BaseRepository {
  list(options: { includeInactive?: boolean } = {}): Promise<PlanDetail[]> {
    return this.client.plan.findMany({
      where: options.includeInactive ? {} : { isActive: true },
      include: PLAN_DETAIL,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  findById(id: string): Promise<PlanDetail | null> {
    return this.client.plan.findUnique({ where: { id }, include: PLAN_DETAIL });
  }

  findByCode(code: string): Promise<PlanDetail | null> {
    return this.client.plan.findUnique({ where: { code }, include: PLAN_DETAIL });
  }

  /** Plan assigned to self-service signups: first active public plan. */
  findDefaultForSignup(): Promise<PlanDetail | null> {
    return this.client.plan.findFirst({
      where: { isActive: true, isPublic: true },
      include: PLAN_DETAIL,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  create(
    data: Omit<Prisma.PlanCreateInput, 'prices' | 'features' | 'subscriptions'>,
    features: PlanFeatureInput[],
    prices: PlanPriceInput[],
  ): Promise<PlanDetail> {
    return this.client.plan.create({
      data: {
        ...data,
        features: { createMany: { data: features } },
        prices: { createMany: { data: prices } },
      },
      include: PLAN_DETAIL,
    });
  }

  update(id: string, data: Prisma.PlanUpdateInput): Promise<PlanDetail> {
    return this.client.plan.update({ where: { id }, data, include: PLAN_DETAIL });
  }

  /** Call inside a transaction: delete + insert must be atomic. */
  async replaceFeatures(planId: string, features: PlanFeatureInput[]): Promise<void> {
    await this.client.planFeature.deleteMany({ where: { planId } });
    if (features.length > 0) {
      await this.client.planFeature.createMany({ data: features.map((f) => ({ ...f, planId })) });
    }
  }

  /** Call inside a transaction: delete + insert must be atomic. */
  async replacePrices(planId: string, prices: PlanPriceInput[]): Promise<void> {
    await this.client.planPrice.deleteMany({ where: { planId } });
    if (prices.length > 0) {
      await this.client.planPrice.createMany({ data: prices.map((p) => ({ ...p, planId })) });
    }
  }

  async tenantIdsOnPlan(planId: string): Promise<string[]> {
    const rows = await this.client.subscription.findMany({ where: { planId }, select: { tenantId: true } });
    return rows.map((r) => r.tenantId);
  }
}
