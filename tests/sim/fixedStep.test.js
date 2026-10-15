import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAccumulator, MAX_STEPS_PER_FRAME } from '../../src/sim/fixedStep.js';

function run(hz, frameHz, seconds) {
  let acc = 0, total = 0;
  const frames = Math.round(frameHz * seconds);
  for (let i = 0; i < frames; i++) {
    const r = advanceAccumulator(acc, 1 / frameHz, hz);
    acc = r.acc; total += r.steps;
  }
  return total;
}

test('no drift at common refresh rates', () => {
  for (const f of [30, 50, 60, 75, 90, 120, 144, 165, 240]) {
    assert.equal(run(120, f, 20), 2400, `${f} Hz`);
    assert.equal(run(120, f, 600), 72000, `${f} Hz long`);
  }
});

test('remainder is carried and in [0,1)', () => {
  const r = advanceAccumulator(0, 1.5 / 120, 120);
  assert.equal(r.steps, 1);
  assert.ok(Math.abs(r.acc - 0.5) < 1e-9);
});

test('clamps steps per frame and keeps remainder sane', () => {
  const r = advanceAccumulator(0.3, 5, 120);
  assert.equal(r.steps, MAX_STEPS_PER_FRAME);
  assert.ok(r.acc >= 0 && r.acc < 1);
});

test('bad input is ignored', () => {
  for (const dt of [-1, NaN, Infinity, undefined]) {
    const r = advanceAccumulator(0.5, dt, 120);
    assert.equal(r.steps, 0);
  }
  assert.deepEqual(advanceAccumulator(NaN, 0, 120), { steps: 0, acc: 0 });
});
