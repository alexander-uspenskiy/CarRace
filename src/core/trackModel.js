// TrackModel: closed centripetal Catmull-Rom centreline resampled uniformly by arc length.
// Pure (no three, no DOM). Sim (x, y) == world (x, 0, z).
import { wrapAngle } from './mathUtil.js';

const ALPHA = 0.5;

function crSegment(p0, p1, p2, p3, count, out) {
  // Barry-Goldman centripetal Catmull-Rom; emits `count` points for t in [0,1) between p1 and p2.
  const d01 = Math.max(Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ALPHA), 1e-6);
  const d12 = Math.max(Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), ALPHA), 1e-6);
  const d23 = Math.max(Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), ALPHA), 1e-6);
  const t0 = 0;
  const t1 = t0 + d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  for (let k = 0; k < count; k++) {
    const t = t1 + ((t2 - t1) * k) / count;
    const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0);
    const a1y = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0);
    const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1);
    const a2y = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1);
    const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2);
    const a3y = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2);
    const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
    const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
    const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
    const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
    out.push(((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1), ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1));
  }
}

/** Dense closed Catmull-Rom polyline (flat [x,y,...], NOT repeating the first point). */
export function denseCentreline(controlPoints, minPerSeg = 32) {
  const n = controlPoints.length;
  if (n < 4) throw new Error('trackModel: need at least 4 control points');
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const count = Math.max(minPerSeg, Math.ceil(segLen / 0.75));
    crSegment(p0, p1, p2, p3, count, out);
  }
  return out;
}

export function buildTrackModel(def, opts = {}) {
  const spacing = opts.spacing ?? 2.0;
  const dense = denseCentreline(def.controlPoints, opts.minPerSeg ?? 32);
  const M = dense.length / 2;

  // cumulative arc length of the closed dense polyline
  const cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    cum[i + 1] = cum[i] + Math.hypot(dense[2 * j] - dense[2 * i], dense[2 * j + 1] - dense[2 * i + 1]);
  }
  const length = cum[M];
  const N = Math.max(8, Math.round(length / spacing));
  const ds = length / N;

  const x = new Float64Array(N);
  const y = new Float64Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (seg < M - 1 && cum[seg + 1] <= s) seg++;
    const j = (seg + 1) % M;
    const segLen = cum[seg + 1] - cum[seg];
    const f = segLen > 0 ? (s - cum[seg]) / segLen : 0;
    x[i] = dense[2 * seg] + (dense[2 * j] - dense[2 * seg]) * f;
    y[i] = dense[2 * seg + 1] + (dense[2 * j + 1] - dense[2 * seg + 1]) * f;
  }

  const tx = new Float64Array(N);
  const ty = new Float64Array(N);
  const nx = new Float64Array(N);
  const ny = new Float64Array(N);
  const heading = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l;
    ty[i] = dy / l;
    nx[i] = -ty[i];
    ny[i] = tx[i];
    heading[i] = Math.atan2(ty[i], tx[i]);
  }

  // signed curvature (+ = turning right/clockwise = heading increasing), 3-sample smoothed
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    raw[i] = wrapAngle(heading[b] - heading[a]) / (2 * ds);
  }
  const curvature = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    curvature[i] = (raw[(i - 1 + N) % N] + raw[i] + raw[(i + 1) % N]) / 3;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumAbsK = 0;
  for (let i = 0; i < N; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
    sumAbsK += Math.abs(curvature[i]);
  }

  const halfWidth = def.width / 2;
  const runoff = def.runoff;
  const kerbWidth = def.kerbWidth;
  const wallOffset = halfWidth + runoff;

  const wrapS = (s) => {
    const r = s % length;
    return r < 0 ? r + length : r;
  };

  function sampleAt(s) {
    s = wrapS(s);
    const f0 = s / ds;
    let i = Math.floor(f0);
    if (i >= N) i = N - 1;
    const f = f0 - i;
    const j = (i + 1) % N;
    let ttx = tx[i] + (tx[j] - tx[i]) * f;
    let tty = ty[i] + (ty[j] - ty[i]) * f;
    const l = Math.hypot(ttx, tty) || 1;
    ttx /= l;
    tty /= l;
    return {
      x: x[i] + (x[j] - x[i]) * f,
      y: y[i] + (y[j] - y[i]) * f,
      tx: ttx,
      ty: tty,
      nx: -tty,
      ny: ttx,
      heading: Math.atan2(tty, ttx),
      curvature: curvature[i] + (curvature[j] - curvature[i]) * f,
      index: i,
      s,
    };
  }

  function offsetPoint(s, d) {
    const p = sampleAt(s);
    return { x: p.x + d * p.nx, y: p.y + d * p.ny };
  }

  function nearestInRange(px, py, from, count) {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % N) + N) % N;
      const ddx = px - x[i];
      const ddy = py - y[i];
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    return best;
  }

  function refine(px, py, k) {
    // project onto segments [k-1,k] and [k,k+1]; keep the closer
    let bestS = k * ds;
    let bestD2 = Infinity;
    for (let side = -1; side <= 0; side++) {
      const a = (((k + side) % N) + N) % N;
      const b = (a + 1) % N;
      const sx = x[b] - x[a];
      const sy = y[b] - y[a];
      const l2 = sx * sx + sy * sy || 1;
      let t = ((px - x[a]) * sx + (py - y[a]) * sy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x[a] + sx * t - px;
      const qy = y[a] + sy * t - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < bestD2) {
        bestD2 = d2;
        // unwrapped position of a relative to k to keep continuity
        bestS = (k + side + t) * ds;
      }
    }
    return wrapS(bestS);
  }

  // Newton polish so that offsetPoint(project(p).s, project(p).d) == p (frames are interpolated, not chord-based).
  function polish(px, py, s) {
    for (let it = 0; it < 3; it++) {
      const sm = sampleAt(s);
      const e = (px - sm.x) * sm.tx + (py - sm.y) * sm.ty;
      const d = (px - sm.x) * sm.nx + (py - sm.y) * sm.ny;
      const denom = 1 - d * sm.curvature;
      if (denom < 0.2) break;
      let step = e / denom;
      step = step > ds ? ds : step < -ds ? -ds : step;
      s = wrapS(s + step);
      if (Math.abs(step) < 1e-7) break;
    }
    return s;
  }

  function project(px, py, hintIndex) {
    let k;
    if (hintIndex !== undefined && hintIndex !== null && Number.isFinite(hintIndex)) {
      k = nearestInRange(px, py, Math.floor(hintIndex) - 60, 121);
    } else {
      k = nearestInRange(px, py, 0, N);
    }
    let s = polish(px, py, refine(px, py, k));
    let p = sampleAt(s);
    let d = (px - p.x) * p.nx + (py - p.y) * p.ny;
    if (hintIndex !== undefined && hintIndex !== null && Math.abs(d) > wallOffset * 2) {
      k = nearestInRange(px, py, 0, N);
      s = polish(px, py, refine(px, py, k));
      p = sampleAt(s);
      d = (px - p.x) * p.nx + (py - p.y) * p.ny;
    }
    return { s, d, index: Math.floor(s / ds) % N, heading: p.heading, dist: Math.abs(d) };
  }

  function surfaceAt(d) {
    const a = Math.abs(d);
    if (a <= halfWidth) return 'asphalt';
    if (a <= halfWidth + kerbWidth) return 'kerb';
    if (a < wallOffset) return 'grass';
    return 'wall';
  }

  // stats
  const CORNER_K = 1 / 150;
  const STRAIGHT_K = 1 / 500;
  const runs = (pred) => {
    // cyclic contiguous runs; returns array of run lengths in samples
    let start = -1;
    for (let i = 0; i < N; i++) if (!pred(i)) { start = i; break; }
    if (start < 0) return [N];
    const out = [];
    let cur = 0;
    for (let k = 1; k <= N; k++) {
      const i = (start + k) % N;
      if (pred(i)) cur++;
      else {
        if (cur) out.push(cur);
        cur = 0;
      }
    }
    if (cur) out.push(cur);
    return out;
  };
  const cornerRuns = runs((i) => Math.abs(curvature[i]) > CORNER_K).filter((r) => r * ds >= 15);
  const straightRuns = runs((i) => Math.abs(curvature[i]) < STRAIGHT_K);
  const stats = {
    length,
    corners: cornerRuns.length,
    longestStraight: straightRuns.length ? Math.max(...straightRuns) * ds : 0,
    avgCurvature: sumAbsK / N,
  };

  return {
    id: def.id,
    length,
    N,
    ds,
    halfWidth,
    runoff,
    kerbWidth,
    wallOffset,
    x,
    y,
    tx,
    ty,
    nx,
    ny,
    heading,
    curvature,
    bbox: { minX, maxX, minY, maxY },
    stats,
    wrapS,
    sampleAt,
    offsetPoint,
    project,
    surfaceAt,
  };
}

export function getReferenceSpeed(model, def) {
  return model.length / def.referenceLapTime;
}
