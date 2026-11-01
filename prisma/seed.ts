/* oxlint-disable no-console -- CLI script */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { normalizeEmail } from '../src/common/helpers/string.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { seedCatalog } from './seed-catalog.js';

/**
 * `npm run db:seed` — runs as the schema owner. Safe to re-run.
 * Creates the feature catalog, default plans and the first platform admin.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL (or DATABASE_URL) is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const { newFeatures } = await seedCatalog(prisma);
    console.log(`✔ feature catalog & plans${newFeatures.length ? ` (+${newFeatures.length} new features granted to plans)` : ''}`);

    const email = process.env.SEED_PLATFORM_ADMIN_EMAIL;
    const password = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
    if (email && password) {
      const normalized = normalizeEmail(email);
      const exists = await prisma.platformAdmin.findUnique({ where: { email: normalized }, select: { id: true } });
      if (!exists) {
        await prisma.platformAdmin.create({
          data: {
            email: normalized,
            fullName: 'Platform Owner',
            role: 'SUPER_ADMIN',
            passwordHash: await new PasswordService().hash(password),
          },
        });
        console.log(`✔ platform super admin ${normalized}`);
      } else {
        console.log(`• platform admin ${normalized} already exists`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
