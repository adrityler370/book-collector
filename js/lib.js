// Pure helpers (no DOM, no network): ISBN handling, matching, parsing API answers, merging backups.
// Loaded as a plain script in the browser (window.BookLib) and with require() in the tests.
(function (root) {
  "use strict";

  function cleanIsbn(s) {
    return String(s || "").toUpperCase().replace(/[^0-9X]/g, "");
  }

  function isValidIsbn13(s) {
    if (!/^97[89]\d{10}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }

  function isValidIsbn10(s) {
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
  }

  // Any ISBN-10 or ISBN-13 (with or without hyphens) -> ISBN-13, or null when invalid.
  function toIsbn13(s) {
    const c = cleanIsbn(s);
    if (c.length === 13) return isValidIsbn13(c) ? c : null;
    if (c.length === 10 && isValidIsbn10(c)) {
      const base = "978" + c.slice(0, 9);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
      return base + ((10 - (sum % 10)) % 10);
    }
    return null;
  }

  // Lowercase, no accents, no punctuation, no leading articles: "La Sombra del Viento" -> "sombra del viento".
  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\b(el|la|los|las|un|una|lo|the|a|an|le|les|il|l)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Title without subtitle: "Sapiens: De animales a dioses" -> "sapiens".
  function titleKey(t) {
    return norm(String(t || "").split(/[:(\[]/)[0]);
  }

  function authorWords(a) {
    return norm(a).split(" ").filter((w) => w.length > 2);
  }

  // Finds the book in the library: same ISBN first, then same work by title (+ author when both are known).
  // Returns {book, by: "isbn" | "title"} or null.
  function findMatch(books, probe) {
    const isbn = toIsbn13(probe.isbn);
    if (isbn) {
      const b = books.find((x) => toIsbn13(x.isbn) === isbn);
      if (b) return { book: b, by: "isbn" };
    }
    const k = titleKey(probe.title);
    if (!k) return null;
    const au = authorWords(probe.author);
    let best = null;
    let bestScore = 0;
    for (const b of books) {
      const bk = titleKey(b.title);
      let score;
      if (bk === k) score = 2;
      else if (k.length >= 6 && bk.length >= 6 && (bk.startsWith(k) || k.startsWith(bk))) score = 1;
      else continue;
      const bau = authorWords(b.author);
      if (au.length && bau.length && !au.some((w) => bau.includes(w))) continue;
      if (score > bestScore) {
        best = b;
        bestScore = score;
      }
    }
    return best ? { book: best, by: "title" } : null;
  }

  function yearOf(s) {
    const m = String(s || "").match(/\d{4}/);
    return m ? m[0] : "";
  }

  function https(url) {
    return url ? String(url).replace(/^http:/, "https:") : "";
  }

  // Google Books volumeInfo -> book fields.
  function fromGoogle(v) {
    if (!v || !v.title) return null;
    const ids = v.industryIdentifiers || [];
    const id13 = ids.find((i) => i.type === "ISBN_13");
    const id10 = ids.find((i) => i.type === "ISBN_10");
    const links = v.imageLinks || {};
    return {
      title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
      author: (v.authors || []).join(", "),
      year: yearOf(v.publishedDate),
      publisher: v.publisher || "",
      pages: v.pageCount || null,
      cover: https(links.thumbnail || links.smallThumbnail).replace("&edge=curl", ""),
      isbn: toIsbn13(id13 ? id13.identifier : id10 ? id10.identifier : "") || "",
    };
  }

  // Open Library /api/books?jscmd=data entry -> book fields.
  function fromOpenLibrary(e, isbn) {
    if (!e || !e.title) return null;
    return {
      title: e.subtitle ? `${e.title}: ${e.subtitle}` : e.title,
      author: (e.authors || []).map((a) => a.name).join(", "),
      year: yearOf(e.publish_date),
      publisher: ((e.publishers || [])[0] || {}).name || "",
      pages: e.number_of_pages || null,
      cover: https((e.cover || {}).medium || ""),
      isbn: toIsbn13(isbn) || "",
    };
  }

  // Open Library search.json doc -> book fields (for title search).
  function fromOpenLibrarySearch(d) {
    if (!d || !d.title) return null;
    const isbn = (d.isbn || []).map(toIsbn13).find(Boolean) || "";
    return {
      title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
      author: (d.author_name || []).join(", "),
      year: d.first_publish_year ? String(d.first_publish_year) : "",
      publisher: (d.publisher || [])[0] || "",
      pages: d.number_of_pages_median || null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
      isbn,
    };
  }

  const BOOK_FIELDS = ["title", "author", "isbn", "year", "publisher", "pages", "cover", "owned", "read", "wish", "rating", "readDate", "notes", "pending", "createdAt", "updatedAt"];

  // Accepts this app's backup and the Claude artifact's rows; returns a clean book or null.
  function sanitizeBook(raw, makeId) {
    if (!raw || typeof raw !== "object" || !String(raw.title || "").trim()) return null;
    const b = { id: typeof raw.id === "string" && raw.id ? raw.id : makeId() };
    for (const f of BOOK_FIELDS) if (raw[f] !== undefined) b[f] = raw[f];
    b.title = String(b.title).trim();
    b.author = String(b.author || "");
    b.isbn = toIsbn13(b.isbn) || "";
    b.owned = !!b.owned;
    b.read = !!b.read;
    b.wish = !!b.wish && !b.owned;
    b.rating = Math.max(0, Math.min(5, Number(b.rating) || 0));
    if (!b.cover && typeof raw.thumb === "string" && raw.thumb.startsWith("data:image/")) b.cover = raw.thumb;
    if (b.cover && !/^(https:|data:image\/)/.test(String(b.cover))) b.cover = "";
    b.createdAt = Number(b.createdAt) || Date.now();
    b.updatedAt = Number(b.updatedAt) || b.createdAt;
    return b;
  }

  // Merges a backup into the library. Same id, same ISBN or same title+author count as the same book;
  // the most recently updated copy wins. Returns {books, added, updated}.
  function mergeBooks(existing, incoming, makeId) {
    const books = existing.map((b) => ({ ...b }));
    let added = 0;
    let updated = 0;
    for (const raw of incoming) {
      const b = sanitizeBook(raw, makeId);
      if (!b) continue;
      const same = books.find((x) => x.id === b.id) || (findMatch(books, b) || {}).book;
      if (!same) {
        books.push(b);
        added++;
      } else if ((b.updatedAt || 0) > (same.updatedAt || 0)) {
        Object.assign(same, b, { id: same.id });
        updated++;
      }
    }
    return { books, added, updated };
  }

  const lib = { cleanIsbn, isValidIsbn13, isValidIsbn10, toIsbn13, norm, titleKey, authorWords, findMatch, fromGoogle, fromOpenLibrary, fromOpenLibrarySearch, sanitizeBook, mergeBooks };
  if (typeof module !== "undefined" && module.exports) module.exports = lib;
  else root.BookLib = lib;
})(this);
