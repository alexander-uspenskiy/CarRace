import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultStorage } from '../../src/core/storage.js';
import { createSaveStore } from '../../src/data/saveStore.js';

function withLocalStorage(impl, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: impl });
  try { fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
}

test('localStorage getter throwing (Safari private / blocked cookies) falls back to memory', () => {
  withLocalStorage(() => { throw new Error('SecurityError'); }, () => {
    const st = getDefaultStorage();
    assert.equal(st.isMemory, true);
    const save = createSaveStore(st);
    save.addCredits(5);
    assert.ok(save.get().credits > 0);
  });
});

test('probe write throwing (quota 0) falls back to memory', () => {
  const ls = { getItem: () => null, removeItem() {}, setItem() { throw new Error('QuotaExceededError'); } };
  withLocalStorage(() => ls, () => assert.equal(getDefaultStorage().isMemory, true));
});

test('write failing after the probe sets writeFailed and never throws; recovers on next good write', () => {
  let full = false;
  const m = new Map();
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k), setItem(k, v) { if (full) throw new Error('Quota'); m.set(k, v); } };
  withLocalStorage(() => ls, () => {
    const st = getDefaultStorage();
    assert.equal(st.isMemory, false);
    assert.equal(st.writeFailed, false);
    const save = createSaveStore(st);
    full = true;
    assert.doesNotThrow(() => save.addCredits(10));
    assert.equal(st.writeFailed, true);
    full = false;
    save.addCredits(1);
    assert.equal(st.writeFailed, false);
  });
});
