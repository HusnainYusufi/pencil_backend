import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Migrations run as the schema OWNER (DATABASE_MIGRATION_URL), while the
 * application connects as a restricted role (DATABASE_URL) that is subject to
 * row-level security. Falls back to DATABASE_URL for local convenience.
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? '',
  },
});
