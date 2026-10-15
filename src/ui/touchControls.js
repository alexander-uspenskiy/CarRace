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
  const active = new Map();   // pointerId -> { btn, key }

  function hold1(btn, key) {
    hold[key] = true;
    btn.classList.add('down');
  }
  function release1(btn, key) {
    hold[key] = [...active.values()].some((a) => a !== undefined && a.key === key && a.btn !== btn);
    btn.classList.remove('down');
  }

  function holdButton(key, cls, label, sub) {
    const btn = h('button.tc-btn.' + cls, { type: 'button', 'aria-label': sub || label, tabindex: -1 }, h('span', label));
    const down = (e) => {
      e.preventDefault();
      if (active.has(e.pointerId)) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      active.set(e.pointerId, { btn, key });
      hold1(btn, key);
    };
    const up = (e) => {
      const a = active.get(e.pointerId);
      if (!a || a.btn !== btn) return;
      active.delete(e.pointerId);
      release1(btn, key);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }

  function tapButton(cls, label, fn) {
    const btn = h('button.tc-btn.' + cls, { type: 'button', 'aria-label': label, tabindex: -1 }, h('span', label));
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('down'); fn(); });
    const clear = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }

  const left = holdButton('left', 'tc-left', '◀', 'Steer left');
  const right = holdButton('right', 'tc-right', '▶', 'Steer right');
  const gas = holdButton('gas', 'tc-gas', 'GAS');
  const brake = holdButton('brake', 'tc-brake', 'BRAKE');
  const boost = holdButton('boost', 'tc-boost', 'BOOST', 'ERS boost');
  const cam = tapButton('tc-cam', 'CAM', () => onAction('camera'));
  const reset = tapButton('tc-reset', 'RESET', () => onReset());

  const el = h('div.tc.hidden',
    h('div.tc-steer', left, right),
    h('div.tc-rgroup', h('div.tc-aux', boost, cam, reset), h('div.tc-pedals', brake, gas)));
  // the controls must never scroll / zoom / select the page
  el.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  root.append(el);

  function release() {
    active.clear();
    for (const k of Object.keys(hold)) hold[k] = false;
    for (const b of el.querySelectorAll('.tc-btn.down')) b.classList.remove('down');
  }

  return {
    el,
    read() { return holdsToInput(hold); },
    setVisible(on) {
      el.classList.toggle('hidden', !on);
      if (!on) release();
    },
    release,
    dispose() { release(); el.remove(); },
  };
}
