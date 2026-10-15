// Weather: per-race conditions (sky, light, fog, rain, wet-track grip). Pure data + helpers, no three / DOM.
import { mulberry32, clamp } from '../core/mathUtil.js';

/**
 * grip      multiplier on every car's tyre grip (wet asphalt); the AI adapts through car.tyreGrip
 * cover     cloud cover 0..1 (sky shader)
 * rain      rain intensity 0..1 (0 = none)
 * grey      0..1 how far sky / fog colours are pulled towards a flat grey
 * dark      0..1 how much the scene brightens down (overcast light)
 * sun       multiplier on the direct sun light, hemi on the ambient light
 * fogNear / fogFar  linear fog range in metres (scaled for the quality setting by the caller)
 * wet       0..1 how dark / damp the asphalt and grass look
 */
export const WEATHER = {
  clear: {
    id: 'clear', label: 'SUNNY', grip: 1, cover: 0.22, rain: 0, grey: 0, dark: 0, sun: 1, hemi: 1, fogNear: 200, fogFar: 1100, wet: 0,
  },
  partly: {
    id: 'partly', label: 'PARTLY CLOUDY', grip: 1, cover: 0.5, rain: 0, grey: 0.12, dark: 0.04, sun: 0.85, hemi: 1, fogNear: 180, fogFar: 1050, wet: 0,
  },
  overcast: {
    id: 'overcast', label: 'OVERCAST', grip: 1, cover: 0.85, rain: 0, grey: 0.45, dark: 0.16, sun: 0.35, hemi: 0.95, fogNear: 150, fogFar: 950, wet: 0,
  },
  fog: {
    id: 'fog', label: 'MIST', grip: 0.985, cover: 0.7, rain: 0, grey: 0.6, dark: 0.1, sun: 0.3, hemi: 1.05, fogNear: 12, fogFar: 300, wet: 0.35,
  },
  drizzle: {
    id: 'drizzle', label: 'LIGHT RAIN', grip: 0.92, cover: 0.95, rain: 0.55, grey: 0.6, dark: 0.26, sun: 0.18, hemi: 0.9, fogNear: 70, fogFar: 650, wet: 1,
  },
};

export const WEATHER_IDS = Object.keys(WEATHER);

// relative odds per circuit (mountain track: gloomier, coast: mostly sunny)
const ODDS = {
  'monte-veloce': { clear: 4, partly: 3, overcast: 2, fog: 1, drizzle: 1.5 },
  ridgeback: { clear: 2, partly: 2, overcast: 3, fog: 2, drizzle: 2 },
  'costa-marina': { clear: 5, partly: 3, overcast: 1, fog: 0.5, drizzle: 1 },
};
const DEFAULT_ODDS = { clear: 4, partly: 3, overcast: 2, fog: 1, drizzle: 1 };

/** Deterministic weather for a race seed (a restart with a new seed rolls again; the game pins it for restarts). */
export function pickWeather(seed, trackId) {
  const odds = ODDS[trackId] || DEFAULT_ODDS;
  const rng = mulberry32(((seed | 0) ^ 0x7e47) >>> 0);
  rng();
  let total = 0;
  for (const id of WEATHER_IDS) total += odds[id] || 0;
  let x = rng() * total;
  for (const id of WEATHER_IDS) {
    x -= odds[id] || 0;
    if (x < 0) return id;
  }
  return 'clear';
}

export function getWeather(id) {
  return WEATHER[id] || WEATHER.clear;
}

/** Multiplier applied to a car's tyre grip. 1 for an unknown / missing weather. */
export function weatherGrip(id) {
  return (WEATHER[id] || WEATHER.clear).grip;
}

function parseHex(h) {
  const s = String(h || '#000000').replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s.padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mixHex(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}
const scaleHex = (a, k) => toHex(parseHex(a).map((v) => v * k));

/**
 * Track theme adjusted for the weather: greyer sky and fog, darker (damp) asphalt and grass. Returns a new theme object
 * with a `weather` entry the renderer reads (cover, rain, light multipliers, fog range).
 */
export function themeForWeather(theme, weatherId) {
  const w = getWeather(weatherId);
  const t = theme || {};
  const skyTop = (t.sky && t.sky[0]) || '#5aa7ff';
  const skyHor = (t.sky && t.sky[1]) || '#cfe8ff';
  const fog = t.fog || '#cfe3f5';
  const greyTop = '#8b95a1', greyHor = '#c3c9d0', greyFog = '#bcc3ca';
  const dim = 1 - w.dark;
  return {
    ...t,
    sky: [scaleHex(mixHex(skyTop, greyTop, w.grey), dim), scaleHex(mixHex(skyHor, greyHor, w.grey), 1 - w.dark * 0.6)],
    fog: scaleHex(mixHex(fog, greyFog, w.grey), 1 - w.dark * 0.6),
    grass: scaleHex(t.grass || '#3f7d2e', 1 - 0.18 * w.wet - 0.5 * w.dark * 0.3),
    asphalt: scaleHex(t.asphalt || '#3a3b3f', 1 - 0.32 * w.wet),
    weather: { ...w },
  };
}
