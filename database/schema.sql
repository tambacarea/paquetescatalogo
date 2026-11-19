-- Esquema de referencia para MySQL / MariaDB (Laragon).
-- No hace falta ejecutarlo: api.php crea la base y las tablas solas la primera vez.
-- Úsalo si prefieres crearlas a mano desde HeidiSQL o phpMyAdmin.

CREATE DATABASE IF NOT EXISTS `paquetescatalogo` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `paquetescatalogo`;

CREATE TABLE IF NOT EXISTS products (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  asin        CHAR(10)     NOT NULL UNIQUE,
  title       VARCHAR(300) NOT NULL,
  price       DECIMAL(10,2) NULL,              -- precio de referencia en USD, capturado a mano
  category    VARCHAR(100) NOT NULL DEFAULT '',
  notes       VARCHAR(500) NOT NULL DEFAULT '',
  brand       VARCHAR(100) NOT NULL DEFAULT '',  -- Marca
  color       VARCHAR(60)  NOT NULL DEFAULT '',  -- Color
  feature     VARCHAR(150) NOT NULL DEFAULT '',  -- Característica especial
  capacity    VARCHAR(60)  NOT NULL DEFAULT '',  -- Capacidad
  dimensions  VARCHAR(120) NOT NULL DEFAULT '',  -- Dimensiones del producto
  about       TEXT         NULL,                 -- Sobre este artículo (un punto por línea)
  image       MEDIUMTEXT   NULL,               -- foto propia como data URI (JPG reducido)
  source      VARCHAR(20)  NOT NULL DEFAULT 'manual',  -- manual | import | creators_api
  is_example  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  BIGINT       NOT NULL,           -- milisegundos Unix
  updated_at  BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundles (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  is_example  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id   VARCHAR(40)  NOT NULL,
  product_id  VARCHAR(40)  NOT NULL,
  qty         INT          NOT NULL DEFAULT 1,
  position    INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,      -- products.category guarda este nombre
  created_at  BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  k  VARCHAR(50) NOT NULL PRIMARY KEY,         -- associate_tag, seeded
  v  TEXT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Si ya tenías la base de la versión anterior, api.php agrega estas columnas solo.
-- Equivalente manual:
-- ALTER TABLE products
--   ADD COLUMN brand VARCHAR(100) NOT NULL DEFAULT '',
--   ADD COLUMN color VARCHAR(60) NOT NULL DEFAULT '',
--   ADD COLUMN feature VARCHAR(150) NOT NULL DEFAULT '',
--   ADD COLUMN capacity VARCHAR(60) NOT NULL DEFAULT '',
--   ADD COLUMN dimensions VARCHAR(120) NOT NULL DEFAULT '',
--   ADD COLUMN about TEXT NULL;
