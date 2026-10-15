import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TEAMS } from '../../src/data/teams.js';
import { buildCarModel, updateCarModel, disposeCarModel, CAR } from '../../src/render/carModel.js';
import { eachTriangle } from './_util.js';

function snap(over = {}) {
  return {
    id: 0, x: 10, y: -4, heading: 0.7, speed: 50, u: 50, v: 0, yawRate: 0, steerAngle: 0.1, ax: 0, ay: 0, throttle: 1, brake: 0,
    gear: 5, rpm: 0.6, slip: 0, surface: 'asphalt', ...over,
  };
}
function meshes(g) {
  const out = [];
  g.traverse((o) => o.isMesh && out.push(o));
  return out;
}

test('all 10 teams build within the draw-call budget and the size contract', () => {
  assert.equal(TEAMS.length, 10);
  for (const team of TEAMS) {
    for (const driverIdx of [0, 1]) {
      const g = buildCarModel(team, { driverIdx, helmet: true, quality: 'high' });
      g.updateMatrixWorld(true);
      const ms = meshes(g);
      assert.ok(ms.length <= 14, `${team.id}: ${ms.length} meshes`);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.x - 5.7) <= 0.4, `${team.id} length ${size.x}`);
      assert.ok(Math.abs(size.z - 2.0) <= 0.15, `${team.id} width ${size.z}`);
      assert.ok(size.y > 0.9 && size.y < 1.15, `${team.id} height ${size.y}`);
      assert.ok(box.min.y > -0.01, 'sits on the ground');
      assert.ok(box.max.x <= 3.35 && box.min.x >= -2.4, 'x extents within nose/tail spec');
      disposeCarModel(g);
    }
  }
});

test('userData contract', () => {
  const g = buildCarModel(TEAMS[0], { quality: 'high' });
  const u = g.userData;
  for (const k of ['fl', 'fr', 'rl', 'rr']) assert.ok(u.wheels[k] && u.wheels[k].isObject3D, `wheel ${k}`);
  assert.ok(u.steerPivots.fl.isObject3D && u.steerPivots.fr.isObject3D);
  assert.ok(u.body.isGroup);
  assert.ok(u.rearLight.isMesh);
  assert.ok(u.helmet && u.helmet.isMesh);
  assert.deepEqual(Object.keys(u.dims).sort(), ['height', 'length', 'wheelbase', 'width']);
  assert.equal(u.dims.wheelbase, 3.6);
  // wheel positions
  const p = new THREE.Vector3();
  g.updateMatrixWorld(true);
  u.wheels.fl.getWorldPosition(p);
  assert.ok(Math.abs(p.x - 1.98) < 1e-6 && Math.abs(p.z + 0.85) < 1e-6 && Math.abs(p.y - 0.33) < 1e-6);
  u.wheels.rr.getWorldPosition(p);
  assert.ok(Math.abs(p.x + 1.62) < 1e-6 && Math.abs(p.z - 0.82) < 1e-6 && Math.abs(p.y - 0.35) < 1e-6);
  const nh = buildCarModel(TEAMS[0], { helmet: false });
  assert.equal(nh.userData.helmet, null);
});

test('merged geometry has finite data, vertex colours, normals', () => {
  const g = buildCarModel(TEAMS[3], {});
  for (const m of meshes(g)) {
    const a = m.geometry.attributes;
    assert.ok(a.position && a.normal, m.name);
    if (m.material.vertexColors) assert.ok(a.color, m.name);
    for (const arr of [a.position.array, a.normal.array]) for (let i = 0; i < arr.length; i += 97) assert.ok(Number.isFinite(arr[i]));
  }
  // lofted fuselage normals roughly agree with winding (smooth normals vs face normals)
  const body = g.getObjectByName('bodyMesh').geometry;
  let flipped = 0;
  let total = 0;
  const nrm = body.attributes.normal;
  const idx = body.index;
  let t = 0;
  eachTriangle(body, (A, B, C, n, len) => {
    const i = idx.getX(t);
    t += 3;
    if (len < 1e-10) return;
    total++;
    const vn = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (vn.dot(n) < 0) flipped++;
  });
  assert.ok(flipped / total < 0.02, `inconsistent winding ratio ${flipped}/${total}`);
});

test('team liveries differ (vertex colour signature)', () => {
  const sig = new Set();
  for (const team of TEAMS) {
    const g = buildCarModel(team, {});
    const c = g.getObjectByName('bodyMesh').geometry.attributes.color;
    sig.add(`${c.getX(0).toFixed(3)},${c.getY(0).toFixed(3)},${c.getZ(0).toFixed(3)}`);
  }
  assert.ok(sig.size >= 9);
});

test('updateCarModel: pose, steering, wheel spin sign, roll/pitch signs, brake light', () => {
  const g = buildCarModel(TEAMS[1], {});
  updateCarModel(g, snap({ heading: 0.7, steerAngle: 0.2, speed: 60 }), 1 / 60);
  assert.deepEqual([g.position.x, g.position.y, g.position.z], [10, 0, -4]);
  assert.ok(Math.abs(g.rotation.y + 0.7) < 1e-12);
  assert.ok(Math.abs(g.userData.steerPivots.fl.rotation.y + 0.2) < 1e-12);
  assert.ok(g.userData.wheels.fl.rotation.z < 0, 'wheels spin forwards (negative about +Z)');
  assert.ok(Math.abs(g.userData.wheels.rl.rotation.z + (60 / 60) / CAR.radiusR) < 1e-9);
  // right turn (ay>0) -> rotation.x negative; braking (ax<0) -> rotation.z negative (nose down)
  for (let i = 0; i < 40; i++) updateCarModel(g, snap({ ay: 28, ax: -30 }), 1 / 60);
  assert.ok(g.userData.body.rotation.x < 0 && g.userData.body.rotation.x >= -0.06 - 1e-9);
  assert.ok(g.userData.body.rotation.z < 0 && g.userData.body.rotation.z >= -0.06 - 1e-9);
  const c0 = g.userData.rearLight.material.color.r;
  updateCarModel(g, snap({ brake: 1 }), 1 / 60);
  assert.ok(g.userData.rearLight.material.color.r > c0);
  // dt = 0 (paused) must not advance the wheels
  const r = g.userData.wheels.fl.rotation.z;
  updateCarModel(g, snap({}), 0);
  assert.equal(g.userData.wheels.fl.rotation.z, r);
  for (const v of [g.position.x, g.rotation.y, g.userData.body.rotation.x]) assert.ok(Number.isFinite(v));
});

test('heading wraps do not break the pose and low quality still builds', () => {
  const g = buildCarModel(TEAMS[2], { quality: 'low' });
  updateCarModel(g, snap({ heading: 3.14 }), 0.016);
  updateCarModel(g, snap({ heading: -3.14 }), 0.016);
  assert.ok(Math.abs(g.rotation.y - 3.14) < 1e-9);
  assert.ok(meshes(g).length <= 14);
});
