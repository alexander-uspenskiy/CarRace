// StorageAdapter = { getItem(key)->string|null, setItem(key,str), removeItem(key), isMemory }
// Nothing here touches globals at import time.
export function createMemoryStorage(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    isMemory: true,
    getItem(key) {
      return m.has(key) ? m.get(key) : null;
    },
    setItem(key, str) {
      m.set(key, String(str));
    },
    removeItem(key) {
      m.delete(key);
    },
  };
}

/** localStorage-backed adapter if usable, otherwise a memory adapter. Never throws. */
export function getDefaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__carrace_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      const adapter = {
        isMemory: false,
        /** true once any write has thrown (quota exceeded / storage disabled mid-session); cleared by the next good write */
        writeFailed: false,
        getItem(key) {
          try {
            return ls.getItem(key);
          } catch {
            return null;
          }
        },
        setItem(key, str) {
          try {
            ls.setItem(key, str);
            adapter.writeFailed = false;
          } catch {
            adapter.writeFailed = true; // quota / disabled: keep running, the UI shows a notice
          }
        },
        removeItem(key) {
          try {
            ls.removeItem(key);
          } catch {
            /* ignore */
          }
        },
      };
      return adapter;
    }
  } catch {
    /* fall through */
  }
  return createMemoryStorage();
}

/**
 * Runs a version migration chain. `steps[v]` upgrades a version-`v` object to version `v+1` (it receives a shallow copy and
 * returns the new object; the runner stamps the new `version`). Missing / invalid / negative versions count as 0.
 * Versions >= `current` are left alone (a newer save cannot be downgraded; callers sanitise field by field).
 * Returns `{ data, from, to, migrated }`. Never throws: a failing step stops the chain and `migrated` stays false for it.
 */
export function runMigrations(raw, steps, current) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { data: raw, from: 0, to: 0, migrated: false };
  const v = Number(raw.version);
  const from = Number.isInteger(v) && v >= 0 ? v : 0;
  let data = { ...raw };
  let at = from;
  while (at < current) {
    const step = steps[at];
    if (typeof step !== 'function') {
      at = current; // no explicit step: nothing to change structurally
    } else {
      try {
        const out = step({ ...data });
        data = out && typeof out === 'object' ? out : data;
      } catch {
        break;
      }
      at++;
    }
    data.version = at;
  }
  return { data, from, to: at, migrated: at !== from };
}
