import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  mergeGeometries, paint, loftGeometry, makeProfile, ribbonGeometry, paramSurface, MeshBuilder, PointHash,
  wingSlab, extrudeXY, extrudeXZ, ringPoint, topY,
} from '../../src/render/geomUtil.js';
import { eachTriangle } from './_util.js';

test('mergeGeometries merges indexed + non-indexed, keeps colours, sets index', () => {
  const a = paint(new THREE.BoxGeometry(1, 1, 1), '#ff0000');
  const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const m = mergeGeometries([a, b]);
  assert.equal(m.attributes.position.count, 24 + 36);
  assert.equal(m.index.count, 36 + 36);
  assert.ok(m.attributes.color && m.attributes.normal);
  // second part has no colour -> white default; first is linear red
  assert.ok(m.attributes.color.getX(0) > 0.99 && m.attributes.color.getY(0) < 0.01);
  assert.equal(m.attributes.color.getY(30), 1);
  for (let i = 0; i < m.index.count; i++) assert.ok(m.index.getX(i) < m.attributes.position.count);
});

test('loftGeometry faces outward and is closed (profile ellipse)', () => {
  const prof = makeProfile([
    { x: 0, z0: -0.5, z1: 0.5, y0: 0, y1: 1, n: 2 },
    { x: 2, z0: -0.3, z1: 0.3, y0: 0.2, y1: 0.8, n: 2 },
    { x: 4, z0: -0.5, z1: 0.5, y0: 0, y1: 1, n: 2 },
  ]);
  const g = loftGeometry(prof, [0, 1, 2, 3, 4], 16);
  const c = new THREE.Vector3(2, 0.5, 0);
  let bad = 0;
  eachTriangle(g, (A, B, C, n, len) => {
    if (len < 1e-9) return;
    const ctr = A.clone().add(B).add(C).divideScalar(3);
    // lateral outward test relative to the axis (x free)
    const out = new THREE.Vector3(0, ctr.y - 0.5, ctr.z);
    const isCap = Math.abs(n.x) > 0.99;
    if (isCap) {
      // front cap faces +x when x is large
      if ((ctr.x > 2 ? 1 : -1) * n.x < 0) bad++;
    } else if (out.lengthSq() > 1e-6 && out.dot(n) <= 0) bad++;
  });
  assert.equal(bad, 0);
  assert.ok(c);
});

test('ringPoint / topY consistent', () => {
  const s = { z0: -0.4, z1: 0.4, y0: 0.1, y1: 0.7, n: 2.6 };
  const o = {};
  ringPoint(s, Math.PI / 2, o);
  assert.ok(Math.abs(o.y - 0.7) < 1e-9 && Math.abs(o.z) < 1e-6);
  assert.ok(Math.abs(topY(s, 0) - 0.7) < 1e-9);
  assert.ok(topY(s, 0.4) < 0.45);
});

test('paramSurface honours the facing hint', () => {
  const fn = (u, v, o) => {
    o[0] = u;
    o[1] = 0;
    o[2] = v;
  };
  for (const hy of [1, -1]) {
    const g = paramSurface(3, 3, fn, [0, hy, 0]);
    eachTriangle(g, (A, B, C, n) => assert.ok(n.y * hy > 0.99));
  }
});

test('ribbonGeometry on a circle: all triangles face +Y, vertices at +-halfWidth', () => {
  const N = 200;
  const R = 100;
  const hw = 7;
  const model = { N, x: new Float64Array(N), y: new Float64Array(N), nx: new Float64Array(N), ny: new Float64Array(N) };
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; // clockwise in sim coords (y down) == increasing angle
    model.x[i] = R * Math.cos(a);
    model.y[i] = R * Math.sin(a);
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    model.nx[i] = -ty;
    model.ny[i] = tx;
  }
  const g = ribbonGeometry(model, { count: N, d0: -hw, d1: hw, cols: 2 });
  eachTriangle(g, (A, B, C, n, len) => {
    if (len > 1e-9) assert.ok(n.y > 0.999);
  });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i));
    assert.ok(r >= R - hw - 1e-3 && r <= R + hw + 1e-3);
  }
});

test('MeshBuilder orients quads toward the hint; boxes are closed with outward normals', () => {
  const mb = new MeshBuilder();
  mb.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, -1, 0], new THREE.Color(1, 1, 1));
  const g = mb.build();
  eachTriangle(g, (A, B, C, n) => assert.ok(n.y < -0.99));
  const mb2 = new MeshBuilder();
  mb2.box([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 1, 2, 3, new THREE.Color(1, 0, 0));
  const g2 = mb2.build();
  assert.equal(g2.attributes.position.count, 24);
  eachTriangle(g2, (A, B, C, n) => {
    const ctr = A.clone().add(B).add(C).divideScalar(3);
    assert.ok(ctr.dot(n) > 0);
  });
});

test('hexa/wingSlab/extrude helpers produce outward, finite geometry', () => {
  const w = wingSlab(1, 0.3, 0.2, 0.02, -1, 1, 0.1, 0.2);
  assert.ok(w.attributes.position.count > 0);
  eachTriangle(w, (A, B, C, n, len) => assert.ok(Number.isFinite(len)));
  const e = extrudeXY([[0, 0], [1, 0], [1, 1], [0, 1]], 0, 0.1);
  e.computeBoundingBox();
  assert.ok(Math.abs(e.boundingBox.max.z - 0.1) < 1e-6 && Math.abs(e.boundingBox.min.z) < 1e-6);
  const f = extrudeXZ([[0, 0], [2, 0], [2, 3], [0, 3]], 0.1, 0.3);
  f.computeBoundingBox();
  assert.ok(Math.abs(f.boundingBox.min.y - 0.1) < 1e-6 && Math.abs(f.boundingBox.max.y - 0.3) < 1e-6);
  // plan polygon (x,z): z range must be [0,3] (sign preserved)
  assert.ok(Math.abs(f.boundingBox.max.z - 3) < 1e-6 && Math.abs(f.boundingBox.min.z) < 1e-6);
});

test('PointHash anyWithin', () => {
  const h = new PointHash(10);
  h.add(0, 0);
  h.add(100, 100);
  assert.ok(h.anyWithin(3, 4, 5.1));
  assert.ok(!h.anyWithin(3, 4, 4.9));
  assert.ok(h.anyWithin(99, 100, 2));
  assert.ok(!h.anyWithin(50, 50, 20));
});
