-- ===========================================================================
-- Security & integrity layer (hand-written; Prisma cannot express these).
--
-- Tenant isolation is enforced twice:
--   1. Application: repositories always filter by tenant_id.
--   2. Database: the row-level-security policies below. The API sets the
--      context per transaction via
--        SELECT set_config('app.tenant_id', '<uuid>', true);
--        SELECT set_config('app.bypass_rls', 'on', true);  -- platform/system only
--      (see src/core/database/prisma-tenant.extension.ts). With no context
--      set, tenant tables return zero rows and reject writes: fail closed.
--
-- FORCE ROW LEVEL SECURITY makes the policies apply to the table owner too;
-- only superusers / BYPASSRLS roles skip them, and the API refuses to boot
-- as such a role in production.
--
-- To protect a new tenant-scoped table, call enable_tenant_rls('<table>') in
-- its migration and register the model in tenant-scoped-models.ts.
-- ===========================================================================

-- Schema lookup for every role (Postgres' own default for `public`); table
-- privileges are still granted explicitly. Keeps `migrate reset` working.
GRANT USAGE ON SCHEMA public TO PUBLIC;

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypassed() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING (app_rls_bypassed() OR tenant_id = app_current_tenant_id())
       WITH CHECK (app_rls_bypassed() OR tenant_id = app_current_tenant_id())',
    target);
END;
$$;

SELECT enable_tenant_rls('roles');
SELECT enable_tenant_rls('audit_logs');

-- Audit trail is append-only, even for the application role.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

-- Integrity backstops (the API validates too; the database has the last word).
ALTER TABLE tenants
  ADD CONSTRAINT tenants_slug_format_chk CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  ADD CONSTRAINT tenants_base_currency_chk CHECK (base_currency ~ '^[A-Z]{3}$');

ALTER TABLE users
  ADD CONSTRAINT users_email_normalized_chk CHECK (email = lower(btrim(email)));

ALTER TABLE platform_admins
  ADD CONSTRAINT platform_admins_email_normalized_chk CHECK (email = lower(btrim(email)));

ALTER TABLE plan_prices
  ADD CONSTRAINT plan_prices_amount_non_negative_chk CHECK (amount >= 0),
  ADD CONSTRAINT plan_prices_currency_chk CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE plan_features
  ADD CONSTRAINT plan_features_limit_non_negative_chk CHECK (limit_value IS NULL OR limit_value >= 0);

ALTER TABLE tenant_feature_overrides
  ADD CONSTRAINT tenant_feature_overrides_limit_non_negative_chk CHECK (limit_value IS NULL OR limit_value >= 0);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_period_order_chk CHECK (current_period_end > current_period_start);
