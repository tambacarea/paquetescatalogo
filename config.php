<?php
/**
 * Configuración de Paquetes Catálogo.
 *
 * Valores por defecto de Laragon: MySQL en localhost, usuario "root" sin contraseña.
 * La base de datos y las tablas se crean solas la primera vez que se abre la página.
 *
 * Si prefieres no usar MySQL, cambia DB_DRIVER a "sqlite" y los datos se guardarán
 * en data/paquetes.sqlite (requiere la extensión pdo_sqlite).
 */

define('DB_DRIVER', 'mysql');            // "mysql" o "sqlite"

define('DB_HOST', '127.0.0.1');
define('DB_PORT', 3306);
define('DB_NAME', 'paquetescatalogo');
define('DB_USER', 'root');
define('DB_PASS', '');

define('SQLITE_PATH', __DIR__ . '/data/paquetes.sqlite');

// Marketplace de Amazon con el que se arman los enlaces.
define('AMAZON_MARKETPLACE', 'https://www.amazon.com');

// Mínimo de productos por paquete.
define('MIN_ITEMS_PER_BUNDLE', 3);

// Cargar productos de ejemplo la primera vez (se pueden borrar desde la página).
define('SEED_EXAMPLES', true);

/*
 * Creators API (pendiente).
 * Cuando la cuenta de Associates tenga acceso, aquí irán las credenciales OAuth.
 * NUNCA se envían al navegador: solo las usará un script del servidor.
 */
define('CREATORS_API_CLIENT_ID', '');
define('CREATORS_API_CLIENT_SECRET', '');
