// Instanced scenery: trees / palms / buildings / grandstands / distant hills, seeded by trackDef.seed.
// Guarantee: no instance is placed within wallOffset + 6 m of ANY centreline sample (spatial hash).
import * as THREE from 'three';
import {
  PointHash, mergeGeometries, paint, paintFn, boxAt, beam, mulberry32, hashString, clamp, TAU,
} from './geomUtil.js';
import { createWindowTexture } from './textures.js';
import { computeLandMargins, isWaterTheme, findCornerRuns } from './trackMesh.js';

const SCENERY_CLEARANCE = 6;

function treeRound(hi) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6).translate(0, 1.6, 0), '#5a3b22'));
  const crown = new THREE.IcosahedronGeometry(2.3, hi ? 1 : 0);
  crown.scale(1, 1.15, 1);
  crown.translate(0, 5.0, 0);
  parts.push(paintFn(crown, (x, y, z, c) => {
    const t = clamp((y - 2.6) / 5.2, 0, 1);
    c.setRGB(0.1 + 0.12 * t, 0.32 + 0.22 * t, 0.07 + 0.06 * t);
  }));
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}
function treePine(hi) {
  const seg = hi ? 7 : 5;
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6).translate(0, 1.2, 0), '#4d3420'));
  const cones = [[2.4, 3.4, 3.0], [1.9, 3.0, 5.1], [1.35, 2.7, 7.0], [0.8, 2.2, 8.7]];
  for (const [r, h, y] of cones) {
    const g = new THREE.ConeGeometry(r, h, seg).translate(0, y, 0);
    parts.push(paintFn(g, (x, yy, z, c) => {
      const t = clamp((yy - (y - h / 2)) / h, 0, 1);
      c.setRGB(0.05 + 0.05 * t, 0.2 + 0.14 * t, 0.07 + 0.04 * t);
    }));
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}
function palmGeo(hi) {
  const parts = [];
  const pts = [[0, 0], [0.25, 2.5], [0.7, 5], [1.4, 7]];
  for (let i = 0; i < pts.length - 1; i++) {
    parts.push(paint(beam([pts[i][0], pts[i][1], 0], [pts[i + 1][0], pts[i + 1][1], 0], 0.2 - i * 0.03, 6), '#8b6a45'));
  }
  const nF = hi ? 9 : 6;
  for (let k = 0; k < nF; k++) {
    const g = new THREE.ConeGeometry(0.34, 3.6, 4);
    g.translate(0, 1.8, 0);
    g.scale(1, 1, 0.3);
    g.rotateZ(-(Math.PI / 2 + 0.45 + (k % 2) * 0.25));
    g.rotateY((k / nF) * TAU);
    g.translate(1.4, 7, 0);
    parts.push(paintFn(g, (x, y, z, c) => c.setRGB(0.12, 0.42 + 0.1 * ((k % 3) / 2), 0.1)));
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}
function buildingGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const n = g.attributes.normal;
  const a = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const v = n.getY(i) > 0.5 ? 0.5 : n.getY(i) < -0.5 ? 0.3 : 1;
    a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const CROWD = ['#d62828', '#f5f5f5', '#1d4ed8', '#f4c20d', '#2f3542', '#e76f51', '#2a9d8f', '#ffffff'];
function grandstandGeo(rnd) {
  const D = 10;
  const tiers = 6;
  const tierD = 1.55;
  const tierH = 1.3;
  const parts = [];
  const concrete = '#9a9ea8';
  for (let k = 0; k < tiers; k++) {
    const z0 = k * tierD;
    const h = (k + 1) * tierH;
    parts.push(paint(boxAt(0, h / 2, (z0 + D) / 2, 1, h, D - z0), concrete));
    const cols = 44;
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.08) continue;
      const col = CROWD[Math.floor(rnd() * CROWD.length)];
      parts.push(paint(boxAt(-0.5 + (c + 0.5) / cols, h + 0.28, z0 + tierD * 0.55, 0.62 / cols, 0.55, 0.55), col));
    }
  }
  const topH = tiers * tierH;
  parts.push(paint(boxAt(0, topH + 3.4, D / 2 + 0.6, 1.02, 0.25, D + 3.5), '#c8ccd4'));
  parts.push(paint(boxAt(0, (topH + 3.4) / 2, D + 0.2, 1, topH + 3.4, 0.3), '#7d828c'));
  for (const sx of [-0.5, 0.5]) parts.push(paint(boxAt(sx, (topH + 3.4) / 2, 2.4, 0.012, topH + 3.4, 0.35), '#5b6068'));
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}
function hillGeo() {
  const g = new THREE.SphereGeometry(1, 12, 7);
  return paint(g, '#ffffff');
}

export function buildScenery(model, def, { quality = 'high' } = {}) {
  const theme = (def && def.theme) || {};
  const list = theme.scenery || [];
  const hi = quality !== 'low';
  const group = new THREE.Group();
  group.name = 'scenery';
  const geos = [];
  const mats = [];
  const tex = [];
  const instanced = [];
  const counts = {};
  const N = model.N;
  const wo = model.wallOffset;
  const R0 = wo + SCENERY_CLEARANCE + 0.5;
  const rnd = mulberry32((def.seed || 1) ^ hashString(def.id || 'scn'));
  const densityQ = hi ? 1 : 0.4;
  const density = clamp(theme.treeDensity != null ? theme.treeDensity : 0.5, 0, 1);

  const hash = new PointHash(16);
  for (let i = 0; i < N; i++) hash.add(model.x[i], model.y[i]);
  const water = isWaterTheme(def);
  const lm = water ? computeLandMargins(model, def) : null;
  const bb = model.bbox;
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minY + bb.maxY) / 2;
  const ph1 = rnd() * TAU;
  const ph2 = rnd() * TAU;
  const patch = (X, Z) => 0.5 + 0.5 * Math.sin(X * 0.017 + ph1) * Math.sin(Z * 0.021 + ph2);
  const onLand = (i, side, dd) => !water || dd < (side > 0 ? lm.right[i] : lm.left[i]) - 6;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  function makeInstanced(name, geo, mat, items) {
    if (!items.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    m.name = name;
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      dummy.position.set(it.x, it.y || 0, it.z);
      dummy.rotation.set(0, it.rot || 0, 0);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
      m.setColorAt(k, it.color || tint.setRGB(1, 1, 1));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    group.add(m);
    geos.push(geo);
    mats.push(mat);
    instanced.push(m);
    counts[name] = items.length;
    return m;
  }
  const vary = (base, spread) => {
    const f = 1 + (rnd() - 0.5) * spread;
    return new THREE.Color(base).multiplyScalar(f);
  };

  // ---------------- trees / palms
  if (list.includes('trees') || list.includes('palms')) {
    const wantTrees = list.includes('trees');
    const wantPalms = list.includes('palms');
    const items = { round: [], pine: [], palm: [] };
    const pinesBias = def.id === 'ridgeback' ? 0.8 : 0.35;
    const cap = Math.round(2400 * densityQ);
    const place = (i, side, dd, jit) => {
      const X = model.x[i] + model.nx[i] * side * dd + model.tx[i] * jit;
      const Z = model.y[i] + model.ny[i] * side * dd + model.ty[i] * jit;
      if (hash.anyWithin(X, Z, R0 + 1.5)) return null;
      if (!onLand(i, side, dd)) return null;
      return [X, Z];
    };
    if (wantTrees) {
      const tiers = [[8, 14, 1, 0.9], [22, 16, 1, 0.8], [40, 30, 2, 0.6], [75, 50, 4, 0.5]];
      for (const [d0, spread, stride, pm] of tiers) {
        for (let i = 0; i < N; i += stride * 2) {
          for (const side of [1, -1]) {
            const X0 = model.x[i] + model.nx[i] * side * (wo + d0);
            const Z0 = model.y[i] + model.ny[i] * side * (wo + d0);
            const p = density * pm * (0.2 + 1.4 * patch(X0, Z0)) * densityQ;
            if (rnd() > p) continue;
            const dd = wo + d0 + rnd() * spread;
            const pos = place(i, side, dd, (rnd() - 0.5) * 6);
            if (!pos) continue;
            const pine = rnd() < pinesBias;
            const s = 0.75 + rnd() * 0.8;
            (pine ? items.pine : items.round).push({
              x: pos[0], z: pos[1], rot: rnd() * TAU, sx: s * (0.9 + rnd() * 0.25), sy: s * (0.85 + rnd() * 0.4), sz: s,
              color: vary(pine ? '#ffffff' : '#ffffff', 0.35),
            });
            if (items.pine.length + items.round.length >= cap) break;
          }
        }
      }
    }
    if (wantPalms) {
      for (let i = 0; i < N; i += 6) {
        for (const side of [1, -1]) {
          if (rnd() > 0.55 * densityQ + 0.15) continue;
          const dd = wo + 7.5 + rnd() * 5;
          const pos = place(i, side, dd, (rnd() - 0.5) * 8);
          if (!pos) continue;
          const s = 0.8 + rnd() * 0.6;
          items.palm.push({ x: pos[0], z: pos[1], rot: rnd() * TAU, sx: s, sy: s * (0.9 + rnd() * 0.3), sz: s, color: vary('#ffffff', 0.3) });
        }
      }
      // loose clusters further out
      for (let i = 0; i < N; i += 10) {
        for (const side of [1, -1]) {
          if (rnd() > 0.5 * densityQ) continue;
          const dd = wo + 16 + rnd() * 30;
          const pos = place(i, side, dd, (rnd() - 0.5) * 20);
          if (!pos) continue;
          const s = 0.8 + rnd() * 0.7;
          items.palm.push({ x: pos[0], z: pos[1], rot: rnd() * TAU, sx: s, sy: s, sz: s, color: vary('#ffffff', 0.3) });
        }
      }
    }
    const foliageMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    makeInstanced('treesRound', treeRound(hi), foliageMat(), items.round);
    makeInstanced('treesPine', treePine(hi), foliageMat(), items.pine);
    makeInstanced('palms', palmGeo(hi), foliageMat(), items.palm);
  }

  // ---------------- buildings (city theme)
  if (list.includes('buildings')) {
    const items = [];
    const placed = new PointHash(24);
    const pastel = ['#f0c79a', '#e8a98a', '#f4e2a8', '#d9b08a', '#a9c4e0', '#eaa59c', '#e8dcb5', '#9fc0cf', '#f2f0ea'];
    const step = Math.max(2, Math.round(10 / model.ds));
    for (const side of [1, -1]) {
      let i = Math.floor(rnd() * step);
      while (i < N) {
        const w = 12 + rnd() * 12;
        const dep = 10 + rnd() * 6;
        const h = 9 + rnd() * 24 * (rnd() < 0.2 ? 1.5 : 1);
        const dd = wo + SCENERY_CLEARANCE + 1.5 + dep / 2 + rnd() * 3;
        const X = model.x[i] + model.nx[i] * side * dd;
        const Z = model.y[i] + model.ny[i] * side * dd;
        const halfDiag = Math.hypot(w, dep) / 2;
        const ok =
          !hash.anyWithin(X, Z, R0 + halfDiag * 0.55 + 2) &&
          !placed.anyWithin(X, Z, halfDiag + 3) &&
          onLand(i, side, dd + dep / 2 + 2);
        if (ok && rnd() < 0.85) {
          placed.add(X, Z);
          const heading = Math.atan2(model.ty[i], model.tx[i]);
          items.push({
            x: X, z: Z, rot: -heading + (side < 0 ? Math.PI : 0), sx: w, sy: h, sz: dep,
            color: new THREE.Color(pastel[Math.floor(rnd() * pastel.length)]),
          });
        }
        i += Math.max(step, Math.round((w + 3 + rnd() * 6) / model.ds));
      }
    }
    const winTex = createWindowTexture();
    if (winTex) tex.push(winTex);
    makeInstanced('buildings', buildingGeo(), new THREE.MeshLambertMaterial({ map: winTex || null, vertexColors: true }), items);
  }

  // ---------------- grandstands
  if (list.includes('grandstands')) {
    const items = [];
    const D = 10;
    const tryStand = (sCenter, len, side) => {
      const idx = Math.round(model.wrapS(sCenter) / model.ds) % N;
      const dFront = wo + SCENERY_CLEARANCE + 1.2; // instance origin = centre of the stand's front edge
      const T = [model.tx[idx], model.ty[idx]];
      const Nn = [model.nx[idx], model.ny[idx]];
      const ox = model.x[idx] + Nn[0] * side * dFront;
      const oz = model.y[idx] + Nn[1] * side * dFront;
      for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) {
        for (const depth of [0, D]) {
          const px = ox + T[0] * len * a + Nn[0] * side * depth;
          const pz = oz + T[1] * len * a + Nn[1] * side * depth;
          if (hash.anyWithin(px, pz, R0)) return;
        }
      }
      if (water && !onLand(idx, side, dFront + D + 2)) return;
      const heading = Math.atan2(T[1], T[0]);
      items.push({ x: ox, z: oz, rot: -heading + (side < 0 ? Math.PI : 0), sx: len, sy: 1, sz: 1, color: new THREE.Color(1, 1, 1) });
    };
    tryStand(model.length - 70, 60, 1);
    tryStand(30, 70, 1);
    tryStand(model.length - 110, 50, -1);
    tryStand(20, 40, -1);
    // outside of the two longest corner runs
    const runs = findCornerRuns(model, { thr: 0.004, padM: 0 }).sort((a, b) => b.count - a.count).slice(0, 3);
    for (const run of runs) {
      const mid = (run.i0 + Math.floor(run.count / 2)) * model.ds;
      const outside = run.sign > 0 ? -1 : 1;
      tryStand(mid, 34, outside);
    }
    const rr = mulberry32((def.seed || 1) ^ 0xabc);
    const gs = grandstandGeo(rr);
    makeInstanced('grandstands', gs, new THREE.MeshLambertMaterial({ vertexColors: true }), items);
  }

  // ---------------- distant hills
  {
    const items = [];
    let maxD = 0;
    for (let i = 0; i < N; i += 4) maxD = Math.max(maxD, Math.hypot(model.x[i] - cx, model.y[i] - cz));
    const count = hi ? 22 : 12;
    const tall = def.id === 'ridgeback' ? 1.9 : water ? 0.7 : 1.0;
    const grass = new THREE.Color(theme.grass || '#3f7d2e');
    const haze = new THREE.Color(theme.fog || '#cfe3f5');
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * TAU + rnd() * 0.25;
      const wx = 200 + rnd() * 260;
      const r = maxD + 420 + wx * 0.6 + rnd() * 420;
      const h = (70 + rnd() * 140) * tall;
      const c = grass.clone().multiplyScalar(0.55 + rnd() * 0.25).lerp(haze, 0.25 + rnd() * 0.25);
      items.push({ x: cx + Math.cos(ang) * r, y: -h * 0.25, z: cz + Math.sin(ang) * r, rot: rnd() * TAU, sx: wx, sy: h, sz: wx * (0.7 + rnd() * 0.6), color: c });
    }
    makeInstanced('hills', hillGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), items);
  }

  group.userData = {
    counts,
    instanced,
    clearance: R0,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      tex.forEach((t) => t.dispose());
      instanced.forEach((m) => m.dispose());
    },
  };
  return group;
}
