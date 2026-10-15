// On-screen driving controls for touch devices: steer left/right, gas, brake, boost, camera, reset.
// Multi-touch safe: each button tracks its own pointer, so steering and the pedals can be held together.
import { h } from './dom.js';

/** Pure: hold state -> InputState fields (both steer buttons cancel, like the keyboard). */
export function holdsToInput(hold) {
  return {
    steer: (hold.right ? 1 : 0) - (hold.left ? 1 : 0),
    throttle: hold.gas ? 1 : 0,
    brake: hold.brake ? 1 : 0,
    handbrake: false,
    boost: !!hold.boost,
    reset: false,
  };
}

/**
 * createTouchControls({ root, onAction, onReset })
 *   onAction('camera') for the camera button; onReset() for the reset button (one-shot).
 * API: el, read() -> InputState partial, setVisible(bool), release() (drop every held button), dispose().
 */
export function createTouchControls({ root, onAction = () => {}, onReset = () => {} } = {}) {
  const hold = { left: false, right: false, gas: false, brake: false, boost: false };
  const active = new Map();   // pointerId -> { group, key }

  // hold state is always derived from the live pointers, so two fingers on one button / a lost event can never stick or drop a key
  function sync() {
    for (const k of Object.keys(hold)) hold[k] = false;
    for (const a of active.values()) if (a.key) hold[a.key] = true;
    for (const g of groups) for (const [key, btn] of g.buttons) btn.classList.toggle('down', hold[key]);
  }
  function buzz() { try { navigator.vibrate?.(8); } catch { /* ignore */ } }

  const groups = [];
  /**
   * A cluster of hold buttons driven as one touch surface: a finger can slide from LEFT to RIGHT (or BRAKE to GAS)
   * without lifting, and a finger that slides off the edge keeps its last button only while inside the cluster's reach.
   */
  function holdGroup(container, buttons) {
    const map = new Map(buttons);
    const group = { buttons: map };
    groups.push(group);
    const pick = (e) => {
      let best = null; let bd = Infinity;
      for (const [key, btn] of map) {
        const r = btn.getBoundingClientRect();
        const c = e.clientX - (r.left + r.width / 2);
        const inside = e.clientX >= r.left - 14 && e.clientX <= r.right + 14 && e.clientY >= r.top - 24 && e.clientY <= r.bottom + 24;
        const d = Math.abs(c);
        if (inside && d < bd) { bd = d; best = key; }
      }
      return best;
    };
    const move = (e, isDown) => {
      const key = pick(e);
      const prev = active.get(e.pointerId);
      if (!prev && !key) return;
      if (!prev || prev.key !== key) { if (key) buzz(); active.set(e.pointerId, { group, key }); sync(); }
      else if (isDown) sync();
    };
    const end = (e) => {
      const a = active.get(e.pointerId);
      if (!a || a.group !== group) return;
      active.delete(e.pointerId);
      sync();
    };
    container.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (active.has(e.pointerId)) return;
      try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      move(e, true);
    });
    container.addEventListener('pointermove', (e) => { if (active.get(e.pointerId)?.group === group) move(e, false); });
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    container.addEventListener('lostpointercapture', end);
    container.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function holdButton(cls, label, sub) {
    return h('button.tc-btn.' + cls, { type: 'button', 'aria-label': sub || label, tabindex: -1 }, h('span', label));
  }

  function tapButton(cls, label, fn) {
    const btn = h('button.tc-btn.' + cls, { type: 'button', 'aria-label': label, tabindex: -1 }, h('span', label));
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('down'); buzz(); fn(); });
    const clear = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }

  const left = holdButton('tc-left', '◀', 'Steer left');
  const right = holdButton('tc-right', '▶', 'Steer right');
  const gas = holdButton('tc-gas', 'GAS');
  const brake = holdButton('tc-brake', 'BRAKE');
  const boost = holdButton('tc-boost', 'BOOST', 'ERS boost');
  const cam = tapButton('tc-cam', 'CAM', () => onAction('camera'));
  const reset = tapButton('tc-reset', 'RESET', () => onReset());

  const steer = h('div.tc-steer', left, right);
  const pedals = h('div.tc-pedals', brake, gas);
  const aux = h('div.tc-aux', boost, cam, reset);
  const el = h('div.tc.hidden', steer, h('div.tc-rgroup', aux, pedals));
  holdGroup(steer, [['left', left], ['right', right]]);
  holdGroup(pedals, [['brake', brake], ['gas', gas]]);
  holdGroup(boost, [['boost', boost]]);
  // the controls must never scroll / zoom / select the page
  el.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  root.append(el);

  function release() {
    active.clear();
    sync();
  }
  // a finger can vanish without events (app switch, rotation, system gesture): never leave a pedal stuck
  const onLost = () => release();
  window.addEventListener('blur', onLost);
  window.addEventListener('orientationchange', onLost);
  document.addEventListener('visibilitychange', onLost);

  return {
    el,
    read() { return holdsToInput(hold); },
    setVisible(on) {
      el.classList.toggle('hidden', !on);
      if (!on) release();
    },
    release,
    dispose() {
      release(); el.remove();
      window.removeEventListener('blur', onLost);
      window.removeEventListener('orientationchange', onLost);
      document.removeEventListener('visibilitychange', onLost);
    },
  };
}
