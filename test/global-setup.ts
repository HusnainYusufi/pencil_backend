import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { seedCatalog } from '../prisma/seed-catalog.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TEST_ENV, TEST_PLATFORM_ADMIN } from './setup-env.js';

/** Once per e2e run: migrate, wipe, seed catalog + a platform admin. */
export default async function setup(): Promise<void> {
  execSync('npx prisma migrate deploy', { env: { ...process.env, ...TEST_ENV }, stdio: 'pipe' });

  const client = new pg.Client({ connectionString: TEST_ENV.DATABASE_MIGRATION_URL });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  // TRUNCATE does not fire the audit log's row-level append-only trigger.
  await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
  await client.end();

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_ENV.DATABASE_MIGRATION_URL }) });
  try {
    await seedCatalog(prisma);
    await prisma.platformAdmin.create({
      data: {
        email: TEST_PLATFORM_ADMIN.email,
        fullName: 'Test Root',
        role: 'SUPER_ADMIN',
        passwordHash: await new PasswordService().hash(TEST_PLATFORM_ADMIN.password),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
