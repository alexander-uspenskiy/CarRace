// Geometry validators shared by track tests (and by the scratch authoring scripts).
import { wrapAngle } from '../../src/core/mathUtil.js';

/** Largest |curvature| over samples s in [sFrom, sTo] (metres, may be negative = before the line). */
export function maxAbsCurvature(model, sFrom, sTo) {
  let m = 0;
  for (let s = sFrom; s <= sTo; s += model.ds) {
    const k = Math.abs(model.sampleAt(s).curvature);
    if (k > m) m = k;
  }
  return m;
}

export function minRadius(model) {
  let kmax = 0;
  let at = 0;
  for (let i = 0; i < model.N; i++) {
    const k = Math.abs(model.curvature[i]);
    if (k > kmax) {
      kmax = k;
      at = i;
    }
  }
  return { radius: kmax > 0 ? 1 / kmax : Infinity, s: at * model.ds };
}

/** Offset polyline ring at lateral distance d (closed, N points). */
export function ring(model, d) {
  const pts = new Array(model.N);
  for (let i = 0; i < model.N; i++) pts[i] = [model.x[i] + d * model.nx[i], model.y[i] + d * model.ny[i]];
  return pts;
}

function segIntersect(a, b, c, d) {
  const d1x = b[0] - a[0];
  const d1y = b[1] - a[1];
  const d2x = d[0] - c[0];
  const d2y = d[1] - c[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
  const u = ((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/** Count proper crossings between non-adjacent segments of a closed polyline (grid-accelerated). */
export function countSelfIntersections(pts) {
  const n = pts.length;
  const cell = 40;
  const grid = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(i);
      }
    }
  }
  let count = 0;
  const seen = new Set();
  for (const arr of grid.values()) {
    for (let p = 0; p < arr.length; p++) {
      for (let q = p + 1; q < arr.length; q++) {
        const i = arr[p];
        const j = arr[q];
        const gap = Math.min(Math.abs(i - j), n - Math.abs(i - j));
        if (gap < 2) continue;
        const pk = i < j ? i * n + j : j * n + i;
        if (seen.has(pk)) continue;
        seen.add(pk);
        if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) count++;
      }
    }
  }
  return count;
}

/** Minimum centreline distance between samples that are > minGap apart along the lap. Returns {dist, s1, s2}. */
export function minSeparation(model, minGap = 150) {
  const N = model.N;
  const gapN = Math.ceil(minGap / model.ds);
  let best = Infinity;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + gapN; j < N; j++) {
      if (N - (j - i) <= gapN) break;
      const dx = model.x[i] - model.x[j];
      const dy = model.y[i] - model.y[j];
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bi = i;
        bj = j;
      }
    }
  }
  return { dist: Math.sqrt(best), s1: bi * model.ds, s2: bj * model.ds };
}

/** Sum of signed heading change around the loop (should be +-2PI for a simple closed curve). */
export function totalTurning(model) {
  let sum = 0;
  for (let i = 0; i < model.N; i++) sum += wrapAngle(model.heading[(i + 1) % model.N] - model.heading[i]);
  return sum;
}
