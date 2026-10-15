import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTouch } from '../../src/ui/device.js';
import { holdsToInput, steerFromDrag, pedalFromDrag } from '../../src/ui/touchControls.js';

test('detectTouch: coarse pointer or touch-only hardware means touch; a desktop does not', () => {
  assert.equal(detectTouch({}), false);
  assert.equal(detectTouch({ coarse: true }), true);                               // phone / tablet
  assert.equal(detectTouch({ coarse: false, hover: false, maxTouchPoints: 5 }), true);
  assert.equal(detectTouch({ coarse: false, hover: true, maxTouchPoints: 10 }), false);   // touch laptop with a mouse
  assert.equal(detectTouch({ coarse: false, hover: false, maxTouchPoints: 0 }), false);
});

test('detectTouch: ?touch=1 / ?touch=0 override the hardware', () => {
  assert.equal(detectTouch({ search: '?touch=1' }), true);
  assert.equal(detectTouch({ search: '?debug=1&touch=1' }), true);
  assert.equal(detectTouch({ search: '?touch=0', coarse: true }), false);
  assert.equal(detectTouch({ search: '?touchy=1' }), false);
});

test('touch holds -> InputState: steer buttons cancel, pedals are digital, reset is never held', () => {
  assert.deepEqual(holdsToInput({}), { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false });
  assert.equal(holdsToInput({ left: true }).steer, -1);
  assert.equal(holdsToInput({ right: true }).steer, 1);
  assert.equal(holdsToInput({ left: true, right: true }).steer, 0);
  const full = holdsToInput({ gas: true, brake: true, boost: true });
  assert.deepEqual([full.throttle, full.brake, full.boost, full.reset], [1, 1, true, false]);
});

test('steerFromDrag: dead zone, eased curve, clamped to full lock', () => {
  assert.equal(steerFromDrag(0, 60), 0);
  assert.equal(steerFromDrag(2, 60), 0);
  assert.equal(steerFromDrag(60, 60), 1);
  assert.equal(steerFromDrag(500, 60), 1);
  assert.equal(steerFromDrag(-500, 60), -1);
  const half = steerFromDrag(30, 60);
  assert.ok(half > 0 && half < 0.5);
  assert.equal(steerFromDrag(-30, 60), -half);
});

test('pedalFromDrag: up = gas, down = brake, with a dead zone', () => {
  assert.equal(pedalFromDrag(0, 60), 0);
  assert.equal(pedalFromDrag(-10, 60), 0);
  assert.equal(pedalFromDrag(-60, 60), 1);
  assert.equal(pedalFromDrag(60, 60), -1);
  assert.ok(pedalFromDrag(-35, 60) > 0 && pedalFromDrag(-35, 60) < 1);
  assert.equal(holdsToInput({ pedal: 0.5 }).throttle, 0.5);
  assert.equal(holdsToInput({ pedal: -0.5 }).brake, 0.5);
  assert.equal(holdsToInput({ pedal: -1, gas: true }).throttle, 1);
});
