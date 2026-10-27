import type { PrismaClient } from '../src/generated/prisma/client.js';
import { Feature, FEATURE_DEFINITIONS } from '../src/modules/entitlements/features.js';

type PlanSeed = {
  code: string;
  name: string;
  description: string;
  trialDays: number;
  sortOrder: number;
  /** featureKey -> limit (number / null = unlimited) or true for boolean features. */
  features: Record<string, number | null | true>;
  /** [currency, monthly, yearly] — placeholder prices; manage real ones in pencil_admin. */
  prices: Array<[string, string, string]>;
};

export const PLAN_SEEDS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Compliant e-invoicing and core accounting for small businesses.',
    trialDays: 14,
    sortOrder: 1,
    features: { [Feature.USERS_MAX]: 3, [Feature.BRANCHES_MAX]: 1, [Feature.EINVOICING]: true },
    prices: [
      ['SAR', '99.000', '990.000'],
      ['JOD', '19.000', '190.000'],
    ],
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'Growing teams: inventory, custom roles, audit trail, multi-currency.',
    trialDays: 14,
    sortOrder: 2,
    features: {
      [Feature.USERS_MAX]: 10,
      [Feature.BRANCHES_MAX]: 3,
      [Feature.EINVOICING]: true,
      [Feature.ROLES_CUSTOM]: true,
      [Feature.AUDIT_LOG]: true,
      [Feature.INVENTORY]: true,
      [Feature.MULTI_CURRENCY]: true,
    },
    prices: [
      ['SAR', '249.000', '2490.000'],
      ['JOD', '49.000', '490.000'],
    ],
  },
  {
    code: 'business',
    name: 'Business',
    description: 'Unlimited users and branches, API access and priority support.',
    trialDays: 14,
    sortOrder: 3,
    features: {
      [Feature.USERS_MAX]: null,
      [Feature.BRANCHES_MAX]: null,
      [Feature.EINVOICING]: true,
      [Feature.ROLES_CUSTOM]: true,
      [Feature.AUDIT_LOG]: true,
      [Feature.INVENTORY]: true,
      [Feature.MULTI_CURRENCY]: true,
      [Feature.API_ACCESS]: true,
    },
    prices: [
      ['SAR', '549.000', '5490.000'],
      ['JOD', '99.000', '990.000'],
    ],
  },
];

/**
 * Idempotent: features are upserted (definitions live in code); plans are
 * only created when missing so edits made in pencil_admin are never clobbered.
 */
export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  for (const f of FEATURE_DEFINITIONS) {
    await prisma.feature.upsert({
      where: { key: f.key },
      create: f,
      update: { name: f.name, description: f.description },
    });
  }

  for (const plan of PLAN_SEEDS) {
    if (await prisma.plan.findUnique({ where: { code: plan.code }, select: { id: true } })) continue;
    await prisma.plan.create({
      data: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        features: {
          createMany: {
            data: Object.entries(plan.features).map(([featureKey, value]) => ({
              featureKey,
              enabled: true,
              limitValue: value === true ? null : value,
            })),
          },
        },
        prices: {
          createMany: {
            data: plan.prices.flatMap(([currency, monthly, yearly]) => [
              { currency, interval: 'MONTHLY' as const, amount: monthly },
              { currency, interval: 'YEARLY' as const, amount: yearly },
            ]),
          },
        },
      },
    });
  }
}
