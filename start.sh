#!/bin/bash
mkdir -p db
mkdir -p certs
chown -R 33:33 ./db
chown -R 33:33 ./certs
chown -R 33:33 ./src
chown -R 33:33 ./nginx-configs

IP=$(curl -s https://ipinfo.io/ip)

echo ""
echo "========================================="
echo "  Reverse Proxy UI Pro — Setup"
echo "========================================="
echo ""
echo "Select installation mode:"
echo ""
echo "  1) webui       — Web dashboard only (password login)"
echo "  2) api         — External API only (API key auth)"
echo "  3) webui+api   — Both web dashboard and external API"
echo ""
read -p "Enter mode [1/2/3] (default: 1): " MODE_CHOICE

case "$MODE_CHOICE" in
    2)
        APP_MODE="api"
        ;;
    3)
        APP_MODE="webui+api"
        ;;
    *)
        APP_MODE="webui"
        ;;
esac

echo ""
echo "Mode: $APP_MODE"

# Generate password (for webui and webui+api modes)
PASS=""
PASS_HASH=""
if [ "$APP_MODE" = "webui" ] || [ "$APP_MODE" = "webui+api" ]; then
    PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 12 ; echo '')
    PASS_HASH=$(docker run --rm php:8.0-cli php -r "echo password_hash('$PASS', PASSWORD_BCRYPT);")
fi

# Generate API key (for api and webui+api modes)
API_KEY=""
API_ENABLED="false"
if [ "$APP_MODE" = "api" ] || [ "$APP_MODE" = "webui+api" ]; then
    API_KEY=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32 ; echo '')
    API_ENABLED="true"
fi

# Write config
/bin/cp -rf ./src/conf.php.template ./src/www/conf.php
sed -i "s|_PASSWORD_HASH_|$PASS_HASH|g" ./src/www/conf.php
sed -i "s|_API_KEY_|$API_KEY|g" ./src/www/conf.php
sed -i "s|_API_ENABLED_|$API_ENABLED|g" ./src/www/conf.php
sed -i "s|_APP_MODE_|$APP_MODE|g" ./src/www/conf.php

docker compose up -d --build

# Write credentials
rm -f ./credentials.txt
echo "=========================================" >> ./credentials.txt
echo "  Reverse Proxy UI Pro — Credentials" >> ./credentials.txt
echo "=========================================" >> ./credentials.txt
echo "" >> ./credentials.txt
echo "Server: http://$IP" >> ./credentials.txt
echo "Mode:   $APP_MODE" >> ./credentials.txt
echo "" >> ./credentials.txt

if [ "$APP_MODE" = "webui" ] || [ "$APP_MODE" = "webui+api" ]; then
    echo "--- Web UI ---" >> ./credentials.txt
    echo "URL:      http://$IP" >> ./credentials.txt
    echo "Password: $PASS" >> ./credentials.txt
    echo "" >> ./credentials.txt
fi

if [ "$APP_MODE" = "api" ] || [ "$APP_MODE" = "webui+api" ]; then
    echo "--- External API ---" >> ./credentials.txt
    echo "API Key:  $API_KEY" >> ./credentials.txt
    echo "" >> ./credentials.txt
    echo "Usage:" >> ./credentials.txt
    echo "  curl -H \"X-API-Key: $API_KEY\" http://$IP/api.php?_path=domains" >> ./credentials.txt
    echo "" >> ./credentials.txt
fi

cat ./credentials.txt
