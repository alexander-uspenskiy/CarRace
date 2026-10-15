// Track geometry: asphalt ribbon, kerbs, runoff, gravel, barriers + ad boards, start line, gantry, grid boxes, ground / sea.
// Every part is ONE merged BufferGeometry (<= ~12 draw calls). Coordinates: world = (sim x, 0, sim y).
import * as THREE from 'three';
import {
  MeshBuilder, ribbonGeometry, mergeGeometries, mulberry32, hashString,
} from './geomUtil.js';
import {
  createAsphaltTexture, createGrassTexture, createCheckerTexture, createWaterTexture,
} from './textures.js';

export const GRID_SLOTS = 20;

/** Duplicate of the sim's gridPose formula (spec 4.2) - do NOT import sim/. */
export function gridSlotPose(model, slot) {
  const s = model.wrapS(-(10 + 8 * slot));
  const d = slot % 2 === 0 ? -2.5 : 2.5;
  const p = model.sampleAt(s);
  return { s, d, x: p.x + p.nx * d, y: p.y + p.ny * d, tx: p.tx, ty: p.ty, nx: p.nx, ny: p.ny, heading: Math.atan2(p.ty, p.tx) };
}

export function isWaterTheme(def) {
  const sc = (def && def.theme && def.theme.scenery) || [];
  return !!(def && ((def.theme && def.theme.water) || sc.includes('water') || def.id === 'costa-marina'));
}
function isCityTheme(def) {
  const sc = (def && def.theme && def.theme.scenery) || [];
  return sc.includes('buildings');
}

/** Contiguous corner runs (|kappa| > thr, padded by padM metres each side). Wraps around the lap. */
export function findCornerRuns(model, { thr = 0.004, padM = 15 } = {}) {
  const N = model.N;
  const pad = Math.ceil(padM / model.ds);
  const flag = new Uint8Array(N);
  for (let i = 0; i < N; i++) flag[i] = Math.abs(model.curvature[i]) > thr ? 1 : 0;
  const mark = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!flag[i]) continue;
    for (let k = -pad; k <= pad; k++) mark[(i + k + N * 4) % N] = 1;
  }
  let start = -1;
  for (let i = 0; i < N; i++) {
    if (!mark[i]) {
      start = i;
      break;
    }
  }
  const runs = [];
  if (start < 0) {
    return [{ i0: 0, count: N - 1, sign: Math.sign(model.curvature.reduce((a, b) => a + b, 0)) || 1 }];
  }
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (mark[i]) {
      if (!cur) cur = { i0: i, len: 0, sum: 0 };
      cur.len++;
      cur.sum += model.curvature[i];
    } else if (cur) {
      runs.push({ i0: cur.i0, count: Math.max(1, cur.len - 1), sign: Math.sign(cur.sum) || 1 });
      cur = null;
    }
  }
  if (cur) runs.push({ i0: cur.i0, count: Math.max(1, cur.len - 1), sign: Math.sign(cur.sum) || 1 });
  return runs;
}

/**
 * Distance from the centreline to the shoreline per sample (water themes only). The INSIDE of the lap is solid land
 * (filled by a polygon), only the OUTSIDE has a wobbling shoreline. insideSign: +1 = inside is the right (+d) side.
 */
export function computeLandMargins(model, def) {
  const N = model.N;
  const rnd = mulberry32(hashString(def.id || 'x') ^ ((def.seed || 1) >>> 0));
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const min = model.wallOffset + 24;
  const left = new Float32Array(N);
  const right = new Float32Array(N);
  let tot = 0;
  for (let i = 0; i < N; i++) tot += model.curvature[i];
  const insideSign = tot >= 0 ? 1 : -1;
  for (let i = 0; i < N; i++) {
    const a = 0.5 + 0.5 * (0.6 * Math.sin(i * 0.0062 + ph[0]) + 0.4 * Math.sin(i * 0.0151 + ph[1]));
    const b = 0.5 + 0.5 * (0.6 * Math.sin(i * 0.0057 + ph[2]) + 0.4 * Math.sin(i * 0.0133 + ph[3]));
    const outer = min + 90 * a * b + 25 * a;
    left[i] = insideSign > 0 ? outer : min;
    right[i] = insideSign > 0 ? min : outer;
  }
  // a margin larger than the local radius of curvature (on the inside of a bend) would fold the ribbon: cap it
  const W = 8;
  for (let i = 0; i < N; i++) {
    let kmax = 0;
    for (let k = -W; k <= W; k++) kmax = Math.max(kmax, Math.abs(model.curvature[(i + k + N) % N]));
    if (kmax < 1e-6) continue;
    const cap = Math.max(model.wallOffset + 2, 0.8 / kmax);
    const kc = model.curvature[i];
    if (kc > 0) right[i] = Math.min(right[i], cap);
    else left[i] = Math.min(left[i], cap);
  }
  return { left, right, insideSign };
}

function groundMottle(x, z) {
  const n = Math.sin(x * 0.011) * Math.sin(z * 0.013) + 0.5 * Math.sin(x * 0.029 + z * 0.023) + 0.3 * Math.sin(x * 0.07 - z * 0.06);
  return 0.9 + 0.09 * n;
}

function buildGroundPlane(cx, cz, size, cells, color, uvScale, mottle) {
  const V = cells + 1;
  const pos = new Float32Array(V * V * 3);
  const nor = new Float32Array(V * V * 3);
  const col = new Float32Array(V * V * 3);
  const uv = new Float32Array(V * V * 2);
  const c = new THREE.Color(color);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = cx + (i / cells - 0.5) * size;
      const z = cz + (j / cells - 0.5) * size;
      const k = j * V + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = z;
      nor[k * 3 + 1] = 1;
      const m = mottle ? groundMottle(x, z) : 1;
      col[k * 3] = c.r * m;
      col[k * 3 + 1] = c.g * m;
      col[k * 3 + 2] = c.b * m;
      uv[k * 2] = x / uvScale;
      uv[k * 2 + 1] = z / uvScale;
    }
  }
  const idx = new Uint16Array(cells * cells * 6);
  let q = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * V + i;
      // (x,z) grid: a -> a+1 is +x, a -> a+V is +z. (a, a+V, a+1) has normal +Y ((0,0,dz) x (dx,0,0)).
      idx[q++] = a;
      idx[q++] = a + V;
      idx[q++] = a + 1;
      idx[q++] = a + 1;
      idx[q++] = a + V;
      idx[q++] = a + V + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const AD_COLORS = ['#d8232a', '#1e5bd8', '#f0b429', '#2a9d5c', '#f3f3f3', '#6a3fb5', '#ff7a1a', '#1b1f2a'];

export function buildTrackMesh(model, def, { textures, quality = 'high' } = {}) {
  const theme = (def && def.theme) || {};
  const hw = model.halfWidth;
  const N = model.N;
  const ds = model.ds;
  const water = isWaterTheme(def);
  const city = isCityTheme(def);
  const group = new THREE.Group();
  group.name = 'track';
  const owned = []; // textures we created
  const geos = [];
  const meshes = {};
  const rnd = mulberry32(hashString(def.id || 'track') ^ 0x51ed);

  const grassCol = new THREE.Color(theme.grass || '#3f7d2e');
  const kerbA = new THREE.Color(theme.kerbA || '#e10600');
  const kerbB = new THREE.Color(theme.kerbB || '#ffffff');
  const white = new THREE.Color(1, 1, 1);

  // ---------- textures
  const tx = textures || {};
  const asphaltTex = tx.asphalt !== undefined ? tx.asphalt : createAsphaltTexture({ halfWidth: hw, color: theme.asphalt || '#3a3b3f' });
  const grassTex = tx.grass !== undefined ? tx.grass : createGrassTexture({ color: theme.grass || '#3f7d2e' });
  const checkerTex = tx.checker !== undefined ? tx.checker : createCheckerTexture();
  const waterTex = water ? (tx.water !== undefined ? tx.water : createWaterTexture()) : null;
  if (!textures) owned.push(asphaltTex, grassTex, checkerTex, waterTex);

  // ---------- materials
  const polyOff = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const asphaltMat = new THREE.MeshLambertMaterial({ map: asphaltTex || null, vertexColors: true });
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex || null, vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true, ...polyOff });
  const kerbMat = new THREE.MeshLambertMaterial({ vertexColors: true, ...polyOff });
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const lineMat = new THREE.MeshLambertMaterial({ map: checkerTex || null, vertexColors: true, ...polyOff });
  const decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, ...polyOff });
  const gantryMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const add = (name, geo, mat, { receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = receive;
    group.add(m);
    meshes[name] = m;
    geos.push(geo);
    return m;
  };

  const vk = Math.max(1, Math.round(model.length / 12)) / model.length;
  // the grass texture already carries the theme colour: tint with white to avoid squaring it
  const groundTint = grassTex ? white : grassCol;

  // ---------- asphalt ribbon (one column; the texture carries edge lines and rubber bands)
  {
    const useTex = !!asphaltTex;
    const baseCol = useTex ? white : new THREE.Color(theme.asphalt || '#3a3b3f');
    const g = ribbonGeometry(model, {
      i0: 0, count: N, stride: 1, cols: 1, d0: -hw, d1: hw, y0: 0, y1: 0, color: baseCol,
      uv: (out, i, d, r) => {
        out[0] = (d + hw) / (2 * hw);
        out[1] = r * ds * vk;
      },
    });
    add('asphalt', g, asphaltMat);
  }

  // ---------- ground
  const bb = model.bbox;
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minY + bb.maxY) / 2;
  const groundSize = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) + 6000;
  if (!water) {
    add('ground', buildGroundPlane(cx, cz, groundSize, quality === 'low' ? 24 : 40, groundTint, 12, true).translate(0, -0.02, 0), grassMat);
  } else {
    // land ribbon hugging the track with a wobbling shoreline, sand beach and a big sea plane
    const lm = computeLandMargins(model, def);
    const landG = ribbonGeometry(model, {
      i0: 0, count: Math.floor(N / 2), stride: 2, cols: 1, d0: (i) => -lm.left[i], d1: (i) => lm.right[i],
      y0: -0.02, y1: -0.02, color: groundTint,
      uv: (out, i, d, r, X, Z) => {
        out[0] = X / 12;
        out[1] = Z / 12;
      },
    });
    // infield: polygon through the centreline (the lap never self-intersects, spec 2.2(d))
    const step = 3;
    const shape = new THREE.Shape();
    for (let i = 0; i < N; i += step) {
      if (i === 0) shape.moveTo(model.x[i], -model.y[i]);
      else shape.lineTo(model.x[i], -model.y[i]);
    }
    shape.closePath();
    const infield = new THREE.ShapeGeometry(shape);
    infield.rotateX(-Math.PI / 2);
    infield.translate(0, -0.02, 0);
    {
      const ip = infield.attributes.position;
      const n = ip.count;
      const iuv = new Float32Array(n * 2);
      const icol = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        iuv[k * 2] = ip.getX(k) / 12;
        iuv[k * 2 + 1] = ip.getZ(k) / 12;
        icol[k * 3] = groundTint.r;
        icol[k * 3 + 1] = groundTint.g;
        icol[k * 3 + 2] = groundTint.b;
      }
      infield.setAttribute('uv', new THREE.BufferAttribute(iuv, 2));
      infield.setAttribute('color', new THREE.BufferAttribute(icol, 3));
    }
    const groundGeo = mergeGeometries([landG, infield], { uv: true });
    landG.dispose();
    infield.dispose();
    add('ground', groundGeo, grassMat);
    const sand = new THREE.Color('#d8c89a');
    const beaches = [];
    if (lm.insideSign > 0) {
      // inside is the right side -> beach on the left (negative d)
      beaches.push(ribbonGeometry(model, {
        i0: 0, count: Math.floor(N / 2), stride: 2, cols: 1, d0: (i) => -lm.left[i] - 9, d1: (i) => -lm.left[i] + 1,
        y0: -0.5, y1: -0.02, color: sand,
      }));
    } else {
      beaches.push(ribbonGeometry(model, {
        i0: 0, count: Math.floor(N / 2), stride: 2, cols: 1, d0: (i) => lm.right[i] - 1, d1: (i) => lm.right[i] + 9,
        y0: -0.02, y1: -0.5, color: sand,
      }));
    }
    const beach = mergeGeometries(beaches);
    beaches.forEach((g) => g.dispose());
    add('beach', beach, plainMat);
    const seaGeo = buildGroundPlane(cx, cz, groundSize, 8, '#ffffff', 40, false).translate(0, -0.22, 0);
    const seaMat = new THREE.MeshPhongMaterial({
      map: waterTex || null, color: waterTex ? 0xffffff : 0x2a86b8, specular: 0x3a4f66, shininess: 45,
    });
    const sea = add('water', seaGeo, seaMat, { receive: false });
    sea.userData.isWater = true;
  }

  // ---------- runoff strip (kerb outer edge -> wall), plus gravel traps on the outside of corners
  {
    const rc = city ? new THREE.Color('#70737a') : grassCol.clone().multiplyScalar(1.12);
    const inner = hw + model.kerbWidth - 0.05;
    const mk = (side) =>
      ribbonGeometry(model, {
        i0: 0, count: Math.floor(N / 2), stride: 2, cols: 1, d0: side > 0 ? inner : -model.wallOffset - 0.3,
        d1: side > 0 ? model.wallOffset + 0.3 : -inner, y0: -0.008, y1: -0.008, color: rc,
      });
    const a = mk(1);
    const b = mk(-1);
    const geo = mergeGeometries([a, b]);
    a.dispose();
    b.dispose();
    add('runoff', geo, plainMat);
  }
  const corners = findCornerRuns(model, { thr: 0.004, padM: 15 });
  {
    const gravel = new THREE.Color(city ? '#8d8f94' : '#b9a982');
    const parts = [];
    const gOut = Math.min(9, Math.max(2, model.runoff - 2.5));
    for (const run of corners) {
      const outside = run.sign > 0 ? -1 : 1; // turning right -> outside is the left (negative d)
      const dA = hw + model.kerbWidth + 1.2;
      const dB = hw + model.kerbWidth + gOut;
      if (dB - dA < 0.8 || model.runoff < 4) continue;
      parts.push(ribbonGeometry(model, {
        i0: run.i0, count: run.count, stride: 1, cols: 1, d0: outside > 0 ? dA : -dB, d1: outside > 0 ? dB : -dA,
        y0: 0.0, y1: 0.0, color: gravel,
      }));
    }
    if (parts.length) {
      const geo = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      add('gravel', geo, plainMat);
    }
  }

  // ---------- kerbs (alternating stripes, both sides, along corner runs)
  {
    const mb = new MeshBuilder();
    const up = [0, 1, 0];
    const kw = model.kerbWidth;
    for (const run of corners) {
      for (let k = 0; k < run.count; k++) {
        const i = (run.i0 + k) % N;
        const j = (i + 1) % N;
        const col = Math.floor(k / 1) % 2 === 0 ? kerbA : kerbB;
        for (const side of [1, -1]) {
          const d0 = side * (hw - 0.04);
          const d1 = side * (hw + kw);
          const P = (idx, d, y) => [model.x[idx] + model.nx[idx] * d, y, model.y[idx] + model.ny[idx] * d];
          mb.quad(P(i, d0, 0.012), P(i, d1, 0.03), P(j, d1, 0.03), P(j, d0, 0.012), up, col);
        }
      }
    }
    if (mb.n > 0) add('kerbs', mb.build(), kerbMat);
  }

  // ---------- barriers + ad boards
  {
    const mb = new MeshBuilder();
    const lowerCol = new THREE.Color('#25282e');
    const wo = model.wallOffset;
    const H = 1.1;
    const HM = 0.55;
    const THK = 0.45;
    const step = 2;
    const nSeg = Math.floor(N / step);
    for (const side of [1, -1]) {
      for (let k = 0; k < nSeg; k++) {
        const i = k * step;
        const j = (k === nSeg - 1 ? 0 : (k + 1) * step) % N;
        const hint = [-side * model.nx[i], 0, -side * model.ny[i]];
        const upper = Math.floor(k / 2) % 2 === 0 ? kerbA : kerbB;
        const P = (idx, d, y) => [model.x[idx] + model.nx[idx] * d, y, model.y[idx] + model.ny[idx] * d];
        const dIn = side * wo;
        const dOut = side * (wo + THK);
        mb.quad(P(i, dIn, 0), P(j, dIn, 0), P(j, dIn, HM), P(i, dIn, HM), hint, lowerCol);
        mb.quad(P(i, dIn, HM), P(j, dIn, HM), P(j, dIn, H), P(i, dIn, H), hint, upper);
        mb.quad(P(i, dIn, H), P(j, dIn, H), P(j, dOut, H), P(i, dOut, H), [0, 1, 0], upper === kerbA ? kerbA : kerbB);
      }
    }
    // ad boards on straights
    const adStep = Math.max(2, Math.round(14 / ds));
    const ux = [0, 1, 0];
    for (let i = 0; i < N; i += adStep) {
      let maxK = 0;
      for (let k = -5; k <= 5; k++) maxK = Math.max(maxK, Math.abs(model.curvature[(i + k + N) % N]));
      if (maxK > 0.0012) continue;
      for (const side of [1, -1]) {
        const tcol = new THREE.Color(AD_COLORS[Math.floor(rnd() * AD_COLORS.length)]);
        const dd = side * (wo + THK + 0.35);
        const c = [model.x[i] + model.nx[i] * dd, 1.9, model.y[i] + model.ny[i] * dd];
        const t = [model.tx[i], 0, model.ty[i]];
        const n = [model.nx[i], 0, model.ny[i]];
        const dark = new THREE.Color('#20232a');
        const front = side > 0 ? 5 : 4;
        mb.box(c, t, ux, n, 4.5, 0.65, 0.06, (f) => (f === front ? tcol : dark));
        // white stripe along the lower quarter of the front face
        const off = -side * 0.065;
        const P = (a, y) => [c[0] + t[0] * a + n[0] * off, y, c[2] + t[2] * a + n[2] * off];
        mb.quad(P(-4.45, 1.28), P(4.45, 1.28), P(4.45, 1.45), P(-4.45, 1.45), [-side * n[0], 0, -side * n[2]], white);
        for (const a of [-3.4, 3.4]) {
          const pc = [model.x[i] + model.nx[i] * dd + t[0] * a, 0.6, model.y[i] + model.ny[i] * dd + t[2] * a];
          mb.box(pc, t, ux, n, 0.06, 0.62, 0.05, dark);
        }
      }
    }
    add('barriers', mb.build(), wallMat, { receive: false });
  }

  // ---------- start/finish line
  {
    const nU = Math.max(2, Math.round((2 * hw) / 2));
    const g = ribbonGeometry(model, {
      i0: 0, count: 1, stride: 1, cols: 1, d0: -hw, d1: hw, y0: 0.02, y1: 0.02, color: white,
      uv: (out, i, d, r) => {
        out[0] = ((d + hw) / (2 * hw)) * nU;
        out[1] = r * 1;
      },
    });
    add('startLine', g, lineMat);
  }

  // ---------- grid boxes (U-shaped white outlines at the 20 grid poses)
  {
    const mb = new MeshBuilder();
    const up = [0, 1, 0];
    const lineCol = new THREE.Color('#f2f2f2');
    const y = 0.022;
    for (let slot = 0; slot < GRID_SLOTS; slot++) {
      const p = gridSlotPose(model, slot);
      const T = [p.tx, p.ty];
      const Nn = [p.nx, p.ny];
      const W = (a, dd, yy) => [p.x + T[0] * a + Nn[0] * dd, yy, p.y + T[1] * a + Nn[1] * dd];
      const a0 = 0.9;
      const a1 = 4.2;
      const hwid = 0.8;
      const th = 0.16;
      for (const sg of [-1, 1]) {
        mb.quad(W(a0, sg * hwid - th / 2, y), W(a1, sg * hwid - th / 2, y), W(a1, sg * hwid + th / 2, y), W(a0, sg * hwid + th / 2, y), up, lineCol);
      }
      mb.quad(W(a0, -hwid, y), W(a0 + th, -hwid, y), W(a0 + th, hwid, y), W(a0, hwid, y), up, lineCol);
    }
    add('gridBoxes', mb.build(), decalMat);
  }

  // ---------- gantry over the start line
  {
    const mb = new MeshBuilder();
    const i = 0;
    const t = [model.tx[i], 0, model.ty[i]];
    const n = [model.nx[i], 0, model.ny[i]];
    const up = [0, 1, 0];
    const base = [model.x[i], 0, model.y[i]];
    const at = (dd, y, tt = 0) => [base[0] + n[0] * dd + t[0] * tt, y, base[2] + n[2] * dd + t[2] * tt];
    const steel = new THREE.Color('#2b2f38');
    const lightC = new THREE.Color('#7a0e0e');
    const px = hw + 2.0;
    for (const sg of [-1, 1]) mb.box(at(sg * px, 3.5), t, up, n, 0.35, 3.5, 0.35, steel);
    const halfSpan = px + 0.3;
    mb.box(at(0, 6.8), t, up, n, 0.6, 0.6, halfSpan, steel);
    // checker bands on both faces of the beam
    const sq = 0.6;
    const cnt = Math.ceil((2 * halfSpan) / sq);
    for (const f of [1, -1]) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cnt; c++) {
          const d0 = -halfSpan + (c * 2 * halfSpan) / cnt;
          const d1 = -halfSpan + ((c + 1) * 2 * halfSpan) / cnt;
          const y0 = 6.8 - 0.5 + r * 0.5;
          const y1 = y0 + 0.5;
          const off = f * 0.61;
          const col = (r + c) % 2 === 0 ? new THREE.Color('#f4f4f4') : new THREE.Color('#111111');
          mb.quad(at(d0, y0, off), at(d1, y0, off), at(d1, y1, off), at(d0, y1, off), [f * t[0], 0, f * t[2]], col);
        }
      }
    }
    // light bar
    mb.box(at(0, 5.7), t, up, n, 0.3, 0.35, 4.2, steel);
    for (let k = 0; k < 5; k++) {
      const dd = -3.2 + k * 1.6;
      for (const f of [1, -1]) mb.box(at(dd, 5.7, f * 0.31), t, up, n, 0.04, 0.22, 0.22, lightC);
    }
    add('gantry', mb.build(), gantryMat, { receive: false });
  }

  // ---------- finalize
  let triangles = 0;
  let vertices = 0;
  for (const g of geos) {
    vertices += g.attributes.position.count;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  const mats = [asphaltMat, grassMat, plainMat, kerbMat, wallMat, lineMat, decalMat, gantryMat];
  group.userData = {
    meshes,
    corners,
    stats: { triangles, vertices, meshCount: Object.keys(meshes).length },
    update(dt) {
      const w = meshes.water;
      if (w && w.material.map) {
        w.material.map.offset.x += dt * 0.004;
        w.material.map.offset.y += dt * 0.0025;
      }
    },
    setShadowReceive(on) {
      for (const k of ['asphalt', 'ground', 'runoff', 'gravel', 'kerbs', 'startLine', 'gridBoxes']) if (meshes[k]) meshes[k].receiveShadow = on;
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      for (const m of group.children) if (m.material && !mats.includes(m.material)) m.material.dispose();
      mats.forEach((m) => m.dispose());
      owned.forEach((t) => t && t.dispose());
    },
  };
  return group;
}
