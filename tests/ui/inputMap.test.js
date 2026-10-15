import test from 'node:test';
import assert from 'node:assert/strict';
import { keysToInput, neutralInput, isGameKey, actionForKey, gamepadToInput, mergeInputs } from '../../src/ui/inputMap.js';

const K = (...c) => keysToInput(new Set(c));

test('empty set is neutral', () => {
  assert.deepEqual(K(), neutralInput());
});

test('throttle/brake via arrows and WASD', () => {
  assert.equal(K('ArrowUp').throttle, 1);
  assert.equal(K('KeyW').throttle, 1);
  assert.equal(K('ArrowDown').brake, 1);
  assert.equal(K('KeyS').brake, 1);
  const both = K('ArrowUp', 'ArrowDown');
  assert.equal(both.throttle, 1); assert.equal(both.brake, 1);
});

test('steering sign: right positive, left negative, both cancel', () => {
  assert.equal(K('ArrowRight').steer, 1);
  assert.equal(K('KeyD').steer, 1);
  assert.equal(K('ArrowLeft').steer, -1);
  assert.equal(K('KeyA').steer, -1);
  assert.equal(K('ArrowLeft', 'ArrowRight').steer, 0);
  assert.equal(K('KeyA', 'KeyD').steer, 0);
  assert.equal(K('ArrowLeft', 'KeyD').steer, 0);
  assert.equal(K('ArrowLeft', 'KeyA', 'ArrowRight').steer, 0);
});

test('handbrake and boost', () => {
  assert.equal(K('Space').handbrake, true);
  assert.equal(K('ShiftLeft').boost, true);
  assert.equal(K('ShiftRight').boost, true);
  assert.equal(K('ArrowUp').boost, false);
});

test('reset is never set by keysToInput (edge handled by input.js)', () => {
  assert.equal(K('KeyR').reset, false);
});

test('multi-key combo', () => {
  const i = K('ArrowUp', 'ArrowRight', 'ShiftLeft', 'Space');
  assert.deepEqual(i, { steer: 1, throttle: 1, brake: 0, handbrake: true, boost: true, reset: false });
});

test('unrelated keys do nothing', () => {
  assert.deepEqual(K('KeyQ', 'Digit1', 'KeyC'), neutralInput());
});

test('game keys / actions', () => {
  for (const c of ['ArrowUp', 'Space', 'Tab', 'KeyW']) assert.equal(isGameKey(c), true);
  assert.equal(isGameKey('KeyQ'), false);
  assert.equal(actionForKey('Escape'), 'pause');
  assert.equal(actionForKey('KeyP'), 'pause');
  assert.equal(actionForKey('KeyC'), 'camera');
  assert.equal(actionForKey('KeyH'), 'help');
  assert.equal(actionForKey('KeyQ'), null);
});

test('gamepad mapping and merge', () => {
  const pad = { axes: [0.5, 0], buttons: Array.from({ length: 8 }, () => ({ value: 0 })) };
  pad.buttons[7] = { value: 0.8 };
  pad.buttons[0] = { value: 1, pressed: true };
  const g = gamepadToInput(pad);
  assert.ok(g.steer > 0 && g.steer < 0.5);
  assert.equal(g.throttle, 0.8);
  assert.equal(g.boost, true);
  assert.equal(gamepadToInput(null), null);
  assert.equal(gamepadToInput({ axes: [0.05], buttons: [] }).steer, 0);
  const m = mergeInputs(K('ArrowLeft'), g);
  assert.equal(m.steer, -1);
  assert.equal(m.throttle, 0.8);
  assert.deepEqual(mergeInputs(K('ArrowUp'), null), K('ArrowUp'));
});
