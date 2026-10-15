// Canvas-generated textures. Every factory returns null when no DOM is available (Node tests).
import * as THREE from 'three';
import { mulberry32 } from './geomUtil.js';

export function canvasAvailable() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function finish(canvas, { repeat = true, repeatX = true, nearest = false, aniso = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = repeat && repeatX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (nearest) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
  }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString(THREE.SRGBColorSpace);
}
/** draw a rect that wraps around canvas edges so the tile is seamless */
function wrapRect(ctx, W, H, x, y, w, h) {
  for (const ox of [-W, 0, W]) {
    for (const oy of [-H, 0, H]) {
      const xx = x + ox;
      const yy = y + oy;
      if (xx + w < 0 || yy + h < 0 || xx > W || yy > H) continue;
      ctx.fillRect(xx, yy, w, h);
    }
  }
}

/**
 * Asphalt cross-section texture. U spans the full asphalt width (clamped), V tiles along the track.
 * Paints edge lines and two darker rubbered-in racing-line bands. Colour is baked (use white vertex colours).
 */
export function createAsphaltTexture({ halfWidth = 7.5, color = '#3a3b3f', size = 512, seed = 7 } = {}) {
  if (!canvasAvailable()) return null;
  const W = size;
  const H = size;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed);
  const base = new THREE.Color(color).multiplyScalar(1.35);
  ctx.fillStyle = '#' + base.getHexString(THREE.SRGBColorSpace);
  ctx.fillRect(0, 0, W, H);
  // aggregate noise
  for (let i = 0; i < 14000; i++) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.07})` : `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
    const s = 1 + Math.floor(rnd() * 2.5);
    wrapRect(ctx, W, H, rnd() * W, rnd() * H, s, s);
  }
  // rubber bands (racing lines) – constant along V
  const band = (u, w, a) => {
    const g = ctx.createLinearGradient((u - w) * W, 0, (u + w) * W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect((u - w) * W, 0, 2 * w * W, H);
  };
  band(0.34, 0.1, 0.22);
  band(0.66, 0.1, 0.22);
  band(0.5, 0.06, 0.1);
  // edge lines: 0.45 m from edge, 0.22 m wide
  const full = halfWidth * 2;
  const lw = Math.max(2, (0.22 / full) * W);
  const off = (0.45 / full) * W;
  ctx.fillStyle = 'rgba(238,238,238,0.96)';
  ctx.fillRect(off, 0, lw, H);
  ctx.fillRect(W - off - lw, 0, lw, H);
  // slight wear on lines
  for (let i = 0; i < 250; i++) {
    ctx.fillStyle = `rgba(40,40,44,${0.15 + rnd() * 0.25})`;
    const y = rnd() * H;
    ctx.fillRect(off, y, lw, 1 + rnd() * 3);
    ctx.fillRect(W - off - lw, y, lw, 1 + rnd() * 3);
  }
  return finish(cv, { repeatX: false });
}

export function createGrassTexture({ color = '#3f7d2e', size = 256, seed = 11 } = {}) {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed);
  const base = new THREE.Color(color);
  ctx.fillStyle = '#' + base.getHexString(THREE.SRGBColorSpace);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const f = 0.78 + rnd() * 0.5;
    ctx.fillStyle = shade(color, f);
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    wrapRect(ctx, size, size, rnd() * size, rnd() * size, 1 + rnd() * 1.5, 2 + rnd() * 4);
  }
  ctx.globalAlpha = 1;
  return finish(cv);
}

export function createCheckerTexture() {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(64, 64);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  return finish(cv, { nearest: true, aniso: 4 });
}

export function createWaterTexture({ size = 256, seed = 5 } = {}) {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#1d6fa5');
  g.addColorStop(1, '#2a86b8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.12})`;
    wrapRect(ctx, size, size, rnd() * size, rnd() * size, 4 + rnd() * 18, 1 + rnd() * 1.5);
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,30,70,${0.05 + rnd() * 0.1})`;
    wrapRect(ctx, size, size, rnd() * size, rnd() * size, 4 + rnd() * 14, 1 + rnd() * 2);
  }
  return finish(cv);
}

/** Facade with a window grid (tinted per instance via instanceColor). */
export function createWindowTexture({ seed = 3 } = {}) {
  if (!canvasAvailable()) return null;
  const W = 128;
  const H = 256;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const cols = 5;
  const rows = 10;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 8 + c * ((W - 16) / cols);
      const y = 10 + r * ((H - 24) / rows);
      const lit = rnd() > 0.82;
      ctx.fillStyle = lit ? '#ffe9a8' : rnd() > 0.5 ? '#3b4a5c' : '#2c3948';
      ctx.fillRect(x, y, (W - 16) / cols - 6, (H - 24) / rows - 8);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, H - 14, W, 14);
  return finish(cv, { repeat: false, aniso: 4 });
}

export function createBlobShadowTexture() {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(128, 128);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(cv, { repeat: false, aniso: 1 });
}

/** Round soft sprite for particles/studio glow. */
export function createRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(cv, { repeat: false, aniso: 1 });
}

/** Vertical gradient backdrop (studio). */
export function createGradientTexture(top, bottom, h = 256) {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(4, h);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, h);
  return finish(cv, { repeat: false, aniso: 1 });
}

/** Podium plate texture: big position number + name. */
export function createPlateTexture(pos, name, color = '#ffffff') {
  if (!canvasAvailable()) return null;
  const cv = makeCanvas(512, 256);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 150px system-ui, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(pos), 256, 110);
  const label = String(name || '').slice(0, 16).toUpperCase();
  let px = 44;
  ctx.font = `bold ${px}px system-ui, Arial, sans-serif`;
  while (px > 18 && ctx.measureText(label).width > 470) {
    px -= 2;
    ctx.font = `bold ${px}px system-ui, Arial, sans-serif`;
  }
  ctx.fillStyle = '#d8dbe3';
  ctx.fillText(label, 256, 212);
  return finish(cv, { repeat: false, aniso: 4 });
}
