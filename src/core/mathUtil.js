// Pure math helpers. No DOM, no three.
export const TAU = Math.PI * 2;

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function invLerp(a, b, x) {
  return a === b ? 0 : (x - a) / (b - a);
}
export function smoothstep(a, b, x) {
  const t = clamp(invLerp(a, b, x), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Wrap x into [lo, hi). */
export function wrap(x, lo, hi) {
  const r = hi - lo;
  if (r <= 0) return lo;
  return ((((x - lo) % r) + r) % r) + lo;
}
/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  let r = wrap(a, -Math.PI, Math.PI); // [-PI, PI)
  if (r === -Math.PI) r = Math.PI;
  return r;
}
/** Shortest signed difference a-b in (-PI, PI]. */
export function angleDiff(a, b) {
  return wrapAngle(a - b);
}
/** Seeded PRNG, returns () => [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** N(0,1) sample (Box-Muller) from a uniform rng. */
export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
export function sign(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
