import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, lerp, invLerp, smoothstep, wrap, wrapAngle, angleDiff, mulberry32, gaussian, sign } from '../../src/core/mathUtil.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);

test('clamp / lerp / invLerp / sign', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(invLerp(10, 20, 15), 0.5);
  assert.equal(invLerp(5, 5, 7), 0);
  assert.equal(sign(-3), -1);
  assert.equal(sign(0), 0);
  assert.equal(sign(9), 1);
});

test('smoothstep clamps and is monotone', () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.ok(smoothstep(0, 1, 0.3) < smoothstep(0, 1, 0.6));
});

test('wrap into [lo,hi)', () => {
  assert.equal(wrap(5, 0, 3), 2);
  assert.equal(wrap(-1, 0, 3), 2);
  assert.equal(wrap(3, 0, 3), 0);
  assert.equal(wrap(0.5, 0, 3), 0.5);
});

test('wrapAngle gives (-PI, PI]', () => {
  near(wrapAngle(0), 0);
  near(wrapAngle(3 * Math.PI), Math.PI);
  near(wrapAngle(-Math.PI), Math.PI);
  near(wrapAngle(Math.PI), Math.PI);
  near(wrapAngle(1.5 * Math.PI), -0.5 * Math.PI);
  near(wrapAngle(-7), -7 + 2 * Math.PI);
  for (let a = -20; a < 20; a += 0.37) {
    const w = wrapAngle(a);
    assert.ok(w > -Math.PI && w <= Math.PI);
    near(Math.cos(w), Math.cos(a));
    near(Math.sin(w), Math.sin(a));
  }
});

test('angleDiff takes the short way', () => {
  near(angleDiff(0.1, -0.1), 0.2);
  near(angleDiff(Math.PI - 0.1, -Math.PI + 0.1), -0.2);
  near(angleDiff(-Math.PI + 0.1, Math.PI - 0.1), 0.2);
});

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const xa = Array.from({ length: 50 }, a);
  const xb = Array.from({ length: 50 }, b);
  const xc = Array.from({ length: 50 }, c);
  assert.deepEqual(xa, xb);
  assert.notDeepEqual(xa, xc);
  assert.ok(xa.every((v) => v >= 0 && v < 1));
});

test('gaussian has ~N(0,1) moments', () => {
  const rng = mulberry32(7);
  const n = 20000;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const g = gaussian(rng);
    s += g;
    s2 += g * g;
  }
  assert.ok(Math.abs(s / n) < 0.03);
  assert.ok(Math.abs(s2 / n - 1) < 0.05);
});
