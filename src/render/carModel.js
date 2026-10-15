// Procedural 2025-style F1 car. Car-local axes: +X forward, +Y up, +Z driver's right, origin = CG on the ground.
// Built from lofted/extruded parts merged into a handful of vertex-coloured geometries (<= 9 meshes per car).
import * as THREE from 'three';
import {
  mergeGeometries, paint, paintFn, boxAt, beam, extrudeXY, extrudeXZ, wingSlab, makeProfile, topY, sideZ,
  loftGeometry, paramSurface, clamp, mulberry32, hashString, TAU,
} from './geomUtil.js';
import { createBlobShadowTexture } from './textures.js';

export const CAR = Object.freeze({
  frontAxle: 1.98, rearAxle: -1.62, trackF: 0.85, trackR: 0.82,
  radiusF: 0.33, radiusR: 0.35, widthF: 0.30, widthR: 0.40,
  noseX: 3.3, tailX: -2.35, wheelbase: 3.6,
});

const CARBON = '#15161a';
const STEEL = '#3d4048';
const SILVER = '#aeb3bd';
const WHITE = '#f2f2f2';
const BLACKISH = '#0b0b0e';

// ---------------------------------------------------------------- shared materials
let _shared = null;
function sharedMaterials() {
  if (_shared) return _shared;
  const blobTex = createBlobShadowTexture();
  _shared = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }),
    helmet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 }),
    blob: new THREE.MeshBasicMaterial({
      color: 0x000000, map: blobTex || null, transparent: true, opacity: blobTex ? 0.75 : 0.3,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  };
  return _shared;
}
export function getCarSharedMaterials() {
  return sharedMaterials();
}

// ---------------------------------------------------------------- profiles
const FUSE = makeProfile([
  { x: 3.0, z0: -0.04, z1: 0.04, y0: 0.22, y1: 0.3, n: 2.2 },
  { x: 2.85, z0: -0.08, z1: 0.08, y0: 0.2, y1: 0.33, n: 2.2 },
  { x: 2.4, z0: -0.13, z1: 0.13, y0: 0.17, y1: 0.38, n: 2.3 },
  { x: 1.9, z0: -0.19, z1: 0.19, y0: 0.13, y1: 0.46, n: 2.4 },
  { x: 1.4, z0: -0.25, z1: 0.25, y0: 0.09, y1: 0.56, n: 2.5 },
  { x: 1.0, z0: -0.3, z1: 0.3, y0: 0.07, y1: 0.62, n: 2.6 },
  { x: 0.5, z0: -0.33, z1: 0.33, y0: 0.06, y1: 0.66, n: 2.8 },
  { x: 0.0, z0: -0.34, z1: 0.34, y0: 0.06, y1: 0.7, n: 2.8 },
  { x: -0.5, z0: -0.31, z1: 0.31, y0: 0.07, y1: 0.76, n: 2.6 },
  { x: -1.0, z0: -0.27, z1: 0.27, y0: 0.09, y1: 0.73, n: 2.5 },
  { x: -1.5, z0: -0.2, z1: 0.2, y0: 0.14, y1: 0.58, n: 2.4 },
  { x: -1.95, z0: -0.12, z1: 0.12, y0: 0.2, y1: 0.42, n: 2.3 },
  { x: -2.15, z0: -0.08, z1: 0.08, y0: 0.24, y1: 0.36, n: 2.2 },
]);
const POD_KEYS = [
  { x: 1.05, z0: 0.16, z1: 0.52, y0: 0.1, y1: 0.4, n: 2.6 },
  { x: 0.7, z0: 0.18, z1: 0.62, y0: 0.08, y1: 0.5, n: 2.7 },
  { x: 0.2, z0: 0.18, z1: 0.67, y0: 0.07, y1: 0.56, n: 2.8 },
  { x: -0.4, z0: 0.18, z1: 0.63, y0: 0.07, y1: 0.53, n: 2.8 },
  { x: -1.0, z0: 0.18, z1: 0.5, y0: 0.07, y1: 0.43, n: 2.6 },
  { x: -1.6, z0: 0.16, z1: 0.33, y0: 0.08, y1: 0.3, n: 2.4 },
  { x: -1.95, z0: 0.14, z1: 0.22, y0: 0.12, y1: 0.25, n: 2.2 },
];
const POD_R = makeProfile(POD_KEYS);
const POD_L = makeProfile(POD_KEYS.map((k) => ({ ...k, z0: -k.z1, z1: -k.z0 })));
const AIRBOX = makeProfile([
  { x: -0.08, z0: -0.13, z1: 0.13, y0: 0.64, y1: 0.9, n: 2.4 },
  { x: -0.3, z0: -0.14, z1: 0.14, y0: 0.64, y1: 0.96, n: 2.4 },
  { x: -0.6, z0: -0.12, z1: 0.12, y0: 0.66, y1: 0.9, n: 2.4 },
  { x: -1.0, z0: -0.08, z1: 0.08, y0: 0.68, y1: 0.8, n: 2.4 },
  { x: -1.4, z0: -0.05, z1: 0.05, y0: 0.62, y1: 0.72, n: 2.4 },
]);

function xsRange(a, b, step) {
  const n = Math.max(2, Math.ceil((b - a) / step) + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

// ---------------------------------------------------------------- wheel
function buildWheelGeometry(R, W, lv, hi) {
  const seg = hi ? 30 : 16;
  const hw = W / 2;
  const Rrim = R * 0.64;
  const parts = [];
  const V = (a) => a.map(([r, ax]) => new THREE.Vector2(r, ax));
  const lathe = (pts) => {
    const g = new THREE.LatheGeometry(V(pts), seg);
    g.rotateX(Math.PI / 2); // axis Y -> Z
    return g;
  };
  // tyre
  parts.push(paint(lathe([
    [Rrim, -hw], [R - 0.04, -hw], [R - 0.015, -hw + 0.025], [R - 0.004, -hw + 0.06], [R, -hw + 0.1],
    [R, hw - 0.1], [R - 0.004, hw - 0.06], [R - 0.015, hw - 0.025], [R - 0.04, hw], [Rrim, hw],
  ]), '#101113'));
  // rim faces (dished)
  const a = hw - 0.02;
  parts.push(paint(lathe([[Rrim, a], [Rrim * 0.6, a - 0.025], [0.02, a - 0.032]]), lv.rim || '#1a1a1a'));
  parts.push(paint(lathe([[0.02, -(a - 0.032)], [Rrim * 0.6, -(a - 0.025)], [Rrim, -a]]), lv.rim || '#1a1a1a'));
  // sidewall stripe (team accent) - flat rings just outside the sidewall
  for (const s of [1, -1]) {
    const ring = new THREE.RingGeometry(R * 0.74, R * 0.8, hi ? 40 : 20);
    if (s < 0) ring.rotateY(Math.PI);
    ring.translate(0, 0, s * (hw + 0.0015));
    parts.push(paint(ring, lv.accent || '#ffffff'));
  }
  // spokes + hub, both sides (make wheel spin readable)
  const nSp = 5;
  for (const s of [1, -1]) {
    for (let k = 0; k < nSp; k++) {
      const len = Rrim * 0.9;
      const g = new THREE.BoxGeometry(len, 0.045, 0.012);
      g.translate(len / 2, 0, s * (hw - 0.012));
      g.rotateZ((k / nSp) * TAU);
      parts.push(paint(g, SILVER));
    }
    const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 0, s * (hw - 0.014));
    parts.push(paint(hub, lv.accent || '#dddddd'));
  }
  const m = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return m;
}

// ---------------------------------------------------------------- helmet
function buildHelmetGeometry(driver, lv, hi) {
  const base = new THREE.Color(driver?.helmet?.base || lv.primary);
  const accent = new THREE.Color(driver?.helmet?.accent || lv.secondary || '#ffffff');
  const visor = new THREE.Color('#0b0e16');
  const rx = 0.158;
  const ry = 0.15;
  const rz = 0.125;
  const g = new THREE.SphereGeometry(1, hi ? 22 : 12, hi ? 16 : 9);
  g.scale(rx, ry, rz);
  paintFn(g, (x, y, z, out) => {
    const px = x / rx;
    const py = y / ry;
    const pz = z / rz;
    if (px > 0.42 && py > -0.12 && py < 0.4 && Math.abs(pz) < 0.92) out.copy(visor);
    else if (Math.abs(pz) < 0.13 && py > 0.15) out.copy(accent);
    else if (py < -0.5 && py > -0.78) out.copy(accent);
    else out.copy(base);
  });
  g.translate(0.3, 0.775, 0);
  return g;
}

// ---------------------------------------------------------------- the car
export function buildCarModel(team, { driverIdx = 0, helmet = true, quality = 'high' } = {}) {
  const lv = team.livery;
  const driver = team.drivers ? team.drivers[driverIdx] || team.drivers[0] : null;
  const hi = quality !== 'low';
  const K = hi ? 16 : 12;
  const step = hi ? 0.14 : 0.26;
  const rnd = mulberry32(hashString(team.id || 'x') ^ 0x9e3779b9);
  const P = lv.primary;
  const Sc = lv.secondary;
  const A = lv.accent;
  const W = lv.wing || lv.primary;

  const body = [];
  const dark = [];
  const addB = (g, c) => body.push(paint(g, c));
  const addD = (g, c = CARBON) => dark.push(paint(g, c));

  // ---- fuselage (nose + monocoque + engine cover) and sidepods
  addB(loftGeometry(FUSE, xsRange(-2.15, 3.0, step), K), P);
  addB(loftGeometry(POD_R, xsRange(-1.95, 1.05, step * 1.2), K), P);
  addB(loftGeometry(POD_L, xsRange(-1.95, 1.05, step * 1.2), K), P);
  addB(loftGeometry(AIRBOX, xsRange(-1.4, -0.08, step * 1.2), 12), P);

  // sampling helpers for decals (surface-following)
  const SF = {};
  const SP = {};
  const SF2 = {};
  const fuseDecal = (color, nu, nv, fn, off = 0.011) => {
    addB(paramSurface(nu, nv, (u, v, o) => {
      const r = fn(u, v);
      FUSE(r[0], SF);
      const hw = SF.z1 - 0.03;
      const z = clamp(r[1], -hw, hw);
      o[0] = r[0];
      o[1] = topY(SF, z) + off;
      o[2] = z;
    }, [0, 1, 0]), color);
  };
  const podDecal = (color, nu, nv, fn, sgn, off = 0.011) => {
    const prof = sgn > 0 ? POD_R : POD_L;
    addB(paramSurface(nu, nv, (u, v, o) => {
      const r = fn(u, v);
      POD_R(r[0], SP);
      FUSE(r[0], SF2);
      const zmin = SF2.z1 + 0.025;
      const zmax = Math.max(zmin + 0.01, SP.z1 - 0.03);
      const z = clamp(r[1], zmin, zmax);
      o[0] = r[0];
      o[1] = topY(SP, z) + off;
      o[2] = sgn * z;
    }, [0, 1, 0]), color);
    return prof;
  };
  const podSide = (color, xa, xb, ya, yb, sgn) => {
    addB(paramSurface(2, 2, (u, v, o) => {
      const x = xa + (xb - xa) * u;
      const y = ya + (yb - ya) * v;
      POD_R(x, SP);
      o[0] = x;
      o[1] = y;
      o[2] = sgn * (sideZ(SP, y, 1) + 0.006);
    }, [0, 0, sgn]), color);
  };

  // livery pattern
  const pat = lv.pattern || 'solid';
  const nvLong = (a, b) => Math.max(2, Math.round(Math.abs(b - a) / 0.09));
  if (pat === 'stripe') {
    fuseDecal(Sc, 2, nvLong(-2.1, 2.95), (u, v) => [-2.1 + v * 5.05, -0.075 + u * 0.15]);
    for (const sg of [1, -1]) {
      fuseDecal(A, 1, nvLong(-2.1, 2.95), (u, v) => [-2.1 + v * 5.05, sg * (0.095 + u * 0.02)], 0.012);
    }
  } else if (pat === 'split') {
    fuseDecal(Sc, 8, nvLong(-2.15, -0.15), (u, v) => [-2.15 + v * 2.0, -0.5 + u]);
    for (const sg of [1, -1]) podDecal(Sc, 6, nvLong(-1.95, -0.3), (u, v) => [-1.95 + v * 1.65, 0.3 + u * 0.7], sg);
  } else if (pat === 'chevron') {
    const k = 1.35;
    for (const x0 of [1.15, 0.2, -0.75]) {
      fuseDecal(Sc, 12, 3, (u, v) => {
        const z = -0.32 + u * 0.64;
        return [x0 - k * Math.abs(z) + v * 0.2, z];
      });
      for (const sg of [1, -1]) {
        podDecal(Sc, 8, 3, (u, v) => {
          const z = 0.34 + u * 0.4;
          return [x0 - k * z + v * 0.2, z];
        }, sg);
      }
    }
  } else {
    // solid: secondary on tail cover, and thin accent line on nose
    fuseDecal(Sc, 8, nvLong(-2.15, -1.5), (u, v) => [-2.15 + v * 0.65, -0.5 + u]);
    fuseDecal(A, 1, nvLong(0.9, 2.9), (u, v) => [0.9 + v * 2.0, -0.012 + u * 0.024], 0.012);
  }
  // nose tip + roundel
  fuseDecal(Sc, 4, 4, (u, v) => [2.62 + v * 0.38, -0.2 + u * 0.4]);
  fuseDecal(WHITE, 6, 10, (u, v) => {
    const a = v * TAU;
    return [2.12 + 0.068 * u * Math.cos(a), 0.068 * u * Math.sin(a)];
  }, 0.014);
  // accent line along each sidepod top edge
  for (const sg of [1, -1]) {
    podDecal(A, 1, 24, (u, v) => {
      const x = 0.95 - v * 2.25;
      POD_R(x, SP);
      return [x, SP.z1 - 0.07 + u * 0.03];
    }, sg, 0.013);
  }
  // cockpit opening
  addD(paramSurface(8, 14, (u, v, o) => {
    const a = v * TAU;
    const x = 0.42 + 0.47 * u * Math.cos(a);
    const z = 0.175 * u * Math.sin(a);
    FUSE(x, SF);
    o[0] = x;
    o[1] = topY(SF, clamp(z, SF.z0 + 0.03, SF.z1 - 0.03)) + 0.012;
    o[2] = z;
  }, [0, 1, 0]), BLACKISH);
  // engine-cover cooling outlet slits
  for (const dz of [-0.07, 0, 0.07]) {
    fuseDecal(BLACKISH, 1, 5, (u, v) => [-1.55 + v * 0.22, dz - 0.012 + u * 0.024], 0.012);
  }

  // sponsor blocks (deterministic per team)
  const pal = [WHITE, BLACKISH, A, Sc, WHITE];
  for (const sg of [1, -1]) {
    let x = 0.55;
    for (let i = 0; i < 4; i++) {
      const len = 0.22 + rnd() * 0.3;
      const ya = 0.2 + rnd() * 0.12;
      const hh = 0.07 + rnd() * 0.07;
      podSide(pal[Math.floor(rnd() * pal.length)], x - len, x, ya, ya + hh, sg);
      x -= len + 0.12 + rnd() * 0.12;
      if (x < -1.1) break;
    }
    // fuselage side block near the cockpit
    addB(boxAt(0.62, 0.52, sg * 0.318, 0.34, 0.07, 0.004), pal[Math.floor(rnd() * pal.length)]);
  }
  addB(boxAt(-1.0, 0.742, 0.0, 0.3, 0.004, 0.09), WHITE);

  // ---- floor, diffuser, intakes
  addD(extrudeXZ([
    [1.55, 0.2], [1.5, 0.62], [0.9, 0.74], [-0.4, 0.78], [-1.0, 0.74], [-1.3, 0.58], [-1.95, 0.46], [-2.05, 0.12],
    [-2.05, -0.12], [-1.95, -0.46], [-1.3, -0.58], [-1.0, -0.74], [-0.4, -0.78], [0.9, -0.74], [1.5, -0.62], [1.55, -0.2],
  ], 0.03, 0.07), CARBON);
  addD(extrudeXY([[-1.45, 0.075], [-2.2, 0.24], [-2.2, 0.29], [-1.45, 0.03]], -0.46, 0.46), CARBON);
  for (const sg of [1, -1]) {
    addB(boxAt(-1.9, 0.18, sg * 0.46, 0.7, 0.2, 0.012), P); // diffuser fences
    addD(boxAt(1.065, 0.25, sg * 0.34, 0.03, 0.19, 0.2), BLACKISH); // sidepod inlet
    addB(boxAt(0.88, 0.69, sg * 0.4, 0.1, 0.045, 0.1), P); // mirror
    addD(boxAt(0.88, 0.66, sg * 0.34, 0.02, 0.05, 0.02), STEEL);
  }
  addD(boxAt(-0.095, 0.79, 0, 0.03, 0.2, 0.19), BLACKISH); // airbox inlet
  // shark fin + exhaust
  addB(extrudeXY([[-1.0, 0.7], [-1.0, 0.8], [-1.95, 0.75], [-1.95, 0.4], [-1.5, 0.55]], -0.006, 0.006), Sc);
  addD(beam([-2.0, 0.4, 0], [-2.28, 0.4, 0], 0.035, 8), STEEL);

  // ---- front wing
  addD(wingSlab(3.3, 0.3, 0, 0.022, -0.95, 0.95, 0.085, 0.085), CARBON);
  const flapSpec = [
    [3.15, 0.25, 0.17, 0.13, 0.17],
    [3.05, 0.22, 0.3, 0.18, 0.235],
    [2.95, 0.2, 0.44, 0.23, 0.3],
  ];
  for (const [x, ch, pitch, y0, y1] of flapSpec) {
    addB(wingSlab(x, ch, pitch, 0.016, 0.1, 0.93, y0, y1), W);
    addB(wingSlab(x, ch, pitch, 0.016, -0.93, -0.1, y1, y0), W);
  }
  for (const sg of [1, -1]) {
    const z0 = sg > 0 ? 0.93 : -0.95;
    addB(extrudeXY([[3.31, 0.06], [3.27, 0.25], [2.95, 0.32], [2.78, 0.23], [2.8, 0.06]], z0, z0 + 0.02), P);
    addB(boxAt(3.0, 0.2, sg * 0.952, 0.28, 0.07, 0.005), A);
    addD(boxAt(2.95, 0.16, sg * 0.06, 0.04, 0.13, 0.025), STEEL); // nose pylons
  }

  // ---- rear wing
  for (const sg of [1, -1]) {
    const z0 = sg > 0 ? 0.49 : -0.51;
    addB(extrudeXY([[-1.88, 0.55], [-1.86, 0.99], [-2.36, 1.0], [-2.38, 0.5]], z0, z0 + 0.02), W);
    addB(boxAt(-2.15, 0.9, sg * 0.514, 0.16, 0.06, 0.005), Sc);
    addB(boxAt(-2.17, 0.74, sg * 0.514, 0.12, 0.05, 0.005), WHITE);
  }
  addB(wingSlab(-2.02, 0.3, 0.42, 0.03, -0.5, 0.5, 0.7, 0.7), W);
  addB(wingSlab(-2.1, 0.28, 0.62, 0.026, -0.5, 0.5, 0.84, 0.84), W); // DRS-style flap
  addB(boxAt(-2.1, 0.9, 0, 0.05, 0.03, 0.08), A);
  addB(wingSlab(-2.12, 0.18, 0.18, 0.016, -0.45, 0.45, 0.52, 0.52), W); // beam wing
  addD(boxAt(-2.04, 0.58, 0, 0.1, 0.4, 0.07), CARBON); // central pylon / swan neck
  addD(beam([-1.95, 0.45, 0], [-2.2, 0.7, 0], 0.025, 6), STEEL);

  // ---- halo
  const halo = (sg) => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.12, 0.72, sg * 0.31), new THREE.Vector3(0.05, 0.9, sg * 0.27), new THREE.Vector3(0.35, 1.0, sg * 0.18),
      new THREE.Vector3(0.68, 1.045, sg * 0.07), new THREE.Vector3(0.9, 1.0, 0),
    ]);
    return new THREE.TubeGeometry(c, hi ? 14 : 8, 0.017, 6, false);
  };
  addD(halo(1), '#464a52');
  addD(halo(-1), '#464a52');
  addD(beam([0.9, 1.0, 0], [1.0, 0.64, 0], 0.02, 6), '#464a52');

  // ---- suspension arms
  const arms = (x, track, ry, hubTop, hubBot) => {
    for (const sg of [1, -1]) {
      const hz = sg * (track - 0.14);
      const bz = sg * 0.2;
      addD(beam([x, hubTop, hz], [x + 0.2, 0.2, bz], 0.012, 5), STEEL);
      addD(beam([x, hubTop, hz], [x - 0.2, 0.2, bz], 0.012, 5), STEEL);
      addD(beam([x, hubBot, hz], [x + 0.22, 0.1, bz], 0.012, 5), STEEL);
      addD(beam([x, hubBot, hz], [x - 0.22, 0.1, bz], 0.012, 5), STEEL);
      addD(beam([x, ry, hz], [x + 0.05, 0.4, sg * 0.16], 0.01, 5), STEEL);
    }
  };
  arms(CAR.frontAxle, CAR.trackF, 0.5, 0.42, 0.2);
  arms(CAR.rearAxle, CAR.trackR, 0.5, 0.44, 0.2);

  // ---- merge into meshes
  const mats = sharedMaterials();
  const bodyGeo = mergeGeometries(body);
  const darkGeo = mergeGeometries(dark);
  body.forEach((g) => g.dispose());
  dark.forEach((g) => g.dispose());

  const group = new THREE.Group();
  group.name = `car-${team.id || 'team'}`;
  const bodyG = new THREE.Group();
  bodyG.name = 'body';
  group.add(bodyG);
  const bodyMesh = new THREE.Mesh(bodyGeo, mats.body);
  bodyMesh.name = 'bodyMesh';
  const darkMesh = new THREE.Mesh(darkGeo, mats.dark);
  darkMesh.name = 'darkMesh';
  bodyG.add(bodyMesh, darkMesh);

  let helmetMesh = null;
  if (helmet) {
    helmetMesh = new THREE.Mesh(buildHelmetGeometry(driver, lv, hi), mats.helmet);
    helmetMesh.name = 'helmet';
    bodyG.add(helmetMesh);
  }

  const lightMat = new THREE.MeshBasicMaterial({ color: 0x4a0606 });
  const rearLight = new THREE.Mesh(boxAt(-2.19, 0.3, 0, 0.04, 0.12, 0.2), lightMat);
  rearLight.name = 'rearLight';
  bodyG.add(rearLight);

  // wheels: steer pivots (front) carry the spinning mesh
  const wf = buildWheelGeometry(CAR.radiusF, CAR.widthF, lv, hi);
  const wr = buildWheelGeometry(CAR.radiusR, CAR.widthR, lv, hi);
  const mk = (geo, name) => {
    const m = new THREE.Mesh(geo, mats.wheel);
    m.name = name;
    return m;
  };
  const wheels = { fl: mk(wf, 'wheelFL'), fr: mk(wf, 'wheelFR'), rl: mk(wr, 'wheelRL'), rr: mk(wr, 'wheelRR') };
  const steerPivots = { fl: new THREE.Group(), fr: new THREE.Group() };
  steerPivots.fl.position.set(CAR.frontAxle, CAR.radiusF, -CAR.trackF);
  steerPivots.fr.position.set(CAR.frontAxle, CAR.radiusF, CAR.trackF);
  steerPivots.fl.add(wheels.fl);
  steerPivots.fr.add(wheels.fr);
  wheels.rl.position.set(CAR.rearAxle, CAR.radiusR, -CAR.trackR);
  wheels.rr.position.set(CAR.rearAxle, CAR.radiusR, CAR.trackR);
  group.add(steerPivots.fl, steerPivots.fr, wheels.rl, wheels.rr);

  const blobGeo = new THREE.PlaneGeometry(5.5, 2.04);
  blobGeo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobGeo, mats.blob);
  blob.name = 'blob';
  blob.position.set(0.45, 0.03, 0);
  blob.renderOrder = 2;
  group.add(blob);

  group.userData = {
    wheels,
    steerPivots,
    body: bodyG,
    rearLight,
    helmet: helmetMesh,
    blob,
    dims: { length: 5.65, width: 2.04, height: 1.05, wheelbase: CAR.wheelbase },
    _roll: 0,
    _pitch: 0,
    _lightOn: false,
    _ownedGeos: [bodyGeo, darkGeo, wf, wr, blobGeo],
  };
  return group;
}

const _lightOff = new THREE.Color(0x4a0606);
const _lightOn = new THREE.Color(0xff1010);

/** Pose the car from a CarSnapshot (allocation free). */
export function updateCarModel(group, c, dt) {
  const ud = group.userData;
  group.position.set(c.x, 0, c.y);
  group.rotation.y = -c.heading;
  const st = -c.steerAngle;
  ud.steerPivots.fl.rotation.y = st;
  ud.steerPivots.fr.rotation.y = st;
  const sp = c.speed * dt;
  const w = ud.wheels;
  const rf = sp / CAR.radiusF;
  const rr = sp / CAR.radiusR;
  w.fl.rotation.z -= rf;
  w.fr.rotation.z -= rf;
  w.rl.rotation.z -= rr;
  w.rr.rotation.z -= rr;
  if (w.fl.rotation.z < -TAU) {
    w.fl.rotation.z += TAU;
    w.fr.rotation.z += TAU;
  }
  if (w.rl.rotation.z < -TAU) {
    w.rl.rotation.z += TAU;
    w.rr.rotation.z += TAU;
  }
  const roll = -clamp(c.ay * 0.002, -0.06, 0.06);
  const pitch = clamp(c.ax * 0.0015, -0.06, 0.06);
  const k = dt > 0 ? Math.min(1, dt * 14) : 1;
  ud._roll += (roll - ud._roll) * k;
  ud._pitch += (pitch - ud._pitch) * k;
  ud.body.rotation.x = ud._roll;
  ud.body.rotation.z = ud._pitch;
  const on = c.brake > 0.1;
  if (on !== ud._lightOn) {
    ud._lightOn = on;
    ud.rearLight.material.color.copy(on ? _lightOn : _lightOff);
  }
}

export function setCarShadow(group, cast, receiveBlob = true) {
  group.traverse((o) => {
    if (o.isMesh && o.name !== 'blob' && o.name !== 'rearLight') o.castShadow = cast;
  });
  group.userData.blob.visible = receiveBlob;
}

export function disposeCarModel(group) {
  const ud = group.userData;
  if (ud._ownedGeos) ud._ownedGeos.forEach((g) => g.dispose());
  if (ud.helmet) ud.helmet.geometry.dispose();
  ud.rearLight.geometry.dispose();
  ud.rearLight.material.dispose();
  ud._ownedGeos = null;
}
