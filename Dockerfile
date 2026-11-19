# Paquetes Catálogo: imagen para Coolify (PHP 8.3 + Apache).
# La configuración sale de variables de entorno; ver DEPLOY-COOLIFY.md.
FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && a2enmod remoteip headers

# Apache detrás del proxy de Coolify: IP real del visitante, HTTPS y .htaccess
COPY docker/apache.conf /etc/apache2/conf-available/pqc.conf
RUN a2enconf pqc

COPY . /var/www/html/

# config.php pasa a leer variables de entorno (en Laragon no cambia nada).
# Las herramientas de despliegue salen de la carpeta pública.
RUN php /var/www/html/docker/env-config.php /var/www/html/config.php \
 && mkdir -p /opt/pqc \
 && mv /var/www/html/docker/set-admin-password.php /opt/pqc/ \
 && mv /var/www/html/docker/entrypoint.sh /usr/local/bin/pqc-entrypoint \
 && chmod +x /usr/local/bin/pqc-entrypoint \
 && rm -rf /var/www/html/docker /var/www/html/Dockerfile /var/www/html/.dockerignore \
           /var/www/html/database /var/www/html/*.md \
 && mkdir -p /var/www/html/data \
 && chown -R www-data:www-data /var/www/html/data

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost/ >/dev/null || exit 1
ENTRYPOINT ["pqc-entrypoint"]
