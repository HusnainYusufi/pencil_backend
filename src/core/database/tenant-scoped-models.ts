import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Models whose table has a `tenant_id` column protected by row-level security.
 * Accessing them without a tenant (or system) scope fails fast in the app
 * instead of silently returning nothing from the database.
 *
 * Adding a tenant-owned model? 1) add it here, 2) call
 * `SELECT enable_tenant_rls('<table>')` in its migration, 3) extend
 * TenantScopedRepository for its repository.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  'Role',
  'AuditLog',
]);
