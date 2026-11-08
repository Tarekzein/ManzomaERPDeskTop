#!/bin/sh
# Bring every company database up to date, then hand over to php-fpm.
set -e
cd /var/www/erp
if [ -z "$APP_KEY" ]; then
  echo "APP_KEY is not set. Generate one with: docker compose run --rm app php artisan key:generate --show" >&2
  exit 1
fi
php artisan config:cache >/dev/null
php artisan route:cache >/dev/null
php artisan erp:control-migrate
php artisan erp:upgrade --all
exec "$@"
