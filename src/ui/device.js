// Touch-device autodetect. Sets `touch` on <html> (CSS switches to the phone layout and the on-screen controls appear).
// Browser globals are only touched inside the functions (import-safe in Node).

/**
 * Pure decision. `search` is location.search; ?touch=1 / ?touch=0 force the mode (handy on a laptop and for tests).
 * A coarse primary pointer (phones, tablets, iPadOS) or a touch-only device (no hover, touch points) counts as touch.
 */
export function detectTouch({ search = '', coarse = false, hover = true, maxTouchPoints = 0 } = {}) {
  const m = /[?&]touch=([01])(?:&|$)/.exec(search);
  if (m) return m[1] === '1';
  if (coarse) return true;
  return !hover && maxTouchPoints > 0;
}

export function readTouchEnv(win = window) {
  const mq = (q) => { try { return win.matchMedia(q).matches; } catch { return false; } };
  return {
    search: (win.location && win.location.search) || '',
    coarse: mq('(pointer: coarse)'),
    hover: mq('(hover: hover)'),
    maxTouchPoints: (win.navigator && win.navigator.maxTouchPoints) || 0,
  };
}

/**
 * Installs the detection: applies the class now, and enables touch mode the first time a real finger touches the screen
 * on a device that looked like a desktop (hybrid laptops, desktop-mode browsers), unless ?touch=0 forced it off.
 * Returns { isTouch(), onChange(fn) -> unsubscribe }.
 */
export function installDeviceMode(win = window) {
  const doc = win.document;
  const listeners = new Set();
  const forced = /[?&]touch=[01](?:&|$)/.test((win.location && win.location.search) || '');
  let touch = detectTouch(readTouchEnv(win));
  const apply = () => {
    doc.documentElement.classList.toggle('touch', touch);
    for (const fn of listeners) { try { fn(touch); } catch { /* ignore */ } }
  };
  apply();
  const onFirstTouch = () => {
    if (touch || forced) return;
    touch = true;
    apply();
  };
  if (!touch && !forced) win.addEventListener('touchstart', onFirstTouch, { passive: true, once: true });
  // orientation / size changes can flip a tablet between the layouts: let CSS (media queries) deal with size, we only re-evaluate the pointer
  try {
    const mq = win.matchMedia('(pointer: coarse)');
    mq.addEventListener?.('change', () => {
      if (forced) return;
      const next = detectTouch(readTouchEnv(win));
      if (next !== touch) { touch = next || touch; apply(); }
    });
  } catch { /* ignore */ }
  return {
    isTouch: () => touch,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
