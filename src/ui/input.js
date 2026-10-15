// DOM input: keyboard (+ optional gamepad) -> InputState, UI action callbacks.
import { keysToInput, actionForKey, isGameKey, gamepadToInput, mergeInputs } from './inputMap.js';

function isTextTarget(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/**
 * createInput({ target, isRaceActive, onAction })
 *   onAction(name) for 'pause' | 'camera' | 'enter' | 'help'  (not 'reset': that is an InputState edge)
 */
export function createInput({ target = window, isRaceActive = () => false, onAction = () => {} } = {}) {
  const pressed = new Set();
  let resetEdge = false;
  let override = null;

  const onKeyDown = (e) => {
    if (isTextTarget(e.target)) return;
    if (isRaceActive() && isGameKey(e.code)) e.preventDefault();
    // macOS swallows keyup for other keys while Cmd is held: never keep stale keys around
    if (e.metaKey) pressed.clear();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!e.repeat) {
      if (e.code === 'KeyR' && isRaceActive()) resetEdge = true;
      const a = actionForKey(e.code);
      if (a && a !== 'reset') onAction(a, e);
    }
    pressed.add(e.code);
  };
  const onKeyUp = (e) => { pressed.delete(e.code); };
  const clearAll = () => { pressed.clear(); };
  const onVis = () => { if (document.hidden) clearAll(); };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', onVis);

  function readPad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return gamepadToInput(p);
    } catch { /* ignore */ }
    return null;
  }

  return {
    pressed,
    /** @returns {InputState}; `reset` is true for exactly one read after R was pressed. */
    read() {
      let inp = mergeInputs(keysToInput(pressed), readPad());
      inp = { ...inp, reset: resetEdge };
      resetEdge = false;
      if (override) inp = { ...inp, ...override };
      return inp;
    },
    setOverride(partial) { override = partial ? { ...partial } : null; },
    getOverride() { return override; },
    clear() { clearAll(); resetEdge = false; },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAll);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
