/* ===========================================================
   DB — thin IndexedDB wrapper.
   One object store, "books", keyed by id (uuid).
   Each record: {
     id, title, author, format ('epub'|'pdf'),
     fileBlob, coverBlob,
     addedAt, lastOpenedAt,
     progress: {
       // epub:
       cfi, percent,
       // pdf:
       page, totalPages,
       // pdf reader locations cache (epub.js locations JSON, epub only)
     },
     locations,          // epub.js locations.save() JSON string, cached
     settings: { fit, spread, direction }  // per-book pdf display prefs
   }
   =========================================================== */
const DB = (() => {
  const DB_NAME = 'stacksDB';
  const DB_VERSION = 1;
  const STORE = 'books';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('addedAt', 'addedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    const t = db.transaction(STORE, mode);
    return { t, store: t.objectStore(STORE) };
  }

  return {
    async add(book) {
      const { t, store } = await tx('readwrite');
      store.add(book);
      return new Promise((res, rej) => { t.oncomplete = () => res(book); t.onerror = () => rej(t.error); });
    },
    async getAll() {
      const { t, store } = await tx('readonly');
      return new Promise((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)));
        req.onerror = () => rej(req.error);
      });
    },
    async get(id) {
      const { t, store } = await tx('readonly');
      return new Promise((res, rej) => {
        const req = store.get(id);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    },
    async update(id, patch) {
      const { t, store } = await tx('readwrite');
      const getReq = store.get(id);
      return new Promise((res, rej) => {
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) return rej(new Error('not found'));
          const updated = Object.assign({}, existing, patch);
          store.put(updated);
          t.oncomplete = () => res(updated);
        };
        getReq.onerror = () => rej(getReq.error);
      });
    },
    async delete(id) {
      const { t, store } = await tx('readwrite');
      store.delete(id);
      return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
    uuid() {
      return (crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        }));
    }
  };
})();
