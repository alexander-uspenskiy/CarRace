// Tiny DOM helpers + shared widgets for the UI. Browser-only (but import-safe in Node).

/** h('div.cls#id', {onclick, dataset:{}, style:{}, class:'x', text:'..'}, ...children) */
export function h(tag, props, ...children) {
  let t = tag, cls = [], id = null;
  const m = /^([a-zA-Z0-9]+)?((?:[.#][\w-]+)*)$/.exec(tag);
  if (m) {
    t = m[1] || 'div';
    const rest = m[2] || '';
    for (const part of rest.match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') cls.push(part.slice(1)); else id = part.slice(1);
    }
  }
  const svgNs = ['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline'].includes(t);
  const el = svgNs ? document.createElementNS('http://www.w3.org/2000/svg', t) : document.createElement(t);
  if (cls.length) el.setAttribute('class', cls.join(' '));
  if (id) el.id = id;
  if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props) || typeof props === 'string' || typeof props === 'number')) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') el.setAttribute('class', [...cls, v].join(' '));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function setChildren(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Write textContent only if changed. */
export function setText(el, v) {
  const s = String(v);
  if (el._t !== s) { el._t = s; el.textContent = s; }
}
export function setStyle(el, prop, v) {
  const key = '_s_' + prop;
  if (el[key] !== v) { el[key] = v; el.style[prop] = v; }
}
export function setClass(el, cls, on) {
  const key = '_c_' + cls;
  if (el[key] !== !!on) { el[key] = !!on; el.classList.toggle(cls, !!on); }
}

// ---------- formatting ----------
export const kph = (ms) => Math.round(ms * 3.6);
export const mph = (ms) => Math.round(ms * 2.23694);
export const pad2 = (n) => String(n).padStart(2, '0');
export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  sec = Math.max(0, sec);
  return `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;
}
export function fmtLap(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
export function fmtGap(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--';
  if (sec >= 60) return `+${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
  return `+${sec.toFixed(1)}`;
}
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const ordinal = (n) => {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---------- widgets ----------
export function chip(color, extra = '') {
  return h('span.chip' + (extra ? '.' + extra : ''), { style: { background: color } });
}

/** Horizontal stat bar. returns {el, set(value0..100, ghost?)}. */
export function statBar(label, value = 0) {
  const fill = h('div.bar-fill');
  const gain = h('div.bar-gain');
  const val = h('span.bar-val');
  const el = h('div.statbar', h('span.bar-label', label), h('div.bar-track', fill, gain), val);
  return {
    el,
    set(v, next = null) {
      v = Math.max(0, Math.min(100, v));
      fill.style.width = v + '%';
      val.textContent = String(Math.round(v));
      if (next !== null && Math.round(next) !== Math.round(v)) {
        const n = Math.max(0, Math.min(100, next));
        const up = n > v;
        gain.className = 'bar-gain ' + (up ? 'up' : 'down');
        gain.style.left = Math.min(v, n) + '%';
        gain.style.width = Math.abs(n - v) + '%';
        gain.style.display = 'block';
        val.textContent = `${Math.round(v)} ${up ? '▲' : '▼'}${Math.abs(Math.round(n) - Math.round(v))}`;
      } else {
        gain.style.display = 'none';
      }
    },
  };
}

export function stars(n, max = 5) {
  return h('span.stars', '★'.repeat(n), h('span.off', '★'.repeat(Math.max(0, max - n))));
}

export function button(label, onClick, cls = '') {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick: onClick }, label);
}

export function screenHeader(title, subtitle) {
  return h('header.screen-head', h('h1', title), subtitle ? h('p.sub', subtitle) : null);
}

/** Wire a screen's Esc -> .btn-back, Enter -> .btn-primary while it is shown. Returns detach(). */
export function attachMenuKeys(root, extra) {
  const fn = (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape') {
      const b = root.querySelector('.btn-back');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
      return;
    }
    if (typing) return;
    if (e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) {
      const b = root.querySelector('.screen-foot .btn-primary') || root.querySelector('.btn-primary:not(.btn-buy)');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
      return;
    }
    if (extra) extra(e);
  };
  window.addEventListener('keydown', fn);
  return () => window.removeEventListener('keydown', fn);
}

/** Static colour swatch used when WebGL previews are unavailable. */
export function swatch(team) {
  const l = team?.livery || {};
  return h('div.swatch', {
    style: { background: `linear-gradient(135deg, ${l.primary || '#444'} 0 55%, ${l.secondary || '#111'} 55% 80%, ${l.accent || '#fff'} 80%)` },
  });
}
