// Pure keyboard/gamepad -> InputState mapping (no DOM). See ARCHITECTURE.md §7.3.

const has = (set, ...codes) => codes.some((c) => set.has(c));

export function neutralInput() {
  return { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false };
}

/** @param {Set<string>} pressed KeyboardEvent.code values */
export function keysToInput(pressed) {
  const right = has(pressed, 'ArrowRight', 'KeyD') ? 1 : 0;
  const left = has(pressed, 'ArrowLeft', 'KeyA') ? 1 : 0;
  return {
    steer: right - left, // both pressed cancel
    throttle: has(pressed, 'ArrowUp', 'KeyW') ? 1 : 0,
    brake: has(pressed, 'ArrowDown', 'KeyS') ? 1 : 0,
    handbrake: pressed.has('Space'),
    boost: has(pressed, 'ShiftLeft', 'ShiftRight'),
    reset: false,
  };
}

/** Key codes that drive the car (used to decide preventDefault while racing). */
export const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
]);

/** UI action key bindings (not part of InputState). */
export const ACTION_KEYS = {
  Escape: 'pause',
  KeyP: 'pause',
  KeyC: 'camera',
  Enter: 'enter',
  KeyH: 'help',
  KeyR: 'reset',
};

export function actionForKey(code) {
  return ACTION_KEYS[code] || null;
}

export function isGameKey(code) {
  return GAME_KEYS.has(code);
}

const dead = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

/** Standard-mapping gamepad (axes[0] steer, RT=7 throttle, LT=6 brake, A=0 boost, X=2 handbrake). */
export function gamepadToInput(pad) {
  if (!pad) return null;
  const btn = (i) => {
    const b = pad.buttons && pad.buttons[i];
    return b ? (typeof b === 'number' ? b : b.value ?? (b.pressed ? 1 : 0)) : 0;
  };
  return {
    steer: Math.max(-1, Math.min(1, dead((pad.axes && pad.axes[0]) || 0))),
    throttle: Math.max(0, Math.min(1, btn(7))),
    brake: Math.max(0, Math.min(1, btn(6))),
    handbrake: btn(2) > 0.5,
    boost: btn(0) > 0.5,
    reset: false,
  };
}

/** Combine keyboard + gamepad: strongest analog magnitude wins, booleans OR. */
export function mergeInputs(a, b) {
  if (!b) return a;
  const pick = (x, y) => (Math.abs(y) > Math.abs(x) ? y : x);
  return {
    steer: pick(a.steer, b.steer),
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    handbrake: a.handbrake || b.handbrake,
    boost: a.boost || b.boost,
    reset: a.reset || b.reset,
  };
}
