#!/bin/sh
# First-boot bootstrap of the bundled PostgreSQL (runs once, on an empty volume).
#
#   pencil_owner  owns the schema; used ONLY by the release job (migrations)
#   pencil_app    what the API connects as: no superuser, no BYPASSRLS,
#                 so PostgreSQL row-level security is always enforced
#
# Passwords come from env/postgres.env; nothing is hard-coded here.
set -eu
: "${PENCIL_OWNER_PASSWORD:?PENCIL_OWNER_PASSWORD is required}"
: "${PENCIL_APP_PASSWORD:?PENCIL_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$PENCIL_OWNER_PASSWORD" -v app_pw="$PENCIL_APP_PASSWORD" <<'SQL'
CREATE ROLE pencil_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE pencil_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_pw';
CREATE DATABASE pencil OWNER pencil_owner;
REVOKE ALL ON DATABASE pencil FROM PUBLIC;
GRANT CONNECT ON DATABASE pencil TO pencil_app;

\connect pencil
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pencil_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pencil_owner GRANT USAGE, SELECT ON SEQUENCES TO pencil_app;
SQL
