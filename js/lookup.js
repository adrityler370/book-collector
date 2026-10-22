// Book data from the internet, all free and without keys: Open Library by ISBN, and Open Library plus
// Apple Books by title. (Google Books needs an API key, which this app deliberately does not use.)
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

  // Resolves {book} (null when Open Library does not know the ISBN); rejects when it could not be asked (offline).
  async function byIsbn(isbn) {
    const d = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const book = L.fromOpenLibrary(d[`ISBN:${isbn}`], isbn);
    if (book && !book.cover) book.cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    return { book };
  }

  async function openLibrarySearch(q) {
    const d = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=title,subtitle,author_name,first_publish_year,cover_i,publisher,number_of_pages_median`);
    return (d.docs || []).map(L.fromOpenLibrarySearch).filter(Boolean);
  }

  // Apple Books' Spanish store: good for recent books and covers (ebook editions only).
  async function appleSearch(q) {
    const d = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=ebook&entity=ebook&country=es&limit=12`);
    return (d.results || []).map(L.fromApple).filter(Boolean);
  }

  // Title or author search in both sources at once. Rejects only when neither answered (offline).
  async function search(q) {
    const [apple, ol] = await Promise.allSettled([appleSearch(q), openLibrarySearch(q)]);
    if (apple.status === "rejected" && ol.status === "rejected") throw ol.reason;
    return L.mergeResults([apple.value || [], ol.value || []]);
  }

  root.Lookup = { byIsbn, search };
})(this);
