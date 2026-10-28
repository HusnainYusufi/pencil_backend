/* oxlint-disable no-console -- CLI script */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { bootstrapAccounting, syncChartTemplate } from '../src/modules/accounting/bootstrap-accounting.js';
import { ensureTaxProfile, syncTaxCodes } from '../src/modules/tax/tax-bootstrap.js';

/**
 * Data migration, safe to run on every release:
 *  - companies created before the accounting module get their chart of
 *    accounts, main branch and current fiscal year;
 *  - every other company gets accounts added to its country template since
 *    it was created (`syncChartTemplate`; existing accounts are never changed).
 *
 * Idempotent and transactional per company. Runs as the schema
 * owner; tables FORCE row-level security, so each transaction sets the
 * system bypass explicitly.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL (or DATABASE_URL) is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, slug: true, country: true, timezone: true, fiscalYearStartMonth: true, taxNumber: true },
      orderBy: { id: 'asc' },
    });
    let seeded = 0;
    let synced = 0;
    for (const tenant of tenants) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        if ((await tx.account.count({ where: { tenantId: tenant.id } })) > 0) {
          const chart = await syncChartTemplate(tx, tenant);
          const tax = await syncTaxCodes(tx, tenant);
          const profile = await ensureTaxProfile(tx, tenant);
          const added = [...chart.added, ...tax.added.map((c) => `tax:${c}`), ...tax.ratesUpdated.map((c) => `rates:${c}`), ...(profile ? ['tax-profile'] : [])];
          return { synced: { added } };
        }
        return { seeded: await bootstrapAccounting(tx, tenant) };
      });
      if (result.seeded) {
        seeded++;
        console.log(`✔ ${tenant.slug}: ${result.seeded.accounts} accounts, ${result.seeded.fiscalYear}`);
      } else if (result.synced && result.synced.added.length > 0) {
        synced++;
        console.log(`✔ ${tenant.slug}: added ${result.synced.added.join(', ')}`);
      }
    }
    console.log(
      seeded || synced
        ? `✔ accounting: ${seeded} companies set up, ${synced} charts updated (of ${tenants.length})`
        : `• accounting already up to date for all ${tenants.length} companies`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
