// Library persistence in IndexedDB (one object store, one record per book), on this device only.
(function (root) {
  "use strict";

  const DB_NAME = "mi-estante";
  const STORE = "books";
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const Store = {
    all: () => tx("readonly", (s) => s.getAll()),
    put: (book) => tx("readwrite", (s) => s.put(book)),
    putMany: (books) => tx("readwrite", (s) => { books.forEach((b) => s.put(b)); }),
    remove: (id) => tx("readwrite", (s) => s.delete(id)),
    // Asks the browser not to evict the library when space runs low. Safari and Chrome grant it
    // more readily once the app is installed on the home screen.
    async persist() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
      catch { return false; }
    },
  };

  root.Store = Store;
})(this);
