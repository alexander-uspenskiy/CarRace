// Player-name sanitising and loose number coercion shared by the save store and hall of fame.
export const MAX_NAME_LENGTH = 16;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
let segmenter;
function getSegmenter() {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    } catch {
      segmenter = null;
    }
  }
  return segmenter;
}

/** Splits into user-perceived characters (emoji / ZWJ sequences / combining marks stay whole). Falls back to code points. */
export function graphemes(str) {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(str), (s) => s.segment);
  return Array.from(str);
}

/** First `max` user-perceived characters of `str` (never splits a surrogate pair or emoji sequence). */
export function truncateGraphemes(str, max) {
  const parts = graphemes(str);
  return parts.length <= max ? str : parts.slice(0, max).join('');
}

export function sanitizeName(name) {
  if (typeof name !== 'string') return 'PLAYER';
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(LONE_SURROGATE, '').trim();
  const n = truncateGraphemes(clean, MAX_NAME_LENGTH).trim();
  return n || 'PLAYER';
}

/** Finite number from a number or a numeric string ("4321", " 12.5 "); anything else -> `def`. */
export function coerceNum(v, def) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return def;
    const n = Number(t);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}
