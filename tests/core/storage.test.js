import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage, getDefaultStorage } from '../../src/core/storage.js';

test('memory storage round trip', () => {
  const s = createMemoryStorage();
  assert.equal(s.isMemory, true);
  assert.equal(s.getItem('k'), null);
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
  s.removeItem('k');
  assert.equal(s.getItem('k'), null);
});

test('getDefaultStorage falls back to memory when localStorage is unavailable', () => {
  const s = getDefaultStorage(); // Node: no localStorage
  assert.equal(s.isMemory, true);
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
});

test('getDefaultStorage wraps a working localStorage (isMemory:false) and swallows errors', () => {
  const store = new Map();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  });
  try {
    const s = getDefaultStorage();
    assert.equal(s.isMemory, false);
    s.setItem('q', 'z');
    assert.equal(store.get('q'), 'z');
    assert.equal(s.getItem('q'), 'z');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

test('getDefaultStorage survives a throwing localStorage', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied');
    },
  });
  try {
    const s = getDefaultStorage();
    assert.equal(s.isMemory, true);
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

import { runMigrations } from '../../src/core/storage.js';

test('runMigrations: chain keyed on version, missing/invalid version counts as 0', () => {
  const steps = {
    0: (o) => ({ ...o, a: 1 }),
    1: (o) => ({ ...o, b: o.a + 1 }),
    2: (o) => ({ ...o, c: o.b + 1 }),
  };
  const r = runMigrations({ x: 'keep' }, steps, 3);
  assert.deepEqual(r.data, { x: 'keep', a: 1, b: 2, c: 3, version: 3 });
  assert.deepEqual([r.from, r.to, r.migrated], [0, 3, true]);
  for (const v of [undefined, null, 'abc', -4, 1.5, NaN]) {
    assert.equal(runMigrations({ version: v }, steps, 3).from, 0);
  }
  const mid = runMigrations({ version: 2, a: 1, b: 2 }, steps, 3);
  assert.deepEqual(mid.data, { version: 3, a: 1, b: 2, c: 3 });   // only step 2 ran
  assert.equal(mid.from, 2);
});

test('runMigrations: current / future versions are left alone, non-objects pass through, never mutates or throws', () => {
  const steps = { 0: () => { throw new Error('should not run'); } };
  const cur = { version: 3, q: 1 };
  const r = runMigrations(cur, steps, 3);
  assert.equal(r.migrated, false);
  assert.deepEqual(r.data, cur);
  assert.equal(runMigrations({ version: 99 }, steps, 3).data.version, 99);
  assert.equal(runMigrations(null, steps, 3).data, null);
  assert.deepEqual(runMigrations([1], steps, 3).data, [1]);
  const orig = { n: 1 };
  const bad = runMigrations(orig, { 0: () => { throw new Error('boom'); } }, 1);   // failing step: chain stops, no throw
  assert.equal(bad.migrated, false);
  assert.deepEqual(orig, { n: 1 });
  const gap = runMigrations({ version: 0 }, {}, 2);                                // missing step = structural no-op
  assert.equal(gap.data.version, 2);
});
