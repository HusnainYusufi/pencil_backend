# Pencil API

Multi-tenant accounting SaaS backend for **Saudi Arabia** (ZATCA) and **Jordan** (JoFotara).
NestJS 12 (ESM) · Fastify · Prisma 7 + PostgreSQL 17 · JWT · Vitest.

Consumers:

- **pencil_frontend**: tenant web app → `/api/v1/*` with a *tenant* token.
- **pencil_admin**: Pencil staff back office → `/api/v1/platform/*` with a *platform* token.

---

## Quick start

```bash
cp .env.example .env              # then adjust; every variable is validated at boot
npm install
npm run db:generate               # generate the Prisma client

docker compose up -d postgres     # Postgres 17 + roles (scripts/db/init-roles.sql)
npm run db:deploy                 # apply migrations (as pencil_owner)
npm run db:seed                   # features, plans, first platform admin
npm run start:dev                 # http://localhost:4100/api  ·  docs: http://localhost:4100/docs
```

Full stack in containers (DB + migrate/seed job + API):

```bash
docker compose --profile app up -d --build
```

Seeded platform admin (local only): `admin@pencil.local` / `ChangeMe!12345`.

| Command | |
|---|---|
| `npm test` | unit tests |
| `npm run test:e2e` | end-to-end tests against `pencil_test` (real HTTP pipeline + Postgres) |
| `npm run typecheck` / `npm run lint` | TypeScript / oxlint |
| `npm run db:migrate` | create a migration in development |

---

## Architecture

```
src/
  config/        env schema (zod, fail-fast) + typed AppConfig
  core/          framework-level infrastructure, no business rules
    context/     request context (AsyncLocalStorage): request id, actor, tenant, tx
    database/    PrismaService, Db (unit of work + tenant scope), base repositories, RLS extension
    security/    route-scope decorators, permission matching, PermissionsGuard, AccessCache
    http/        exception filter (single error shape), validation pipe, Fastify/app setup
    idempotency/ Idempotency-Key support for unsafe requests
    logging/ health/
  common/        pure helpers (money, tax, dates/Hijri, crypto, pagination, strings) + DTOs
  modules/
    auth/        both realms: tenant users + platform staff; AuthGuard; sessions
    identity/    users & sessions (data access)
    tenancy/     tenants, memberships, roles, subscriptions, provisioning, company/roles/members API
    access/      tenant & platform permission catalogs, system roles
    entitlements/ plan features & limits, FeatureGuard
    catalog/     plans & features (data access)
    audit/       append-only audit trail
    platform/    pencil_admin API: onboarding, lifecycle, plans, overrides, audit
prisma/schema/   one .prisma file per bounded context
prisma/migrations/
```

**Layering:** controller → service (business rules, transactions, audit) → repository (the only code
that touches Prisma). Services never import Prisma.

### Multi-tenancy: defence in depth

1. **Application:** tenant repositories extend `TenantScopedRepository` and always filter or stamp `tenantId`.
2. **Database:** Postgres row-level security on every tenant-owned table (`FORCE ROW LEVEL SECURITY`).
   The scope is set per transaction (`set_config(..., is_local => true)`), so it never leaks through the
   connection pool. With no scope, tenant tables return nothing and reject writes (fail closed).
3. **Roles:** the API connects as `pencil_app` (no superuser, no `BYPASSRLS`); migrations run as
   `pencil_owner`. The API refuses to boot in production as an RLS-bypassing role.

Scopes are switched only through `Db.withTenant()` and `Db.asSystem()` (cross-tenant). Both are easy to
grep and should be reviewed wherever they appear. Platform routes run in system scope by design and are
permission-checked and audited.

### Request pipeline

`ThrottlerGuard → AuthGuard → PermissionsGuard → FeatureGuard → ValidationPipe → handler`

- Routes are **secure by default**: an undecorated route needs a tenant user with a company selected.
  Use `@Public()`, `@TenantOptional()` or `@PlatformAuth()` to change that.
- `@RequirePermissions('invoices.issue')` checks the role; `@RequireFeature('inventory')` checks the plan.
- A suspended tenant gets 403. A lapsed subscription makes the tenant **read-only** (402 on writes).

### Auth

- Access token: JWT HS256 (15 min). Tenant and platform tokens use separate secrets and audiences.
- Refresh token: opaque `<session>.<secret>` (only SHA-256 is stored), rotated on every use, with
  **reuse detection** (replaying an old token revokes the session). Delivered in the body and as an
  `httpOnly; SameSite=Strict` cookie scoped to the auth path.
- Argon2id passwords, per-account lockout, constant-time "unknown email" handling.
- Access context (session + membership + role + plan state) is cached for 30 s and invalidated on
  logout, role change, suspension and plan change.

### Errors

Every non-2xx response has this shape (codes are stable; the frontend localises by `code`):

```json
{ "error": { "code": "FEATURE_NOT_AVAILABLE", "message": "…", "details": { "feature": "roles.custom" }, "requestId": "…" } }
```

### Money

Use `common/helpers/money.ts`: always `Decimal`, rounded half-up to the currency's minor units
(SAR 2, **JOD 3**). It provides `computeTax` (inclusive/exclusive VAT) and `allocate` (penny-exact
splits). The database uses `Decimal`, never `Float`.

---

## Recipes

**Add a tenant-owned table**

1. Add the model with `tenantId String @map("tenant_id") @db.Uuid`, then run `npm run db:migrate -- --create-only`.
2. Append `SELECT enable_tenant_rls('<table>');` to the generated migration.
3. Add the model name to `src/core/database/tenant-scoped-models.ts`.
4. Write its repository by extending `TenantScopedRepository`.

**Add a permission:** add it to `modules/access/permissions.ts`. System roles pick it up automatically.

**Add a plan feature:** add it to `modules/entitlements/features.ts`, re-run the seed, and grant it to
plans in pencil_admin. Gate routes with `@RequireFeature()` and quotas with
`EntitlementsService.assertWithinLimit()`.

**Make an endpoint retry-safe:** decorate it with `@Idempotent()`. Clients send an `Idempotency-Key` header.
