<?php
/**
 * Se ejecuta al construir la imagen: hace que cada constante de config.php pueda
 * venir de una variable de entorno con el mismo nombre (DB_HOST, DB_PASS, …),
 * conservando el valor del archivo como predeterminado y su tipo (número, sí/no, texto).
 * Así config.php sigue sirviendo igual en Laragon y las constantes nuevas se cubren solas.
 */
$file = $argv[1] ?? '';
$src = @file_get_contents($file);
if ($src === false) {
    fwrite(STDERR, "No se pudo leer $file\n");
    exit(1);
}
$helper = <<<'PHP'
if (!function_exists('pqc_env')) {
    function pqc_env(string $name, $default)
    {
        $v = getenv($name);
        if ($v === false || $v === '') {
            return $default;
        }
        if (is_bool($default)) {
            return filter_var($v, FILTER_VALIDATE_BOOLEAN);
        }
        if (is_int($default)) {
            return (int) $v;
        }
        if (is_float($default)) {
            return (float) $v;
        }
        return $v;
    }
}

PHP;
$out = preg_replace_callback(
    "/define\(\s*'([A-Z][A-Z0-9_]*)'\s*,\s*(.+?)\s*\);/s",
    fn ($m) => "define('{$m[1]}', pqc_env('{$m[1]}', {$m[2]}));",
    $src,
    -1,
    $count
);
$out = preg_replace('/^<\?php\s*/', "<?php\n" . $helper, $out, 1);
file_put_contents($file, $out);
fwrite(STDERR, "config.php: $count constantes aceptan variables de entorno\n");
