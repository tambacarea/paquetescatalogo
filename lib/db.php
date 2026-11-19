<?php
/**
 * Conexión a la base de datos e instalación automática del esquema.
 */

require_once __DIR__ . '/../config.php';

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    if (DB_DRIVER === 'sqlite') {
        $dir = dirname(SQLITE_PATH);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $pdo = new PDO('sqlite:' . SQLITE_PATH, null, null, $options);
        $pdo->exec('PRAGMA journal_mode = WAL');
    } else {
        // Conecta al servidor, crea la base si no existe y la selecciona.
        $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', DB_HOST, DB_PORT);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        $name = str_replace('`', '', DB_NAME);
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("USE `$name`");
    }

    install_schema($pdo);
    return $pdo;
}

function install_schema(PDO $pdo): void
{
    $mysql = DB_DRIVER !== 'sqlite';
    $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        asin CHAR(10) NOT NULL UNIQUE,
        title VARCHAR(300) NOT NULL,
        price DECIMAL(10,2) NULL,
        category VARCHAR(100) NOT NULL DEFAULT '',
        notes VARCHAR(500) NOT NULL DEFAULT '',
        brand VARCHAR(100) NOT NULL DEFAULT '',
        color VARCHAR(60) NOT NULL DEFAULT '',
        feature VARCHAR(150) NOT NULL DEFAULT '',
        capacity VARCHAR(60) NOT NULL DEFAULT '',
        dimensions VARCHAR(120) NOT NULL DEFAULT '',
        about TEXT NULL,
        image MEDIUMTEXT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'manual',
        is_example TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    )$suffix");

    $pdo->exec("CREATE TABLE IF NOT EXISTS bundles (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        description VARCHAR(500) NOT NULL DEFAULT '',
        is_example TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    )$suffix");

    $pdo->exec("CREATE TABLE IF NOT EXISTS bundle_items (
        bundle_id VARCHAR(40) NOT NULL,
        product_id VARCHAR(40) NOT NULL,
        qty INT NOT NULL DEFAULT 1,
        position INT NOT NULL DEFAULT 0,
        PRIMARY KEY (bundle_id, product_id)
    )$suffix");

    $pdo->exec("CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at BIGINT NOT NULL
    )$suffix");

    $pdo->exec("CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(50) NOT NULL PRIMARY KEY,
        v TEXT NOT NULL
    )$suffix");

    // Bases creadas con la versión anterior: agrega las columnas nuevas si faltan.
    add_missing_columns($pdo, 'products', [
        'brand' => "VARCHAR(100) NOT NULL DEFAULT ''",
        'color' => "VARCHAR(60) NOT NULL DEFAULT ''",
        'feature' => "VARCHAR(150) NOT NULL DEFAULT ''",
        'capacity' => "VARCHAR(60) NOT NULL DEFAULT ''",
        'dimensions' => "VARCHAR(120) NOT NULL DEFAULT ''",
        'about' => 'TEXT NULL',
    ]);

    if (SEED_EXAMPLES && get_setting($pdo, 'seeded') === null) {
        seed_examples($pdo);
        set_setting($pdo, 'seeded', '1');
    }
    if (get_setting($pdo, 'seeded_categories') === null) {
        seed_categories($pdo);
        set_setting($pdo, 'seeded_categories', '1');
    }
    if (SEED_EXAMPLES && get_setting($pdo, 'seeded_vitamix') === null) {
        seed_vitamix($pdo);
        set_setting($pdo, 'seeded_vitamix', '1');
    }
}

function add_missing_columns(PDO $pdo, string $table, array $columns): void
{
    $existing = [];
    if (DB_DRIVER === 'sqlite') {
        foreach ($pdo->query("PRAGMA table_info($table)") as $c) {
            $existing[strtolower($c['name'])] = true;
        }
    } else {
        foreach ($pdo->query("SHOW COLUMNS FROM `$table`") as $c) {
            $existing[strtolower($c['Field'])] = true;
        }
    }
    foreach ($columns as $name => $def) {
        if (!isset($existing[$name])) {
            $pdo->exec("ALTER TABLE $table ADD COLUMN $name $def");
        }
    }
}

function get_setting(PDO $pdo, string $k): ?string
{
    $st = $pdo->prepare('SELECT v FROM settings WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string) $v;
}

function set_setting(PDO $pdo, string $k, string $v): void
{
    $st = $pdo->prepare('UPDATE settings SET v = ? WHERE k = ?');
    $st->execute([$v, $k]);
    if ($st->rowCount() === 0 && get_setting($pdo, $k) === null) {
        $pdo->prepare('INSERT INTO settings (k, v) VALUES (?, ?)')->execute([$k, $v]);
    }
}

function seed_examples(PDO $pdo): void
{
    $now = (int) round(microtime(true) * 1000);
    $products = [
        ['p-ej-aeropress', 'B0047BIWSK', 'AeroPress Original – cafetera de prensa', 'Ejemplo: base del kit de café'],
        ['p-ej-skerton', 'B01MXJI90S', 'Hario Skerton Pro – molino manual de cerámica', 'Ejemplo: molino para grano entero'],
        ['p-ej-buono', 'B0BWGXG5GN', 'Hario V60 Buono – tetera cuello de ganso 1.2 L', 'Ejemplo: tetera para vertido preciso'],
    ];
    $pdo->beginTransaction();
    $ins = $pdo->prepare('INSERT INTO products (id, asin, title, price, category, notes, image, source, is_example, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 1, ?, ?)');
    foreach ($products as $i => $p) {
        $ins->execute([$p[0], $p[1], $p[2], 'Café', $p[3], 'manual', $now + $i, $now + $i]);
    }
    $pdo->prepare('INSERT INTO bundles (id, name, description, is_example, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
        ->execute(['b-ej-cafe', 'Kit de café en casa (ejemplo)', 'Prensa, molino y tetera para preparar café de especialidad', $now + 10, $now + 10]);
    $item = $pdo->prepare('INSERT INTO bundle_items (bundle_id, product_id, qty, position) VALUES (?, ?, 1, ?)');
    foreach ($products as $i => $p) {
        $item->execute(['b-ej-cafe', $p[0], $i]);
    }
    $pdo->commit();
}

/** Licuadora Vitamix 5200 roja (ASIN B00BY0A8Y8), con todos los campos de detalle. */
function seed_vitamix(PDO $pdo): void
{
    $st = $pdo->prepare('SELECT 1 FROM products WHERE asin = ?');
    $st->execute(['B00BY0A8Y8']);
    if ($st->fetchColumn()) {
        return;
    }
    $now = (int) round(microtime(true) * 1000) + 100; // después de los ejemplos
    $about = implode("\n", [
        'Motor de 2 caballos de fuerza (HP) con cuchillas de acero inoxidable cortadas con láser para lograr texturas muy finas.',
        'Vaso clásico de 64 onzas libre de BPA, pensado para lotes medianos y grandes; su forma genera el vórtice característico de Vitamix.',
        '10 velocidades variables más un ajuste de alta velocidad para controlar la textura, desde smoothies sedosos hasta salsas con trozos.',
        'Prepara recetas frías y calientes en el mismo vaso: smoothies, jugos, purés, salsas, sopas y helados.',
        'Función de autolimpieza: con agua tibia y unas gotas de jabón el vaso queda listo en segundos.',
        'Ventilador de enfriamiento radial y sistema de protección térmica para un uso prolongado.',
        'Cable de 6 pies; especificaciones eléctricas de 120 V, 50/60 Hz y 11.5 A.',
        'Incluye base del motor, vaso clásico de 64 oz y apisonador (tamper) para mover mezclas espesas.',
        'Garantía limitada de 7 años.',
    ]);
    $pdo->prepare('INSERT INTO products (id, asin, title, price, category, notes, brand, color, feature, capacity, dimensions, about, image, source, is_example, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)')
        ->execute([
            'p-vitamix-5200-rojo', 'B00BY0A8Y8', 'Vitamix 5200 – licuadora profesional, vaso de 64 oz, rojo',
            'Cocina', '', 'Vitamix', 'Rojo', 'Mezclas', '64 onzas fluidas',
            '8.75 x 7.25 x 20.5 pulgadas (prof. x ancho x alto)', $about, 'manual', $now, $now,
        ]);
}

/** Registra una categoría si no existe (sin distinguir mayúsculas). Devuelve su nombre registrado. */
function ensure_category(PDO $pdo, string $name): string
{
    $name = trim($name);
    if ($name === '') {
        return '';
    }
    $st = $pdo->prepare('SELECT name FROM categories WHERE LOWER(name) = LOWER(?)');
    $st->execute([$name]);
    $found = $st->fetchColumn();
    if ($found !== false) {
        return (string) $found;
    }
    $pdo->prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)')
        ->execute(['c-' . bin2hex(random_bytes(6)), $name, (int) round(microtime(true) * 1000)]);
    return $name;
}

/** Categorías iniciales: unas básicas más las que ya usan los productos. */
function seed_categories(PDO $pdo): void
{
    foreach (['Cocina', 'Café', 'Electrodomésticos', 'Electrónica', 'Hogar'] as $c) {
        ensure_category($pdo, $c);
    }
    foreach ($pdo->query("SELECT DISTINCT category FROM products WHERE category <> ''")->fetchAll(PDO::FETCH_COLUMN) as $c) {
        ensure_category($pdo, (string) $c);
    }
}
