#!/bin/sh
# Creates deploy/env/*.env from the *.env.example templates with freshly
# generated secrets. Run ONCE on the server; the outputs are gitignored and
# written with mode 600. Refuses to overwrite existing files.
#
#   API_DOMAIN=api.pencil.sa ADMIN_DOMAIN=admin.pencil.sa APP_ORIGIN=https://app.pencil.sa \
#   ACME_EMAIL=ops@pencil.sa ADMIN_ALLOWED_IPS="203.0.113.0/24" APP_CELL=ksa-1 \
#   SEED_ADMIN_EMAIL=you@pencil.sa ./generate-secrets.sh
set -eu
umask 077
cd "$(dirname "$0")/env"

for f in caddy postgres migrate api admin; do
  if [ -e "$f.env" ]; then
    echo "refusing to overwrite env/$f.env (delete it first if you really mean to)" >&2
    exit 1
  fi
done

: "${API_DOMAIN:?set API_DOMAIN}"
: "${ADMIN_DOMAIN:?set ADMIN_DOMAIN}"
: "${APP_ORIGIN:?set APP_ORIGIN (tenant web app origin, e.g. https://app.example.com)}"
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
SEED_ADMIN_PASSWORD="$(rand 18)-Pn1"

render() {
  sed \
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
    -e "s|__SEED_ADMIN_EMAIL__|$SEED_ADMIN_EMAIL|g" \
    -e "s|__SEED_ADMIN_PASSWORD__|$SEED_ADMIN_PASSWORD|g" \
    "$1.env.example" > "$1.env"
  chmod 600 "$1.env"
}

for f in caddy postgres migrate api admin; do render "$f"; done

if grep -l '__[A-Z_]*__' ./*.env >/dev/null 2>&1; then
  echo "error: unreplaced placeholders remain:" >&2
  grep -n '__[A-Z_]*__' ./*.env >&2
  exit 1
fi

echo "✔ wrote env/{caddy,postgres,migrate,api,admin}.env (mode 600, gitignored)"
echo
echo "First platform admin: $SEED_ADMIN_EMAIL"
echo "Temporary password:   $SEED_ADMIN_PASSWORD"
echo "Store it in your password manager now; it is not shown again."
echo "After the first successful deploy, remove the SEED_* lines from env/migrate.env."
