import type { PrismaClient } from '../../generated/prisma/client.js';
import { TENANT_SCOPED_MODELS } from './tenant-scoped-models.js';

export interface DbScope {
  tenantId: string | null;
  bypassRls: boolean;
}

type ScopeExecutor = Pick<PrismaClient, '$executeRaw'>;

/**
 * Sets the row-level-security context for the current transaction only
 * (`is_local = true`), so it can never leak to another request through the
 * connection pool.
 */
export function applyDbScope(client: ScopeExecutor, scope: DbScope) {
  return client.$executeRaw`SELECT
    set_config('app.tenant_id', ${scope.tenantId ?? ''}, true),
    set_config('app.bypass_rls', ${scope.bypassRls ? 'on' : 'off'}, true)`;
}

/**
 * Prisma client extension that runs each model operation together with the
 * scope statement in one short batch transaction whenever a scope is active.
 *
 * Every operation is wrapped (not only tenant-scoped models) because nested
 * reads, e.g. `membership.findMany({ include: { role: true } })`, touch RLS
 * tables too. For hot paths that issue many queries, use `Db.transaction()`:
 * the scope is then set once for the whole unit of work.
 */
export function createTenantScopedClient(prisma: PrismaClient, getScope: () => DbScope) {
  return prisma.$extends({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const scope = getScope();
          if (!scope.tenantId && !scope.bypassRls) {
            if (TENANT_SCOPED_MODELS.has(model)) {
              throw new Error(
                `Tenant scope required to access ${model}. ` +
                  'Run inside an authenticated tenant request, Db.withTenant() or Db.asSystem().',
              );
            }
            return query(args);
          }
          const [, result] = await prisma.$transaction([applyDbScope(prisma, scope), query(args)]);
          return result;
        },
      },
    },
  });
}
