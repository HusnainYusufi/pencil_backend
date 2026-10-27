/**
 * Environment for e2e tests: a dedicated `pencil_test` database (created by
 * scripts/db/init-roles.sql). Override with TEST_DATABASE_URL /
 * TEST_DATABASE_MIGRATION_URL in CI.
 */
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SWAGGER_ENABLED: 'false',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://pencil_app:pencil_app_dev@localhost:5432/pencil_test',
  DATABASE_MIGRATION_URL:
    process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgresql://pencil_owner:pencil_owner_dev@localhost:5432/pencil_test',
  JWT_ACCESS_SECRET: 'test-tenant-access-secret-0123456789abcdef',
  JWT_PLATFORM_SECRET: 'test-platform-access-secret-0123456789abcd',
  AUTH_MAX_FAILED_LOGINS: '3',
} as const;

export const TEST_PLATFORM_ADMIN = { email: 'root@pencil.test', password: 'PlatformRoot!2026' } as const;

Object.assign(process.env, TEST_ENV);
