// Layout helpers shared by screens: keep the shared 3D preview centred in the area NOT covered by DOM panels.
// Browser-only at call time (import-safe in Node).

const visibleRect = (el) => {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

export const isStacked = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

/**
 * Compute the free rectangle padding of the preview canvas.
 * sides: { left: El|El[], right: ..., top: ..., bottom: ... } - each side's value is the DOM element(s) that cover that side of the canvas;
 * or { within: El } to fit the 3D view inside that element's rectangle.
 */
export function computePadding(canvas, sides = {}) {
  const cv = canvas.getBoundingClientRect();
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  // `within`: the free area IS this element's rectangle (e.g. a transparent spacer reserved for the 3D view)
  const win = visibleRect(sides.within);
  if (win) { pad.left = win.left - cv.left; pad.right = cv.right - win.right; pad.top = win.top - cv.top; pad.bottom = cv.bottom - win.bottom; }
  for (const el of list(sides.left)) { const r = visibleRect(el); if (r) pad.left = Math.max(pad.left, r.right - cv.left); }
  for (const el of list(sides.right)) { const r = visibleRect(el); if (r) pad.right = Math.max(pad.right, cv.right - r.left); }
  for (const el of list(sides.top)) { const r = visibleRect(el); if (r) pad.top = Math.max(pad.top, r.bottom - cv.top); }
  for (const el of list(sides.bottom)) { const r = visibleRect(el); if (r) pad.bottom = Math.max(pad.bottom, cv.bottom - r.top); }
  // never leave less than 120 px free in either direction
  const maxX = Math.max(0, cv.width - 120), maxY = Math.max(0, cv.height - 120);
  if (pad.left + pad.right > maxX) { const k = maxX / (pad.left + pad.right); pad.left *= k; pad.right *= k; }
  if (pad.top + pad.bottom > maxY) { const k = maxY / (pad.top + pad.bottom); pad.top *= k; pad.bottom *= k; }
  for (const k of Object.keys(pad)) pad[k] = Math.max(0, Math.round(pad[k]));
  return pad;
}

/**
 * Binds preview padding to a screen: call `bind()` in show(), `unbind()` in hide().
 * getSides() is evaluated on every layout pass so it may depend on the current breakpoint.
 */
export function createPreviewPadding(game, getSides) {
  let onResize = null, raf = 0, timer = 0;
  const apply = () => {
    const pv = game.preview, cv = game.host?.canvas;
    if (!pv || !cv || typeof pv.setPadding !== 'function') return;
    try {
      pv.setPadding(computePadding(cv, getSides()));
    } catch (e) { console.error('[layout] setPadding', e); }
  };
  return {
    apply,
    bind() {
      this.unbind();
      onResize = () => apply();
      window.addEventListener('resize', onResize);
      apply();
      // layout settles after the screen becomes visible (and after fonts/animations)
      raf = requestAnimationFrame(apply);
      timer = setTimeout(apply, 320);
    },
    unbind() {
      if (onResize) window.removeEventListener('resize', onResize);
      onResize = null;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      try { game.preview?.setPadding?.(null); } catch { /* ignore */ }
    },
  };
}

/** Debounce helper; returns fn with .flush() and .cancel(). */
export function debounce(fn, ms) {
  let t = null, lastArgs = null;
  const d = (...args) => { lastArgs = args; clearTimeout(t); t = setTimeout(() => { t = null; fn(...lastArgs); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = null; fn(...lastArgs); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}
