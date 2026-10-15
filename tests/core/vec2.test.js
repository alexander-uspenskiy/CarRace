import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../../src/core/vec2.js';

test('basic ops are non-mutating', () => {
  const a = V.v2(3, 4);
  const b = V.v2(1, -2);
  assert.deepEqual(V.add(a, b), { x: 4, y: 2 });
  assert.deepEqual(V.sub(a, b), { x: 2, y: 6 });
  assert.deepEqual(V.scale(a, 2), { x: 6, y: 8 });
  assert.equal(V.dot(a, b), -5);
  assert.equal(V.cross(a, b), -10);
  assert.equal(V.len(a), 5);
  assert.equal(V.len2(a), 25);
  assert.equal(V.dist(a, b), Math.hypot(2, 6));
  assert.equal(V.dist2(a, b), 40);
  assert.deepEqual(V.perp(a), { x: -4, y: 3 });
  assert.deepEqual(V.lerpV(a, b, 0.5), { x: 2, y: 1 });
  assert.deepEqual(a, { x: 3, y: 4 });
  assert.deepEqual(b, { x: 1, y: -2 });
});

test('norm and rotate', () => {
  const n = V.norm(V.v2(0, 10));
  assert.deepEqual(n, { x: 0, y: 1 });
  assert.deepEqual(V.norm(V.v2(0, 0)), { x: 0, y: 0 });
  const r = V.rotate(V.v2(1, 0), Math.PI / 2);
  assert.ok(Math.abs(r.x) < 1e-12 && Math.abs(r.y - 1) < 1e-12);
});
