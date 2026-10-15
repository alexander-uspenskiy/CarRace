// On-screen driving controls for touch devices. Right thumb: a floating analog steering zone (touch anywhere on the right
// side, drag left/right). Left thumb: boost, camera, reset. The stick's vertical axis is the pedal (up = gas, down = brake).
// Multi-touch safe: every finger is tracked by its own pointer, so steering and the pedals work together.
import { h } from './dom.js';

/** Pure: hold state -> InputState fields (both steer buttons cancel, like the keyboard). */
export function holdsToInput(hold) {
  return {
    steer: Math.max(-1, Math.min(1, (hold.right ? 1 : 0) - (hold.left ? 1 : 0) + (hold.axis || 0))),
    // the stick's vertical axis is an analog pedal (up = gas, down = brake); the buttons stay as full-on alternatives
    throttle: Math.max(hold.gas ? 1 : 0, hold.pedal > 0 ? hold.pedal : 0),
    brake: Math.max(hold.brake ? 1 : 0, hold.pedal < 0 ? -hold.pedal : 0),
    handbrake: false,
    boost: !!hold.boost,
    reset: false,
  };
}

/**
 * Pure: horizontal drag distance (px) -> steering in [-1, 1]. Small dead zone, then an eased curve
 * so small movements are precise and a full-radius drag is full lock.
 */
export function steerFromDrag(dx, radius) {
  const v = Math.max(-1, Math.min(1, dx / radius));
  const dead = 0.06;
  const a = Math.abs(v);
  if (a < dead) return 0;
  return Math.sign(v) * Math.pow((a - dead) / (1 - dead), 1.35);
}

/**
 * Pure: vertical drag distance (px, screen coords: up is negative) -> pedal in [-1, 1], + = gas, - = brake.
 * Needs a deliberate push (dead zone) so steering with a slightly wandering thumb never touches the pedals.
 */
export function pedalFromDrag(dy, radius) {
  const v = Math.max(-1, Math.min(1, -dy / radius));
  const dead = 0.3;
  const a = Math.abs(v);
  if (a < dead) return 0;
  return Math.sign(v) * Math.min(1, (a - dead) / (0.9 - dead));
}

/**
 * createTouchControls({ root, onAction, onReset })
 *   onAction('camera') for the camera button; onReset() for the reset button (one-shot).
 * API: el, read() -> InputState partial, setVisible(bool), release() (drop every held button), dispose().
 */
export function createTouchControls({ root, onAction = () => {}, onReset = () => {} } = {}) {
  const hold = { gas: false, brake: false, boost: false, axis: 0, pedal: 0 };
  const active = new Map();   // pointerId -> { group, key }

  // hold state is always derived from the live pointers, so two fingers on one button / a lost event can never stick or drop a key
  function sync() {
    for (const k of ['gas', 'brake', 'boost']) hold[k] = false;
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

  const boost = holdButton('tc-boost', 'BOOST', 'ERS boost');
  const cam = tapButton('tc-cam', 'CAM', () => onAction('camera'));
  const reset = tapButton('tc-reset', 'RESET', () => onReset());

  // floating analog steering: the origin is wherever the thumb lands; if the thumb runs past full lock the origin follows it
  const knob = h('div.tc-knob');
  const ring = h('div.tc-ring', knob);
  const zone = h('div.tc-zone', { 'aria-label': 'Steering: touch and drag left or right' }, ring);
  let steerPtr = null;                      // { id, ox, oy }
  const radius = () => Math.max(44, Math.min(72, window.innerWidth * 0.15));
  function drawSteer(dx, dy = 0) {
    const r = radius();
    ring.style.setProperty('--r', r * 2 + 'px');
    knob.style.transform = 'translate(' + Math.max(-r, Math.min(r, dx)) + 'px, ' + Math.max(-r, Math.min(r, dy)) + 'px)';
  }
  function endSteer() {
    steerPtr = null;
    hold.axis = 0;
    hold.pedal = 0;
    ring.classList.remove('on', 'gas', 'brk');
    drawSteer(0, 0);
  }
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (steerPtr) return;
    try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const box = zone.getBoundingClientRect();
    steerPtr = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    ring.style.left = (e.clientX - box.left) + 'px';
    ring.style.top = (e.clientY - box.top) + 'px';
    ring.classList.add('on');
    hold.axis = 0;
    hold.pedal = 0;
    drawSteer(0, 0);
    buzz();
  });
  zone.addEventListener('pointermove', (e) => {
    if (!steerPtr || e.pointerId !== steerPtr.id) return;
    const r = radius();
    let dx = e.clientX - steerPtr.ox;
    let dy = e.clientY - steerPtr.oy;
    const lim = r * 1.25;
    if (dx > lim) { steerPtr.ox = e.clientX - lim; dx = lim; }
    else if (dx < -lim) { steerPtr.ox = e.clientX + lim; dx = -lim; }
    if (dy > lim) { steerPtr.oy = e.clientY - lim; dy = lim; }
    else if (dy < -lim) { steerPtr.oy = e.clientY + lim; dy = -lim; }
    hold.axis = steerFromDrag(dx, r);
    hold.pedal = pedalFromDrag(dy, r);
    ring.classList.toggle('gas', hold.pedal > 0);
    ring.classList.toggle('brk', hold.pedal < 0);
    drawSteer(dx, dy);
  });
  const zoneEnd = (e) => { if (steerPtr && e.pointerId === steerPtr.id) endSteer(); };
  zone.addEventListener('pointerup', zoneEnd);
  zone.addEventListener('pointercancel', zoneEnd);
  zone.addEventListener('lostpointercapture', zoneEnd);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());

  const aux = h('div.tc-aux', boost, cam, reset);
  const el = h('div.tc.hidden', zone, h('div.tc-lgroup', aux));
  holdGroup(boost, [['boost', boost]]);
  // the controls must never scroll / zoom / select the page
  el.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  root.append(el);

  function release() {
    active.clear();
    sync();
    endSteer();
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
