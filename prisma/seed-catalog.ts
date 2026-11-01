import type { PrismaClient } from '../src/generated/prisma/client.js';
import { FEATURE_DEFINITIONS } from '../src/modules/entitlements/features.js';

type PlanCode = 'starter' | 'professional' | 'business';
type FeatureDefinition = (typeof FEATURE_DEFINITIONS)[number];

/** [currency, monthly, yearly]: placeholder prices; manage real ones in pencil_admin. */
export const PLAN_SEEDS: Array<{
  code: PlanCode;
  name: string;
  description: string;
  trialDays: number;
  sortOrder: number;
  prices: Array<[string, string, string]>;
}> = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Core accounting and compliant e-invoicing for small businesses.',
    trialDays: 14,
    sortOrder: 1,
    prices: [
      ['SAR', '99.000', '990.000'],
      ['JOD', '19.000', '190.000'],
    ],
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'Growing teams: cost centers, inventory, custom roles, audit trail.',
    trialDays: 14,
    sortOrder: 2,
    prices: [
      ['SAR', '249.000', '2490.000'],
      ['JOD', '49.000', '490.000'],
    ],
  },
  {
    code: 'business',
    name: 'Business',
    description: 'Unlimited users and branches, budgets, bank feeds and API access.',
    trialDays: 14,
    sortOrder: 3,
    prices: [
      ['SAR', '549.000', '5490.000'],
      ['JOD', '99.000', '990.000'],
    ],
  },
];

const grant = (value: true | number | null) => ({ enabled: true, limitValue: value === true ? null : value });

/**
 * Idempotent and safe on every release:
 *  - feature metadata (name, module, status, order) is synced from code;
 *  - a feature seen for the FIRST time is granted to the seeded plans per its
 *    catalog defaults, and a core feature (included in every seeded plan) also
 *    to every custom plan, so a release never takes a capability away from a
 *    company; existing grants are never touched, so plan edits made in
 *    pencil_admin always win;
 *  - plans are only created when missing.
 *
 * `definitions` is injectable for tests only.
 */
export async function seedCatalog(
  prisma: PrismaClient,
  definitions: ReadonlyArray<FeatureDefinition> = FEATURE_DEFINITIONS,
): Promise<{ newFeatures: string[] }> {
  const newFeatures: FeatureDefinition[] = [];
  for (const f of definitions) {
    const meta = { name: f.name, description: f.description, module: f.module, status: f.status, sortOrder: f.sortOrder };
    const existing = await prisma.feature.findUnique({ where: { key: f.key }, select: { key: true } });
    if (existing) {
      await prisma.feature.update({ where: { key: f.key }, data: meta });
    } else {
      await prisma.feature.create({ data: { key: f.key, type: f.type, ...meta } });
      newFeatures.push(f);
    }
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
            data: definitions.flatMap((f) => {
              const value = f.plans[plan.code];
              return value === undefined ? [] : [{ featureKey: f.key, ...grant(value) }];
            }),
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

  // Introduce brand-new features into the existing seeded plans (once).
  for (const f of newFeatures) {
    for (const [code, value] of Object.entries(f.plans) as Array<[PlanCode, true | number | null]>) {
      const plan = await prisma.plan.findUnique({ where: { code }, select: { id: true } });
      if (!plan) continue;
      await prisma.planFeature.createMany({ data: [{ planId: plan.id, featureKey: f.key, ...grant(value) }], skipDuplicates: true });
    }
  }

  // ...and core ones into custom plans too. Limits are left out: a custom
  // plan's limits are a commercial decision made in pencil_admin.
  const seeded: string[] = PLAN_SEEDS.map((p) => p.code);
  const core = newFeatures.filter((f) => PLAN_SEEDS.every((p) => f.plans[p.code] === true));
  if (core.length > 0) {
    const custom = await prisma.plan.findMany({ where: { code: { notIn: seeded } }, select: { id: true } });
    for (const plan of custom) {
      await prisma.planFeature.createMany({
        data: core.map((f) => ({ planId: plan.id, featureKey: f.key, ...grant(true) })),
        skipDuplicates: true,
      });
    }
  }
  return { newFeatures: newFeatures.map((f) => f.key) };
}
