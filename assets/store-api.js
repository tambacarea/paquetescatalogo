/* Almacén de datos para Laragon: habla con api.php (MySQL o SQLite).
 * Interfaz común que usa app.js:
 *   init(onData, onStatus), saveProduct(input, id), deleteProduct(id), saveBundle(input, id),
 *   deleteBundle(id), saveConfig(tag), saveCategory(name, id, oldName), deleteCategory(id, name),
 *   importProducts(list), readOnly()
 */
window.PaquetesStore = (() => {
  "use strict";
  const API = "api.php";
  let onData = () => {};
  let onStatus = () => {};

  const Auth = window.PaquetesAuth;

  async function call(method, route, { id, body, query } = {}, retried = false) {
    const qs = new URLSearchParams({ r: route, ...(query || {}) });
    if (id) qs.set("id", id);
    let res;
    try {
      res = await fetch(`${API}?${qs}`, {
        method,
        credentials: "same-origin",
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...Auth.headers() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new Error("No hay respuesta del servidor. Revisa que Apache esté iniciado en Laragon.");
    }
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
    const state = data.state || (route === "state" ? data : null);
    if (state) {
      onData(state);
      const label = state.config && state.config.driver === "sqlite" ? "SQLite" : "MySQL";
      onStatus({ kind: "ok", label: `Guardado en ${label}`, message: "" });
    }
    return data;
  }

  async function reload() {
    try { await call("GET", "state"); }
    catch (e) { onStatus({ kind: "bad", label: "Sin conexión", message: e.message }); }
  }

  return {
    readOnly: () => false,
    async init(dataCb, statusCb) {
      onData = dataCb; onStatus = statusCb;
      onStatus({ kind: "wait", label: "Conectando…" });
      await Auth.ensure();
      await reload();
      // Al volver a la pestaña, recarga por si otra persona hizo cambios.
      window.addEventListener("focus", reload);
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
