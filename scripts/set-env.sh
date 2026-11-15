#!/usr/bin/env bash
# Sets the Fiscora API settings added in phases 0-3, then restarts the API.
#
# Run on the VM from the API folder (or pass the folder):
#   bash scripts/set-env.sh                 # uses the current folder
#   bash scripts/set-env.sh /path/to/api    # or point at the API folder
#
# Safe to re-run: existing values are kept unless you type a new one, and
# SHEETS_TOKEN_KEY is only generated when missing (changing it later would
# disconnect every user's Google Sheets).
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
ENV_FILE="$APP_DIR/.env"
PM2_NAME="${PM2_NAME:-spendly-api}"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "error: $APP_DIR doesn't look like the API folder (no package.json)" >&2
  exit 1
fi
touch "$ENV_FILE"
cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
chmod 600 "$ENV_FILE"

current() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }

# Replace (or add) KEY=VALUE without touching any other line.
set_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Ask with a default; an empty answer keeps the default.
ask() {
  local prompt="$1" default="$2" answer
  read -r -p "$prompt [${default:-none}]: " answer
  printf '%s' "${answer:-$default}"
}

echo "Fiscora API settings -> $ENV_FILE"
echo

# Current value from .env, or [fallback] when it isn't set yet.
default_for() { local v; v="$(current "$1")"; printf '%s' "${v:-$2}"; }

# 1. Grievance contact shown publicly in the app (DPDP).
set_var GRIEVANCE_NAME "$(ask 'Grievance contact name' "$(default_for GRIEVANCE_NAME 'Surya')")"
set_var GRIEVANCE_EMAIL "$(ask 'Grievance contact email' "$(default_for GRIEVANCE_EMAIL 'fiscora.support@gmail.com')")"

# 2. Key that encrypts stored Google Sheets tokens: generate once, never rotate casually.
if [ -z "$(current SHEETS_TOKEN_KEY)" ]; then
  set_var SHEETS_TOKEN_KEY "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")"
  echo "Generated SHEETS_TOKEN_KEY (kept in .env; not printed)."
else
  echo "SHEETS_TOKEN_KEY already set, keeping it."
fi

# 3. Where Google may send users back after "Connect Google Sheets" (comma-separated).
set_var SHEETS_OAUTH_REDIRECT_URIS "$(ask 'Sheets OAuth redirect URIs' "$(default_for SHEETS_OAUTH_REDIRECT_URIS 'https://spendly-web-psi.vercel.app/settings')")"

# 4. Firebase UIDs allowed to add AI knowledge-base documents (comma-separated, optional).
uids="$(ask 'Admin Firebase UID(s) for the AI knowledge base (Firebase console > Authentication > Users)' "$(current RAG_ADMIN_UIDS)")"
if [ -n "$uids" ]; then set_var RAG_ADMIN_UIDS "$uids"; fi

# 5. New Google OAuth client secret after rotating it (hidden input; Enter keeps the current one).
read -r -s -p "New GOOGLE_SHEETS_CLIENT_SECRET (Enter to keep the current one): " secret; echo
if [ -n "$secret" ]; then set_var GOOGLE_SHEETS_CLIENT_SECRET "$secret"; fi
unset secret

chmod 600 "$ENV_FILE"
echo
echo "Saved. Keys now set:"
grep -E '^(GRIEVANCE_NAME|GRIEVANCE_EMAIL|SHEETS_TOKEN_KEY|SHEETS_OAUTH_REDIRECT_URIS|RAG_ADMIN_UIDS|GOOGLE_SHEETS_CLIENT_SECRET)=' "$ENV_FILE" \
  | sed -E 's/^(SHEETS_TOKEN_KEY|GOOGLE_SHEETS_CLIENT_SECRET)=.*/\1=<hidden>/'

if command -v pm2 >/dev/null 2>&1; then
  echo
  echo "Restarting $PM2_NAME (takes a few minutes on a small VM)..."
  NODE_ENV=production pm2 restart "$PM2_NAME" --update-env
else
  echo "pm2 not found: restart the API yourself to load the new settings."
fi
