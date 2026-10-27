-- ---------------------------------------------------------------------------
-- One-time cluster bootstrap for LOCAL DEVELOPMENT (run as a superuser).
-- Docker: mounted into /docker-entrypoint-initdb.d by docker-compose.yml.
-- Manual: psql -U postgres -f scripts/db/init-roles.sql
--
-- Two roles, on purpose:
--   pencil_owner  owns the schema and runs `prisma migrate` (DATABASE_MIGRATION_URL)
--   pencil_app    what the API connects as (DATABASE_URL). NOT superuser and
--                 NOBYPASSRLS, so Postgres row-level security is enforced.
--                 The API refuses to boot in production if this is violated.
--
-- Production: create the same roles through your IaC with generated secrets.
-- ---------------------------------------------------------------------------

CREATE ROLE pencil_owner LOGIN CREATEDB PASSWORD 'pencil_owner_dev';
CREATE ROLE pencil_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'pencil_app_dev';

CREATE DATABASE pencil OWNER pencil_owner;
CREATE DATABASE pencil_test OWNER pencil_owner;

-- Objects created by pencil_owner (i.e. by migrations) are automatically
-- usable by pencil_app. Database-wide (not tied to the public schema's OID),
-- so it survives `prisma migrate reset`. No TRUNCATE / DDL for the app role.

\connect pencil
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pencil_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT USAGE, SELECT ON SEQUENCES TO pencil_app;

\connect pencil_test
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pencil_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT USAGE, SELECT ON SEQUENCES TO pencil_app;
