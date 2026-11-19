/* Lector de la ficha de Amazon que la persona copia y pega (Ctrl+A, Ctrl+C en la página del producto).
 * No descarga nada de Amazon: solo interpreta el contenido pegado.
 * Usa el HTML del portapapeles cuando existe (más preciso) y el texto plano como respaldo.
 * Reconoce etiquetas en español y en inglés.
 *
 *   AmazonParse.parse({ html, text }) → { asin, title, price, brand, color, feature, capacity,
 *                                         dimensions, about, breadcrumb: [], found: [] }
 *   AmazonParse.titleFromUrl(url)     → borrador de nombre tomado del enlace
 */
window.AmazonParse = (() => {
  "use strict";

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‎‏ ]/g, " ").replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim();
  const clean = (s) => String(s || "").replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();

  // Etiqueta normalizada → campo
  const LABELS = [
    ["brand", /^(marca|brand|nombre de la marca|brand name)$/],
    ["color", /^(color|colour|nombre del color|color name)$/],
    ["feature", /^(caracteristicas? especial(es)?|special features?)$/],
    ["capacity", /^(capacidad|capacity|capacidad de volumen|volume capacity)$/],
    ["dimensions", /^(dimensiones del (producto|articulo)|product dimensions|item dimensions)( .*)?$/],
    ["asin", /^asin$/],
  ];
  function fieldFor(label) {
    const n = norm(label);
    if (!n || n.length > 60) return null;
    for (const [f, re] of LABELS) if (re.test(n)) return f;
    return null;
  }
  function setField(r, label, value, keepFirst = true) {
    const f = fieldFor(label);
    const v = clean(value);
    if (!f || !v || v.length > 300) return false;
    if (keepFirst && r[f]) return false;
    r[f] = f === "asin" ? v.toUpperCase().slice(0, 10) : v;
    return true;
  }

  function parsePrice(s) {
    const t = String(s || "").replace(/ /g, " ");
    const m = t.match(/(?:US\s?\$|USD\s?|\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, "") + "." + (m[2] || "00"));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  function brandFromByline(s) {
    const t = clean(s);
    let m = t.match(/^visita la tienda de (.+)$/i) || t.match(/^visit the (.+?) store$/i) || t.match(/^(?:marca|brand)\s*:\s*(.+)$/i);
    return m ? clean(m[1]) : "";
  }
  const dedupe = (arr) => [...new Set(arr.map(clean).filter(Boolean))];
  const isJunkBullet = (t) => /^(aseg[uú]rate de que|make sure this fits|›|ver m[aá]s|see more)/i.test(t) || t.length < 12;

  // ---------- HTML (preferido) ----------
  function fromHtml(html) {
    const r = {};
    let doc;
    try { doc = new DOMParser().parseFromString(html, "text/html"); } catch (_) { return r; }
    const q = (sel) => doc.querySelector(sel);
    const txt = (el) => (el ? clean(el.textContent) : "");

    r.title = txt(q("#productTitle")) || txt(q("#title"));
    r.brand = brandFromByline(txt(q("#bylineInfo")));

    const priceSel = [
      "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen",
      "#apex_desktop .a-price:not(.a-text-price) .a-offscreen",
      "#priceblock_dealprice", "#priceblock_ourprice", "#price_inside_buybox", "#newBuyBoxPrice",
      "#corePrice_feature_div .a-price .a-offscreen",
    ];
    for (const sel of priceSel) {
      const v = parsePrice(txt(q(sel)));
      if (v != null) { r.price = v; break; }
    }

    // Tabla de resumen (Marca, Color, Característica especial, Capacidad, Dimensiones…)
    doc.querySelectorAll("#productOverview_feature_div tr, #poExpander tr").forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length >= 2) setField(r, txt(tds[0]), txt(tds[tds.length - 1]));
    });
    // Tablas de detalles técnicos y viñetas de detalles
    doc.querySelectorAll("#prodDetails tr, [id^='productDetails_'] tr, #technicalSpecifications_feature_div tr").forEach((tr) => {
      const th = tr.querySelector("th"), td = tr.querySelector("td");
      if (th && td) setField(r, txt(th), txt(td));
    });
    doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li").forEach((li) => {
      const spans = li.querySelectorAll(".a-list-item > span");
      if (spans.length >= 2) setField(r, txt(spans[0]), txt(spans[1]));
    });

    // "Acerca de este artículo"
    const bullets = [...doc.querySelectorAll("#feature-bullets li:not(#replacementPartsFitmentBullet) .a-list-item, #featurebullets_feature_div li .a-list-item")]
      .map(txt).filter((t) => !isJunkBullet(t));
    if (bullets.length) r.about = dedupe(bullets).join("\n");

    const crumbs = [...doc.querySelectorAll("#wayfinding-breadcrumbs_feature_div li a, #wayfinding-breadcrumbs_container li a")].map(txt).filter(Boolean);
    if (crumbs.length) r.breadcrumb = crumbs;

    if (!r.asin) {
      const a = doc.querySelector("input#ASIN, input[name='ASIN']");
      if (a && /^[A-Z0-9]{10}$/i.test(a.value || "")) r.asin = a.value.toUpperCase();
    }
    return r;
  }

  // ---------- Texto plano (respaldo) ----------
  const ABOUT_HEAD = /^(acerca de este art[ií]culo|sobre este art[ií]culo|about this item)$/i;
  const ABOUT_STOP = /^(›|›\s|ver m[aá]s|see more|mostrar m[aá]s|show more|informar|report|nota:|note:|productos relacionados|related|considera|consider|comparar|compare|comprados juntos|frequently|informaci[oó]n (del|sobre el) producto|product (information|details|description)|detalles del producto|especificaciones|descripci[oó]n del producto|videos?$|opiniones|customer reviews|patrocinad|sponsored|de la marca|from the brand|productos similares|similar|clientes que|customers who|preguntas|questions|ver detalles|see details)/i;
  const PRICE_SKIP = /(lista|list price|t[ií]pico|typical|ahorra|save|antes|was:|env[ií]o|shipping|entrega|delivery|cupon|coupon|\/\s?(oz|onza|count|unidad|ounce|lb|libra))/i;
  const BYLINE = /^(visita la tienda de .+|visit the .+ store|marca:\s*.+|brand:\s*.+)$/i;

  function fromText(text) {
    const r = {};
    const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/[‎‏]/g, "").trim()).filter(Boolean);
    if (!lines.length) return r;

    // Filas "Etiqueta<TAB>Valor", "Etiqueta: Valor" o etiqueta y valor en líneas seguidas
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const tabs = line.split(/\t+/);
      if (tabs.length >= 2 && setField(r, tabs[0], tabs.slice(1).join(" "))) continue;
      const colon = line.match(/^([^:]{2,45}):\s*(.+)$/);
      if (colon && setField(r, colon[1], colon[2])) continue;
      if (fieldFor(line) && lines[i + 1] && !fieldFor(lines[i + 1])) { if (setField(r, line, lines[i + 1])) i++; }
    }

    // Nombre: la línea anterior a "Visita la tienda de…" / "Visit the … Store"
    const by = lines.findIndex((l) => BYLINE.test(l));
    if (by > 0) {
      if (!r.brand) r.brand = brandFromByline(lines[by]);
      for (let k = by - 1; k >= Math.max(0, by - 3); k--) {
        const c = lines[k];
        if (c.length >= 12 && !/estrellas|stars|calificaci|ratings|›/i.test(c)) { r.title = c; break; }
      }
    }

    // Precio: primero que aparezca después del nombre, ignorando precio de lista, envío, etc.
    const start = by > 0 ? by : 0;
    for (let i = start; i < Math.min(lines.length, start + 60); i++) {
      if (PRICE_SKIP.test(lines[i])) continue;
      const v = parsePrice(lines[i]);
      if (v != null) { r.price = v; break; }
    }

    // "Acerca de este artículo"
    const h = lines.findIndex((l) => ABOUT_HEAD.test(l));
    if (h >= 0) {
      const out = [];
      for (let i = h + 1; i < lines.length && out.length < 15; i++) {
        const l = lines[i].replace(/^[•·\-*]\s*/, "");
        if (ABOUT_STOP.test(l)) break;
        if (!isJunkBullet(l)) out.push(l);
      }
      if (out.length) r.about = dedupe(out).join("\n");
    }

    // Ruta de categorías: "Hogar y Cocina › Electrodomésticos › Licuadoras"
    for (let i = 0; i < Math.min(lines.length, 120); i++) {
      if (lines[i].includes(" › ")) { r.breadcrumb = lines[i].split("›").map(clean).filter(Boolean); break; }
      if (lines[i] === "›" && i > 0) {
        const crumbs = [lines[i - 1]];
        let j = i;
        while (lines[j] === "›" && lines[j + 1]) { crumbs.push(lines[j + 1]); j += 2; }
        r.breadcrumb = crumbs.map(clean).filter((c) => c.length < 80);
        break;
      }
    }
    return r;
  }

  const FIELDS = ["asin", "title", "price", "brand", "color", "feature", "capacity", "dimensions", "about", "breadcrumb"];
  function parse({ html, text }) {
    const a = html ? fromHtml(html) : {};
    const b = text ? fromText(text) : {};
    const r = {};
    FIELDS.forEach((f) => {
      const v = a[f] !== undefined && a[f] !== "" && !(Array.isArray(a[f]) && !a[f].length) ? a[f] : b[f];
      if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) r[f] = v;
    });
    if (r.title) r.title = r.title.slice(0, 300);
    if (r.about) r.about = r.about.slice(0, 5000);
    r.found = FIELDS.filter((f) => r[f] !== undefined && f !== "asin");
    return r;
  }

  // Borrador del nombre a partir del "slug" del enlace: amazon.com/Cuisinart-DGB-400NAS-…/dp/ASIN
  function titleFromUrl(url) {
    const m = String(url || "").match(/amazon\.[a-z.]+\/([^/?#]+)\/(?:dp|gp\/product)\//i);
    if (!m) return "";
    let slug;
    try { slug = decodeURIComponent(m[1]); } catch (_) { slug = m[1]; }
    if (/^(dp|gp|s|stores)$/i.test(slug) || slug.length < 6) return "";
    return slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }

  return { parse, titleFromUrl, parsePrice };
})();
