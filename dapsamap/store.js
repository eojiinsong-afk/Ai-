// 저장소 — 브라우저 IndexedDB. 서버 없이 이 기기 안에만 저장됩니다.
// 원칙(docs/DATA_POLICY.md와 같음): ID는 한 번 만들면 바꾸지 않고, 문서는 통째로 읽어 통째로 되쓴다.
// 그래서 이 코드가 모르는 필드도 지워지지 않는다.

const DB_NAME = 'dapsamap';
const DB_VERSION = 1;
const STORES = ['photos', 'thumbs', 'sites', 'buildings', 'shots', 'settings'];

const Store = (() => {
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    get: (store, key) => tx(store, 'readonly', s => s.get(key)),
    put: (store, key, val) => tx(store, 'readwrite', s => s.put(val, key)),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
    async all(store) {
      const db = await open();
      const s = db.transaction(store, 'readonly').objectStore(store);
      const [keys, vals] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
      return keys.map((k, i) => [k, vals[i]]);
    },
    async putMany(store, entries) {
      return tx(store, 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); });
    }
  };
})();

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
