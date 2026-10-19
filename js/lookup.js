// Book data from the internet: Open Library first (free, no key), Google Books as a fallback.
(function (root) {
  "use strict";
  const L = root.BookLib;

  async function getJson(url, ms = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function openLibraryIsbn(isbn) {
    const d = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    return L.fromOpenLibrary(d[`ISBN:${isbn}`], isbn);
  }

  async function googleIsbn(isbn) {
    const d = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const v = d.items && d.items[0] && d.items[0].volumeInfo;
    const b = L.fromGoogle(v);
    if (b) b.isbn = isbn;
    return b;
  }

  // Resolves {book} (null when no service knows the ISBN); rejects when no service answered (offline).
  async function byIsbn(isbn) {
    const tries = [openLibraryIsbn, googleIsbn];
    let lastErr = null;
    let book = null;
    let answered = false;
    for (const t of tries) {
      try {
        const b = await t(isbn);
        answered = true;
        if (b) {
          book = book ? { ...b, ...Object.fromEntries(Object.entries(book).filter(([, v]) => v)) } : b;
          if (book.cover) break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (book && !book.cover) book.cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    if (!book && !answered) throw lastErr;
    return { book };
  }

  async function search(q) {
    const enc = encodeURIComponent(q);
    let results = [];
    try {
      const d = await getJson(`https://openlibrary.org/search.json?q=${enc}&limit=12&fields=title,subtitle,author_name,first_publish_year,isbn,cover_i,publisher,number_of_pages_median`);
      results = (d.docs || []).map(L.fromOpenLibrarySearch).filter(Boolean);
    } catch (e) {
      if (!navigator.onLine) throw e;
    }
    if (results.length < 3) {
      try {
        const d = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=10`);
        results = results.concat((d.items || []).map((i) => L.fromGoogle(i.volumeInfo)).filter(Boolean));
      } catch { /* Google's keyless quota is often exhausted; Open Library results are enough */ }
    }
    return results;
  }

  root.Lookup = { byIsbn, search };
})(this);
