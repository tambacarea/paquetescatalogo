#!/bin/sh
# Arranque del contenedor. Apache inicia de inmediato; en segundo plano, si existe
# ADMIN_PASSWORD y aún no hay contraseña, se crea en cuanto la base de datos responda.

db_ready() {
  # Prueba rápida de conexión (3 s) para no quedarse colgado si el host no existe.
  php -r '$s = @fsockopen(getenv("DB_HOST") ?: "127.0.0.1", (int) (getenv("DB_PORT") ?: 3306), $e, $m, 3); exit($s ? 0 : 1);'
}

bootstrap_admin() {
  i=0
  while [ "$i" -lt 20 ]; do
    if db_ready && php /opt/pqc/set-admin-password.php --from-env --if-missing; then
      return 0
    fi
    i=$((i + 1))
    echo "[pqc] Esperando a la base de datos ($i/20)…" >&2
    sleep 3
  done
  echo "[pqc] No se pudo fijar la contraseña inicial: revisa DB_HOST, DB_PORT, DB_USER y DB_PASS." >&2
}

if [ -n "$ADMIN_PASSWORD" ] && [ "${DB_DRIVER:-mysql}" != "sqlite" ]; then
  bootstrap_admin &
elif [ -n "$ADMIN_PASSWORD" ]; then
  php /opt/pqc/set-admin-password.php --from-env --if-missing || true
fi

exec docker-php-entrypoint apache2-foreground
