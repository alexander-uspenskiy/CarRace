// Tiny synchronous event bus. Listener errors are caught and logged.
export function createEventBus() {
  const map = new Map();

  function off(name, fn) {
    const set = map.get(name);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) map.delete(name);
  }
  function on(name, fn) {
    let set = map.get(name);
    if (!set) {
      set = new Set();
      map.set(name, set);
    }
    set.add(fn);
    return () => off(name, fn);
  }
  function once(name, fn) {
    const wrapper = (payload) => {
      off(name, wrapper);
      fn(payload);
    };
    return on(name, wrapper);
  }
  function emit(name, payload) {
    const set = map.get(name);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[eventBus] listener for "${name}" threw:`, err);
      }
    }
  }
  function clear() {
    map.clear();
  }
  return { on, off, once, emit, clear };
}
