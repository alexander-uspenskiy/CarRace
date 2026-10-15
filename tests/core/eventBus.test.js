import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../../src/core/eventBus.js';

test('on/emit/unsubscribe/off', () => {
  const bus = createEventBus();
  const got = [];
  const un = bus.on('a', (p) => got.push(p));
  bus.emit('a', 1);
  un();
  bus.emit('a', 2);
  const f = (p) => got.push('f' + p);
  bus.on('a', f);
  bus.emit('a', 3);
  bus.off('a', f);
  bus.emit('a', 4);
  assert.deepEqual(got, [1, 'f3']);
});

test('once fires one time; clear removes all', () => {
  const bus = createEventBus();
  let n = 0;
  bus.once('x', () => n++);
  bus.emit('x');
  bus.emit('x');
  assert.equal(n, 1);
  bus.on('y', () => n++);
  bus.clear();
  bus.emit('y');
  assert.equal(n, 1);
});

test('listener errors are caught and do not stop other listeners', () => {
  const bus = createEventBus();
  const orig = console.error;
  let logged = 0;
  console.error = () => logged++;
  try {
    let ok = false;
    bus.on('e', () => {
      throw new Error('boom');
    });
    bus.on('e', () => {
      ok = true;
    });
    bus.emit('e', {});
    assert.ok(ok);
    assert.equal(logged, 1);
  } finally {
    console.error = orig;
  }
});

test('listeners may unsubscribe during emit (snapshot iteration)', () => {
  const bus = createEventBus();
  const calls = [];
  const a = () => {
    calls.push('a');
    bus.off('z', b);
  };
  const b = () => calls.push('b');
  bus.on('z', a);
  bus.on('z', b);
  bus.emit('z');
  bus.emit('z');
  assert.deepEqual(calls, ['a', 'b', 'a']);
});
