/* Almacén de datos para Laragon / Coolify: habla con api.php (MySQL o SQLite).
 * Interfaz común que usa app.js:
 *   init(onData, onStatus), saveProduct(input, id), deleteProduct(id), saveBundle(input, id),
 *   deleteBundle(id), saveConfig(tag), saveCategory(name, id, oldName), deleteCategory(id, name),
 *   importProducts(list), readOnly()
 *
 * Rendimiento:
 *  - Cada petición tiene tiempo límite (REQUEST_TIMEOUT_MS) y un mensaje claro si se agota.
 *  - Una sola lectura del estado en vuelo a la vez: llamadas simultáneas comparten la misma promesa.
 *  - Si el servidor devuelve el mismo ETag (sin cambios), no se vuelve a dibujar la página.
 *  - Al volver a la pestaña recarga, pero no más de una vez cada RELOAD_MIN_MS.
 *  - Al arrancar, el estado se pide en paralelo con la comprobación de sesión.
 */
window.PaquetesStore = (() => {
  "use strict";
  const API = "api.php";
  const REQUEST_TIMEOUT_MS = 15000;
  const RELOAD_MIN_MS = 30000;
  let onData = () => {};
  let onStatus = () => {};
  let lastEtag = null;
  let lastLoad = 0;
  let inflightState = null;

  const Auth = window.PaquetesAuth;

  async function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("El servidor tardó demasiado en responder. Revisa tu conexión e intenta de nuevo.");
      throw new Error("No hay respuesta del servidor. Revisa tu conexión (o que Apache esté iniciado en Laragon).");
    } finally {
      clearTimeout(timer);
    }
  }

  function deliver(state, etag) {
    lastLoad = Date.now();
    if (etag && etag === lastEtag) return; // mismos datos: no se redibuja
    lastEtag = etag || null;
    onData(state);
    const label = state.config && state.config.driver === "sqlite" ? "SQLite" : "MySQL";
    onStatus({ kind: "ok", label: `Guardado en ${label}`, message: "" });
  }

  async function call(method, route, { id, body, query } = {}, retried = false) {
    const qs = new URLSearchParams({ r: route, ...(query || {}) });
    if (id) qs.set("id", id);
    const res = await fetchWithTimeout(`${API}?${qs}`, {
      method,
      credentials: "same-origin",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...Auth.headers() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Sesión vencida (401) o token desactualizado (403): pide la contraseña o renueva el token y reintenta una vez.
    if ((res.status === 401 || res.status === 403) && !retried) {
      await (res.status === 401 ? Auth.expired() : Auth.ensure());
      return call(method, route, { id, body, query }, true);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* respuesta no JSON */ }
    if (!res.ok || !data) {
      throw new Error((data && data.error) || `El servidor respondió con error ${res.status}. ¿Abriste la página desde http://localhost y no como archivo?`);
    }
    if (data.state) deliver(data.state, null);              // escrituras: siempre traen datos nuevos
    else if (route === "state") deliver(data, res.headers.get("ETag"));
    return data;
  }

  // Lectura del estado: si ya hay una en curso, se reutiliza en lugar de pedirla otra vez.
  function loadState() {
    if (!inflightState) {
      inflightState = call("GET", "state").finally(() => { inflightState = null; });
    }
    return inflightState;
  }

  async function reload() {
    try { await loadState(); }
    catch (e) { onStatus({ kind: "bad", label: "Sin conexión", message: e.message }); }
  }

  // Petición anticipada del estado (sin pedir contraseña si falla): corre en paralelo con la sesión.
  async function earlyState() {
    try {
      const res = await fetchWithTimeout(`${API}?r=state`, { credentials: "same-origin" });
      if (!res.ok) return null;
      return { data: await res.json(), etag: res.headers.get("ETag") };
    } catch (_) { return null; }
  }

  return {
    readOnly: () => false,
    async init(dataCb, statusCb) {
      onData = dataCb; onStatus = statusCb;
      onStatus({ kind: "wait", label: "Conectando…" });
      const early = earlyState();         // empieza ya…
      await Auth.ensure();                // …mientras se confirma la sesión
      const got = await early;
      if (got && got.data && Array.isArray(got.data.products)) deliver(got.data, got.etag);
      else await reload();                // sin sesión al inicio: se pide después del acceso
      // Al volver a la pestaña, recarga por si otra persona hizo cambios (como máximo cada 30 s).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && Date.now() - lastLoad > RELOAD_MIN_MS) reload();
      });
    },
    async saveProduct(input, id) {
      const body = { ...input };
      if (id) body.id = id;
      return (await call("POST", "product", { body })).id;
    },
    async deleteProduct(id) { await call("DELETE", "product", { id }); },
    async saveBundle(input, id) {
      const body = { ...input };
      if (id) body.id = id;
      return (await call("POST", "bundle", { body })).id;
    },
    async deleteBundle(id) { await call("DELETE", "bundle", { id }); },
    async saveConfig(tag) { await call("POST", "config", { body: { tag } }); },
    async saveCategory(name, id, oldName) {
      const body = { name };
      if (id) body.id = id;
      if (oldName) body.oldName = oldName;
      return (await call("POST", "category", { body })).id;
    },
    async deleteCategory(id, name) {
      await call("DELETE", "category", { id, query: { name: name || "" } });
    },
    async importProducts(list) {
      const r = await call("POST", "import", { body: list });
      return { added: r.added, skipped: r.skipped };
    },
  };
})();
