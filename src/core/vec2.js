// Plain-object 2D vectors {x,y}; every function is non-mutating.
export const v2 = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len2 = (v) => v.x * v.x + v.y * v.y;
export const len = (v) => Math.hypot(v.x, v.y);
export const norm = (v) => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
};
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const rotate = (v, a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};
export const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Left-hand perpendicular (-y, x). */
export const perp = (v) => ({ x: -v.y, y: v.x });
