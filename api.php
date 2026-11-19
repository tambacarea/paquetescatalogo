<?php
/**
 * API JSON de Paquetes Catálogo.
 *
 *   GET    api.php?r=state                 Catálogo, paquetes y configuración
 *   POST   api.php?r=product               Crear o actualizar un producto
 *   DELETE api.php?r=product&id=...        Eliminar un producto
 *   POST   api.php?r=bundle                Crear o actualizar un paquete
 *   DELETE api.php?r=bundle&id=...         Eliminar un paquete
 *   POST   api.php?r=category              Crear o renombrar una categoría
 *   DELETE api.php?r=category&id=…         Eliminar una categoría (sus productos quedan sin categoría)
 *   POST   api.php?r=config                Guardar el tag de afiliado
 *   POST   api.php?r=import                Importar una lista de productos (JSON)
 *
 * Acceso (lib/auth.php). Son las únicas rutas que no piden sesión:
 *   GET    api.php?r=session               ¿Hay sesión? ¿Falta crear la contraseña? + token CSRF
 *   POST   api.php?r=login                 {password}
 *   POST   api.php?r=setup                 {password, repeat}  Primera contraseña, solo desde localhost
 *   POST   api.php?r=logout                Cerrar sesión
 * Con sesión: POST api.php?r=password {current, password, repeat}  Cambiar la contraseña
 *
 * Todas las demás rutas responden 401 sin sesión, y las de escritura 403 sin el
 * encabezado X-CSRF-Token. Las respuestas de escritura devuelven el estado completo.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

class ApiError extends Exception
{
    public $status;
    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

function respond($data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new ApiError('El cuerpo de la petición no es JSON válido.');
    }
    return $data;
}

function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

function new_id(string $prefix): string
{
    return $prefix . '-' . base_convert((string) now_ms(), 10, 36) . bin2hex(random_bytes(3));
}

function clean_str($v, int $max): string
{
    $s = trim((string) ($v ?? ''));
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function extract_asin($input): ?string
{
    $s = trim((string) ($input ?? ''));
    if (preg_match('/^[A-Z0-9]{10}$/i', $s)) {
        return strtoupper($s);
    }
    if (preg_match('~(?:/dp/|/gp/product/|/gp/aw/d/|/exec/obidos/ASIN/|/o/ASIN/|[?&]asin=)([A-Z0-9]{10})(?=[/?&#]|$)~i', $s, $m)) {
        return strtoupper($m[1]);
    }
    return null;
}

function lower(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function valid_id($id): bool
{
    return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id) === 1;
}

function parse_price($v): ?float
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_numeric($v) || (float) $v < 0 || (float) $v > 99999999) {
        throw new ApiError('El precio debe ser un número positivo.');
    }
    return round((float) $v, 2);
}

/* ---------- Lectura ---------- */

function state(PDO $pdo): array
{
    $products = [];
    foreach ($pdo->query('SELECT * FROM products ORDER BY created_at ASC') as $r) {
        $products[] = [
            'id' => $r['id'],
            'asin' => $r['asin'],
            'title' => $r['title'],
            'price' => $r['price'] === null ? null : (float) $r['price'],
            'category' => $r['category'],
            'notes' => $r['notes'],
            'brand' => $r['brand'],
            'color' => $r['color'],
            'feature' => $r['feature'],
            'capacity' => $r['capacity'],
            'dimensions' => $r['dimensions'],
            'about' => $r['about'] ?? '',
            'image' => $r['image'],
            'source' => $r['source'],
            'example' => (bool) $r['is_example'],
            'createdAt' => (int) $r['created_at'],
            'updatedAt' => (int) $r['updated_at'],
        ];
    }

    $items = [];
    foreach ($pdo->query('SELECT bundle_id, product_id, qty FROM bundle_items ORDER BY position ASC') as $r) {
        $items[$r['bundle_id']][] = ['pid' => $r['product_id'], 'qty' => (int) $r['qty']];
    }

    $bundles = [];
    foreach ($pdo->query('SELECT * FROM bundles ORDER BY created_at DESC') as $r) {
        $bundles[] = [
            'id' => $r['id'],
            'name' => $r['name'],
            'desc' => $r['description'],
            'items' => $items[$r['id']] ?? [],
            'example' => (bool) $r['is_example'],
            'createdAt' => (int) $r['created_at'],
            'updatedAt' => (int) $r['updated_at'],
        ];
    }

    $categories = [];
    foreach ($pdo->query('SELECT id, name FROM categories ORDER BY name ASC') as $r) {
        $categories[] = ['id' => $r['id'], 'name' => $r['name']];
    }

    return [
        'products' => $products,
        'bundles' => $bundles,
        'categories' => $categories,
        'config' => [
            'tag' => get_setting($pdo, 'associate_tag') ?? '',
            'marketplace' => AMAZON_MARKETPLACE,
            'minItems' => MIN_ITEMS_PER_BUNDLE,
            'driver' => DB_DRIVER,
        ],
    ];
}

/* ---------- Productos ---------- */

function save_product(PDO $pdo, array $in, string $source = 'manual'): string
{
    $asin = extract_asin($in['asin'] ?? ($in['url'] ?? ''));
    if ($asin === null) {
        throw new ApiError('Falta un ASIN válido: pega la URL del producto o los 10 caracteres del ASIN.');
    }
    $title = clean_str($in['title'] ?? '', 300);
    if ($title === '') {
        throw new ApiError('Escribe el nombre del producto.');
    }
    $price = parse_price($in['price'] ?? null);
    $category = ensure_category($pdo, clean_str($in['category'] ?? '', 100));
    $notes = clean_str($in['notes'] ?? '', 500);
    $brand = clean_str($in['brand'] ?? '', 100);
    $color = clean_str($in['color'] ?? '', 60);
    $feature = clean_str($in['feature'] ?? '', 150);
    $capacity = clean_str($in['capacity'] ?? '', 60);
    $dimensions = clean_str($in['dimensions'] ?? '', 120);
    $about = clean_str(str_replace(["\r\n", "\r"], "\n", (string) ($in['about'] ?? '')), 5000);

    $id = $in['id'] ?? null;
    $existing = null;
    if ($id !== null) {
        if (!valid_id($id)) {
            throw new ApiError('Identificador de producto inválido.');
        }
        $st = $pdo->prepare('SELECT * FROM products WHERE id = ?');
        $st->execute([$id]);
        $existing = $st->fetch() ?: null;
        if ($existing === null) {
            throw new ApiError('Ese producto ya no existe. Recarga la página.', 404);
        }
    }

    $dup = $pdo->prepare('SELECT title FROM products WHERE asin = ? AND id <> ?');
    $dup->execute([$asin, $id ?? '']);
    if ($t = $dup->fetchColumn()) {
        throw new ApiError("Ese ASIN ya está en el catálogo como “{$t}”.", 409);
    }

    // Imagen: null = conservar, "" = quitar, data:image/... = nueva.
    $image = $existing['image'] ?? null;
    if (array_key_exists('image', $in) && $in['image'] !== null) {
        $img = (string) $in['image'];
        if ($img === '') {
            $image = null;
        } elseif (preg_match('~^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$~', $img) && strlen($img) <= 600000) {
            $image = $img;
        } else {
            throw new ApiError('La foto debe ser JPG, PNG o WebP y pesar menos de 400 KB.');
        }
    }

    $now = now_ms();
    if ($existing) {
        $pdo->prepare('UPDATE products SET asin = ?, title = ?, price = ?, category = ?, notes = ?, brand = ?, color = ?, feature = ?, capacity = ?, dimensions = ?, about = ?, image = ?, is_example = 0, updated_at = ? WHERE id = ?')
            ->execute([$asin, $title, $price, $category, $notes, $brand, $color, $feature, $capacity, $dimensions, $about, $image, $now, $id]);
        return $id;
    }

    $id = new_id('p');
    $pdo->prepare('INSERT INTO products (id, asin, title, price, category, notes, brand, color, feature, capacity, dimensions, about, image, source, is_example, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
        ->execute([$id, $asin, $title, $price, $category, $notes, $brand, $color, $feature, $capacity, $dimensions, $about, $image, $source, $now, $now]);
    return $id;
}

function delete_product(PDO $pdo, $id): void
{
    if (!valid_id($id)) {
        throw new ApiError('Identificador de producto inválido.');
    }
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM bundle_items WHERE product_id = ?')->execute([$id]);
    $pdo->prepare('DELETE FROM products WHERE id = ?')->execute([$id]);
    $pdo->commit();
}

/* ---------- Paquetes ---------- */

function save_bundle(PDO $pdo, array $in): string
{
    $name = clean_str($in['name'] ?? '', 150);
    if ($name === '') {
        throw new ApiError('Ponle nombre al paquete.');
    }
    $desc = clean_str($in['desc'] ?? '', 500);

    $items = [];
    foreach ((array) ($in['items'] ?? []) as $it) {
        $pid = $it['pid'] ?? null;
        if (!valid_id($pid) || isset($items[$pid])) {
            continue;
        }
        $items[$pid] = max(1, min(99, (int) ($it['qty'] ?? 1)));
    }
    if ($items) {
        $ph = implode(',', array_fill(0, count($items), '?'));
        $st = $pdo->prepare("SELECT id FROM products WHERE id IN ($ph)");
        $st->execute(array_keys($items));
        $found = array_flip($st->fetchAll(PDO::FETCH_COLUMN));
        $items = array_intersect_key($items, $found);
    }
    if (count($items) < MIN_ITEMS_PER_BUNDLE) {
        throw new ApiError('Un paquete necesita al menos ' . MIN_ITEMS_PER_BUNDLE . ' productos del catálogo.');
    }

    $id = $in['id'] ?? null;
    $now = now_ms();
    $pdo->beginTransaction();
    if ($id !== null) {
        if (!valid_id($id)) {
            throw new ApiError('Identificador de paquete inválido.');
        }
        $st = $pdo->prepare('UPDATE bundles SET name = ?, description = ?, is_example = 0, updated_at = ? WHERE id = ?');
        $st->execute([$name, $desc, $now, $id]);
        $exists = $pdo->prepare('SELECT 1 FROM bundles WHERE id = ?');
        $exists->execute([$id]);
        if (!$exists->fetchColumn()) {
            $pdo->rollBack();
            throw new ApiError('Ese paquete ya no existe. Recarga la página.', 404);
        }
        $pdo->prepare('DELETE FROM bundle_items WHERE bundle_id = ?')->execute([$id]);
    } else {
        $id = new_id('b');
        $pdo->prepare('INSERT INTO bundles (id, name, description, is_example, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
            ->execute([$id, $name, $desc, $now, $now]);
    }
    $ins = $pdo->prepare('INSERT INTO bundle_items (bundle_id, product_id, qty, position) VALUES (?, ?, ?, ?)');
    $pos = 0;
    foreach ($items as $pid => $qty) {
        $ins->execute([$id, $pid, $qty, $pos++]);
    }
    $pdo->commit();
    return $id;
}

function delete_bundle(PDO $pdo, $id): void
{
    if (!valid_id($id)) {
        throw new ApiError('Identificador de paquete inválido.');
    }
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM bundle_items WHERE bundle_id = ?')->execute([$id]);
    $pdo->prepare('DELETE FROM bundles WHERE id = ?')->execute([$id]);
    $pdo->commit();
}

/* ---------- Categorías ---------- */

function save_category(PDO $pdo, array $in): string
{
    $name = clean_str($in['name'] ?? '', 100);
    if ($name === '') {
        throw new ApiError('Escribe el nombre de la categoría.');
    }
    $id = $in['id'] ?? null;
    $old = clean_str($in['oldName'] ?? '', 100);
    if ($id !== null) {
        if (!valid_id($id)) {
            throw new ApiError('Identificador de categoría inválido.');
        }
        $st = $pdo->prepare('SELECT name FROM categories WHERE id = ?');
        $st->execute([$id]);
        $old = $st->fetchColumn();
        if ($old === false) {
            throw new ApiError('Esa categoría ya no existe. Recarga la página.', 404);
        }
    }
    $clash = $pdo->prepare('SELECT name FROM categories WHERE LOWER(name) = LOWER(?) AND id <> ?');
    $clash->execute([$name, $id ?? '']);
    if (($c = $clash->fetchColumn()) && lower((string) $c) !== lower((string) $old)) {
        throw new ApiError("Ya existe la categoría “{$c}”.", 409);
    }

    $pdo->beginTransaction();
    if ($id !== null) {
        $pdo->prepare('UPDATE categories SET name = ? WHERE id = ?')->execute([$name, $id]);
    } else {
        $name = ensure_category($pdo, $name);
        $st = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
        $st->execute([$name]);
        $id = (string) $st->fetchColumn();
    }
    if ($old !== '' && $old !== false && $old !== $name) {
        // Renombrar: los productos de la categoría anterior pasan a la nueva
        $pdo->prepare('UPDATE products SET category = ?, updated_at = ? WHERE category = ?')->execute([$name, now_ms(), $old]);
    }
    $pdo->commit();
    return $id;
}

function delete_category(PDO $pdo, $id, string $name): void
{
    if ($id !== null && $id !== '') {
        if (!valid_id($id)) {
            throw new ApiError('Identificador de categoría inválido.');
        }
        $st = $pdo->prepare('SELECT name FROM categories WHERE id = ?');
        $st->execute([$id]);
        $found = $st->fetchColumn();
        if ($found !== false) {
            $name = (string) $found;
        }
    }
    $pdo->beginTransaction();
    if ($name !== '') {
        $pdo->prepare("UPDATE products SET category = '', updated_at = ? WHERE category = ?")->execute([now_ms(), $name]);
    }
    if ($id) {
        $pdo->prepare('DELETE FROM categories WHERE id = ?')->execute([$id]);
    } elseif ($name !== '') {
        $pdo->prepare('DELETE FROM categories WHERE name = ?')->execute([$name]);
    }
    $pdo->commit();
}

/* ---------- Ruteo ---------- */

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $r = $_GET['r'] ?? 'state';

    try {
        $pdo = db();
    } catch (PDOException $e) {
        error_log('[paquetescatalogo] ' . $e->getMessage());
        throw new ApiError(DB_DRIVER === 'sqlite'
            ? 'No se pudo abrir la base SQLite. Revisa que la carpeta data/ tenga permisos de escritura.'
            : 'No se pudo conectar a MySQL. Inicia MySQL en Laragon ("Start All") y revisa usuario y contraseña en config.php.', 503);
    }

    /* ---------- Acceso ---------- */
    auth_start_session();

    if ($method === 'GET' && $r === 'session') {
        respond(auth_status($pdo));
    }
    if ($method === 'POST' && $r === 'login') {
        auth_login($pdo, body());
        respond(auth_status($pdo));
    }
    if ($method === 'POST' && $r === 'setup') {
        auth_setup($pdo, body());
        respond(auth_status($pdo));
    }
    if ($method === 'POST' && $r === 'logout') {
        auth_clear_session();
        respond(['admin' => false]);
    }

    // A partir de aquí todo requiere sesión de administrador.
    auth_require();

    if ($method === 'POST' && $r === 'password') {
        auth_change_password($pdo, body());
        respond(auth_status($pdo));
    }

    if ($method === 'GET' && $r === 'state') {
        respond(state($pdo));
    }

    if ($method === 'POST' && $r === 'product') {
        $id = save_product($pdo, body());
        respond(['id' => $id, 'state' => state($pdo)]);
    }
    if ($method === 'DELETE' && $r === 'product') {
        delete_product($pdo, $_GET['id'] ?? null);
        respond(['state' => state($pdo)]);
    }

    if ($method === 'POST' && $r === 'bundle') {
        $id = save_bundle($pdo, body());
        respond(['id' => $id, 'state' => state($pdo)]);
    }
    if ($method === 'DELETE' && $r === 'bundle') {
        delete_bundle($pdo, $_GET['id'] ?? null);
        respond(['state' => state($pdo)]);
    }

    if ($method === 'POST' && $r === 'category') {
        $id = save_category($pdo, body());
        respond(['id' => $id, 'state' => state($pdo)]);
    }
    if ($method === 'DELETE' && $r === 'category') {
        delete_category($pdo, $_GET['id'] ?? null, clean_str($_GET['name'] ?? '', 100));
        respond(['state' => state($pdo)]);
    }

    if ($method === 'POST' && $r === 'config') {
        $tag = clean_str(body()['tag'] ?? '', 64);
        if ($tag !== '' && !preg_match('/^[A-Za-z0-9_-]{2,64}$/', $tag)) {
            throw new ApiError('El tag solo lleva letras, números y guiones (ej. tutienda-20).');
        }
        set_setting($pdo, 'associate_tag', $tag);
        respond(['state' => state($pdo)]);
    }

    if ($method === 'POST' && $r === 'import') {
        $list = body();
        if (isset($list['items']) && is_array($list['items'])) {
            $list = $list['items'];
        } elseif (isset($list['products']) && is_array($list['products'])) {
            $list = $list['products'];
        }
        if (!$list || array_keys($list) !== range(0, count($list) - 1)) {
            throw new ApiError('Se esperaba una lista de productos: [{"asin": …, "title": …}].');
        }
        $added = 0;
        $skipped = 0;
        foreach ($list as $raw) {
            if (!is_array($raw)) {
                $skipped++;
                continue;
            }
            $in = [
                'asin' => $raw['asin'] ?? ($raw['ASIN'] ?? ($raw['url'] ?? '')),
                'title' => $raw['title'] ?? ($raw['name'] ?? ''),
                'price' => $raw['price'] ?? null,
                'category' => $raw['category'] ?? '',
                'brand' => $raw['brand'] ?? '',
                'color' => $raw['color'] ?? '',
                'feature' => $raw['feature'] ?? '',
                'capacity' => $raw['capacity'] ?? '',
                'dimensions' => $raw['dimensions'] ?? '',
                'about' => $raw['about'] ?? '',
            ];
            try {
                save_product($pdo, $in, 'import');
                $added++;
            } catch (ApiError $e) {
                $skipped++;
            }
        }
        respond(['added' => $added, 'skipped' => $skipped, 'state' => state($pdo)]);
    }

    throw new ApiError('Ruta no encontrada.', 404);
} catch (ApiError $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[paquetescatalogo] ' . $e);
    respond(['error' => 'Error interno del servidor. Revisa el log de PHP en Laragon.'], 500);
}
