<?php
/**
 * Se ejecuta al construir la imagen: agrega ?v=<huella> a los archivos de assets/ que cita index.html
 * (scripts y estilos). Con eso el navegador los guarda un año y, al cambiar
 * un archivo, cambia su URL y se descarga la versión nueva. En Laragon no se usa.
 */
$root = rtrim($argv[1] ?? '/var/www/html', '/');
$file = "$root/index.html";
$html = file_get_contents($file);
$n = 0;
// Solo JS y CSS: las fuentes conservan su URL para que la precarga y el CSS pidan el mismo archivo.
$html = preg_replace_callback('~((?:src|href|content)=")(assets/[A-Za-z0-9._/-]+\.(?:js|css))(")~', function ($m) use ($root, &$n) {
    $path = "$root/{$m[2]}";
    if (!is_file($path)) {
        return $m[0];
    }
    $n++;
    return $m[1] . $m[2] . '?v=' . substr(md5_file($path), 0, 10) . $m[3];
}, $html);
file_put_contents($file, $html);
fwrite(STDERR, "index.html: $n archivos con versión\n");
