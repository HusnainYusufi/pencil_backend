#!/bin/sh
# Creates deploy/env/*.env from the *.env.example templates with freshly
# generated secrets. Run ONCE on the server; the outputs are gitignored and
# written with mode 600. Refuses to overwrite existing files.
#
#   APP_DOMAIN=app.pencil.sa API_DOMAIN=api.pencil.sa ADMIN_DOMAIN=admin.pencil.sa \
#   ACME_EMAIL=ops@pencil.sa ADMIN_ALLOWED_IPS="203.0.113.0/24" APP_CELL=ksa-1 \
#   SEED_ADMIN_EMAIL=you@pencil.sa \
#   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=you@gmail.com \
#   SMTP_PASSWORD='app password' EMAIL_FROM=no-reply@pencil.sa EMAIL_FROM_NAME=Pencil \
#   SUPPORT_EMAIL=support@pencil.sa ./generate-secrets.sh
set -eu
umask 077
cd "$(dirname "$0")/env"

for f in caddy postgres migrate api app admin; do
  if [ -e "$f.env" ]; then
    echo "refusing to overwrite env/$f.env (delete it first if you really mean to)" >&2
    exit 1
  fi
done

: "${APP_DOMAIN:?set APP_DOMAIN (tenant web app, e.g. app.example.com)}"
: "${API_DOMAIN:?set API_DOMAIN}"
: "${ADMIN_DOMAIN:?set ADMIN_DOMAIN}"
APP_ORIGIN="${APP_ORIGIN:-https://$APP_DOMAIN}"
# Outgoing email: required (invitations, password reset). Pass them in, e.g.
#   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=... SMTP_PASSWORD='...' EMAIL_FROM=... ./generate-secrets.sh
: "${SMTP_HOST:?set SMTP_HOST (and SMTP_USER, SMTP_PASSWORD, EMAIL_FROM)}"
: "${SMTP_USER:?set SMTP_USER}"
: "${SMTP_PASSWORD:?set SMTP_PASSWORD}"
: "${EMAIL_FROM:?set EMAIL_FROM}"
SMTP_PORT="${SMTP_PORT:-465}"
SMTP_SECURE="${SMTP_SECURE:-true}"
EMAIL_FROM_NAME="${EMAIL_FROM_NAME:-Pencil}"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-$EMAIL_FROM}"
: "${ACME_EMAIL:?set ACME_EMAIL}"
: "${SEED_ADMIN_EMAIL:?set SEED_ADMIN_EMAIL}"
ADMIN_ALLOWED_IPS="${ADMIN_ALLOWED_IPS:-0.0.0.0/0 ::/0}"
APP_CELL="${APP_CELL:-prod-1}"

# URL-safe random string with ~$1 bytes of entropy (no shell/URL-special chars).
rand() { head -c "$1" /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"$(( $1 * 4 / 3 ))"; }

POSTGRES_PASSWORD=$(rand 32)
PENCIL_OWNER_PASSWORD=$(rand 32)
PENCIL_APP_PASSWORD=$(rand 32)
JWT_ACCESS_SECRET=$(rand 48)
JWT_PLATFORM_SECRET=$(rand 48)
SESSION_SECRET=$(rand 48)
APP_SESSION_SECRET=$(rand 48)
# Exactly 32 random bytes, standard base64 (AES-256 data key).
DATA_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
SEED_ADMIN_PASSWORD="$(rand 18)-Pn1"

# Values that may contain sed-special characters (| & \) are escaped first.
esc() { printf '%s' "$1" | sed -e 's/[|&\\]/\\&/g'; }

render() {
  sed \
    -e "s|__APP_DOMAIN__|$APP_DOMAIN|g" \
    -e "s|__APP_SESSION_SECRET__|$APP_SESSION_SECRET|g" \
    -e "s|__SMTP_HOST__|$(esc "$SMTP_HOST")|g" \
    -e "s|__SMTP_PORT__|$SMTP_PORT|g" \
    -e "s|__SMTP_SECURE__|$SMTP_SECURE|g" \
    -e "s|__SMTP_USER__|$(esc "$SMTP_USER")|g" \
    -e "s|__SMTP_PASSWORD__|$(esc "$SMTP_PASSWORD")|g" \
    -e "s|__EMAIL_FROM__|$(esc "$EMAIL_FROM")|g" \
    -e "s|__EMAIL_FROM_NAME__|$(esc "$EMAIL_FROM_NAME")|g" \
    -e "s|__SUPPORT_EMAIL__|$(esc "$SUPPORT_EMAIL")|g" \
    -e "s|__API_DOMAIN__|$API_DOMAIN|g" \
    -e "s|__ADMIN_DOMAIN__|$ADMIN_DOMAIN|g" \
    -e "s|__ACME_EMAIL__|$ACME_EMAIL|g" \
    -e "s|__ADMIN_ALLOWED_IPS__|$ADMIN_ALLOWED_IPS|g" \
    -e "s|__APP_ORIGIN__|$APP_ORIGIN|g" \
    -e "s|__APP_CELL__|$APP_CELL|g" \
    -e "s|__POSTGRES_PASSWORD__|$POSTGRES_PASSWORD|g" \
    -e "s|__PENCIL_OWNER_PASSWORD__|$PENCIL_OWNER_PASSWORD|g" \
    -e "s|__PENCIL_APP_PASSWORD__|$PENCIL_APP_PASSWORD|g" \
    -e "s|__JWT_ACCESS_SECRET__|$JWT_ACCESS_SECRET|g" \
    -e "s|__JWT_PLATFORM_SECRET__|$JWT_PLATFORM_SECRET|g" \
    -e "s|__SESSION_SECRET__|$SESSION_SECRET|g" \
    -e "s|__DATA_ENCRYPTION_KEY__|$DATA_ENCRYPTION_KEY|g" \
    -e "s|__SEED_ADMIN_EMAIL__|$SEED_ADMIN_EMAIL|g" \
    -e "s|__SEED_ADMIN_PASSWORD__|$SEED_ADMIN_PASSWORD|g" \
    "$1.env.example" > "$1.env"
  chmod 600 "$1.env"
}

for f in caddy postgres migrate api app admin; do render "$f"; done

if grep -l '__[A-Z_]*__' ./*.env >/dev/null 2>&1; then
  echo "error: unreplaced placeholders remain:" >&2
  grep -n '__[A-Z_]*__' ./*.env >&2
  exit 1
fi

echo "✔ wrote env/{caddy,postgres,migrate,api,app,admin}.env (mode 600, gitignored)"
echo
echo "First platform admin: $SEED_ADMIN_EMAIL"
echo "Temporary password:   $SEED_ADMIN_PASSWORD"
echo "Store it in your password manager now; it is not shown again."
echo "After the first successful deploy, remove the SEED_* lines from env/migrate.env."
