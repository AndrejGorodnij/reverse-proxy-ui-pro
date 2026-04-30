#!/usr/bin/env bash
# Generate nginx-configs/00-cloudflare-realip.conf with current Cloudflare
# IP ranges, so $remote_addr becomes the real visitor IP (not CF edge).
#
# Run once after install if your domains are proxied through Cloudflare.
# Re-run periodically (CF rarely changes ranges, but it does happen).
#
# Required: this script must be run from the project root.

set -euo pipefail

OUT="nginx-configs/00-cloudflare-realip.conf"

if [ ! -d nginx-configs ]; then
    echo "error: run this from the project root (nginx-configs/ not found)" >&2
    exit 1
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

{
    echo "# Cloudflare real-IP — generated $(date -Iseconds)"
    echo "# Do not edit manually; re-run scripts/cloudflare-realip.sh"
    echo
    curl -sf --max-time 10 https://www.cloudflare.com/ips-v4 | sed 's|^|set_real_ip_from |; s|$|;|'
    curl -sf --max-time 10 https://www.cloudflare.com/ips-v6 | sed 's|^|set_real_ip_from |; s|$|;|'
    echo
    echo "real_ip_header CF-Connecting-IP;"
    echo "real_ip_recursive on;"
} > "$tmp"

# Sanity check — must contain at least the two header lines + several CF ranges
lines=$(wc -l < "$tmp")
if [ "$lines" -lt 10 ]; then
    echo "error: generated file too short ($lines lines), curl probably failed" >&2
    cat "$tmp" >&2
    exit 1
fi

mv "$tmp" "$OUT"
trap - EXIT

echo "wrote $OUT ($lines lines)"
echo "next: docker exec reverse-proxy nginx -t && docker exec reverse-proxy nginx -s reload"
