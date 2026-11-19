# Publicar en Coolify (VPS de Hostinger)

La imagen se construye con el `Dockerfile` de esta carpeta (PHP 8.3 + Apache).
En Laragon nada cambia: `config.php` se sigue usando igual. Dentro de la imagen,
cada constante de `config.php` puede venir de una variable de entorno con el mismo nombre.

## 1. Subir el proyecto a GitHub (repositorio privado)

En GitHub crea un repositorio **privado** vacío, por ejemplo `paquetescatalogo`. Luego, en PowerShell:

```powershell
cd C:\laragon\www\paquetescatalogo
git init
git add .
git commit -m "Paquetes Catálogo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/paquetescatalogo.git
git push -u origin main
```

`config.php` solo trae los valores de Laragon (root sin contraseña); las claves reales
van en Coolify, nunca en el repositorio.

## 2. Base de datos en Coolify

1. En tu proyecto de Coolify: **+ New → Database → MariaDB** (o MySQL) → **Start**.
2. Copia de su pantalla: el **host interno** (el nombre del recurso, no `localhost`),
   el **usuario**, la **contraseña** y el **nombre de la base**.
3. Activa los **respaldos programados** de esa base.

Las tablas se crean solas en el primer arranque.

## 3. Aplicación en Coolify

1. **+ New → Private Repository (with GitHub App)** → elige el repositorio y la rama `main`.
2. **Build Pack: Dockerfile**. **Port: 80**.
3. **Environment Variables**:

| Variable | Valor |
|---|---|
| `DB_HOST` | host interno de la base (paso 2) |
| `DB_PORT` | `3306` |
| `DB_NAME` | nombre de la base |
| `DB_USER` | usuario de la base |
| `DB_PASS` | contraseña de la base |
| `ADMIN_PASSWORD` | contraseña inicial del panel (mínimo 8 caracteres) |
| `SEED_EXAMPLES` | `false` (sin productos de ejemplo) |

4. **Domains**: `https://paquetes.tudominio.com`. En tu DNS crea un registro **A**
   de ese subdominio apuntando a la IP del VPS. Coolify emite el certificado HTTPS.
5. **Deploy**.

## 4. Primer acceso

- Entra a tu dominio y escribe la contraseña de `ADMIN_PASSWORD`.
- Después de entrar, **borra la variable `ADMIN_PASSWORD`** en Coolify. Solo se usa cuando
  aún no existe contraseña, pero es mejor no dejarla guardada.
- Desde el servidor la primera contraseña **no** se puede crear en la página (solo desde
  localhost), por eso existe `ADMIN_PASSWORD`.

## Cambiar u olvidar la contraseña

- Con sesión: desde la página (Ajustes).
- Sin sesión: Coolify → la aplicación → **Terminal** →

```sh
php /opt/pqc/set-admin-password.php
```

## Detalles técnicos

- Apache toma la IP real del visitante de `X-Forwarded-For` solo si viene del proxy
  interno de Coolify; así el bloqueo tras 5 intentos fallidos afecta solo a esa IP.
- `X-Forwarded-Proto: https` activa la cookie de sesión con `Secure`.
- `lib/` y `data/` responden 403; las herramientas de despliegue quedan fuera de la carpeta pública.
- Encabezados de seguridad: `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`.
- Salud del contenedor: `curl http://localhost/`.
