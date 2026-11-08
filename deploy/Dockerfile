# Server mode: the same Laravel backend serving many desktop clients on a LAN
# or over the internet. One MySQL database per company (erp_<slug>).
FROM php:8.4-fpm-alpine AS base

RUN apk add --no-cache icu-libs libzip sqlite-libs mariadb-client \
 && apk add --no-cache --virtual .build icu-dev libzip-dev sqlite-dev $PHPIZE_DEPS \
 && docker-php-ext-install -j"$(nproc)" pdo_mysql pdo_sqlite intl zip bcmath opcache pcntl \
 && apk del .build

COPY deploy/php.ini /usr/local/etc/php/conf.d/erp.ini

FROM base AS vendor
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-scripts --no-autoloader --no-interaction --no-progress
COPY backend/ ./
RUN composer dump-autoload --optimize --no-dev \
 && php artisan filament:assets \
 && rm -rf storage/app/control tests database/database.sqlite .env storage/logs/*.log

FROM base
WORKDIR /var/www/erp
COPY --from=vendor --chown=www-data:www-data /app ./
COPY deploy/entrypoint.sh /usr/local/bin/erp-entrypoint
RUN chmod +x /usr/local/bin/erp-entrypoint \
 && mkdir -p storage/app storage/backups storage/framework/cache storage/framework/views storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache
USER www-data
ENTRYPOINT ["erp-entrypoint"]
CMD ["php-fpm"]
