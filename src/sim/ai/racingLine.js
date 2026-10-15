// Racing line + speed profile (spec §4.5). Pure and deterministic; cached per (track, stats-key).
import { wrapAngle, clamp } from '../../core/mathUtil.js';
import { BASE_CAR } from '../../data/carStats.js';

const cache = new WeakMap();   // trackModel -> Map(key -> line)
const geoCache = new WeakMap();   // trackModel -> Map(geoKey -> {offset,x,y,curvature,heading,dsl,length}) (independent of the car)

/** Tuning of how much the Brakes stat lets the AI carry (corner speed margin / braking-zone trust). */
export const BRAKE_TUNING = { fullGain: 0.7, muGain: 0.07, brakeFactorGain: 0.08 };

/**
 * 0 for stock brakes, 1 at a fully upgraded brake system (+70% force), up to 1.3. Better brakes let the AI trust its
 * stopping power: it uses a bigger share of the braking limit and carries more speed to the apex.
 */
export function brakeConfidence(stats) {
  return clamp((stats.brakeForceMax / BASE_CAR.brakeForceMax - 1) / BRAKE_TUNING.fullGain, 0, 1.3);
}

function statsKey(stats, opts) {
  return [stats.mass, stats.power, stats.clA, stats.cdA, stats.tyreMu, stats.brakeForceMax,
    stats.aeroBalanceFront, stats.crr, stats.cgToFront, stats.cgToRear,
    stats.derived && stats.derived.topSpeed, opts.iterations, opts.curvWeight, opts.margin, opts.maxSlope,
    opts.muFactor, opts.brakeFactor].join('|');
}


/**
 * Maximum total brake force (N) that keeps both axles able to produce the lateral force `ay` (m/s^2) needs,
 * given the ABS-style 0.6/0.4 split of the physics (front saturates first, then rear takes the rest).
 * Blends from the straight-line limit (ay ~ 0) to the "front must not saturate" limit by ay.
 */
export function brakeForceLimit(stats, u, ay, grip = 1) {
  const m = stats.mass, g = 9.81, L = stats.cgToFront + stats.cgToRear;
  const kdf = 0.5 * 1.2 * stats.clA;
  const DF = kdf * u * u;
  const mu = stats.tyreMu * grip;
  const Fzf = m * g * stats.cgToRear / L + DF * stats.aeroBalanceFront;
  const Fzr = m * g * stats.cgToFront / L + DF * (1 - stats.aeroBalanceFront);
  const capF = mu * Fzf, capR = mu * Fzr;
  const FyfReq = 1.1 * m * ay * stats.cgToRear / L, FyrReq = 1.1 * m * ay * stats.cgToFront / L;
  const fxfMax = Math.sqrt(Math.max(0, capF * capF - FyfReq * FyfReq));
  const fxrMax = Math.sqrt(Math.max(0, capR * capR - FyrReq * FyrReq));
  // straight-line: front saturates at capF, rear takes the rest up to its limit
  const full = Math.min(stats.brakeForceMax, capF + fxrMax);
  // cornering: front must stay below its (reduced) friction circle
  const lim = Math.min(stats.brakeForceMax, fxfMax / 0.6, 2.5 * fxrMax);
  const w = Math.min(1, Math.max(0, ay / 3));
  return (1 - w) * full + w * lim;
}

function lineGeometry(model, o) {
  const N = model.N, ds = model.ds;
  const cx = model.x, cy = model.y, nx = model.nx, ny = model.ny;
  const lim = Math.max(0.5, model.halfWidth - o.margin);

  // ---- relaxation on positions (SOR) ----
  const d = new Float64Array(N);
  const px = new Float64Array(N), py = new Float64Array(N);
  for (let i = 0; i < N; i++) { px[i] = cx[i]; py[i] = cy[i]; }
  // Blend of min-length (neighbour average) and min-curvature (bi-Laplacian) targets.
  // Pure min-length hugs the inside of tight corners (line tighter than the centreline);
  // the min-curvature term keeps corner radii >= centreline radii.
  const lam = o.curvWeight;
  for (let it = 0; it < o.iterations; it++) {
    for (let i = 0; i < N; i++) {
      const ip = i === 0 ? N - 1 : i - 1, inx = i === N - 1 ? 0 : i + 1;
      const ipp = ip === 0 ? N - 1 : ip - 1, inn = inx === N - 1 ? 0 : inx + 1;
      const t1x = 0.5 * (px[ip] + px[inx]), t1y = 0.5 * (py[ip] + py[inx]);
      const t2x = (4 * (px[ip] + px[inx]) - (px[ipp] + px[inn])) / 6;
      const t2y = (4 * (py[ip] + py[inx]) - (py[ipp] + py[inn])) / 6;
      const tx = (1 - lam) * t1x + lam * t2x, ty = (1 - lam) * t1y + lam * t2y;
      const want = (tx - cx[i]) * nx[i] + (ty - cy[i]) * ny[i];
      let nd = d[i] + o.omega * (want - d[i]);
      if (nd > lim) nd = lim; else if (nd < -lim) nd = -lim;
      d[i] = nd;
      px[i] = cx[i] + nd * nx[i]; py[i] = cy[i] + nd * ny[i];
    }
  }
  // ---- offset continuity (Lipschitz clamp, cyclic) ----
  const L = o.maxSlope;
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 1; k <= N; k++) {
      const i = k % N, ip = (k - 1) % N;
      const lo = d[ip] - L, hi = d[ip] + L;
      if (d[i] > hi) d[i] = hi; else if (d[i] < lo) d[i] = lo;
    }
    for (let k = N - 1; k >= 0; k--) {
      const i = k % N, inx = (k + 1) % N;
      const lo = d[inx] - L, hi = d[inx] + L;
      if (d[i] > hi) d[i] = hi; else if (d[i] < lo) d[i] = lo;
    }
  }
  const offset = new Float32Array(N);
  const x = new Float64Array(N), y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    offset[i] = d[i];
    x[i] = cx[i] + d[i] * nx[i]; y[i] = cy[i] + d[i] * ny[i];
  }

  // ---- line heading, spacing, curvature ----
  const dsl = new Float64Array(N);          // distance i -> i+1
  const hd = new Float64Array(N);           // heading of segment centred at i (i-1 -> i+1)
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    dsl[i] = Math.hypot(x[j] - x[i], y[j] - y[i]);
  }
  for (let i = 0; i < N; i++) {
    const ip = (i - 1 + N) % N, inx = (i + 1) % N;
    hd[i] = Math.atan2(y[inx] - y[ip], x[inx] - x[ip]);
  }
  const kRaw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ip = (i - 1 + N) % N, inx = (i + 1) % N;
    kRaw[i] = wrapAngle(hd[inx] - hd[ip]) / (dsl[ip] + dsl[i]);
  }
  const curvature = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += kRaw[(i + k + N) % N];
    curvature[i] = s / 5;
  }

  return { offset, x, y, curvature, hd, dsl };
}

export function buildRacingLine(model, stats, opts = {}) {
  const o = {
    iterations: opts.iterations ?? 800, omega: opts.omega ?? 1.5, curvWeight: opts.curvWeight ?? 1.0,
    margin: opts.margin ?? 1.8, maxSlope: opts.maxSlope ?? 0.15,
    muFactor: opts.muFactor ?? 0.92 + BRAKE_TUNING.muGain * Math.min(1, brakeConfidence(stats)),
    brakeFactor: opts.brakeFactor ?? 0.9 + BRAKE_TUNING.brakeFactorGain * brakeConfidence(stats),
  };
  let perTrack = cache.get(model);
  if (!perTrack) { perTrack = new Map(); cache.set(model, perTrack); }
  const key = statsKey(stats, o);
  const hit = perTrack.get(key);
  if (hit) return hit;

  const N = model.N, ds = model.ds;
  let geoMap = geoCache.get(model);
  if (!geoMap) { geoMap = new Map(); geoCache.set(model, geoMap); }
  const gkey = [o.iterations, o.omega, o.curvWeight, o.margin, o.maxSlope].join('|');
  let geo = geoMap.get(gkey);
  if (!geo) { geo = lineGeometry(model, o); geoMap.set(gkey, geo); }
  const { offset, x, y, curvature, hd, dsl } = geo;

  // ---- speed profile ----
  const m = stats.mass, g = 9.81;
  const kdf = 0.5 * 1.2 * stats.clA;
  const muC = stats.tyreMu * o.muFactor, muF = stats.tyreMu;
  const top = (stats.derived && stats.derived.topSpeed) || 90;
  const cap = 0.99 * top;
  const Lw = stats.cgToFront + stats.cgToRear;
  const v = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(curvature[i]);
    let vc = Math.sqrt(muC * g / Math.max(k - muC * kdf / m, 1e-4));
    if (vc > cap) vc = cap;
    v[i] = v[i + N] = vc;
  }
  const drag = (u) => 0.5 * 1.2 * stats.cdA * u * u + stats.crr * (m * g + kdf * u * u);
  // g-g aware limits: lateral demand v^2*kappa eats into the traction / braking circle.
  const accelAt = (u, kap) => {
    const Fzr = m * g * stats.cgToFront / Lw + kdf * (1 - stats.aeroBalanceFront) * u * u;
    const cap = 0.95 * muF * Fzr;
    const FyReq = 1.12 * m * u * u * kap * stats.cgToFront / Lw;
    const trac = Math.sqrt(Math.max(0, cap * cap - FyReq * FyReq));
    return (Math.min(stats.power / Math.max(u, 4), trac) - drag(u)) / m;
  };
  const decelAt = (u, kap) => {
    const Fx = brakeForceLimit(stats, u, u * u * kap) * o.brakeFactor;
    return (Fx + drag(u)) / m;
  };
  const fwd = () => {
    for (let i = 0; i < 2 * N - 1; i++) {
      const a = accelAt(v[i], Math.abs(curvature[i % N]));
      const nv = Math.sqrt(v[i] * v[i] + 2 * Math.max(a, 0) * dsl[i % N]);
      if (nv < v[i + 1]) v[i + 1] = nv;
    }
  };
  fwd();
  for (let i = 2 * N - 2; i >= 0; i--) {
    const a = decelAt(v[i + 1], Math.abs(curvature[(i + 1) % N]));
    const nv = Math.sqrt(v[i + 1] * v[i + 1] + 2 * a * dsl[i % N]);
    if (nv < v[i]) v[i] = nv;
  }
  fwd();
  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.min(v[i + N], v[i]);

  let length = 0;
  for (let i = 0; i < N; i++) length += dsl[i];
  const line = { offset, x, y, curvature, speed, heading: hd, dsl, length, topSpeed: top, ds };
  perTrack.set(key, line);
  return line;
}
