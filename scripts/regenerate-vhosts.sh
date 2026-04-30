#!/usr/bin/env bash
# Regenerate nginx-configs/<domain>.conf for all domains in the SQLite DB
# using the current src/nginx-templates/vhost-template.txt.
#
# Use this after editing the template, to apply changes to existing domains
# without re-running certbot (avoids Let's Encrypt rate limits).
#
# Run from the project root. Requires sqlite3 cli.

set -euo pipefail

DB="db/db.db"
TPL="src/nginx-templates/vhost-template.txt"
OUT_DIR="nginx-configs"
CERTS_DIR="certs/certificates/live"

if [ ! -f "$DB" ]; then
    echo "error: $DB not found — run from project root" >&2
    exit 1
fi
if [ ! -f "$TPL" ]; then
    echo "error: $TPL not found" >&2
    exit 1
fi
if ! command -v sqlite3 >/dev/null; then
    echo "error: sqlite3 cli is not installed (apt install sqlite3)" >&2
    exit 1
fi

# Backup whole nginx-configs (in case anything goes wrong)
ts=$(date +%Y%m%d-%H%M%S)
backup="nginx-configs.bak-$ts"
cp -r "$OUT_DIR" "$backup"
echo "backup: $backup"

ok=0; skip_cert=0; skip_ip=0

# Iterate active domains; tab-separated to be safe with weird names
while IFS=$'\t' read -r domain ip; do
    [ -z "$domain" ] && continue

    if [ -z "$ip" ]; then
        echo "✗ SKIP $domain — no destination IP in DB"
        skip_ip=$((skip_ip + 1))
        continue
    fi
    if [ ! -f "$CERTS_DIR/$domain/fullchain.pem" ]; then
        echo "✗ SKIP $domain — no cert at $CERTS_DIR/$domain/"
        skip_cert=$((skip_cert + 1))
        continue
    fi

    sed -e "s|DOMAIN|$domain|g" -e "s|DESTINATIONIP|$ip|g" \
        "$TPL" > "$OUT_DIR/$domain.conf.new"
    mv "$OUT_DIR/$domain.conf.new" "$OUT_DIR/$domain.conf"
    echo "✓ $domain → $ip"
    ok=$((ok + 1))
done < <(sqlite3 -separator $'\t' "$DB" "SELECT name, ip FROM domain ORDER BY name;")

echo "---"
echo "Regenerated: $ok | Skipped (no cert): $skip_cert | Skipped (no ip): $skip_ip"
echo
echo "Next steps:"
echo "  docker exec reverse-proxy nginx -t   # validate"
echo "  docker exec reverse-proxy nginx -s reload   # apply"
echo
echo "Rollback (if needed):"
echo "  rm -rf $OUT_DIR && mv $backup $OUT_DIR"
echo "  docker exec reverse-proxy nginx -s reload"
