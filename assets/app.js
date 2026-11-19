/* Armador de paquetes Amazon: interfaz.
 * Proceso: 1) Catálogo (alta, consulta, edición y baja de productos)
 *          2) Armar paquete (elegir 3+ productos del catálogo)
 *          3) Paquetes guardados (consulta, edición, duplicado y baja)
 * Los datos los guarda window.PaquetesStore (api.php en Laragon, o la base de la página publicada).
 */
(() => {
  "use strict";

  const Store = window.PaquetesStore;
  const PAGE = 10;
  const VIEWS = ["catalogo", "armar", "paquetes"];

  const S = {
    ready: false,
    products: new Map(),
    bundles: new Map(),
    config: { tag: "", marketplace: "https://www.amazon.com", minItems: 3 },
    categories: [],         // [{ id, name }]
    catEditing: null,       // id de la categoría que se está renombrando
    paste: null,            // { html, text } de lo último pegado en "Autocompletar"
    autoUndo: null,         // valores previos para "Deshacer autocompletado"
    titleFromUrl: false,    // el nombre actual es un borrador sacado del enlace
    view: "catalogo",
    cat: { q: "", category: "", usage: "", page: 1, open: new Set() },
    bun: { q: "", sort: "recent", page: 1, open: new Set(), highlight: null },
    pickQ: "",
    draft: null,          // { id|null, name, desc, items:[{pid, qty}], dirty }
    editingProductId: null,
    pendingImage: undefined, // undefined = sin cambio, "" = quitar, data:… = nueva
  };

  // ---------- Utilidades ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MIN = () => S.config.minItems || 3;
  const hasPrice = (p) => p && p.price !== null && p.price !== undefined && p.price !== "";
  const norm = (s) => String(s || "").toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (el, block = "start") => el && el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block });

  const DETAIL_FIELDS = [
    ["brand", "f-brand", "Marca"],
    ["color", "f-color", "Color"],
    ["feature", "f-feature", "Característica especial"],
    ["capacity", "f-capacity", "Capacidad"],
    ["dimensions", "f-dims", "Dimensiones del producto"],
  ];
  const aboutLines = (t) => String(t || "").split(/\n+/).map((s) => s.replace(/^[\s•·\-*]+/, "").trim()).filter(Boolean);

  function extractAsin(input) {
    const s = String(input || "").trim();
    if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
    const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/exec\/obidos\/ASIN\/|\/o\/ASIN\/|[?&]asin=)([A-Z0-9]{10})(?=[\/?&#]|$)/i);
    return m ? m[1].toUpperCase() : null;
  }
  function productUrl(asin) {
    const base = `${S.config.marketplace}/dp/${encodeURIComponent(asin)}`;
    return S.config.tag ? `${base}/?tag=${encodeURIComponent(S.config.tag)}` : base;
  }
  function cartUrl(items) {
    const p = new URLSearchParams();
    let n = 0;
    items.forEach((it) => {
      const prod = S.products.get(it.pid);
      if (!prod) return;
      n++;
      p.set(`ASIN.${n}`, prod.asin);
      p.set(`Quantity.${n}`, String(it.qty || 1));
    });
    if (S.config.tag) p.set("AssociateTag", S.config.tag);
    return `${S.config.marketplace}/gp/aws/cart/add.html?${p.toString()}`;
  }
  function initials(title) {
    return (String(title || "?").match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/g) || ["?"]).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }
  const thumbHtml = (p) => `<div class="thumb" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(initials(p.title))}</div>`;
  function bundleItems(b) { return (b.items || []).filter((i) => S.products.has(i.pid)); }
  function bundleTotals(items) {
    let total = 0, priced = 0;
    items.forEach((i) => { const p = S.products.get(i.pid); if (hasPrice(p)) { total += Number(p.price) * (i.qty || 1); priced++; } });
    return { total, priced, count: items.length };
  }
  function bundlesUsing(pid) { return [...S.bundles.values()].filter((b) => (b.items || []).some((i) => i.pid === pid)); }
  function catNames() {
    const names = new Set(S.categories.map((c) => c.name));
    S.products.forEach((p) => { if (p.category) names.add(p.category); }); // categorías antiguas aún sin registrar
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }
  const catCount = (name) => [...S.products.values()].filter((p) => p.category === name).length;
  const findCat = (name) => catNames().find((c) => norm(c) === norm(name));

  // ---------- Avisos ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function showBanner(msg) { const b = $("banner"); b.textContent = msg || ""; b.hidden = !msg; }
  function setStatus({ kind, label, message }) {
    $("chip-sync").innerHTML = `<span class="dot ${kind || ""}"></span><b>${esc(label)}</b>`;
    if (message !== undefined) showBanner(message);
  }

  // Diálogo de confirmación reutilizable. Devuelve true si se confirma.
  function confirmDialog({ title, body, ok = "Confirmar", danger = false }) {
    const dlg = $("dlg-confirm");
    $("dc-title").textContent = title;
    $("dc-body").innerHTML = body;
    const okBtn = $("dc-ok");
    okBtn.textContent = ok;
    okBtn.className = danger ? "danger-btn" : "primary";
    dlg.returnValue = "";
    dlg.showModal();
    $("dc-cancel").focus();
    return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
  }
  document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // ---------- Navegación entre pasos ----------
  function canBuild() { return S.products.size >= MIN(); }
  function route() {
    let v = location.hash.slice(1);
    if (!VIEWS.includes(v)) v = "catalogo";
    if (v === "armar" && S.ready && !canBuild()) {
      toast(`Primero agrega al menos ${MIN()} productos al catálogo`);
      v = "catalogo";
      history.replaceState(null, "", "#catalogo");
    }
    if (v === "armar" && !S.draft) S.draft = newDraft();
    S.view = v;
    VIEWS.forEach((name) => { $("view-" + name).hidden = name !== v; });
    render();
  }
  function go(view) {
    if (location.hash === "#" + view) route(); else location.hash = view;
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  }
  window.addEventListener("hashchange", route);
  $("tab-armar").addEventListener("click", (e) => {
    if (!canBuild()) { e.preventDefault(); toast(`Primero agrega al menos ${MIN()} productos al catálogo`); }
  });

  function renderStepper() {
    const n = S.products.size, min = MIN(), nb = S.bundles.size;
    const tabs = { catalogo: $("tab-catalogo"), armar: $("tab-armar"), paquetes: $("tab-paquetes") };
    Object.entries(tabs).forEach(([k, el]) => {
      el.classList.toggle("active", S.view === k);
      if (S.view === k) el.setAttribute("aria-current", "step"); else el.removeAttribute("aria-current");
    });
    tabs.catalogo.classList.toggle("done", n >= min);
    $("tab-catalogo-sub").textContent = n >= min ? `${plural(n, "producto", "productos")} ✓` : `${n} de ${min} productos mínimos`;

    const locked = !canBuild();
    tabs.armar.classList.toggle("locked", locked);
    tabs.armar.setAttribute("aria-disabled", locked ? "true" : "false");
    const d = S.draft;
    const inProgress = d && (d.items.length || d.name.trim() || d.id);
    tabs.armar.classList.toggle("in-progress", !!inProgress && S.view !== "armar");
    $("tab-armar-sub").textContent = locked ? `Requiere ${min} productos en el catálogo`
      : d && d.id ? `Editando: ${d.name || "paquete"}`
      : inProgress ? `En curso: ${d.items.length} de ${min} productos` : `Elige ${min} productos o más`;

    tabs.paquetes.classList.toggle("done", nb > 0);
    $("tab-paquetes-sub").textContent = nb ? plural(nb, "paquete", "paquetes") : "Aún no hay paquetes";

    const ro = Store.readOnly && Store.readOnly();
    $("btn-add-product").disabled = !S.ready || ro;
    $("btn-new-bundle").disabled = !S.ready || ro || locked;
    $("btn-new-bundle").title = locked ? `Necesitas al menos ${min} productos en el catálogo` : "";
    const tagChip = $("tag-chip");
    tagChip.textContent = S.config.tag ? `Tag: ${S.config.tag}` : "Sin tag de afiliado";
    $("tag-dot").className = "dot " + (S.config.tag ? "ok" : "wait");
  }

  function render() {
    renderStepper();
    if (S.view === "catalogo") renderCatalog();
    if (S.view === "armar") renderBuilder();
    if (S.view === "paquetes") renderBundles();
  }

  // ---------- Paginación ----------
  function pager(el, total, page, onPage, noun) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (total <= PAGE) { el.innerHTML = ""; return 1; }
    page = Math.min(Math.max(1, page), pages);
    const from = (page - 1) * PAGE + 1, to = Math.min(total, page * PAGE);
    let nums = "";
    for (let i = 1; i <= pages; i++) {
      if (pages > 7 && i !== 1 && i !== pages && Math.abs(i - page) > 1) {
        if (!nums.endsWith("…</span>")) nums += `<span class="muted">…</span>`;
        continue;
      }
      nums += `<button type="button" data-page="${i}" ${i === page ? 'aria-current="page"' : ""}>${i}</button>`;
    }
    el.innerHTML = `<span class="small muted">Mostrando ${from}–${to} de ${total} ${noun}</span>
      <div class="pages">
        <button type="button" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>Anterior</button>
        ${nums}
        <button type="button" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>Siguiente</button>
      </div>`;
    el.onclick = (e) => {
      const b = e.target.closest("button[data-page]"); if (!b || b.disabled) return;
      onPage(parseInt(b.dataset.page, 10));
    };
    return page;
  }

  // =====================================================================
  // 1. CATÁLOGO
  // =====================================================================
  function filteredProducts() {
    const q = norm(S.cat.q);
    return [...S.products.values()]
      .filter((p) => !S.cat.category || (S.cat.category === "__none__" ? !p.category : p.category === S.cat.category))
      .filter((p) => {
        if (!S.cat.usage) return true;
        const used = bundlesUsing(p.id).length > 0;
        return S.cat.usage === "used" ? used : !used;
      })
      .filter((p) => !q || norm([p.title, p.asin, p.brand, p.category, p.color].join(" ")).includes(q))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function renderCatalog() {
    const n = S.products.size, min = MIN();
    // Guía del paso
    const co = $("cat-callout");
    if (!S.ready) co.hidden = true;
    else if (n < min) {
      co.className = "callout todo"; co.hidden = false;
      co.innerHTML = `<div class="callout-text"><b>Paso 1 de 3: agrega al menos ${min} productos al catálogo.</b>
        <span class="small">Llevas ${n}. Con ${min} productos se habilita el paso 2, “Armar paquete”.</span></div>
        <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, (n / min) * 100)}%"></i></div>`;
    } else if (S.bundles.size === 0) {
      co.className = "callout ok"; co.hidden = false;
      co.innerHTML = `<div class="callout-text"><b>✓ Catálogo listo.</b><span class="small">Siguiente paso: arma tu primer paquete con estos productos.</span></div>
        <button type="button" class="primary" data-go="armar-new">Armar paquete →</button>`;
    } else co.hidden = true;

    // Filtros
    const sel = $("cat-filter");
    const cur = S.cat.category;
    const none = [...S.products.values()].filter((p) => !p.category).length;
    sel.innerHTML = `<option value="">Todas las categorías</option>` +
      catNames().map((c) => `<option value="${esc(c)}"${c === cur ? " selected" : ""}>${esc(c)} (${catCount(c)})</option>`).join("") +
      (none ? `<option value="__none__"${cur === "__none__" ? " selected" : ""}>Sin categoría (${none})</option>` : "");

    const list = filteredProducts();
    const ro = Store.readOnly && Store.readOnly();
    if (!S.ready) { $("cat-list").innerHTML = `<div class="empty">Cargando catálogo…</div>`; $("cat-pager").innerHTML = ""; return; }
    if (!n) {
      $("cat-list").innerHTML = `<div class="empty"><b>Tu catálogo está vacío.</b><span>Agrega el primer producto con su enlace de amazon.com.</span>
        <button type="button" class="primary" data-act="add">+ Agregar producto</button></div>`;
      $("cat-pager").innerHTML = ""; return;
    }
    if (!list.length) {
      $("cat-list").innerHTML = `<div class="empty">Ningún producto coincide con la búsqueda.<button type="button" data-act="clear-filters">Quitar filtros</button></div>`;
      $("cat-pager").innerHTML = ""; return;
    }
    S.cat.page = pager($("cat-pager"), list.length, S.cat.page, (p) => { S.cat.page = p; renderCatalog(); scrollTo($("cat-list")); }, "productos");
    const pageItems = list.slice((S.cat.page - 1) * PAGE, S.cat.page * PAGE);

    $("cat-list").innerHTML = pageItems.map((p) => {
      const used = bundlesUsing(p.id);
      const open = S.cat.open.has(p.id);
      const specs = DETAIL_FIELDS.filter(([f]) => p[f]).map(([f, , l]) => `<dt>${l}</dt><dd>${esc(p[f])}</dd>`).join("");
      const about = aboutLines(p.about);
      return `<article class="row prod${S.editingProductId === p.id ? " editing" : ""}" data-id="${esc(p.id)}">
        ${thumbHtml(p)}
        <div class="r-main">
          <span class="r-title">${esc(p.title)}</span>
          <div class="r-meta">
            <span class="mono">${esc(p.asin)}</span>
            ${p.brand ? `<span>${esc(p.brand)}</span>` : ""}
            ${p.category ? `<span>${esc(p.category)}</span>` : ""}
            ${p.example ? `<span class="badge ex">Ejemplo</span>` : ""}
          </div>
        </div>
        <div class="r-price">${hasPrice(p) ? money(p.price) : `<span class="small muted">Sin precio</span>`}</div>
        <div class="r-use">${used.length ? `<span class="badge used" title="${esc(used.map((b) => b.name).join(", "))}">En ${plural(used.length, "paquete", "paquetes")}</span>` : `<span class="badge">Sin paquete</span>`}</div>
        <div class="r-actions">
          <button type="button" class="link" data-act="details" aria-expanded="${open}">${open ? "Ocultar" : "Ver"}</button>
          <button type="button" class="link" data-act="edit" ${ro ? "disabled" : ""}>Editar</button>
          <button type="button" class="link danger" data-act="delete" ${ro ? "disabled" : ""}>Eliminar</button>
        </div>
        ${open ? `<div class="r-detail">
          <div class="detail-cols">
            <div class="stack">
              ${specs ? `<dl class="specs">${specs}</dl>` : `<span class="small muted">Sin detalles de ficha. Usa “Editar” para agregar marca, color, capacidad…</span>`}
              <div class="small"><span class="muted">Paquetes:</span> ${used.length ? used.map((b) => esc(b.name)).join(", ") : "ninguno"}</div>
              ${p.notes ? `<div class="small"><span class="muted">Notas internas:</span> ${esc(p.notes)}</div>` : ""}
              <div><a class="btn" href="${esc(productUrl(p.asin))}" target="_blank" rel="noopener">Ver en Amazon ↗</a></div>
            </div>
            <div>
              <h3>Sobre este artículo</h3>
              ${about.length ? `<ul class="about">${about.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p class="small muted">Sin descripción.</p>`}
            </div>
          </div>
        </div>` : ""}
      </article>`;
    }).join("");
  }

  $("cat-q").addEventListener("input", () => { S.cat.q = $("cat-q").value; S.cat.page = 1; renderCatalog(); });
  $("cat-filter").addEventListener("change", () => { S.cat.category = $("cat-filter").value; S.cat.page = 1; renderCatalog(); });
  $("cat-usage").addEventListener("change", () => { S.cat.usage = $("cat-usage").value; S.cat.page = 1; renderCatalog(); });
  $("btn-add-product").addEventListener("click", () => openProductDialog(null));
  $("cat-callout").addEventListener("click", (e) => { if (e.target.closest("[data-go='armar-new']")) startNewBundle(); });

  $("cat-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const act = btn.dataset.act;
    if (act === "add") return openProductDialog(null);
    if (act === "clear-filters") {
      S.cat = { ...S.cat, q: "", category: "", usage: "", page: 1 };
      $("cat-q").value = ""; $("cat-usage").value = ""; renderCatalog(); return;
    }
    const id = btn.closest(".prod")?.dataset.id;
    const p = id && S.products.get(id); if (!p) return;
    if (act === "details") { S.cat.open.has(id) ? S.cat.open.delete(id) : S.cat.open.add(id); renderCatalog(); }
    else if (act === "edit") openProductDialog(id);
    else if (act === "delete") deleteProduct(id);
  });

  async function deleteProduct(id) {
    const p = S.products.get(id); if (!p) return;
    const used = bundlesUsing(id);
    const short = used.filter((b) => bundleItems(b).length - 1 < MIN());
    let body = `<p>Se eliminará <b>${esc(p.title)}</b> del catálogo.</p>`;
    if (used.length) {
      body += `<p style="margin-top:10px">También se quitará de ${plural(used.length, "paquete", "paquetes")}:</p>
        <ul>${used.map((b) => `<li>${esc(b.name)}${short.includes(b) ? ` <span class="badge warn">quedará con ${bundleItems(b).length - 1} de ${MIN()}</span>` : ""}</li>`).join("")}</ul>`;
      if (short.length) body += `<p class="small muted" style="margin-top:10px">Los paquetes que queden con menos de ${MIN()} productos se marcarán como incompletos para que los completes.</p>`;
    } else body += `<p class="small muted" style="margin-top:8px">No está en ningún paquete.</p>`;
    if (!(await confirmDialog({ title: "¿Eliminar producto?", body, ok: "Eliminar producto", danger: true }))) return;
    try {
      await Store.deleteProduct(id);
      S.cat.open.delete(id);
      if (S.draft) S.draft.items = S.draft.items.filter((i) => i.pid !== id);
      toast("Producto eliminado");
    } catch (ex) { toast(ex.message); }
  }

  // ---------- Diálogo de producto (alta / edición) ----------
  const dlgP = $("dlg-product");
  function setThumb(src, title) {
    $("f-thumb").innerHTML = src ? `<img src="${esc(src)}" alt="">` : esc(initials(title || "?"));
    $("f-img-remove").hidden = !src;
  }
  function openProductDialog(id) {
    const p = id ? S.products.get(id) : null;
    S.editingProductId = id; S.pendingImage = undefined;
    $("product-form").reset();
    $("form-error").textContent = "";
    $("dp-title").textContent = p ? "Editar producto" : "Agregar producto al catálogo";
    $("f-submit").textContent = p ? "Guardar cambios" : "Guardar producto";
    $("f-save-another").hidden = !!p;
    if (p) {
      $("f-url").value = p.asin; $("f-title").value = p.title;
      $("f-price").value = hasPrice(p) ? p.price : ""; $("f-cat").value = p.category || "";
      $("f-notes").value = p.notes || "";
      DETAIL_FIELDS.forEach(([f, el]) => { $(el).value = p[f] || ""; });
      $("f-about").value = p.about || "";
    }
    fillCatSelect(p ? p.category : "");
    resetAutofill(!p);
    $("f-details").open = !!(p && (DETAIL_FIELDS.some(([f]) => p[f]) || p.about));
    $("f-extra").open = !!(p && (p.image || p.notes));
    setThumb(p && p.image, p && p.title);
    updateProductForm();
    dlgP.showModal();
    (p ? $("f-title") : $("f-url")).focus();
  }
  function updateProductForm() {
    const v = $("f-url").value.trim();
    const asin = extractAsin(v);
    const prev = $("asin-preview");
    prev.classList.toggle("bad", !!v && !asin);
    if (!v) prev.textContent = "Pega la URL completa del producto; el ASIN se detecta solo.";
    else if (asin) {
      const dup = [...S.products.values()].find((p) => p.asin === asin && p.id !== S.editingProductId);
      prev.innerHTML = dup ? `El ASIN <b>${esc(asin)}</b> ya está en el catálogo como “${esc(dup.title)}”.` : `ASIN detectado: <b>${esc(asin)}</b>`;
      prev.classList.toggle("bad", !!dup);
    } else if (/amzn\.(to|eu)|a\.co\//i.test(v)) prev.textContent = "Los enlaces cortos no incluyen el ASIN. Ábrelo en el navegador y copia la URL completa.";
    else prev.textContent = "No encuentro un ASIN. Busca la parte /dp/XXXXXXXXXX de la URL.";
    const open = $("f-open-amazon");
    if (asin) { open.href = productUrl(asin); open.setAttribute("aria-disabled", "false"); $("f-open-hint").textContent = `ASIN ${asin}`; }
    else { open.href = "#"; open.setAttribute("aria-disabled", "true"); $("f-open-hint").textContent = "Primero pega el enlace o ASIN arriba."; }
    const dup = asin && [...S.products.values()].some((p) => p.asin === asin && p.id !== S.editingProductId);
    const ok = !!asin && !dup && !!$("f-title").value.trim();
    $("f-submit").disabled = !ok; $("f-save-another").disabled = !ok;
    $("form-hint").textContent = ok ? "Listo para guardar." : !asin ? "Falta un enlace o ASIN válido." : dup ? "Ese producto ya existe en el catálogo." : "Falta el nombre del producto.";
  }
  $("f-url").addEventListener("input", () => {
    // Borrador del nombre a partir del enlace, solo si el nombre está vacío o también era borrador
    const draft = window.AmazonParse ? AmazonParse.titleFromUrl($("f-url").value) : "";
    const t = $("f-title");
    if (draft && (!t.value.trim() || S.titleFromUrl)) { t.value = draft; S.titleFromUrl = true; t.classList.add("autofilled"); }
    $("f-title-note").hidden = !S.titleFromUrl;
    updateProductForm();
  });
  $("f-title").addEventListener("input", () => { S.titleFromUrl = false; $("f-title-note").hidden = true; updateProductForm(); });
  // Un campo autocompletado deja de resaltarse cuando la persona lo edita
  $("product-form").addEventListener("input", (e) => { if (e.target.classList && e.target.id !== "f-url") e.target.classList.remove("autofilled"); });
  $("f-img").addEventListener("change", async () => {
    const file = $("f-img").files[0]; if (!file) return;
    try { S.pendingImage = await shrinkImage(file, 240); setThumb(S.pendingImage); }
    catch { $("form-error").textContent = "No se pudo leer la imagen. Prueba con un JPG o PNG."; }
  });
  $("f-img-remove").addEventListener("click", () => { S.pendingImage = ""; $("f-img").value = ""; setThumb("", $("f-title").value); });
  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
      img.src = url;
    });
  }
  async function submitProduct(another) {
    const err = $("form-error"); err.textContent = "";
    updateProductForm();
    if ($("f-submit").disabled) return;
    const input = {
      asin: extractAsin($("f-url").value),
      title: $("f-title").value.trim(),
      price: $("f-price").value.trim(),
      category: selectedCat(),
      notes: $("f-notes").value.trim(),
      about: $("f-about").value.trim(),
    };
    DETAIL_FIELDS.forEach(([f, el]) => { input[f] = $(el).value.trim(); });
    if (S.pendingImage !== undefined) input.image = S.pendingImage;
    const editing = S.editingProductId;
    [$("f-submit"), $("f-save-another")].forEach((b) => { b.disabled = true; });
    try {
      await Store.saveProduct(input, editing);
      const n = S.products.size;
      if (another) {
        toast(`Producto guardado (${plural(n, "producto", "productos")} en el catálogo)`);
        openProductDialog(null);
      } else {
        dlgP.close();
        toast(editing ? "Producto actualizado" : n >= MIN() && n - 1 < MIN() ? "Catálogo listo: ya puedes armar paquetes" : `Producto agregado (${n} de ${MIN()})`);
      }
    } catch (ex) { err.textContent = ex.message; updateProductForm(); }
  }

  // ---------- Categoría en el formulario ----------
  function fillCatSelect(selected) {
    const sel = $("f-cat");
    const names = catNames();
    if (selected && !names.includes(selected)) names.push(selected);
    sel.innerHTML = `<option value="">Sin categoría</option>` +
      names.map((c) => `<option value="${esc(c)}"${c === selected ? " selected" : ""}>${esc(c)}</option>`).join("") +
      `<option value="__new__">+ Nueva categoría…</option>`;
    sel.value = selected || "";
    sel.dataset.prev = sel.value;
    $("f-cat-new").hidden = true;
  }
  const selectedCat = () => { const v = $("f-cat").value; return v === "__new__" ? "" : v; };
  function selectCat(name) {
    const sel = $("f-cat");
    if (![...sel.options].some((o) => o.value === name)) {
      const opt = document.createElement("option"); opt.value = name; opt.textContent = name;
      sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
    }
    sel.value = name; sel.dataset.prev = name; sel.classList.add("autofilled");
    $("f-cat-new").hidden = true;
  }
  $("f-cat").addEventListener("change", () => {
    const sel = $("f-cat");
    if (sel.value === "__new__") { $("f-cat-new").hidden = false; $("f-cat-name").value = ""; $("f-cat-name").focus(); }
    else { sel.dataset.prev = sel.value; $("f-cat-new").hidden = true; }
  });
  $("f-cat-cancel").addEventListener("click", () => { const sel = $("f-cat"); sel.value = sel.dataset.prev || ""; $("f-cat-new").hidden = true; });
  async function addCategoryInline(name) {
    name = String(name || "").trim();
    if (!name) { $("f-cat-name").focus(); return; }
    const existing = findCat(name);
    if (existing) { selectCat(existing); return; }
    try { await Store.saveCategory(name, null); selectCat(name); toast(`Categoría “${name}” creada`); }
    catch (ex) { $("form-error").textContent = ex.message; }
  }
  $("f-cat-add").addEventListener("click", () => addCategoryInline($("f-cat-name").value));
  $("f-cat-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCategoryInline($("f-cat-name").value); } });

  function showCatSuggestion(crumbs) {
    const box = $("f-cat-suggest");
    if (!crumbs || !crumbs.length) { box.hidden = true; return; }
    const last = crumbs[crumbs.length - 1];
    // Si alguna categoría existente coincide con la ruta de Amazon (la más específica primero), se elige sola
    const match = [...crumbs].reverse().map(findCat).find(Boolean);
    if (match && !selectedCat()) selectCat(match);
    const current = selectedCat();
    const opts = [...new Set([last, crumbs[0]])].filter((c) => norm(c) !== norm(current));
    box.innerHTML = `<span class="path">Amazon: ${crumbs.map(esc).join(" › ")}</span>` +
      opts.map((c) => `<button type="button" class="link" data-cat="${esc(c)}">Usar “${esc(c)}”${findCat(c) ? "" : " (nueva)"}</button>`).join("");
    box.hidden = false;
  }
  $("f-cat-suggest").addEventListener("click", (e) => { const b = e.target.closest("button[data-cat]"); if (b) addCategoryInline(b.dataset.cat); });

  // ---------- Autocompletar con la página pegada ----------
  const AUTO_FIELDS = [
    ["title", "f-title", "Nombre"], ["price", "f-price", "Precio"], ["brand", "f-brand", "Marca"],
    ["color", "f-color", "Color"], ["feature", "f-feature", "Característica especial"], ["capacity", "f-capacity", "Capacidad"],
    ["dimensions", "f-dims", "Dimensiones"], ["about", "f-about", "Sobre este artículo"],
  ];
  function resetAutofill(openIt) {
    S.paste = null; S.autoUndo = null; S.titleFromUrl = false;
    $("f-paste").value = ""; $("f-extract").disabled = true; $("f-undo").hidden = true;
    $("f-auto-result").hidden = true; $("f-cat-suggest").hidden = true; $("f-title-note").hidden = true;
    $("f-auto").open = !!openIt;
    document.querySelectorAll("#product-form .autofilled").forEach((el) => el.classList.remove("autofilled"));
  }
  $("f-paste").addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    const html = cd ? cd.getData("text/html") : "";
    const text = cd ? cd.getData("text/plain") : "";
    if (!html && !text) return; // deja que el navegador pegue y luego se usa "Extraer datos"
    e.preventDefault();
    S.paste = { html, text };
    $("f-paste").value = text.length > 4000 ? text.slice(0, 4000) + "\n…" : text;
    $("f-extract").disabled = false;
    runExtraction();
  });
  $("f-paste").addEventListener("input", () => { S.paste = null; $("f-extract").disabled = !$("f-paste").value.trim(); });
  $("f-extract").addEventListener("click", runExtraction);

  function runExtraction() {
    if (!window.AmazonParse) return;
    const src = S.paste || { text: $("f-paste").value };
    const r = AmazonParse.parse(src);
    const box = $("f-auto-result");
    box.hidden = false;
    if (!r.found.length) {
      box.className = "autofill-result bad";
      box.innerHTML = `No reconocí datos de un producto de Amazon en lo pegado. Abre la ficha del producto, presiona <kbd>Ctrl</kbd>+<kbd>A</kbd> y <kbd>Ctrl</kbd>+<kbd>C</kbd>, y vuelve a pegar.`;
      return;
    }
    // Guardar valores previos para poder deshacer
    S.autoUndo = { url: $("f-url").value, cat: $("f-cat").value };
    AUTO_FIELDS.forEach(([, id]) => { S.autoUndo[id] = $(id).value; });

    const warnings = [];
    const urlAsin = extractAsin($("f-url").value);
    if (r.asin) {
      if (!urlAsin) $("f-url").value = r.asin;
      else if (urlAsin !== r.asin) warnings.push(`La página pegada es del ASIN ${r.asin}, pero el enlace es del ${urlAsin}. Revisa que sea el mismo producto.`);
    }
    const filled = [];
    AUTO_FIELDS.forEach(([f, id, label]) => {
      if (r[f] === undefined || r[f] === "") return;
      $(id).value = r[f];
      $(id).classList.add("autofilled");
      filled.push(label);
    });
    if (r.title) { S.titleFromUrl = false; $("f-title-note").hidden = true; }
    if (["brand", "color", "feature", "capacity", "dimensions", "about"].some((f) => r[f])) $("f-details").open = true;
    if (r.breadcrumb) { showCatSuggestion(r.breadcrumb); filled.push("Categoría (sugerida)"); }
    const missing = AUTO_FIELDS.filter(([f]) => r[f] === undefined).map(([, , l]) => l);

    box.className = "autofill-result ok";
    box.innerHTML = `<span>✓ Se llenaron ${filled.length} campos: ${filled.map(esc).join(", ")}. Están resaltados; revísalos antes de guardar.</span>` +
      (missing.length ? `<span class="small muted">No encontré: ${missing.map(esc).join(", ")}. Puedes escribirlos a mano.</span>` : "") +
      warnings.map((w) => `<span class="warn small">⚠ ${esc(w)}</span>`).join("");
    $("f-undo").hidden = false;
    updateProductForm();
  }
  $("f-undo").addEventListener("click", () => {
    const u = S.autoUndo; if (!u) return;
    $("f-url").value = u.url;
    AUTO_FIELDS.forEach(([, id]) => { $(id).value = u[id]; $(id).classList.remove("autofilled"); });
    $("f-cat").value = [...$("f-cat").options].some((o) => o.value === u.cat) ? u.cat : "";
    $("f-cat").classList.remove("autofilled");
    S.autoUndo = null; $("f-undo").hidden = true; $("f-auto-result").hidden = true; $("f-cat-suggest").hidden = true;
    updateProductForm();
    toast("Autocompletado deshecho");
  });

  // ---------- Administrar categorías ----------
  function renderCatManage() {
    const list = catNames();
    const byName = new Map(S.categories.map((c) => [c.name, c]));
    $("cat-manage").innerHTML = list.length ? list.map((name) => {
      const c = byName.get(name);
      const key = c ? c.id : "legacy:" + name;
      const n = catCount(name);
      if (S.catEditing === key) {
        return `<div class="cat-row editing" data-key="${esc(key)}" data-name="${esc(name)}">
          <input id="cat-rename" value="${esc(name)}" maxlength="100" aria-label="Nuevo nombre para ${esc(name)}">
          <div class="c-actions"><button type="button" class="primary" data-act="save">Guardar</button><button type="button" class="link" data-act="cancel">Cancelar</button></div>
        </div>`;
      }
      return `<div class="cat-row" data-key="${esc(key)}" data-name="${esc(name)}">
        <span class="c-name">${esc(name)}</span>
        <span class="badge${n ? " used" : ""}">${plural(n, "producto", "productos")}</span>
        <div class="c-actions">
          <button type="button" class="link" data-act="rename">Renombrar</button>
          <button type="button" class="link danger" data-act="delete">Eliminar</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty small">Aún no hay categorías.</div>`;
    if (S.catEditing) { const i = $("cat-rename"); if (i) { i.focus(); i.select(); } }
  }
  $("btn-cats").addEventListener("click", () => { S.catEditing = null; $("cat-error").textContent = ""; renderCatManage(); $("dlg-cats").showModal(); $("cat-new-name").focus(); });
  $("cat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("cat-new-name").value.trim();
    $("cat-error").textContent = "";
    if (!name) return;
    if (findCat(name)) { $("cat-error").textContent = `La categoría “${findCat(name)}” ya existe.`; return; }
    try { await Store.saveCategory(name, null); $("cat-new-name").value = ""; toast(`Categoría “${name}” creada`); renderCatManage(); }
    catch (ex) { $("cat-error").textContent = ex.message; }
  });
  async function saveRename(row) {
    const old = row.dataset.name, key = row.dataset.key;
    const name = $("cat-rename").value.trim();
    $("cat-error").textContent = "";
    if (!name || name === old) { S.catEditing = null; renderCatManage(); return; }
    const clash = findCat(name);
    if (clash && norm(clash) !== norm(old)) { $("cat-error").textContent = `Ya existe la categoría “${clash}”.`; return; }
    try {
      await Store.saveCategory(name, key.startsWith("legacy:") ? null : key, old);
      if (S.cat.category === old) S.cat.category = name;
      S.catEditing = null; toast(`Categoría renombrada a “${name}” (${plural(catCount(old) + catCount(name), "producto", "productos")})`);
      renderCatManage(); render();
    } catch (ex) { $("cat-error").textContent = ex.message; }
  }
  $("cat-manage").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const row = b.closest(".cat-row"); const { key, name } = row.dataset;
    const act = b.dataset.act;
    if (act === "rename") { S.catEditing = key; renderCatManage(); }
    else if (act === "cancel") { S.catEditing = null; renderCatManage(); }
    else if (act === "save") saveRename(row);
    else if (act === "delete") {
      const n = catCount(name);
      $("dlg-cats").close();
      const ok = await confirmDialog({
        title: "¿Eliminar categoría?",
        body: `<p>Se eliminará la categoría <b>${esc(name)}</b>.</p>` + (n ? `<p class="small muted" style="margin-top:8px">${plural(n, "producto quedará", "productos quedarán")} “Sin categoría”. Los productos no se borran.</p>` : ""),
        ok: "Eliminar categoría", danger: true,
      });
      if (ok) {
        try {
          await Store.deleteCategory(key.startsWith("legacy:") ? null : key, name);
          if (S.cat.category === name) S.cat.category = "";
          toast("Categoría eliminada");
        } catch (ex) { toast(ex.message); }
      }
      renderCatManage(); $("dlg-cats").showModal();
    }
  });
  $("cat-manage").addEventListener("keydown", (e) => {
    if (e.target.id !== "cat-rename") return;
    if (e.key === "Enter") { e.preventDefault(); saveRename(e.target.closest(".cat-row")); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); S.catEditing = null; renderCatManage(); }
  });

  $("product-form").addEventListener("submit", (e) => { e.preventDefault(); submitProduct(false); });
  $("f-save-another").addEventListener("click", () => submitProduct(true));
  dlgP.addEventListener("close", () => { S.editingProductId = null; S.pendingImage = undefined; if (S.view === "catalogo") renderCatalog(); });

  // =====================================================================
  // 2. ARMAR PAQUETE
  // =====================================================================
  function newDraft() { return { id: null, name: "", desc: "", items: [], dirty: false }; }
  async function startNewBundle() {
    if (!canBuild()) { toast(`Primero agrega al menos ${MIN()} productos al catálogo`); return; }
    const d = S.draft;
    if (d && !d.id && (d.items.length || d.name.trim())) { go("armar"); toast("Tienes un paquete en curso: termínalo o cancélalo"); return; }
    if (d && d.id && d.dirty) {
      const ok = await confirmDialog({ title: "¿Dejar la edición?", body: `<p>Los cambios a <b>${esc(d.name || "este paquete")}</b> no se guardarán.</p>`, ok: "Dejar y crear nuevo", danger: true });
      if (!ok) return;
    }
    S.draft = newDraft(); S.pickQ = ""; $("pick-q").value = "";
    loadDraftFields(); go("armar"); setTimeout(() => $("pick-q").focus({ preventScroll: true }), 50);
  }
  function editBundle(id, duplicate = false) {
    const b = S.bundles.get(id); if (!b) return;
    S.draft = {
      id: duplicate ? null : id,
      name: duplicate ? `${b.name} (copia)` : b.name || "",
      desc: b.desc || "",
      items: bundleItems(b).map((i) => ({ pid: i.pid, qty: i.qty || 1 })),
      dirty: duplicate,
    };
    S.pickQ = ""; $("pick-q").value = "";
    loadDraftFields(); go("armar");
  }
  function loadDraftFields() { $("bd-name").value = S.draft.name; $("bd-desc").value = S.draft.desc; $("bd-error").textContent = ""; }

  function renderBuilder() {
    const d = S.draft; if (!d) return;
    const min = MIN();
    d.items = d.items.filter((i) => S.products.has(i.pid));
    const editing = !!d.id;
    $("view-armar").classList.toggle("editing", editing);
    $("bd-mode").textContent = editing ? "Editando paquete guardado" : "Paquete nuevo";
    $("bd-mode").classList.toggle("editing", editing);
    $("bd-title").textContent = editing ? (d.name.trim() || "Paquete sin nombre") : "Arma un paquete";
    $("bd-cancel").textContent = editing ? "Cancelar edición" : "Cancelar";

    // Selector de productos
    const q = norm(S.pickQ);
    const chosen = new Set(d.items.map((i) => i.pid));
    const all = [...S.products.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const list = all.filter((p) => !q || norm([p.title, p.asin, p.brand, p.category].join(" ")).includes(q));
    $("pick-count").textContent = `${chosen.size} elegidos de ${all.length}`;
    $("pick-list").innerHTML = list.length ? list.map((p) => {
      const on = chosen.has(p.id);
      const others = bundlesUsing(p.id).filter((b) => b.id !== d.id).length;
      return `<label class="pick${on ? " on" : ""}" for="pk-${esc(p.id)}">
        <input type="checkbox" id="pk-${esc(p.id)}" data-pid="${esc(p.id)}" ${on ? "checked" : ""}>
        ${thumbHtml(p)}
        <span><span class="p-title">${esc(p.title)}</span><br><span class="p-meta"><span class="mono">${esc(p.asin)}</span>${p.brand ? " · " + esc(p.brand) : ""}${others ? ` · en ${plural(others, "otro paquete", "otros paquetes")}` : ""}</span></span>
        <span class="p-price">${hasPrice(p) ? money(p.price) : "—"}</span>
      </label>`;
    }).join("") : `<div class="empty">Ningún producto coincide.</div>`;

    // Productos elegidos
    $("bd-items").innerHTML = d.items.length ? d.items.map((it) => {
      const p = S.products.get(it.pid);
      return `<div class="bd-item" data-pid="${esc(it.pid)}">
        <span class="t">${esc(p.title)}</span>
        <input type="number" min="1" max="99" value="${it.qty}" id="qty-${esc(it.pid)}" aria-label="Cantidad de ${esc(p.title)}" data-act="qty">
        <button type="button" class="link danger" data-act="remove" aria-label="Quitar ${esc(p.title)}">Quitar</button>
      </div>`;
    }).join("") : `<div class="empty small">Marca productos en la lista de la izquierda.</div>`;

    const t = bundleTotals(d.items);
    $("bd-total").textContent = money(t.total);
    $("bd-priced").textContent = !t.count ? "Sin productos" : t.priced === t.count ? "Total de referencia" : `Total de referencia (${t.priced} de ${t.count} con precio)`;

    const enough = d.items.length >= min, named = !!d.name.trim();
    $("bd-check").innerHTML = `
      <li class="${enough ? "ok" : ""}">Al menos ${min} productos <span class="muted">(llevas ${d.items.length})</span></li>
      <li class="${named ? "ok" : ""}">Nombre del paquete</li>`;
    const ro = Store.readOnly && Store.readOnly();
    $("bd-save").disabled = !(enough && named) || ro;
    $("bd-save").textContent = editing ? "Guardar cambios" : "Guardar paquete";
  }

  $("pick-q").addEventListener("input", () => { S.pickQ = $("pick-q").value; renderBuilder(); });
  $("pick-list").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-pid]"); if (!cb || !S.draft) return;
    const pid = cb.dataset.pid;
    const d = S.draft;
    if (cb.checked) { if (!d.items.some((i) => i.pid === pid)) d.items.push({ pid, qty: 1 }); }
    else d.items = d.items.filter((i) => i.pid !== pid);
    d.dirty = true;
    const left = MIN() - d.items.length;
    if (cb.checked) toast(left > 0 ? `Agregado · faltan ${left}` : !d.name.trim() ? "Listo: ahora escribe el nombre del paquete" : "Listo para guardar");
    render();
  });
  $("bd-items").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act='remove']"); if (!b || !S.draft) return;
    const pid = b.closest(".bd-item").dataset.pid;
    S.draft.items = S.draft.items.filter((i) => i.pid !== pid); S.draft.dirty = true; render();
  });
  $("bd-items").addEventListener("change", (e) => {
    if (e.target.dataset.act !== "qty" || !S.draft) return;
    const pid = e.target.closest(".bd-item").dataset.pid;
    const it = S.draft.items.find((i) => i.pid === pid);
    if (it) { it.qty = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); S.draft.dirty = true; renderBuilder(); }
  });
  $("bd-name").addEventListener("input", () => { if (!S.draft) return; S.draft.name = $("bd-name").value; S.draft.dirty = true; renderBuilder(); renderStepper(); });
  $("bd-desc").addEventListener("input", () => { if (!S.draft) return; S.draft.desc = $("bd-desc").value; S.draft.dirty = true; });

  $("bd-cancel").addEventListener("click", async () => {
    const d = S.draft;
    if (d && d.dirty && (d.items.length || d.name.trim())) {
      const ok = await confirmDialog({
        title: d.id ? "¿Cancelar la edición?" : "¿Descartar este paquete?",
        body: d.id ? `<p>Los cambios a <b>${esc(d.name || "este paquete")}</b> no se guardarán. El paquete guardado no cambia.</p>` : `<p>Se perderán los productos elegidos y el nombre. Los productos siguen en el catálogo.</p>`,
        ok: d.id ? "Cancelar edición" : "Descartar", danger: !d.id,
      });
      if (!ok) return;
    }
    S.draft = null;
    go(S.bundles.size ? "paquetes" : "catalogo");
  });

  $("bd-save").addEventListener("click", async () => {
    const d = S.draft; if (!d) return;
    const err = $("bd-error"); err.textContent = "";
    const input = { name: d.name.trim(), desc: d.desc.trim(), items: d.items.map((i) => ({ pid: i.pid, qty: i.qty })) };
    const wasEditing = !!d.id;
    $("bd-save").disabled = true;
    try {
      const id = await Store.saveBundle(input, d.id);
      S.draft = null;
      S.bun.highlight = id; S.bun.open.add(id);
      S.bun.q = ""; $("bun-q").value = ""; S.bun.sort = "recent"; $("bun-sort").value = "recent"; S.bun.page = 1;
      showSavedCallout(input.name, wasEditing);
      toast(wasEditing ? "Paquete actualizado" : "Paquete guardado");
      go("paquetes");
    } catch (ex) { err.textContent = ex.message; renderBuilder(); }
  });

  // =====================================================================
  // 3. PAQUETES GUARDADOS
  // =====================================================================
  function showSavedCallout(name, wasEditing) {
    const co = $("bun-callout");
    co.innerHTML = `<div class="callout-text"><b>✓ “${esc(name)}” ${wasEditing ? "se actualizó" : "se guardó"}.</b>
      <span class="small">Aparece resaltado abajo. Para crear otro, pulsa “Armar otro paquete”.</span></div>
      <div class="actions"><button type="button" class="primary" data-act="new">Armar otro paquete</button><button type="button" class="link" data-act="dismiss">Cerrar aviso</button></div>`;
    co.hidden = false;
  }
  $("bun-callout").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    if (b.dataset.act === "new") startNewBundle();
    $("bun-callout").hidden = true; S.bun.highlight = null; renderBundles();
  });

  function filteredBundles() {
    const q = norm(S.bun.q);
    const list = [...S.bundles.values()].filter((b) => {
      if (!q) return true;
      const names = bundleItems(b).map((i) => S.products.get(i.pid)).map((p) => [p.title, p.asin, p.brand].join(" "));
      return norm([b.name, b.desc, ...names].join(" ")).includes(q);
    });
    const tot = (b) => bundleTotals(bundleItems(b)).total;
    const sorters = {
      recent: (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
      name: (a, b) => String(a.name).localeCompare(String(b.name), "es"),
      total: (a, b) => tot(b) - tot(a),
      items: (a, b) => bundleItems(b).length - bundleItems(a).length,
    };
    return list.sort(sorters[S.bun.sort] || sorters.recent);
  }

  function renderBundles() {
    if (!S.ready) { $("bun-list").innerHTML = `<div class="empty">Cargando paquetes…</div>`; return; }
    const all = filteredBundles();
    const ro = Store.readOnly && Store.readOnly();
    if (!S.bundles.size) {
      $("bun-list").innerHTML = `<div class="empty"><b>Aún no hay paquetes guardados.</b>
        <span>${canBuild() ? "Ya tienes productos suficientes en el catálogo." : `Primero agrega al menos ${MIN()} productos al catálogo.`}</span>
        ${canBuild() ? `<button type="button" class="primary" data-act="new">+ Armar el primer paquete</button>` : `<a class="btn primary" href="#catalogo">Ir al catálogo</a>`}</div>`;
      $("bun-pager").innerHTML = ""; return;
    }
    if (!all.length) {
      $("bun-list").innerHTML = `<div class="empty">Ningún paquete coincide con “${esc(S.bun.q)}”.<button type="button" data-act="clear">Quitar búsqueda</button></div>`;
      $("bun-pager").innerHTML = ""; return;
    }
    // Si hay un paquete resaltado, ir a su página
    if (S.bun.highlight) {
      const idx = all.findIndex((b) => b.id === S.bun.highlight);
      if (idx >= 0) S.bun.page = Math.floor(idx / PAGE) + 1;
    }
    S.bun.page = pager($("bun-pager"), all.length, S.bun.page, (p) => { S.bun.page = p; S.bun.highlight = null; renderBundles(); scrollTo($("bun-list")); }, "paquetes");
    const pageItems = all.slice((S.bun.page - 1) * PAGE, S.bun.page * PAGE);
    const min = MIN();

    $("bun-list").innerHTML = pageItems.map((b) => {
      const items = bundleItems(b);
      const t = bundleTotals(items);
      const open = S.bun.open.has(b.id);
      const incomplete = items.length < min;
      const editing = S.draft && S.draft.id === b.id;
      return `<article class="row bun${S.bun.highlight === b.id ? " highlight" : ""}${editing ? " editing" : ""}" data-id="${esc(b.id)}">
        <button type="button" class="chev" data-act="toggle" aria-expanded="${open}" aria-label="${open ? "Ocultar" : "Ver"} productos de ${esc(b.name)}">▶</button>
        <div class="r-main" data-act="toggle">
          <span class="r-title">${esc(b.name)}
            ${S.bun.highlight === b.id ? `<span class="badge new">Recién guardado</span>` : ""}
            ${editing ? `<span class="badge warn">En edición</span>` : ""}
            ${incomplete ? `<span class="badge warn">Incompleto: ${items.length} de ${min}</span>` : ""}
            ${b.example ? `<span class="badge ex">Ejemplo</span>` : ""}
          </span>
          <div class="r-meta"><span>${plural(items.length, "producto", "productos")}</span><span>Actualizado ${esc(fmtDate(b.updatedAt || b.createdAt))}</span></div>
        </div>
        <div class="r-price">${t.priced ? money(t.total) : `<span class="small muted">Sin precios</span>`}</div>
        <div class="r-actions">
          <button type="button" class="link" data-act="edit" ${ro ? "disabled" : ""}>Editar</button>
          <button type="button" class="link danger" data-act="delete" ${ro ? "disabled" : ""}>Eliminar</button>
        </div>
        ${open ? `<div class="r-detail">
          ${b.desc ? `<p class="muted">${esc(b.desc)}</p>` : ""}
          <ol class="bun-items">${items.map((i) => { const p = S.products.get(i.pid); return `<li><div class="li-row"><a href="${esc(productUrl(p.asin))}" target="_blank" rel="noopener">${esc(p.title)}</a><span class="small muted">${i.qty > 1 ? `× ${i.qty} · ` : ""}${hasPrice(p) ? money(p.price * (i.qty || 1)) : "sin precio"}</span></div></li>`; }).join("")}</ol>
          ${incomplete ? `<p class="small" style="color:var(--warn)">Le faltan ${min - items.length} producto(s): pulsa “Editar” para completarlo.</p>` : ""}
          <div class="actions">
            <a class="btn primary" href="${esc(cartUrl(items))}" target="_blank" rel="noopener">Agregar todo al carrito ↗</a>
            <button type="button" data-act="copy">Copiar enlaces</button>
            <button type="button" data-act="duplicate" ${ro || !canBuild() ? "disabled" : ""}>Duplicar</button>
          </div>
        </div>` : ""}
      </article>`;
    }).join("");
  }

  $("bun-q").addEventListener("input", () => { S.bun.q = $("bun-q").value; S.bun.page = 1; S.bun.highlight = null; renderBundles(); });
  $("bun-sort").addEventListener("change", () => { S.bun.sort = $("bun-sort").value; S.bun.page = 1; S.bun.highlight = null; renderBundles(); });
  $("btn-new-bundle").addEventListener("click", startNewBundle);

  $("bun-list").addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act;
    if (act === "new") return startNewBundle();
    if (act === "clear") { S.bun.q = ""; $("bun-q").value = ""; renderBundles(); return; }
    const id = el.closest(".bun")?.dataset.id;
    const b = id && S.bundles.get(id); if (!b) return;
    if (act === "toggle") { S.bun.open.has(id) ? S.bun.open.delete(id) : S.bun.open.add(id); renderBundles(); }
    else if (act === "edit") {
      const d = S.draft;
      if (d && d.dirty && d.id !== id && (d.items.length || d.name.trim())) {
        const ok = await confirmDialog({ title: "Tienes otro paquete en curso", body: `<p>Si editas <b>${esc(b.name)}</b>, se descartará lo que llevas en “Armar paquete”.</p>`, ok: "Descartar y editar", danger: true });
        if (!ok) return;
      }
      editBundle(id);
    } else if (act === "duplicate") editBundle(id, true);
    else if (act === "copy") {
      const items = bundleItems(b);
      const lines = [b.name, ...(b.desc ? [b.desc] : []), "",
        ...items.map((i, n) => { const p = S.products.get(i.pid); return `${n + 1}. ${p.title}${i.qty > 1 ? " ×" + i.qty : ""}\n   ${productUrl(p.asin)}`; }),
        "", "Agregar todo al carrito:", cartUrl(items)];
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Enlaces copiados"); }
      catch { toast("El navegador bloqueó el portapapeles"); }
    } else if (act === "delete") {
      const ok = await confirmDialog({
        title: "¿Eliminar paquete?",
        body: `<p>Se eliminará <b>${esc(b.name)}</b>.</p><p class="small muted" style="margin-top:8px">Sus ${plural(bundleItems(b).length, "producto sigue", "productos siguen")} en el catálogo.</p>`,
        ok: "Eliminar paquete", danger: true,
      });
      if (!ok) return;
      try {
        await Store.deleteBundle(id);
        S.bun.open.delete(id);
        if (S.bun.highlight === id) { S.bun.highlight = null; $("bun-callout").hidden = true; }
        if (S.draft && S.draft.id === id) S.draft = null;
        toast("Paquete eliminado");
      } catch (ex) { toast(ex.message); }
    }
  });

  // =====================================================================
  // Ajustes: tag de afiliado y JSON
  // =====================================================================
  $("btn-settings").addEventListener("click", () => {
    $("tag-input").value = S.config.tag; $("tag-status").textContent = ""; $("json-error").textContent = "";
    $("dlg-settings").showModal();
  });
  $("tag-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tag = $("tag-input").value.trim();
    if (tag && !/^[A-Za-z0-9_-]{2,64}$/.test(tag)) { $("tag-status").textContent = "El tag solo lleva letras, números y guiones (ej. tutienda-20)."; return; }
    try { await Store.saveConfig(tag); $("tag-status").textContent = tag ? `Guardado. Los enlaces llevan ?tag=${tag}` : "Tag eliminado."; toast(tag ? "Tag guardado" : "Tag eliminado"); }
    catch (ex) { $("tag-status").textContent = ex.message; }
  });
  $("json-export").addEventListener("click", () => {
    const out = [...S.products.values()].map((p) => ({
      asin: p.asin, title: p.title, price: hasPrice(p) ? p.price : null, category: p.category || "",
      brand: p.brand || "", color: p.color || "", feature: p.feature || "", capacity: p.capacity || "",
      dimensions: p.dimensions || "", about: p.about || "", url: productUrl(p.asin),
    }));
    $("json-io").value = JSON.stringify(out, null, 2); $("json-error").textContent = "";
  });
  $("json-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("json-io").value); toast("JSON copiado"); } catch { toast("El navegador bloqueó el portapapeles"); }
  });
  $("json-import").addEventListener("click", async () => {
    const err = $("json-error"); err.textContent = "";
    let arr;
    try { arr = JSON.parse($("json-io").value); } catch { err.textContent = "El texto no es JSON válido."; return; }
    if (arr && !Array.isArray(arr)) arr = arr.items || arr.products;
    if (!Array.isArray(arr) || !arr.length) { err.textContent = 'Se esperaba una lista de productos: [{"asin": …, "title": …}].'; return; }
    try {
      const r = await Store.importProducts(arr);
      toast(`${r.added} importado(s)${r.skipped ? `, ${r.skipped} omitido(s) por duplicado o datos incompletos` : ""}`);
    } catch (ex) { err.textContent = ex.message; }
  });

  // =====================================================================
  // Arranque
  // =====================================================================
  function onData(data) {
    S.products = new Map((data.products || []).map((p) => [p.id, p]));
    S.bundles = new Map((data.bundles || []).map((b) => [b.id, b]));
    S.config = { ...S.config, ...(data.config || {}) };
    S.categories = data.categories || [];
    if ($("dlg-cats").open && !S.catEditing) renderCatManage();
    const first = !S.ready;
    S.ready = true;
    if (first) route(); else render();
  }
  render();
  Store.init(onData, setStatus);
  route();
})();
