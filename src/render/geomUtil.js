// Geometry helpers for the renderer (own implementation: no three/addons are vendored).
// Pure: safe to import in Node (no document / WebGL access).
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}
export const angleDiff = (a, b) => wrapAngle(a - b);
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

const _tmpColor = new THREE.Color();
export function toColor(c, out = _tmpColor) {
  if (c && c.isColor) return out.copy(c);
  return out.set(c);
}

/** Replace/assign a uniform vertex colour (linear working space, via THREE.Color). */
export function paint(geo, c) {
  const col = new THREE.Color(c && c.isColor ? c : c);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = col.r;
    a[i * 3 + 1] = col.g;
    a[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Per-vertex colour: fn(x, y, z, outColor) fills outColor. */
export function paintFn(geo, fn) {
  const p = geo.attributes.position;
  const n = p.count;
  const a = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/**
 * Merge geometries (indexed or not) into ONE indexed BufferGeometry with
 * position, normal, color (white default) and optionally uv.
 */
export function mergeGeometries(list, { uv = false } = {}) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3).fill(1);
  const uvs = uv ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    const u = g.attributes.uv;
    const cnt = p.count;
    for (let i = 0; i < cnt; i++) {
      const o = (vo + i) * 3;
      pos[o] = p.getX(i);
      pos[o + 1] = p.getY(i);
      pos[o + 2] = p.getZ(i);
      nor[o] = n.getX(i);
      nor[o + 1] = n.getY(i);
      nor[o + 2] = n.getZ(i);
      if (c) {
        col[o] = c.getX(i);
        col[o + 1] = c.getY(i);
        col[o + 2] = c.getZ(i);
      }
      if (uvs && u) {
        uvs[(vo + i) * 2] = u.getX(i);
        uvs[(vo + i) * 2 + 1] = u.getY(i);
      }
    }
    if (g.index) {
      const gi = g.index;
      for (let k = 0; k < gi.count; k++) idx[io++] = gi.getX(k) + vo;
    } else {
      for (let k = 0; k < cnt; k++) idx[io++] = vo + k;
    }
    vo += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export function disposeList(list) {
  for (const g of list) g.dispose();
}

// ---------------------------------------------------------------- primitives
export function boxAt(cx, cy, cz, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
/** Cylinder between two points p, q ([x,y,z]). */
export function beam(p, q, r, seg = 6) {
  _dir.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const len = _dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  _q.setFromUnitVectors(_up, _dir.multiplyScalar(1 / (len || 1)));
  g.applyQuaternion(_q);
  g.translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  return g;
}

/** Closed polygon in the (x,y) plane (car side profile) extruded in z from z0 to z1. */
export function extrudeXY(points, z0, z1) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, z0);
  return g;
}

/** Closed polygon given in the ground plane (x,z) extruded in y from y0 to y1. */
export function extrudeXZ(points, y0, y1) {
  const shape = new THREE.Shape();
  // rotateX(-90deg) maps (a,b,c) -> (a, c, -b): feed b = -z
  shape.moveTo(points[0][0], -points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Hexahedron from 8 points: bottom quad p0..p3 (loop) and top quad p4..p7 (same loop). Flat shaded, outward normals. */
export function hexa(p) {
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const c = [0, 0, 0];
  for (const q of p) {
    c[0] += q[0] / 8;
    c[1] += q[1] / 8;
    c[2] += q[2] / 8;
  }
  const pos = [];
  const nor = [];
  for (const f of faces) {
    let [a, b, cc, d] = f.map((i) => p[i]);
    const e1 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const fc = [(a[0] + b[0] + cc[0] + d[0]) / 4 - c[0], (a[1] + b[1] + cc[1] + d[1]) / 4 - c[1], (a[2] + b[2] + cc[2] + d[2]) / 4 - c[2]];
    if (n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0) {
      [b, d] = [d, b];
      n = [-n[0], -n[1], -n[2]];
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    for (const v of [a, b, cc, a, cc, d]) {
      pos.push(v[0], v[1], v[2]);
      nor.push(n[0], n[1], n[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Wing element. Leading edge at xLE, trailing edge `chord` behind it (-x), pitched so the TE is
 * higher by chord*sin(pitch). Spans z0..z1 with LE height yA at z0 and yB at z1.
 */
export function wingSlab(xLE, chord, pitch, thick, z0, z1, yA, yB) {
  const dx = -chord * Math.cos(pitch);
  const dy = chord * Math.sin(pitch);
  const h = thick / 2;
  const pts = [];
  for (const [z, y] of [[z0, yA], [z1, yB]]) {
    pts.push([xLE, y - h, z], [xLE + dx, y + dy - h, z], [xLE + dx, y + dy + h, z], [xLE, y + h, z]);
  }
  // order: bottom loop = inner(LE bot, TE bot) + outer(TE bot, LE bot); top loop likewise
  const [a0, a1, a2, a3, b0, b1, b2, b3] = pts;
  return hexa([a0, a1, b1, b0, a3, a2, b2, b3]);
}

// ------------------------------------------------------------ lofted bodies
/**
 * Profile: keys [{x, z0, z1, y0, y1, n}] -> sample(x,out). Cross-sections are superellipses
 * spanning z0..z1 (width) and y0..y1 (height) with exponent n (2 = ellipse, higher = boxier).
 * Channels are interpolated with a uniform Catmull-Rom along the key list.
 */
export function makeProfile(keys) {
  const k = keys.slice().sort((a, b) => a.x - b.x);
  const CH = ['z0', 'z1', 'y0', 'y1', 'n'];
  const cr = (p0, p1, p2, p3, t) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const fn = function sample(x, out = {}) {
    let j = 0;
    while (j < k.length - 2 && x > k[j + 1].x) j++;
    const a = k[j];
    const b = k[j + 1];
    const t = clamp((x - a.x) / (b.x - a.x || 1), 0, 1);
    const p0 = k[Math.max(j - 1, 0)];
    const p3 = k[Math.min(j + 2, k.length - 1)];
    for (const c of CH) out[c] = cr(p0[c], a[c], b[c], p3[c], t);
    if (out.z1 < out.z0 + 0.01) out.z1 = out.z0 + 0.01;
    if (out.y1 < out.y0 + 0.01) out.y1 = out.y0 + 0.01;
    if (out.n < 2) out.n = 2;
    return out;
  };
  fn.xMin = k[0].x;
  fn.xMax = k[k.length - 1].x;
  return fn;
}

export function ringPoint(s, phi, out) {
  const cz = (s.z0 + s.z1) / 2;
  const rz = (s.z1 - s.z0) / 2;
  const cy = (s.y0 + s.y1) / 2;
  const ry = (s.y1 - s.y0) / 2;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const e = 2 / s.n;
  out.z = cz + rz * Math.sign(c) * Math.pow(Math.abs(c), e);
  out.y = cy + ry * Math.sign(sn) * Math.pow(Math.abs(sn), e);
  return out;
}
/** Height of the top surface at lateral position z for section s. */
export function topY(s, z) {
  const cz = (s.z0 + s.z1) / 2;
  const rz = (s.z1 - s.z0) / 2;
  const cy = (s.y0 + s.y1) / 2;
  const ry = (s.y1 - s.y0) / 2;
  const u = clamp(Math.abs(z - cz) / rz, 0, 1);
  return cy + ry * Math.pow(1 - Math.pow(u, s.n), 1 / s.n);
}
/** Lateral position of the side surface at height y (sign +1 = +z side). */
export function sideZ(s, y, sign) {
  const cz = (s.z0 + s.z1) / 2;
  const rz = (s.z1 - s.z0) / 2;
  const cy = (s.y0 + s.y1) / 2;
  const ry = (s.y1 - s.y0) / 2;
  const v = clamp(Math.abs(y - cy) / ry, 0, 1);
  return cz + sign * rz * Math.pow(1 - Math.pow(v, s.n), 1 / s.n);
}

/** Loft the profile through the x-stations `xs` (any order), K ring points, flat end caps. Outward-facing. */
export function loftGeometry(profile, xs, K = 16) {
  const X = xs.slice().sort((a, b) => a - b);
  const S = X.length;
  const pos = [];
  const sec = {};
  const rp = {};
  for (let j = 0; j < S; j++) {
    profile(X[j], sec);
    for (let i = 0; i < K; i++) {
      ringPoint(sec, (i / K) * TAU, rp);
      pos.push(X[j], rp.y, rp.z);
    }
  }
  const idx = [];
  for (let j = 0; j < S - 1; j++) {
    for (let i = 0; i < K; i++) {
      const i2 = (i + 1) % K;
      const a = j * K + i;
      const b = j * K + i2;
      const c = (j + 1) * K + i;
      const d = (j + 1) * K + i2;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps (separate vertices, fan around the centre)
  const addCap = (j, front) => {
    profile(X[j], sec);
    const base = pos.length / 3;
    pos.push(X[j], (sec.y0 + sec.y1) / 2, (sec.z0 + sec.z1) / 2);
    for (let i = 0; i < K; i++) {
      ringPoint(sec, (i / K) * TAU, rp);
      pos.push(X[j], rp.y, rp.z);
    }
    for (let i = 0; i < K; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % K);
      if (front) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  };
  addCap(S - 1, true);
  addCap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Parametric surface grid; fn(u,v,out[3]) for u,v in 0..1. Triangle orientation is flipped (if needed)
 * so the surface faces `hint` ([x,y,z]) at its centre.
 */
export function paramSurface(nu, nv, fn, hint) {
  const out = [0, 0, 0];
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, out);
      const o = (j * (nu + 1) + i) * 3;
      pos[o] = out[0];
      pos[o + 1] = out[1];
      pos[o + 2] = out[2];
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  // orientation test: sum of triangle normals vs hint
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    nx += e1y * e2z - e1z * e2y;
    ny += e1z * e2x - e1x * e2z;
    nz += e1x * e2y - e1y * e2x;
  }
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ mesh builder
/** Accumulates flat-shaded quads/boxes with automatic outward winding; for walls, boxes, lines. */
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
    this.useUV = false;
  }
  /** a,b,c,d: [x,y,z] loop order. hint: [x,y,z] desired facing. col: THREE.Color. uvs: optional [[u,v]*4] in loop order. */
  quad(a, b, c, d, hint, col, uvs) {
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    let v = [a, b, c, d];
    let u = uvs ? uvs.slice() : null;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      v = [a, d, c, b];
      if (u) u = [u[0], u[3], u[2], u[1]];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (uvs) this.useUV = true;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.nor.push(nx, ny, nz);
      this.col.push(col.r, col.g, col.b);
      if (u) this.uv.push(u[i][0], u[i][1]);
      else this.uv.push(0, 0);
    }
    const o = this.n;
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    this.n += 4;
  }
  /** Oriented box: centre c, unit axes ux,uy,uz, half sizes. colFn(faceIndex 0..5) or a Color. Faces: +u,-u,+v,-v,+w,-w. */
  box(c, ux, uy, uz, hx, hy, hz, col) {
    const P = (sx, sy, sz) => [
      c[0] + ux[0] * hx * sx + uy[0] * hy * sy + uz[0] * hz * sz,
      c[1] + ux[1] * hx * sx + uy[1] * hy * sy + uz[1] * hz * sz,
      c[2] + ux[2] * hx * sx + uy[2] * hy * sy + uz[2] * hz * sz,
    ];
    const cf = (i) => (typeof col === 'function' ? col(i) : col);
    this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), ux, cf(0));
    this.quad(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), [-ux[0], -ux[1], -ux[2]], cf(1));
    this.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), uy, cf(2));
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), [-uy[0], -uy[1], -uy[2]], cf(3));
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), uz, cf(4));
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), [-uz[0], -uz[1], -uz[2]], cf(5));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.useUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const IA = this.n > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IA(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------ track ribbons
/**
 * Ribbon along the track model's centreline. Shared vertices, flat +Y normals, `cols` lateral columns.
 * Winding (world x east, z south): triangles (L_i,R_i,L_{i+1}) and (R_i,R_{i+1},L_{i+1}) face +Y.
 * Options: i0 (start sample), count (segments), stride (samples per step), d0/d1 (lateral offsets, number or fn(i,row)),
 * y0/y1 (heights at d0/d1, number or fn), color (Color | fn(i,t,row,outColor)), uv (fn(out,i,d,row,X,Z)).
 */
export function ribbonGeometry(model, o = {}) {
  const N = model.N;
  const stride = o.stride || 1;
  const i0 = o.i0 || 0;
  const count = o.count != null ? o.count : Math.floor(N / stride);
  const cols = o.cols || 1;
  const rows = count + 1;
  const V = cols + 1;
  const pos = new Float32Array(rows * V * 3);
  const nor = new Float32Array(rows * V * 3);
  const col = new Float32Array(rows * V * 3);
  const uv = o.uv ? new Float32Array(rows * V * 2) : null;
  const tmpC = new THREE.Color();
  const tmpUV = [0, 0];
  const constColor = o.color && o.color.isColor ? o.color : null;
  const fnNum = (v, i, r) => (typeof v === 'function' ? v(i, r) : v);
  for (let r = 0; r < rows; r++) {
    const i = (((i0 + r * stride) % N) + N) % N;
    const cx = model.x[i];
    const cz = model.y[i];
    const nx = model.nx[i];
    const nz = model.ny[i];
    const d0 = fnNum(o.d0, i, r);
    const d1 = fnNum(o.d1, i, r);
    const y0 = fnNum(o.y0 != null ? o.y0 : 0, i, r);
    const y1 = fnNum(o.y1 != null ? o.y1 : y0, i, r);
    for (let c = 0; c < V; c++) {
      const t = c / cols;
      const d = d0 + (d1 - d0) * t;
      const X = cx + nx * d;
      const Z = cz + nz * d;
      const k = (r * V + c) * 3;
      pos[k] = X;
      pos[k + 1] = y0 + (y1 - y0) * t;
      pos[k + 2] = Z;
      nor[k + 1] = 1;
      if (constColor) {
        col[k] = constColor.r;
        col[k + 1] = constColor.g;
        col[k + 2] = constColor.b;
      } else if (o.color) {
        o.color(i, t, r, tmpC);
        col[k] = tmpC.r;
        col[k + 1] = tmpC.g;
        col[k + 2] = tmpC.b;
      } else {
        col[k] = col[k + 1] = col[k + 2] = 1;
      }
      if (uv) {
        o.uv(tmpUV, i, d, r, X, Z, t);
        uv[(r * V + c) * 2] = tmpUV[0];
        uv[(r * V + c) * 2 + 1] = tmpUV[1];
      }
    }
  }
  const nQuads = count * cols;
  const IA = rows * V > 65535 ? Uint32Array : Uint16Array;
  const idx = new IA(nQuads * 6);
  let q = 0;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * V + c; // L_i
      const b = a + 1; // R_i
      const a2 = a + V; // L_{i+1}
      const b2 = b + V; // R_{i+1}
      idx[q++] = a;
      idx[q++] = b;
      idx[q++] = a2;
      idx[q++] = b;
      idx[q++] = b2;
      idx[q++] = a2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Uniform spatial hash of 2D points for 'any point within R' queries. */
export class PointHash {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(cx, cz) {
    return (cx + 8192) * 16384 + (cz + 8192);
  }
  add(x, z) {
    const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(x, z);
  }
  /** true if any stored point is closer than R to (x,z) */
  anyWithin(x, z, R) {
    const c = this.cell;
    const r2 = R * R;
    const x0 = Math.floor((x - R) / c);
    const x1 = Math.floor((x + R) / c);
    const z0 = Math.floor((z - R) / c);
    const z1 = Math.floor((z + R) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.map.get(this._key(cx, cz));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 2) {
          const dx = a[i] - x;
          const dz = a[i + 1] - z;
          if (dx * dx + dz * dz < r2) return true;
        }
      }
    }
    return false;
  }
}

/** Dispose every geometry/material/texture below an Object3D (shared materials excluded via `skip` set). */
export function disposeObject(root, skip) {
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const m = Array.isArray(o.material) ? o.material : [o.material];
      for (const x of m) if (!skip || !skip.has(x)) mats.add(x);
    }
    if (o.isInstancedMesh) o.dispose();
  });
  for (const m of mats) {
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (v && v.isTexture) v.dispose();
    }
    m.dispose();
  }
}
