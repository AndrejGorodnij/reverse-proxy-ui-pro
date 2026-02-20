#!/bin/bash
mkdir -p db
mkdir -p certs
chown -R 33:33 ./db
chown -R 33:33 ./certs
chown -R 33:33 ./src
chown -R 33:33 ./nginx-configs

IP=$(curl -s https://ipinfo.io/ip)
PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 12 ; echo '')

# Generate bcrypt hash for the password
PASS_HASH=$(docker run --rm php:8.0-cli php -r "echo password_hash('$PASS', PASSWORD_BCRYPT);")

/bin/cp -rf ./src/conf.php.template ./src/www/conf.php
sed -i "s|_PASSWORD_HASH_|$PASS_HASH|g" ./src/www/conf.php

docker compose up -d --build

rm -f ./credentials.txt
echo "You can login to:" >> ./credentials.txt
echo "http://$IP" >> ./credentials.txt
echo "with password:" >> ./credentials.txt
echo "$PASS" >> ./credentials.txt
cat ./credentials.txt
