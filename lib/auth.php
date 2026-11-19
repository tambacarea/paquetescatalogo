<?php
/**
 * Acceso de administración: toda la página requiere contraseña.
 *
 * - La contraseña se guarda solo como hash (password_hash) en settings.admin_password_hash.
 * - La primera contraseña solo se puede crear desde el mismo equipo (localhost).
 * - Sesión PHP con cookie HttpOnly + SameSite=Strict; caduca tras AUTH_IDLE_SECONDS sin uso.
 * - Las peticiones que modifican datos llevan el encabezado X-CSRF-Token.
 * - 5 contraseñas incorrectas desde la misma IP bloquean esa IP 15 minutos.
 *
 * Olvidé la contraseña: borra la fila admin_password_hash de la tabla settings
 * (HeidiSQL) y abre la página desde http://localhost para crear una nueva.
 */

const AUTH_IDLE_SECONDS = 2 * 60 * 60;
const AUTH_MAX_FAILS = 5;
const AUTH_LOCK_SECONDS = 15 * 60;
const AUTH_MIN_LENGTH = 8;
const AUTH_MAX_LENGTH = 200;

function auth_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $path = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
    session_name('pqc_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $path,
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_start();
}

function auth_is_local_request(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return $ip === '127.0.0.1' || $ip === '::1';
}

function auth_is_admin(): bool
{
    if (empty($_SESSION['admin'])) {
        return false;
    }
    $last = (int) ($_SESSION['last'] ?? 0);
    if (time() - $last > AUTH_IDLE_SECONDS) {
        auth_clear_session();
        return false;
    }
    $_SESSION['last'] = time();
    return true;
}

function auth_csrf(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function auth_status(PDO $pdo): array
{
    $needsSetup = get_setting($pdo, 'admin_password_hash') === null;
    $admin = !$needsSetup && auth_is_admin();
    return [
        'admin' => $admin,
        'needsSetup' => $needsSetup,
        'canSetup' => $needsSetup && auth_is_local_request(),
        'csrf' => $admin ? auth_csrf() : '',
    ];
}

/** Detiene la petición si no hay sesión de administrador (401) o falta el token CSRF (403). */
function auth_require(): void
{
    if (!auth_is_admin()) {
        throw new ApiError('Tu sesión terminó. Vuelve a escribir la contraseña.', 401);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD') {
        $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        if ($sent === '' || !hash_equals(auth_csrf(), $sent)) {
            throw new ApiError('La petición no trae el token de seguridad. Recarga la página.', 403);
        }
    }
}

function auth_check_new_password($pass, $repeat): string
{
    $pass = (string) ($pass ?? '');
    $len = function_exists('mb_strlen') ? mb_strlen($pass, 'UTF-8') : strlen($pass);
    if ($len < AUTH_MIN_LENGTH) {
        throw new ApiError('La contraseña debe tener al menos ' . AUTH_MIN_LENGTH . ' caracteres.');
    }
    if ($len > AUTH_MAX_LENGTH) {
        throw new ApiError('La contraseña es demasiado larga.');
    }
    if ($repeat !== null && (string) $repeat !== $pass) {
        throw new ApiError('Las dos contraseñas no coinciden.');
    }
    return $pass;
}

function auth_setup(PDO $pdo, array $in): void
{
    if (get_setting($pdo, 'admin_password_hash') !== null) {
        throw new ApiError('La contraseña ya está creada. Escríbela para entrar.', 409);
    }
    if (!auth_is_local_request()) {
        throw new ApiError('La primera contraseña solo se puede crear desde el mismo equipo (http://localhost).', 403);
    }
    $pass = auth_check_new_password($in['password'] ?? '', $in['repeat'] ?? '');
    set_setting($pdo, 'admin_password_hash', password_hash($pass, PASSWORD_DEFAULT));
    auth_open_session();
}

function auth_login(PDO $pdo, array $in): void
{
    $hash = get_setting($pdo, 'admin_password_hash');
    if ($hash === null) {
        throw new ApiError('Aún no hay contraseña. Ábrela desde http://localhost para crearla.', 409);
    }
    $key = 'login_fail:' . substr(hash('sha256', $_SERVER['REMOTE_ADDR'] ?? ''), 0, 24);
    $fail = json_decode((string) (get_setting($pdo, $key) ?? ''), true) ?: ['n' => 0, 'until' => 0];
    if ($fail['until'] > time()) {
        $min = (int) ceil(($fail['until'] - time()) / 60);
        throw new ApiError("Demasiados intentos. Espera {$min} min y vuelve a intentar.", 429);
    }

    if (!password_verify((string) ($in['password'] ?? ''), $hash)) {
        $n = ($fail['until'] && $fail['until'] <= time()) ? 1 : $fail['n'] + 1;
        $until = $n >= AUTH_MAX_FAILS ? time() + AUTH_LOCK_SECONDS : 0;
        set_setting($pdo, $key, json_encode(['n' => $until ? 0 : $n, 'until' => $until]));
        $left = AUTH_MAX_FAILS - $n;
        throw new ApiError($until
            ? 'Contraseña incorrecta. Por seguridad, espera 15 min antes de intentar de nuevo.'
            : "Contraseña incorrecta. Te quedan {$left} intento(s).", 401);
    }

    $pdo->prepare('DELETE FROM settings WHERE k = ?')->execute([$key]);
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
        set_setting($pdo, 'admin_password_hash', password_hash((string) $in['password'], PASSWORD_DEFAULT));
    }
    auth_open_session();
}

function auth_change_password(PDO $pdo, array $in): void
{
    $hash = (string) get_setting($pdo, 'admin_password_hash');
    if (!password_verify((string) ($in['current'] ?? ''), $hash)) {
        throw new ApiError('La contraseña actual no es correcta.', 400);
    }
    $pass = auth_check_new_password($in['password'] ?? '', $in['repeat'] ?? '');
    set_setting($pdo, 'admin_password_hash', password_hash($pass, PASSWORD_DEFAULT));
    auth_open_session(); // nuevo id de sesión y nuevo token
}

function auth_open_session(): void
{
    session_regenerate_id(true);
    $_SESSION = ['admin' => true, 'last' => time(), 'csrf' => bin2hex(random_bytes(32))];
}

function auth_clear_session(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'],
            'httponly' => true, 'samesite' => 'Strict',
        ]);
        session_destroy();
    }
}
