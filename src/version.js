// Release number shown at the top of the screen. The build id is the ?v= stamp on the main script tag (set by tools/bump.sh).
export const VERSION = '1.3.0';

export function buildId(doc = typeof document !== 'undefined' ? document : null) {
  try {
    const el = doc && doc.querySelector('script[type="module"][src*="main.js"]');
    const m = el && /[?&]v=([0-9a-f]+)/.exec(el.getAttribute('src') || '');
    return m ? m[1] : '';
  } catch { return ''; }
}

export function showVersion(doc = document) {
  const el = doc.createElement('div');
  el.className = 'app-version';
  el.textContent = 'v' + VERSION + (buildId(doc) ? ' · ' + buildId(doc) : '');
  doc.body.append(el);
  return el;
}
