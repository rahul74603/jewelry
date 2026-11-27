/**
 * Tiny key/value store abstraction (localStorage-backed, with an
 * in-memory twin for tests).
 *
 * This used to live in src/lib/cloudBackup.ts next to the Google
 * Drive backup feature. Drive backup was REMOVED in v1.0.52 (Ajay:
 * only our own automatic cloud backup stays) — the Drive folder
 * pick/upload/download/disconnect code is gone, and so is the
 * DriveFolder native plugin's only caller. What remains is just
 * this store: auto-backup and auto-SMS keep small bits of state
 * in it (their own keys), and tests inject the in-memory twin.
 * Nothing here touches any cloud, Drive or network.
 */
export interface KvStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localKvStore: KvStore = {
  get(key) {
    try {
      return typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: state just won't persist.
    }
  },
  remove(key) {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

/** In-memory store for tests. */
export function memoryKvStore(): {
  store: KvStore;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      get: (k) => map.get(k) ?? null,
      set: (k, v) => void map.set(k, v),
      remove: (k) => void map.delete(k),
    },
  };
}
