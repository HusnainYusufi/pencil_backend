# Deploying Pencil

One Docker Compose stack serves the whole platform:

```
Internet ──443──▶ Caddy (TLS, HTTP/3) ──▶ app:3000     (tenant web app, public)
                                     ├──▶ api:4100     (API, public)
                                     └──▶ admin:3000   (staff console, IP-restricted)
                   app / admin ──private network──▶ api   (server-to-server)
                   api / migrate ──internal network──▶ postgres (no internet route)
                   api ──▶ SMTP (invitations, password reset) and ZATCA (e-invoicing)
```

| Service | Image | Runs as | Notes |
|---|---|---|---|
| `caddy` | `caddy:2.11.7-alpine` | non-root caps | Automatic Let's Encrypt, HSTS, admin IP allowlist |
| `migrate` | backend `migrate` target | `node` | One-shot: `migrate deploy` → seed catalog → backfill accounting |
| `api` | backend `runtime` target | `node` | Read-only rootfs, all caps dropped, 768 MB limit |
| `app` | `pencil_frontend` image | `node` | Tenant web app; read-only rootfs, all caps dropped, 512 MB limit |
| `admin` | `pencil_admin` image | `node` | Read-only rootfs, all caps dropped, 512 MB limit |
| `postgres` | `postgres:17.11-alpine` | `postgres` | Optional (`--profile bundled-db`); prefer a managed DB |

## First deploy

On a fresh Linux host with Docker Engine and the Compose plugin, check out the three repos side by side:

```bash
git clone https://github.com/HusnainYusufi/pencil_backend.git
git clone https://github.com/HusnainYusufi/pencil_frontend.git
git clone https://github.com/HusnainYusufi/pencil_admin.git
cd pencil_backend/deploy
```

1. **DNS:** point `APP_DOMAIN`, `API_DOMAIN` and `ADMIN_DOMAIN` at the server, and open ports 80 and 443.
2. **Secrets and settings** (generated on the server and never committed). Put the SMTP password in single quotes:
   ```bash
   APP_DOMAIN=app.example.com API_DOMAIN=api.example.com ADMIN_DOMAIN=admin.example.com \
   ACME_EMAIL=ops@example.com ADMIN_ALLOWED_IPS="203.0.113.0/24" APP_CELL=ksa-1 \
   SEED_ADMIN_EMAIL=you@example.com \
   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true \
   SMTP_USER=sender@gmail.com SMTP_PASSWORD='xxxx xxxx xxxx xxxx' \
   EMAIL_FROM=no-reply@example.com EMAIL_FROM_NAME="Pencil" SUPPORT_EMAIL=support@example.com \
   ./generate-secrets.sh
   ```
   This writes `env/{caddy,postgres,migrate,api,app,admin}.env` with mode 600 and prints the first admin's temporary password once.
   Email notes:
   - Gmail needs an **app password** (Google account → Security → App passwords), not the account password.
   - Gmail rewrites the sender to the SMTP account unless `EMAIL_FROM` is a verified "Send mail as" alias of that account. For a branded sender, use a provider for your own domain (SES, Postmark, SendGrid, Google Workspace) with SPF and DKIM set.
   - Gmail allows roughly 500 messages a day; fine for invitations and resets, not for bulk mail.
3. **Start:**
   ```bash
   docker compose -f docker-compose.prod.yml --profile bundled-db up -d --build
   docker compose -f docker-compose.prod.yml logs migrate   # migrations + seed + backfill
   docker compose -f docker-compose.prod.yml ps             # api/admin should be "healthy"
   ```
4. Sign in at `https://ADMIN_DOMAIN` and change the temporary password. Then **delete the `SEED_*` lines from `env/migrate.env`.**

With a **managed PostgreSQL**:

- drop `--profile bundled-db`
- create the `pencil_owner` and `pencil_app` roles as in `postgres/init-roles.sh`
- set the hosts in `env/migrate.env` and `env/api.env`, adding `?sslmode=require`

After the first start, open `https://APP_DOMAIN`, onboard a company from `https://ADMIN_DOMAIN` (the owner receives an activation email),
and check the API logs for `email ... failed` lines if no email arrives.

## Releasing a new version

```bash
git -C ../ pull && git -C ../../pencil_frontend pull && git -C ../../pencil_admin pull
docker compose -f docker-compose.prod.yml --profile bundled-db up -d --build
```

The `migrate` job runs before the new API starts. If a migration fails, the API is not replaced. The release job is idempotent, so it's safe to run on every deploy.

## Secrets and data-leak rules

- **Nothing secret is in git or in an image.** Secrets live only in `deploy/env/*.env` on the server: mode 600, gitignored, excluded by `.dockerignore`.
- **Least privilege per service:**
  - the API gets the restricted `pencil_app` URL and its JWT keys
  - only the release job sees the schema-owner password
  - the admin gets only its session key
  - Caddy gets only domains
- **Enforced on every commit:** `.githooks/pre-commit` (installed by `npm install`) blocks env, key and backup files and secret-looking content. CI (`.github/workflows/secret-scan.yml`) runs gitleaks on the full history of every push and PR; make it a required check on `main`.
- **Rotation:**
  - **JWT keys:** change `env/api.env` and recreate `api`. This invalidates all access tokens; refresh tokens keep working.
  - **`SESSION_SECRET`:** change it and recreate `admin`. All staff are signed out.
  - **Database passwords:** change them in Postgres and in the env files, then recreate.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Health | `curl https://API_DOMAIN/api/health/ready` |
| DB backup (bundled) | `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres -Fc pencil > pencil-$(date +%F).dump`. Store it off-host and encrypted; `*.dump` is gitignored. |
| Restore drill | `pg_restore` into a scratch database monthly |
