/* Acceso de administración (Laragon): toda la página pide contraseña.
 *   PaquetesAuth.ensure()   Promesa que se cumple cuando hay sesión (muestra la pantalla de acceso si hace falta)
 *   PaquetesAuth.expired()  La sesión terminó: vuelve a pedir la contraseña
 *   PaquetesAuth.headers()  Encabezados con el token CSRF para las peticiones de escritura
 * La comprobación real está en el servidor (lib/auth.php); esto solo es la interfaz.
 */
window.PaquetesAuth = (() => {
  "use strict";
  const API = "api.php";
  const $ = (id) => document.getElementById(id);
  let csrf = "";
  let waiting = null;    // { promise, resolve } mientras se espera la contraseña
  let mode = "login";    // login | setup | blocked | error

  async function req(method, r, body) {
    let res;
    try {
      res = await fetch(`${API}?r=${r}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...headers() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new Error("No hay respuesta del servidor. Revisa que Apache esté iniciado en Laragon.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error((data && data.error) || `El servidor respondió con error ${res.status}.`);
    return data;
  }

  function headers() { return csrf ? { "X-CSRF-Token": csrf } : {}; }

  const TEXT = {
    login: { lede: "Escribe la contraseña de administración.", btn: "Entrar" },
    setup: { lede: "Primera vez: crea la contraseña de administración (mínimo 8 caracteres). Se pedirá cada vez que entres.", btn: "Crear contraseña y entrar" },
    blocked: { lede: "Aún no hay contraseña de administración. Abre la página en el equipo donde está Laragon (http://localhost/paquetescatalogo/) para crearla.", btn: "" },
    error: { lede: "", btn: "Reintentar" },
  };

  function showScreen(nextMode, message) {
    mode = nextMode;
    $("app").hidden = true;
    $("login-screen").hidden = false;
    $("login-lede").textContent = TEXT[mode].lede;
    $("login-lede").hidden = !TEXT[mode].lede;
    $("login-pass-wrap").hidden = mode === "blocked" || mode === "error";
    $("login-pass2-wrap").hidden = mode !== "setup";
    $("login-pass").autocomplete = mode === "setup" ? "new-password" : "current-password";
    $("login-pass").required = mode === "login" || mode === "setup";
    $("login-pass2").required = mode === "setup";
    $("login-submit").textContent = TEXT[mode].btn;
    $("login-submit").hidden = !TEXT[mode].btn;
    $("login-error").textContent = message || "";
    if (!$("login-pass-wrap").hidden) $("login-pass").focus();
  }

  function hideScreen() {
    $("login-screen").hidden = true;
    $("app").hidden = false;
    $("login-form").reset();
    $("login-error").textContent = "";
  }

  function waitForLogin(nextMode, message) {
    if (!waiting) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      waiting = { promise, resolve };
    }
    showScreen(nextMode, message);
    return waiting.promise;
  }

  function done(st) {
    csrf = st.csrf || "";
    hideScreen();
    const w = waiting; waiting = null;
    if (w) w.resolve();
  }

  async function ensure(message) {
    let st;
    try { st = await req("GET", "session"); }
    catch (e) { return waitForLogin("error", e.message); }
    if (st.admin) { done(st); return; }
    csrf = "";
    return waitForLogin(st.needsSetup ? (st.canSetup ? "setup" : "blocked") : "login", message);
  }

  function expired() { csrf = ""; return ensure("Tu sesión terminó. Vuelve a escribir la contraseña."); }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mode === "error") { ensure(); return; }
    if (mode === "blocked") return;
    const btn = $("login-submit");
    btn.disabled = true;
    try {
      const password = $("login-pass").value;
      const st = mode === "setup"
        ? await req("POST", "setup", { password, repeat: $("login-pass2").value })
        : await req("POST", "login", { password });
      if (st.admin) done(st);
    } catch (ex) {
      $("login-error").textContent = ex.message;
      $("login-pass").select();
    } finally {
      btn.disabled = false;
    }
  });

  $("btn-logout").addEventListener("click", async () => {
    try { await req("POST", "logout"); } catch (_) { /* se recarga de todos modos */ }
    location.reload();
  });

  $("pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("pass-status");
    status.textContent = "";
    try {
      const st = await req("POST", "password", {
        current: $("pass-current").value,
        password: $("pass-new").value,
        repeat: $("pass-repeat").value,
      });
      csrf = st.csrf || csrf;
      $("pass-form").reset();
      status.textContent = "Contraseña cambiada.";
    } catch (ex) {
      status.textContent = ex.message;
    }
  });

  return { ensure, expired, headers };
})();
