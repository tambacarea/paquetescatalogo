# Paquetes Catálogo

Armador de paquetes de productos de **amazon.com** para afiliados (Amazon Associates).
Se cargan productos por ASIN o enlace, se agrupan en paquetes de **3 o más** y se comparten
los enlaces de afiliado o un enlace de "agregar todo al carrito".

No hace scraping: los productos se capturan a mano o se importan en JSON. Más adelante se
pueden traer de la **Creators API** de Amazon (la que reemplazó a la PA-API 5.0).

## Requisitos

- Laragon con Apache y MySQL (o MariaDB) y PHP 7.4 o superior.
- Extensión `pdo_mysql` activa (viene activa en Laragon).

## Puesta en marcha

1. La carpeta ya está en `C:\laragon\www\paquetescatalogo`.
2. En Laragon pulsa **Start All** (Apache y MySQL).
3. Abre **http://localhost/paquetescatalogo/**
   (o `http://paquetescatalogo.test` si tienes activados los virtual hosts automáticos de Laragon).

La primera vez se crean solas la base `paquetescatalogo`, sus tablas y 3 productos de ejemplo
con un paquete armado. Los ejemplos se pueden borrar desde la página.

## Acceso con contraseña

Toda la página pide la contraseña de administración: sin ella no se ven ni se modifican datos.

- **Primera vez:** abre la página **en el equipo donde está Laragon** (`http://localhost/paquetescatalogo/`)
  y crea la contraseña (mínimo 8 caracteres). Desde otro equipo no se puede crear.
- **Cambiarla:** Ajustes → "Cambiar contraseña de administración".
- **Cerrar sesión:** botón "Cerrar sesión" arriba. La sesión también se cierra sola tras 2 horas sin uso.
- **Intentos:** 5 contraseñas incorrectas seguidas bloquean esa IP durante 15 minutos.
- **La olvidé:** en HeidiSQL borra de la tabla `settings` la fila `admin_password_hash` y vuelve a abrir
  la página desde `http://localhost` para crear una nueva. Los productos y paquetes no se tocan.

La contraseña se guarda solo como hash (`password_hash`). La sesión usa una cookie `HttpOnly` y `SameSite=Strict`,
y cada cambio lleva un token anti-CSRF. Si publicas la página fuera de tu red, usa **HTTPS**:
sin él, la contraseña viaja sin cifrar.

> Abre siempre la página desde `http://localhost/...`. Si la abres con doble clic como archivo,
> el navegador no puede hablar con `api.php` y no se cargan los datos.

## Configuración (`config.php`)

| Constante | Para qué sirve | Valor por defecto |
|---|---|---|
| `DB_DRIVER` | `mysql` o `sqlite` | `mysql` |
| `DB_HOST`, `DB_PORT` | Servidor MySQL | `127.0.0.1`, `3306` |
| `DB_NAME` | Nombre de la base | `paquetescatalogo` |
| `DB_USER`, `DB_PASS` | Credenciales | `root`, vacío (Laragon) |
| `AMAZON_MARKETPLACE` | Tienda para los enlaces | `https://www.amazon.com` |
| `MIN_ITEMS_PER_BUNDLE` | Mínimo de productos por paquete | `3` |
| `SEED_EXAMPLES` | Cargar ejemplos la primera vez | `true` |

Con `DB_DRIVER = 'sqlite'` los datos se guardan en `data/paquetes.sqlite` y no hace falta MySQL.

## Cómo se usa (proceso en 3 pasos)

| Paso | Qué haces | Alta | Consulta | Edición | Baja |
|---|---|---|---|---|---|
| **1. Catálogo** | Lista maestra de productos | “+ Agregar producto” (o “Guardar y agregar otro” para varios seguidos) | Buscar por nombre/ASIN/marca, filtrar por categoría o uso, “Ver” ficha | “Editar” | “Eliminar”: avisa en qué paquetes está y cuáles quedarían incompletos |
| **2. Armar paquete** | Se habilita con 3 productos en el catálogo | Marcar productos + nombre; “Guardar” solo se activa al cumplir los requisitos | Lista de requisitos y total en vivo | — | “Cancelar” pide confirmar si hay cambios |
| **3. Paquetes guardados** | Lista paginada (10 por página) | “+ Nuevo paquete” o “Duplicar” | Buscar por paquete o producto, ordenar, abrir para ver productos, carrito y enlaces | “Editar” abre el paso 2 en modo edición | “Eliminar” (los productos siguen en el catálogo) |

Un producto puede estar en varios paquetes; el catálogo muestra en cuántos (“En 2 paquetes”).

## Estructura

```
paquetescatalogo/
├── index.html            Interfaz: pasos, vistas y diálogos
├── assets/app.css        Estilos (tema claro y oscuro)
├── assets/app.js         Lógica de la interfaz (compartida con la versión publicada)
├── assets/auth.js        Pantalla de acceso, cerrar sesión y cambio de contraseña
├── assets/store-api.js   Conexión de la interfaz con api.php
├── assets/amazon-parse.js Lector de la ficha de Amazon pegada (autocompletar)
├── api.php               API JSON (productos, paquetes, tag de afiliado, importación)
├── config.php            Configuración
├── lib/db.php            Conexión PDO, creación/migración del esquema y datos de ejemplo
├── lib/auth.php          Contraseña, sesión, bloqueo por intentos y token CSRF
├── database/schema.sql   Esquema de referencia para MySQL (opcional)
└── data/                 Base SQLite si se usa ese modo (protegida por .htaccess)
```

## Autocompletar un producto

En “Agregar producto”:

1. Pega el enlace de amazon.com: se detecta el ASIN y se propone un nombre a partir del enlace.
2. Pulsa “Abrir el producto en Amazon”, y en esa página presiona Ctrl+A y luego Ctrl+C.
3. Vuelve y pega (Ctrl+V) en el cuadro “Autocompletar”. Se llenan nombre, precio, marca, color,
   característica especial, capacidad, dimensiones y “Sobre este artículo”, y se sugiere la categoría
   según la ruta de Amazon. Los campos llenados quedan resaltados para revisarlos; “Deshacer” los regresa.

La página no descarga nada de Amazon (eso sería scraping, prohibido por sus Condiciones de Uso y
bloqueado con CAPTCHA): solo lee lo que la persona copia. El lector está en `assets/amazon-parse.js`
y reconoce la ficha en español y en inglés. Si Amazon cambia el diseño de su página, ese es el archivo
a ajustar. Con acceso a la Creators API, el mismo formulario podrá llenarse desde la API.

## Categorías

Botón “Categorías” en el catálogo: agregar, renombrar (actualiza todos sus productos) y eliminar
(sus productos quedan “Sin categoría”). En el formulario se elige de la lista o se crea una nueva
con “+ Nueva categoría…”. El filtro del catálogo muestra cuántos productos tiene cada una.

## Campos de cada producto

ASIN, nombre, precio de referencia, categoría, notas internas, foto propia y los detalles de la ficha:
**Marca**, **Color**, **Característica especial**, **Capacidad**, **Dimensiones del producto** y
**Sobre este artículo** (texto largo, un punto por línea, que se muestra como lista).

## API

Todas las rutas requieren sesión (responden 401 sin ella). Las de escritura (POST/DELETE) también exigen
el encabezado `X-CSRF-Token` (si falta, responden 403). Las únicas rutas abiertas son las de acceso:

| Método | Ruta | Acción |
|---|---|---|
| GET | `api.php?r=session` | ¿Hay sesión?, ¿falta crear la contraseña?, token CSRF |
| POST | `api.php?r=setup` | Crear la primera contraseña `{password, repeat}` (solo desde localhost) |
| POST | `api.php?r=login` | Entrar `{password}` |
| POST | `api.php?r=logout` | Cerrar sesión |
| POST | `api.php?r=password` | Cambiar contraseña `{current, password, repeat}` (con sesión) |

| Método | Ruta | Acción |
|---|---|---|
| GET | `api.php?r=state` | Catálogo, paquetes y configuración |
| POST | `api.php?r=product` | Crear o actualizar producto (`id` opcional) |
| DELETE | `api.php?r=product&id=…` | Eliminar producto (también lo quita de los paquetes) |
| POST | `api.php?r=bundle` | Crear o actualizar paquete (mínimo 3 productos) |
| DELETE | `api.php?r=bundle&id=…` | Eliminar paquete |
| POST | `api.php?r=category` | Crear o renombrar categoría (`id` u `oldName` para renombrar) |
| DELETE | `api.php?r=category&id=…` | Eliminar categoría (sus productos quedan sin categoría) |
| POST | `api.php?r=config` | Guardar el tag de afiliado |
| POST | `api.php?r=import` | Importar lista JSON `[{"asin","title","price","category","brand","color","feature","capacity","dimensions","about"}]` |

## Siguiente paso: Creators API

Para obtener acceso se necesita una cuenta aprobada de Amazon Associates con al menos
10 ventas calificadas en los últimos 30 días. Con acceso:

1. Poner las credenciales OAuth en `config.php` (`CREATORS_API_CLIENT_ID`, `CREATORS_API_CLIENT_SECRET`).
   Nunca se envían al navegador.
2. Un script PHP del servidor llama a `GetItems` con los ASIN del catálogo y actualiza título,
   precio e imagen (`source = 'creators_api'`).
3. La interfaz no cambia: ya lee todo desde `api.php`.

## Notas

- Los precios son de referencia y se capturan a mano; Amazon cobra el precio vigente al comprar.
- Usa fotos propias. Las imágenes de Amazon solo deben mostrarse a través de su API.
- Verifica en tu panel de Associates que el botón "Agregar todo al carrito" registre la comisión.
