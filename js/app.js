// UI: scan, library, add and backup screens. Everything renders from the state object S.
(function () {
  "use strict";
  const L = window.BookLib;

  const S = {
    books: [], ready: false, storeOk: true,
    view: "scan", filter: "all", q: "", sort: "recent", quick: "",
    scan: null,      // last scanned book: {isbn, phase: 'looking'|'done'|'unknown'|'offline', info, match, by, fresh}
    search: { q: "", phase: "idle", results: [] }, // online search on the Add screen
    isbnEntry: null, // typed ISBN box on the scan screen: {value} while open
    picker: null,    // title search that fills in a book: {ctx: 'scan'|'sheet', q, phase: 'idle'|'loading'|'done'|'offline', results}
    sheet: null,     // book form: {mode: 'new'|'edit', id, data, armed}
    scanMode: null,  // 'check' | 'bulk' | 'fill' while the camera is open
    bulk: null,      // {count, last, log: []}
    installPrompt: null,
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  /* ---------- data ---------- */
  async function saveBook(book) {
    book.updatedAt = Date.now();
    const i = S.books.findIndex((b) => b.id === book.id);
    if (i >= 0) S.books[i] = book; else S.books.unshift(book);
    render();
    try {
      await Store.put(book);
      if (!lsGet("persistAsked")) { lsSet("persistAsked", "1"); Store.persist(); }
    } catch {
      toast("No se pudo guardar en este móvil. Revisa el espacio libre.");
    }
  }
  async function addBook(fields) {
    const book = { id: newId(), title: "", author: "", isbn: "", year: "", publisher: "", pages: null, cover: "",
      owned: false, read: false, wish: false, rating: 0, readDate: "", notes: "", createdAt: Date.now(), ...fields };
    if (book.owned) book.wish = false;
    await saveBook(book);
    return book;
  }
  async function patchBook(id, patch) {
    const b = S.books.find((x) => x.id === id);
    if (!b) return;
    const next = { ...b, ...patch };
    if (next.owned) next.wish = false;
    await saveBook(next);
  }
  async function removeBook(id) {
    S.books = S.books.filter((b) => b.id !== id);
    render();
    try { await Store.remove(id); } catch { toast("No se pudo borrar. Vuelve a intentarlo."); }
  }
  const infoFields = (info) => (info ? { title: info.title, author: info.author, isbn: info.isbn, year: info.year, publisher: info.publisher, pages: info.pages, cover: info.cover } : {});

  // Books added offline (only the ISBN known) get their title and cover as soon as there is a connection.
  let completing = false;
  async function completePending() {
    if (completing || !navigator.onLine) return;
    completing = true;
    try {
      for (const b of S.books.filter((x) => x.pending && x.isbn)) {
        try {
          const { book } = await Lookup.byIsbn(b.isbn);
          if (book) await patchBook(b.id, { ...infoFields(book), pending: false });
        } catch { break; }
      }
    } finally { completing = false; }
  }

  /* ---------- small renderers ---------- */
  function spine(title, big) {
    let h = 0;
    for (const c of String(title || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
    const initials = String(title || "?").replace(/^ISBN\s*/, "#").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return `<span class="cv${big ? " big" : ""}"><span class="spine" style="background:hsl(${h} 38% 38%)">${esc(initials)}</span>`;
  }
  function cover(b, big) {
    const img = b && b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    return spine(b && b.title, big) + img + "</span>";
  }
  function pills(b) {
    const p = [];
    if (b.pending) p.push(`<span class="pill muted">Sin datos</span>`);
    if (b.owned && b.read) p.push(`<span class="pill ok">Tengo · Leído</span>`);
    else if (b.owned) p.push(`<span class="pill warn">Tengo · Sin leer</span>`);
    else if (b.read) p.push(`<span class="pill no">Leído · No lo tengo</span>`);
    if (b.wish && !b.owned) p.push(`<span class="pill wish">Lo quiero</span>`);
    return p.join("");
  }
  function stamps(b, fresh) {
    const f = fresh ? " fresh" : "";
    if (!b) return `<span class="stamp no${f}">No lo tienes</span><span class="stamp no${f}">No lo has leído</span>`;
    return (b.owned ? `<span class="stamp ok${f}">✓ Ya lo tienes</span>` : `<span class="stamp no${f}">No lo tienes</span>`) +
      (b.read ? `<span class="stamp ok${f}">✓ Leído</span>` : `<span class="stamp warn${f}">Sin leer</span>`) +
      (b.wish && !b.owned ? `<span class="stamp wish${f}">En tu lista de deseos</span>` : "");
  }
  const isbnOnly = (b) => !!b && /^ISBN \d/.test(b.title || "");
  const metaLine = (o) => [o.year, o.publisher, o.isbn ? "ISBN " + o.isbn : ""].filter(Boolean).map(esc).join(" · ");
  function itemRow(b) {
    return `<button type="button" class="item" data-act="open" data-id="${esc(b.id)}">
      ${cover(b)}
      <div><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author || "Autor desconocido")}${b.rating ? " · " + "★".repeat(b.rating) : ""}</div></div>
      <div class="pills">${pills(b)}</div></button>`;
  }

  /* ---------- screens ---------- */
  function render() {
    renderStats();
    for (const t of ["scan", "library", "add", "more"]) {
      const el = $("#tab-" + t);
      if (t === S.view) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    }
    const active = document.activeElement && document.activeElement.id;
    const caret = active && document.activeElement.selectionStart;
    $("#view").innerHTML = S.view === "scan" ? scanView() : S.view === "library" ? libraryView() : S.view === "add" ? addView() : moreView();
    if (active && ["quick", "libq", "netq", "pickq", "isbnq"].includes(active)) {
      const el = document.getElementById(active);
      if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } }
    }
    readSheet(); // keep what is being typed in an open book form when the screen behind it redraws
    renderSheet();
  }
  function renderStats() {
    const el = $("#stats");
    if (!S.ready) { el.textContent = "Abriendo tu estante…"; return; }
    const n = (f) => S.books.filter(f).length;
    el.innerHTML = `<b>${n((b) => b.owned)}</b> en tu estante · <b>${n((b) => b.read)}</b> leídos · <b>${n((b) => b.owned && !b.read)}</b> pendientes · <b>${n((b) => b.wish && !b.owned)}</b> deseados`;
  }

  const barcodeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7.5 8v8M10 8v8M12 8v8M14.5 8v8M16.5 8v8"/></svg>`;

  // Typed ISBN, for books whose ISBN is printed without a barcode (old books, the copyright page).
  function isbnHint(raw) {
    if (!raw) return "Son 13 cifras (10 en libros antiguos). Está en la contraportada o en la página de créditos, al principio del libro.";
    if (L.toIsbn13(raw)) return "ISBN correcto.";
    if (raw.length === 10 || raw.length === 13) return "Ese ISBN no es válido. Revisa los números.";
    if (raw.length > 13) return "Sobran cifras. Un ISBN tiene 13 (o 10).";
    return `${raw.length} ${raw.length === 1 ? "cifra" : "cifras"}…`;
  }
  function isbnEntryHTML() {
    const raw = L.cleanIsbn(S.isbnEntry.value);
    return `<section class="card" id="isbncard">
      <h3>Escribir el ISBN</h3>
      <div class="searchbar"><input type="text" id="isbnq" inputmode="numeric" autocomplete="off" enterkeyhint="search" placeholder="978 84…" value="${esc(S.isbnEntry.value)}" aria-describedby="isbnhint" aria-label="ISBN">
        <button type="button" class="btn primary" id="isbn-go" data-act="isbn-go"${L.toIsbn13(raw) ? "" : " disabled"}>Comprobar</button></div>
      <p class="note" id="isbnhint">${isbnHint(raw)}</p>
      <div class="row" id="isbnx"${/^\d{9}$/.test(raw) ? "" : " hidden"}><button type="button" class="btn small" data-act="isbn-x">Termina en X</button></div>
      <div class="row"><button type="button" class="btn small ghost" data-act="isbn-close">Cancelar</button></div>
    </section>`;
  }
  function openIsbnEntry() {
    S.isbnEntry = { value: "" };
    S.view = "scan";
    render();
    const el = $("#isbnq");
    if (el) { el.focus(); el.scrollIntoView({ block: "center" }); }
  }
  function submitIsbnEntry() {
    const isbn = S.isbnEntry && L.toIsbn13(S.isbnEntry.value);
    if (!isbn) return;
    S.isbnEntry = null;
    checkIsbn(isbn);
  }

  // Search box + covers to tap. Used for ISBNs nobody knows and for books saved without a title.
  function pickerHTML(label) {
    const p = S.picker;
    let body = "";
    if (p.phase === "loading") body = `<p class="loading">Buscando en Open Library y Apple Books</p>`;
    else if (p.phase === "offline") body = `<p class="note">Sin conexión. Prueba otra vez cuando tengas cobertura.</p>`;
    else if (p.phase === "done" && !p.results.length) body = `<p class="note">Nada con esas palabras. Prueba con otras o añade el autor.</p>`;
    else if (p.phase === "done") {
      body = `<div class="picks">${p.results.map((r, i) => `<button type="button" class="pick" data-act="pick-fill" data-i="${i}">
          ${cover(r, true)}<span class="pt">${esc(r.title)}</span><span class="pa">${esc(r.author)}${r.year ? " · " + esc(r.year) : ""}</span></button>`).join("")}</div>
        <p class="note">Toca el que coincide con tu libro. Si no está, prueba con otras palabras o escribe la ficha a mano.</p>`;
    }
    return `<div class="picker">
      <label class="field" for="pickq">${label}</label>
      <div class="searchbar"><input type="search" id="pickq" value="${esc(p.q)}" placeholder="Ej.: los huérfanos mola" autocomplete="off" enterkeyhint="search">
        <button type="button" class="btn" data-act="pick-go">Buscar</button></div>
      ${body}</div>`;
  }

  function scanView() {
    let html = S.isbnEntry ? isbnEntryHTML() : "";
    html += S.scan ? scanResult(S.scan) : "";
    html += Scanner.canUseCamera()
      ? `<button type="button" class="cam-btn" data-act="scan">${barcodeIcon}
          <span class="big">Escanear un libro</span>
          <span class="sub">Apunta al código de barras y te digo si ya lo tienes y si lo has leído</span></button>
         <div class="row"><button type="button" class="btn" data-act="isbn-open">Escribir el ISBN</button><button type="button" class="btn ghost" data-act="photo-code">Leer el código de una foto</button></div>`
      : `<div class="banner"><strong>Este navegador no deja usar la cámara en vivo.</strong> Puedes hacer una foto del código de barras o escribir el ISBN.
           <div class="row"><button type="button" class="btn primary" data-act="photo-code">Fotografiar el código</button><button type="button" class="btn" data-act="isbn-open">Escribir el ISBN</button></div></div>`;
    html += `<section class="card flat">
      <label class="field" for="quick">¿Sin código de barras? Escribe el título, el autor o el ISBN</label>
      <input type="search" id="quick" placeholder="Ej.: Patria, Aramburu" value="${esc(S.quick)}" autocomplete="off" enterkeyhint="search">
      <div id="quickres">${quickResults()}</div></section>`;
    return html;
  }
  function quickResults() {
    const raw = S.quick.trim();
    if (raw.length < 2) return "";
    const isbn = L.toIsbn13(raw);
    if (isbn) return `<div class="row"><button type="button" class="btn primary" data-act="check-isbn" data-isbn="${isbn}">Comprobar ISBN ${isbn}</button></div>`;
    const q = L.norm(raw);
    const hits = S.books.filter((b) => L.norm(`${b.title} ${b.author || ""}`).includes(q)).slice(0, 6);
    const net = `<button type="button" class="btn small ghost" data-act="net-search">Buscar «${esc(raw)}» en internet</button>`;
    if (!hits.length) return `<p class="note">No está en tu estante.</p><div class="row">${net}</div>`;
    return `<div class="list">${hits.map(itemRow).join("")}</div><div class="row">${net}</div>`;
  }

  function scanResult(sc) {
    const m = sc.match;
    const info = sc.info;
    const shown = info || m || { title: "ISBN " + sc.isbn, isbn: sc.isbn };
    const lines = [];
    if (sc.phase === "looking") lines.push(`<p class="loading">Buscando los datos del libro</p>`);
    if (sc.phase === "offline") lines.push(`<p class="note">Sin conexión: no he podido buscar el título. ${m ? "Lo de arriba sale de tu estante." : "En tu estante no hay ningún libro con este ISBN."}</p>`);
    if (sc.phase === "unknown" && (!m || isbnOnly(m))) {
      lines.push(`<p class="note">No encuentro el título de este ISBN en Open Library.</p>`);
      if (S.picker && S.picker.ctx === "scan") lines.push(pickerHTML("Escribe unas palabras del título y elige su portada"));
      lines.push(`<div class="row"><a class="btn small ghost" href="https://books.google.es/books?vid=ISBN${sc.isbn}" target="_blank" rel="noopener">Ver este ISBN en Google Libros ↗</a></div>`);
    }
    if (m && sc.by === "title") lines.push(`<p class="note">Tienes otra edición: «${esc(m.title)}»${m.isbn ? ` (ISBN ${esc(m.isbn)})` : ""}.</p>`);
    let actions = "";
    if (!m) {
      actions = `<button type="button" class="btn primary" data-act="scan-add" data-mode="owned">Lo he comprado</button>
        <button type="button" class="btn" data-act="scan-add" data-mode="read">Ya lo leí</button>
        <button type="button" class="btn" data-act="scan-add" data-mode="wish">Lo quiero</button>`;
    } else {
      if (!m.owned) actions += `<button type="button" class="btn primary" data-act="scan-patch" data-patch="owned">Lo he comprado</button>`;
      if (!m.read) actions += `<button type="button" class="btn${m.owned ? " primary" : ""}" data-act="scan-patch" data-patch="read">Marcar como leído</button>`;
      if (!m.owned && !m.wish) actions += `<button type="button" class="btn" data-act="scan-patch" data-patch="wish">Lo quiero</button>`;
      actions += `<button type="button" class="btn" data-act="open" data-id="${esc(m.id)}">Ver ficha</button>`;
    }
    return `<section class="card" aria-live="polite">
      <div class="stamps">${stamps(m, sc.fresh)}</div>
      <div class="result-head">${cover(shown, true)}
        <div><p class="book-title">${esc(shown.title)}</p><p class="book-author">${esc(shown.author || "")}</p><div class="meta">${metaLine({ ...shown, isbn: sc.isbn })}</div></div></div>
      ${lines.join("")}
      <div class="row">${actions}</div>
      <div class="row"><button type="button" class="btn small ghost" data-act="scan">Escanear otro</button></div>
    </section>`;
  }

  function filtered() {
    const q = L.norm(S.q);
    const list = S.books.filter((b) => {
      if (S.filter === "owned" && !b.owned) return false;
      if (S.filter === "read" && !b.read) return false;
      if (S.filter === "pending" && !(b.owned && !b.read)) return false;
      if (S.filter === "wish" && !(b.wish && !b.owned)) return false;
      if (S.filter === "nodata" && !isbnOnly(b)) return false;
      return !q || L.norm(`${b.title} ${b.author || ""} ${b.isbn || ""}`).includes(q);
    });
    const byTitle = (a, b) => L.norm(a.title).localeCompare(L.norm(b.title));
    const surname = (b) => L.authorWords(String(b.author || "").split(",")[0]).slice(-1)[0] || "~";
    if (S.sort === "title") list.sort(byTitle);
    else if (S.sort === "author") list.sort((a, b) => surname(a).localeCompare(surname(b)) || byTitle(a, b));
    else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }
  function libraryView() {
    if (!S.ready) return `<div class="empty"><span class="big">Abriendo tu estante…</span></div>`;
    const n = (f) => S.books.filter(f).length;
    const counts = { all: S.books.length, owned: n((b) => b.owned), read: n((b) => b.read), pending: n((b) => b.owned && !b.read), wish: n((b) => b.wish && !b.owned), nodata: n(isbnOnly) };
    const chip = (k, label) => `<button type="button" class="chip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${label} ${counts[k]}</button>`;
    const list = filtered();
    let body;
    if (!S.books.length) {
      body = `<div class="list"><div class="empty"><span class="big">Tu estante está vacío</span>
        Lo más rápido es escanear los libros que tienes en casa, uno detrás de otro.
        <div class="row"><button type="button" class="btn primary" data-act="bulk">Escanear mi estantería</button><button type="button" class="btn" data-act="new">Añadir a mano</button></div></div></div>`;
    } else if (!list.length) {
      body = `<div class="list"><div class="empty">Ningún libro coincide con la búsqueda.</div></div>`;
    } else {
      body = `<div class="list">${list.map(itemRow).join("")}</div>`;
    }
    const opt = (v, l) => `<option value="${v}"${S.sort === v ? " selected" : ""}>${l}</option>`;
    return `<section class="toolbar">
        <input type="search" id="libq" placeholder="Buscar por título, autor o ISBN" value="${esc(S.q)}" autocomplete="off" aria-label="Buscar en tu estante">
        <div class="chips">${chip("all", "Todos")}${chip("owned", "En el estante")}${chip("read", "Leídos")}${chip("pending", "Pendientes")}${chip("wish", "Deseos")}${counts.nodata || S.filter === "nodata" ? chip("nodata", "Sin título") : ""}</div>
        <div class="sortline"><span>${list.length} ${list.length === 1 ? "libro" : "libros"}</span>
          <label>Ordenar <select id="sort">${opt("recent", "Recientes")}${opt("title", "Título")}${opt("author", "Autor")}</select></label></div>
        ${counts.nodata ? `<div class="banner"><strong>${counts.nodata} ${counts.nodata === 1 ? "libro sin título" : "libros sin título"}.</strong> Ábrelos y escribe unas palabras del título para completarlos.</div>` : ""}
      </section>
      <section>${body}</section>`;
  }

  function addView() {
    const s = S.search;
    let results = "";
    if (s.phase === "loading") results = `<p class="loading">Buscando en Open Library y Apple Books</p>`;
    else if (s.phase === "offline") results = `<p class="note">Sin conexión. Prueba más tarde o añádelo a mano.</p>`;
    else if (s.phase === "done" && !s.results.length) results = `<p class="note">No he encontrado nada. Prueba con menos palabras o añádelo a mano.</p>`;
    else if (s.phase === "done") {
      results = `<div class="list">${s.results.map((r, i) => {
        const m = L.findMatch(S.books, r);
        return `<button type="button" class="item" data-act="pick" data-i="${i}">${cover(r)}
          <div><div class="t">${esc(r.title)}</div><div class="a">${esc(r.author || "Autor desconocido")}${r.year ? " · " + esc(r.year) : ""}</div></div>
          <div class="pills">${m ? pills(m.book) || `<span class="pill muted">En tu estante</span>` : `<span class="pill muted">Añadir</span>`}</div></button>`;
      }).join("")}</div>`;
    }
    return `<section class="card">
        <h2>Escanear tu estantería</h2>
        <p class="lede">Ve pasando los libros por la cámara y se añaden solos como tuyos. Sin conexión también funciona; los datos se completan después.</p>
        <div class="row"><button type="button" class="btn primary" data-act="bulk">Empezar a escanear</button></div>
      </section>
      <section class="card flat">
        <h3>Buscar por título o autor</h3>
        <form class="searchbar" id="netform"><input type="search" id="netq" placeholder="Ej.: La sombra del viento" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search" aria-label="Título o autor">
          <button class="btn" type="submit">Buscar</button></form>
        ${results}
      </section>
      <section class="card flat">
        <h3>Escribir la ficha a mano</h3>
        <p class="note">Para libros sin ISBN o que no aparecen en la búsqueda.</p>
        <div class="row"><button type="button" class="btn" data-act="new">Añadir a mano</button></div>
      </section>`;
  }

  function moreView() {
    const last = lsGet("lastExport");
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let install = "";
    if (standalone) install = `<p class="note">La app ya está instalada en este móvil.</p>`;
    else if (S.installPrompt) install = `<div class="row"><button type="button" class="btn primary" data-act="install">Instalar en la pantalla de inicio</button></div>`;
    else if (ios) install = `<p class="note">En Safari, pulsa <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>.</p>`;
    else install = `<p class="note">En el menú del navegador, elige <strong>Instalar app</strong> o <strong>Añadir a pantalla de inicio</strong>.</p>`;
    const canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] }));
    return `<section class="card">
        <h2>Exportar tu colección</h2>
        <p class="lede">Tus libros se guardan solo en este dispositivo. Expórtalos a un archivo de vez en cuando para no perderlos, o para pasarlos a otro móvil o al ordenador.</p>
        <p class="note">${S.books.length} ${S.books.length === 1 ? "libro" : "libros"} · Última exportación: ${last ? esc(new Date(+last).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })) : "nunca"}</p>
        <div class="row">
          ${canShare ? `<button type="button" class="btn primary" data-act="export-share">Exportar y enviar…</button>` : ""}
          <button type="button" class="btn${canShare ? "" : " primary"}" data-act="export-file">Descargar el archivo</button>
        </div>
        ${canShare ? `<p class="note">«Exportar y enviar» te deja mandarlo por WhatsApp o correo, o guardarlo en Drive o en Archivos.</p>` : ""}
      </section>
      <section class="card flat">
        <h3>Importar una colección</h3>
        <p class="note">En el otro móvil o en el ordenador, abre esta misma web, entra en Exportar y elige el archivo. Se añaden los libros que faltan y se actualizan los que cambiaron; no se borra nada.</p>
        <div class="row"><button type="button" class="btn" data-act="import">Importar un archivo</button></div>
      </section>
      <section class="card flat">
        <h3>Instalar como app</h3>
        <p class="note">Instalada se abre a pantalla completa, funciona sin conexión y el navegador no borra tus libros por falta de uso.</p>
        ${install}
      </section>
      <section class="card flat">
        <h3>Acerca de</h3>
        <p class="note">Los datos de los libros vienen de <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a> y de la tienda de Apple Books, sin claves ni cuentas. El código de barras se lee en el propio móvil; las fotos no salen de él.</p>
      </section>`;
  }

  /* ---------- book form ---------- */
  function openSheet(mode, data, id) {
    S.sheet = { mode, id: id || null, armed: false, data: { title: "", author: "", isbn: "", year: "", publisher: "", pages: null, cover: "", owned: true, read: false, wish: false, rating: 0, readDate: "", notes: "", ...data } };
    const d = S.sheet.data;
    S.picker = mode === "edit" && (!d.title || isbnOnly(d)) ? { ctx: "sheet", q: "", phase: "idle", results: [] } : null;
    renderSheet();
    setTimeout(() => { const t = $("#s-title"); if (t && !t.value) t.focus(); }, 60);
  }
  function closeSheet() {
    S.sheet = null;
    if (S.picker && S.picker.ctx === "sheet") S.picker = null;
    renderSheet();
  }
  function dupWarning(d) {
    if (S.sheet.mode !== "new") return "";
    const m = L.findMatch(S.books, d);
    return m ? `<div class="banner"><strong>Ya tienes «${esc(m.book.title)}» en tu estante.</strong><div class="row"><button type="button" class="btn small ghost" data-act="open" data-id="${esc(m.book.id)}">Abrir esa ficha</button></div></div>` : "";
  }
  function renderSheet() {
    const ov = $("#overlay");
    const sh = S.sheet;
    if (!sh) { ov.hidden = true; ov.innerHTML = ""; document.body.style.overflow = ""; return; }
    const d = sh.data;
    ov.hidden = false;
    document.body.style.overflow = "hidden";
    ov.innerHTML = `<form class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" novalidate>
      <div class="sheet-head"><h2 id="sheet-h">${sh.mode === "new" ? "Nuevo libro" : "Ficha del libro"}</h2>
        <button type="button" class="btn small ghost" data-act="close">Cerrar</button></div>
      <div class="sheet-cover">${cover(d, false)}
        <div class="row">${Scanner.canUseCamera() ? `<button type="button" class="btn small" data-act="fill-scan">Rellenar escaneando el ISBN</button>` : ""}
          ${S.picker && S.picker.ctx === "sheet" ? "" : `<button type="button" class="btn small" data-act="pick-open">Buscar título y portada</button>`}</div></div>
      ${S.picker && S.picker.ctx === "sheet" ? pickerHTML(isbnOnly(d) || !d.title ? "Este libro no tiene título. Escribe unas palabras del título o el autor" : "Escribe unas palabras del título o el autor") : ""}
      <label class="field" for="s-title">Título<input type="text" id="s-title" name="title" value="${esc(d.title)}" required></label>
      <label class="field" for="s-author">Autor<input type="text" id="s-author" name="author" value="${esc(d.author)}"></label>
      <div class="grid2">
        <label class="field" for="s-isbn">ISBN<input type="text" id="s-isbn" name="isbn" inputmode="numeric" value="${esc(d.isbn)}"></label>
        <label class="field" for="s-year">Año<input type="text" id="s-year" name="year" inputmode="numeric" value="${esc(d.year)}"></label>
      </div>
      <div id="dupwarn">${dupWarning(d)}</div>
      <div class="toggles">
        <label class="toggle" for="s-owned">Lo tengo<input type="checkbox" id="s-owned" name="owned" ${d.owned ? "checked" : ""}></label>
        <label class="toggle" for="s-read">Lo he leído<input type="checkbox" id="s-read" name="read" ${d.read ? "checked" : ""}></label>
        <label class="toggle" for="s-wish">En mi lista de deseos<input type="checkbox" id="s-wish" name="wish" ${d.wish ? "checked" : ""}></label>
      </div>
      <div class="field"><span>Mi valoración</span><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star${d.rating >= n ? " on" : ""}" data-act="star" data-n="${n}" aria-label="${n} de 5">★</button>`).join("")}</div></div>
      <label class="field" for="s-date">Terminado en<input type="month" id="s-date" name="readDate" value="${esc(d.readDate)}"></label>
      <label class="field" for="s-notes">Notas<textarea id="s-notes" name="notes" placeholder="A quién se lo presté, qué me pareció…">${esc(d.notes)}</textarea></label>
      <div class="row"><button type="submit" class="btn primary">${sh.mode === "new" ? "Guardar en mi estante" : "Guardar cambios"}</button></div>
      ${sh.mode === "edit" ? `<div class="row"><button type="button" class="btn danger${sh.armed ? " armed" : ""}" data-act="delete">${sh.armed ? "Pulsa otra vez para eliminar" : "Eliminar libro"}</button></div>` : ""}
    </form>`;
  }
  function readSheet() {
    const f = $("#sheet");
    if (!f || !S.sheet) return;
    const d = S.sheet.data;
    d.title = f.title.value.trim(); d.author = f.author.value.trim(); d.isbn = f.isbn.value.trim(); d.year = f.year.value.trim();
    d.owned = f.owned.checked; d.read = f.read.checked; d.wish = f.wish.checked; d.readDate = f.readDate.value; d.notes = f.notes.value;
  }

  /* ---------- scanning ---------- */
  let lastBadCodeAt = 0;
  const buzz = () => { try { if (navigator.userActivation?.hasBeenActive !== false && navigator.vibrate) navigator.vibrate(60); } catch { /* not supported */ } };
  async function openScanner(mode) {
    S.scanMode = mode;
    if (mode === "bulk") S.bulk = { count: 0, last: "", log: [] };
    $("#scan-title").textContent = mode === "bulk" ? "Escanea tus libros uno detrás de otro" : "Apunta al código de barras";
    $("#bulk-panel").hidden = mode !== "bulk";
    $("#bulk-log").innerHTML = "";
    $("#scan-msg").textContent = "";
    $("#torch").hidden = true;
    $("#scan-type").hidden = mode !== "check";
    $("#scanner").hidden = false;
    try {
      await Scanner.start($("#video"), onCode);
      $("#torch").hidden = !Scanner.torchAvailable();
    } catch (e) {
      await closeScanner();
      const name = e && e.name;
      toast(name === "NotAllowedError" ? "Sin permiso para usar la cámara. Actívalo en los ajustes del navegador para esta web."
        : name === "NotFoundError" ? "No encuentro ninguna cámara en este dispositivo."
        : "No se pudo abrir la cámara. Prueba a leer el código desde una foto.");
    }
  }
  async function closeScanner() {
    await Scanner.stop();
    $("#scanner").hidden = true;
    const wasBulk = S.scanMode === "bulk" && S.bulk && S.bulk.count;
    S.scanMode = null;
    if (wasBulk) { toast(`${S.bulk.count} ${S.bulk.count === 1 ? "libro añadido" : "libros añadidos"}`); S.view = "library"; render(); }
  }
  function onCode(text) {
    const isbn = L.toIsbn13(text);
    if (!isbn) {
      if (Date.now() - lastBadCodeAt > 2500) {
        lastBadCodeAt = Date.now();
        $("#scan-msg").textContent = S.scanMode === "check" ? "Ese código no es un ISBN. Busca el que empieza por 978 o 979, o pulsa «Escribir el ISBN»." : "Ese código no es un ISBN. Busca el que empieza por 978 o 979.";
      }
      return;
    }
    const mode = S.scanMode;
    if (mode === "bulk") return bulkAdd(isbn);
    buzz();
    closeScanner();
    if (mode === "fill") return fillSheet(isbn);
    checkIsbn(isbn);
  }

  async function checkIsbn(isbn) {
    const local = L.findMatch(S.books, { isbn });
    const sc = { isbn, phase: "looking", info: null, match: local ? local.book : null, by: local ? "isbn" : null, fresh: true };
    S.scan = sc;
    if (S.picker && S.picker.ctx === "scan") S.picker = null;
    S.view = "scan";
    $("#toast").hidden = true;
    render();
    sc.fresh = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const { book } = await Lookup.byIsbn(isbn);
      sc.info = book;
      sc.phase = book ? "done" : "unknown";
      if (!book && (!sc.match || isbnOnly(sc.match))) S.picker = { ctx: "scan", q: "", phase: "idle", results: [] };
      if (!sc.match && book) {
        const t = L.findMatch(S.books, book);
        if (t) { sc.match = t.book; sc.by = "title"; sc.fresh = true; }
      }
    } catch {
      sc.phase = "offline";
    }
    if (S.scan === sc) { render(); sc.fresh = false; }
  }

  async function bulkAdd(isbn) {
    const bk = S.bulk;
    if (!bk || isbn === bk.last) return; // the same book is still in front of the camera
    bk.last = isbn;
    buzz();
    const read = $("#bulk-read").checked;
    const known = L.findMatch(S.books, { isbn });
    let line;
    if (known) {
      const b = known.book;
      if (!b.owned || (read && !b.read)) { await patchBook(b.id, { owned: true, read: b.read || read }); line = `Actualizado: ${b.title}`; }
      else line = `Ya lo tenías: ${b.title}`;
    } else {
      $("#scan-msg").textContent = "Buscando " + isbn + "…";
      let info = null, pending = false;
      try { info = (await Lookup.byIsbn(isbn)).book; } catch { pending = true; }
      const t = info && L.findMatch(S.books, info);
      if (t && t.book.owned) line = `Ya tenías otra edición: ${t.book.title}`;
      else {
        const b = await addBook({ ...infoFields(info), isbn, title: info ? info.title : `ISBN ${isbn}`, owned: true, read, pending: pending || !info });
        bk.count++;
        line = `Añadido: ${b.title}`;
      }
    }
    bk.log.unshift(line);
    bk.log = bk.log.slice(0, 3);
    $("#scan-msg").textContent = `${bk.count} ${bk.count === 1 ? "añadido" : "añadidos"}`;
    $("#bulk-log").innerHTML = bk.log.map((l) => `<div>${esc(l)}</div>`).join("");
  }

  async function fillSheet(isbn) {
    if (!S.sheet) return;
    S.sheet.data.isbn = isbn;
    renderSheet();
    toast("Buscando los datos del libro…");
    try {
      const { book } = await Lookup.byIsbn(isbn);
      if (!S.sheet) return;
      if (book) {
        readSheet();
        Object.assign(S.sheet.data, Object.fromEntries(Object.entries(infoFields(book)).filter(([, v]) => v)));
        renderSheet();
        toast("Datos rellenados");
      } else toast("No encuentro ese ISBN. Escribe el título a mano.");
    } catch { toast("Sin conexión. Guarda el ISBN y completa el resto después."); }
  }

  /* ---------- backup ---------- */
  function backupFile() {
    const data = JSON.stringify({ app: "mi-estante", version: 1, exportedAt: new Date().toISOString(), books: S.books }, null, 1);
    const name = `mi-estante-${new Date().toISOString().slice(0, 10)}.json`;
    return new File([data], name, { type: "application/json" });
  }
  async function exportShare() {
    const file = backupFile();
    try {
      await navigator.share({ files: [file], title: "Copia de Mi Estante" });
      lsSet("lastExport", String(Date.now()));
      render();
    } catch (e) {
      if (e && e.name !== "AbortError") exportDownload();
    }
  }
  function exportDownload() {
    const file = backupFile();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    lsSet("lastExport", String(Date.now()));
    render();
  }
  async function importFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.books) ? parsed.books : null;
      if (!incoming) throw new Error("format");
      const r = L.mergeBooks(S.books, incoming, newId);
      await Store.putMany(r.books);
      S.books = r.books;
      render();
      toast(`${r.added} ${r.added === 1 ? "libro nuevo" : "libros nuevos"}, ${r.updated} actualizados`);
      completePending();
    } catch {
      toast("Ese archivo no es una copia de Mi Estante.");
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act], [data-tab]");
    if (!t) { if (ev.target === $("#overlay")) closeSheet(); return; }
    const act = t.dataset.act || "tab";
    const sc = S.scan;
    switch (act) {
      case "tab": S.view = t.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "scan": openScanner("check"); break;
      case "bulk": openScanner("bulk"); break;
      case "photo-code": $("#photo-code").click(); break;
      case "check-isbn": checkIsbn(t.dataset.isbn); break;
      case "isbn-open": openIsbnEntry(); break;
      case "isbn-go": submitIsbnEntry(); break;
      case "isbn-close": S.isbnEntry = null; render(); break;
      case "isbn-x": { const el = $("#isbnq"); el.value += "X"; el.dispatchEvent(new Event("input", { bubbles: true })); el.focus(); break; }
      case "net-search": S.search.q = S.quick.trim(); S.view = "add"; runSearch(); break;
      case "filter": S.filter = t.dataset.f; render(); break;
      case "open": { const b = S.books.find((x) => x.id === t.dataset.id); if (b) openSheet("edit", { ...b }, b.id); break; }
      case "new": openSheet("new", {}); break;
      case "pick": {
        const r = S.search.results[+t.dataset.i];
        const m = r && L.findMatch(S.books, r);
        if (m) openSheet("edit", { ...m.book }, m.book.id); else if (r) openSheet("new", { ...r });
        break;
      }
      case "close": closeSheet(); break;
      case "star": readSheet(); { const n = +t.dataset.n; S.sheet.data.rating = S.sheet.data.rating === n ? 0 : n; } renderSheet(); break;
      case "fill-scan": readSheet(); openScanner("fill"); break;
      case "delete":
        if (!S.sheet.armed) { S.sheet.armed = true; renderSheet(); break; }
        { const id = S.sheet.id; closeSheet(); await removeBook(id); toast("Libro eliminado"); }
        break;
      case "scan-add": {
        const mode = t.dataset.mode;
        const b = await addBook({ ...infoFields(sc.info), isbn: sc.isbn, title: sc.info ? sc.info.title : `ISBN ${sc.isbn}`,
          owned: mode === "owned", read: mode === "read", wish: mode === "wish", pending: !sc.info });
        sc.match = b; sc.by = "isbn"; sc.fresh = true; render(); sc.fresh = false;
        toast(mode === "owned" ? "Añadido a tu estante" : mode === "read" ? "Guardado como leído" : "Añadido a tu lista de deseos");
        if (!sc.info) openSheet("edit", { ...b, title: "" }, b.id);
        break;
      }
      case "scan-patch": {
        const p = t.dataset.patch;
        await patchBook(sc.match.id, { [p]: true });
        sc.match = S.books.find((x) => x.id === sc.match.id); sc.fresh = true; render(); sc.fresh = false;
        toast(p === "owned" ? "Marcado como tuyo" : p === "read" ? "Marcado como leído" : "Añadido a tu lista de deseos");
        break;
      }
      case "pick-open": readSheet(); S.picker = { ctx: "sheet", q: isbnOnly(S.sheet.data) ? "" : S.sheet.data.title, phase: "idle", results: [] }; renderSheet(); setTimeout(() => $("#pickq")?.focus(), 30); break;
      case "pick-go": S.picker.q = $("#pickq").value; $("#pickq").blur(); runPicker(); break;
      case "pick-fill": await pickFill(S.picker.results[+t.dataset.i]); break;
      case "export-share": exportShare(); break;
      case "export-file": exportDownload(); break;
      case "import": $("#import-file").click(); break;
      case "install":
        if (S.installPrompt) { S.installPrompt.prompt(); await S.installPrompt.userChoice.catch(() => null); S.installPrompt = null; render(); }
        break;
    }
  });

  function renderPicker() {
    if (!S.picker) return;
    if (S.picker.ctx === "sheet") { readSheet(); renderSheet(); } else render();
  }
  async function runPicker() {
    const p = S.picker;
    const q = p.q.trim();
    if (q.length < 2) return;
    p.phase = "loading";
    renderPicker();
    try {
      const results = await Lookup.search(q);
      if (S.picker === p && p.q.trim() === q) { p.results = results.slice(0, 9); p.phase = "done"; }
    } catch {
      if (S.picker === p) p.phase = "offline";
    }
    if (S.picker === p) renderPicker();
  }
  // Applies the chosen search result to the scanned ISBN or to the open book form. The ISBN always stays
  // the one the reader scanned or typed: search results are works, not the reader's edition.
  async function pickFill(r) {
    if (!r) return;
    const p = S.picker;
    S.picker = null;
    const fields = { title: r.title, author: r.author, year: r.year, publisher: r.publisher, cover: r.cover };
    if (p.ctx === "sheet" && S.sheet) {
      readSheet();
      Object.assign(S.sheet.data, Object.fromEntries(Object.entries(fields).filter(([, v]) => v)));
      renderSheet();
      toast("Datos rellenados. Revisa y guarda.");
      return;
    }
    const sc = S.scan;
    if (!sc) return;
    if (sc.match && isbnOnly(sc.match)) {
      await patchBook(sc.match.id, { ...fields, pending: false });
      sc.match = S.books.find((b) => b.id === sc.match.id);
    }
    sc.info = { ...fields, isbn: sc.isbn };
    sc.phase = "done";
    if (!sc.match) {
      const t = L.findMatch(S.books, sc.info);
      if (t) { sc.match = t.book; sc.by = "title"; }
    }
    sc.fresh = true;
    render();
    sc.fresh = false;
  }

  async function runSearch() {
    const q = S.search.q.trim();
    if (q.length < 2) return;
    S.search = { q, phase: "loading", results: [] };
    render();
    try {
      const results = await Lookup.search(q);
      if (S.search.q === q) S.search = { q, phase: "done", results };
    } catch {
      if (S.search.q === q) S.search = { q, phase: "offline", results: [] };
    }
    render();
  }

  document.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (ev.target.id === "netform") { S.search.q = $("#netq").value; $("#netq").blur(); runSearch(); return; }
    if (ev.target.id !== "sheet") return;
    readSheet();
    const sh = S.sheet, d = sh.data;
    if (!d.title) { $("#s-title").focus(); toast("Falta el título."); return; }
    const isbn = d.isbn ? L.toIsbn13(d.isbn) : "";
    if (d.isbn && !isbn) { $("#s-isbn").focus(); toast("Ese ISBN no es válido. Revísalo o déjalo vacío."); return; }
    const fields = { title: d.title, author: d.author, isbn: isbn || "", year: d.year, publisher: d.publisher || "", pages: d.pages || null, cover: d.cover || "",
      owned: d.owned, read: d.read, wish: d.wish, rating: d.rating || 0, readDate: d.readDate, notes: d.notes, pending: isbnOnly(d) };
    closeSheet();
    if (sh.mode === "new") { await addBook(fields); toast("Guardado en tu estante"); }
    else { await patchBook(sh.id, fields); toast("Cambios guardados"); }
    if (S.scan && S.scan.match && S.scan.match.id === sh.id) S.scan.match = S.books.find((b) => b.id === sh.id) || null;
    render();
  });

  document.addEventListener("input", (ev) => {
    const id = ev.target.id;
    if (id === "quick") { S.quick = ev.target.value; $("#quickres").innerHTML = quickResults(); }
    if (id === "libq") { S.q = ev.target.value; render(); }
    if (id === "netq") S.search.q = ev.target.value;
    if (id === "pickq" && S.picker) S.picker.q = ev.target.value;
    if (id === "isbnq" && S.isbnEntry) {
      S.isbnEntry.value = ev.target.value;
      const raw = L.cleanIsbn(ev.target.value);
      $("#isbnhint").textContent = isbnHint(raw);
      $("#isbn-go").disabled = !L.toIsbn13(raw);
      $("#isbnx").hidden = !/^\d{9}$/.test(raw);
      if (raw.length === 13 && L.toIsbn13(raw)) { ev.target.blur(); submitIsbnEntry(); }
    }
    if (["s-title", "s-author", "s-isbn"].includes(id) && S.sheet) { readSheet(); $("#dupwarn").innerHTML = dupWarning(S.sheet.data); }
  });
  document.addEventListener("change", async (ev) => {
    const id = ev.target.id;
    if (id === "sort") { S.sort = ev.target.value; render(); }
    if (id === "photo-code") {
      const f = ev.target.files[0];
      ev.target.value = "";
      if (!f) return;
      toast("Leyendo el código…");
      const text = await Scanner.decodeFile(f).catch(() => null);
      const isbn = L.toIsbn13(text);
      if (isbn) checkIsbn(isbn);
      else toast(text ? "Ese código no es un ISBN." : "No encuentro un código de barras en la foto. Acércate más y que salga recto.");
    }
    if (id === "import-file") { const f = ev.target.files[0]; ev.target.value = ""; if (f) importFile(f); }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.id === "isbnq") { ev.preventDefault(); submitIsbnEntry(); return; }
    if (ev.key === "Enter" && ev.target.id === "pickq" && S.picker) {
      ev.preventDefault(); // inside the book form, Enter would submit it
      S.picker.q = ev.target.value;
      ev.target.blur();
      runPicker();
      return;
    }
    if (ev.key !== "Escape") return;
    if (!$("#scanner").hidden) closeScanner(); else if (S.sheet) closeSheet();
  });
  $("#scan-close").addEventListener("click", closeScanner);
  $("#scan-type").addEventListener("click", () => {
    $("#scanner").hidden = true;
    openIsbnEntry(); // focus inside the tap itself, or phones do not open the keyboard
    closeScanner();
  });
  let torchOn = false;
  $("#torch").addEventListener("click", async () => {
    torchOn = !torchOn;
    try { await Scanner.setTorch(torchOn); $("#torch").textContent = torchOn ? "Apagar linterna" : "Linterna"; } catch { torchOn = false; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !$("#scanner").hidden) closeScanner(); });
  window.addEventListener("online", completePending);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; if (S.view === "more") render(); });

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2800);
  }

  /* ---------- start ---------- */
  render();
  Store.all().then((books) => {
    S.books = books || [];
    S.ready = true;
    render();
    completePending();
  }).catch(() => {
    S.ready = true;
    S.storeOk = false;
    const b = $("#banner");
    b.innerHTML = "<strong>Este navegador no deja guardar datos</strong> (¿modo incógnito?). Los libros que añadas se perderán al cerrar.";
    b.hidden = false;
    render();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
