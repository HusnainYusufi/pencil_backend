/* oxlint-disable no-console -- CLI script */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { bootstrapAccounting } from '../src/modules/accounting/bootstrap-accounting.js';
import { bootstrapTaxRates } from '../src/modules/tax/bootstrap-tax.js';

/**
 * Data migration for companies created before the accounting / tax modules:
 * gives each one its chart of accounts, main branch, current fiscal year and
 * its country's tax rates.
 *
 * Idempotent (skips companies that already have accounts) and transactional
 * per company, so it is safe to run on every release. Runs as the schema
 * owner; tables FORCE row-level security, so each transaction sets the
 * system bypass explicitly.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL (or DATABASE_URL) is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, slug: true, country: true, timezone: true, fiscalYearStartMonth: true },
      orderBy: { id: 'asc' },
    });
    let seeded = 0;
    let taxSeeded = 0;
    for (const tenant of tenants) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const accounting = (await tx.account.count({ where: { tenantId: tenant.id } })) > 0 ? null : await bootstrapAccounting(tx, tenant);
        const taxRates = (await tx.taxRate.count({ where: { tenantId: tenant.id } })) > 0 ? 0 : await bootstrapTaxRates(tx, tenant);
        return { accounting, taxRates };
      });
      if (result.accounting) {
        seeded++;
        console.log(`✔ ${tenant.slug}: ${result.accounting.accounts} accounts, ${result.accounting.fiscalYear}`);
      }
      if (result.taxRates > 0) {
        taxSeeded++;
        console.log(`✔ ${tenant.slug}: ${result.taxRates} tax rates`);
      }
    }
    if (taxSeeded) console.log(`✔ tax rates backfilled for ${taxSeeded} companies`);
    console.log(seeded ? `✔ accounting backfilled for ${seeded} of ${tenants.length} companies` : `• accounting already set up for all ${tenants.length} companies`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
