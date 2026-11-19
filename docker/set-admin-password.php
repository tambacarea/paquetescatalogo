<?php
/**
 * Contraseña de administración desde la terminal del contenedor (Coolify → Terminal).
 *
 *   php /opt/pqc/set-admin-password.php                       pide la contraseña y la guarda
 *   php /opt/pqc/set-admin-password.php --from-env --if-missing
 *        usa la variable ADMIN_PASSWORD solo si todavía no hay contraseña (lo hace el arranque)
 *
 * Guarda el hash igual que lib/auth.php: settings.admin_password_hash con password_hash().
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require '/var/www/html/lib/db.php';

$fromEnv = in_array('--from-env', $argv, true);
$ifMissing = in_array('--if-missing', $argv, true);

try {
    $pdo = db();
} catch (Throwable $e) {
    fwrite(STDERR, "[pqc] La base de datos aún no responde (" . $e->getMessage() . ").\n");
    exit(1);
}
if ($ifMissing && get_setting($pdo, 'admin_password_hash') !== null) {
    fwrite(STDERR, "[pqc] Ya hay contraseña de administrador; no se cambia.\n");
    exit(0);
}

if ($fromEnv) {
    $pass = (string) getenv('ADMIN_PASSWORD');
} else {
    $ask = function (string $label): string {
        fwrite(STDOUT, $label);
        @shell_exec('stty -echo 2>/dev/null');
        $v = rtrim((string) fgets(STDIN), "\r\n");
        @shell_exec('stty echo 2>/dev/null');
        fwrite(STDOUT, "\n");
        return $v;
    };
    $pass = $ask('Nueva contraseña de administrador: ');
    if ($ask('Repítela: ') !== $pass) {
        fwrite(STDERR, "[pqc] Las contraseñas no coinciden.\n");
        exit(1);
    }
}

$len = function_exists('mb_strlen') ? mb_strlen($pass, 'UTF-8') : strlen($pass);
if ($len < 8 || $len > 200) {
    fwrite(STDERR, "[pqc] La contraseña debe tener entre 8 y 200 caracteres.\n");
    exit(1);
}
set_setting($pdo, 'admin_password_hash', password_hash($pass, PASSWORD_DEFAULT));
fwrite(STDOUT, "[pqc] Contraseña de administrador guardada.\n");
