import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxCorners, sweepExtents, solveFraming } from '../../src/render/framing.js';
import { CarPreviewController } from '../../src/render/carPreview.js';
import { TEAMS } from '../../src/data/teams.js';

/** project a world point with the (updated) camera into canvas px */
function toPx(cam, p, W, H) {
  cam.updateMatrixWorld(true);
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H, z: v.z };
}

test('solveFraming: subject centred in the free rect and within margin', () => {
  const e = { uMin: -0.3, uMax: 0.3, vMin: -0.1, vMax: 0.1 };
  const r = solveFraming(e, 1000, 600, { left: 400 }, 0.8);
  assert.ok(r.free.x === 400 && r.free.w === 600);
  // width-limited: subject spans 80 % of the free width
  assert.ok(Math.abs(r.f * 0.6 - 600 * 0.8) < 1e-6);
  // extent centre (u=0) lands on the free rect centre (x = 700)
  assert.ok(Math.abs(500 - r.offsetX - 700) < 1e-6);
});

for (const aspect of [0.5, 0.8, 1.333, 1.778, 2]) {
  test(`team preview: every team's whole car stays inside the viewport at all turntable angles (aspect ${aspect})`, () => {
    const H = 600;
    const W = Math.round(H * aspect);
    const pv = new CarPreviewController({ quality: 'low' });
    pv.resize(W, H);
    for (const team of TEAMS) {
      pv.showTeam(team.id, 0);
      const cam = pv.camera;
      const car = pv.current;
      const bx = car.userData.previewBox;
      for (let a = 0; a < Math.PI * 2; a += 0.2) {
        pv.turntable.rotation.y = a;
        pv.update(0.016, null);
        pv.turntable.rotation.y = a; // update spins; keep exact angle
        // box corners in turntable space (car shifted by -0.45), rotated by the turntable angle
        const sh = { min: [bx.min[0] - 0.45, bx.min[1], bx.min[2]], max: [bx.max[0] - 0.45, bx.max[1], bx.max[2]] };
        for (const p of boxCorners(sh, a)) {
          const px = toPx(cam, p, W, H);
          assert.ok(px.x > W * 0.03 && px.x < W * 0.97 && px.y > H * 0.03 && px.y < H * 0.97, `${team.id} a=${a.toFixed(1)} corner at ${px.x.toFixed(0)},${px.y.toFixed(0)} of ${W}x${H}`);
        }
      }
    }
    pv.dispose();
  });
}

test('setPadding centres the car in the free rectangle between panels', () => {
  const W = 1200;
  const H = 700;
  const pv = new CarPreviewController({ quality: 'low' });
  pv.resize(W, H);
  pv.showTeam(TEAMS[0].id, 0);
  pv.turntable.rotation.y = 0;
  pv.setPadding({ left: 360, right: 300, top: 60, bottom: 40 });
  assert.deepEqual(pv.getPadding(), { left: 360, right: 300, top: 60, bottom: 40 });
  pv.update(0, null);
  pv.turntable.rotation.y = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const bx = pv.current.userData.previewBox;
  const sh = { min: [bx.min[0] - 0.45, bx.min[1], bx.min[2]], max: [bx.max[0] - 0.45, bx.max[1], bx.max[2]] };
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    for (const p of boxCorners(sh, a)) {
      const px = toPx(pv.camera, p, W, H);
      minX = Math.min(minX, px.x); maxX = Math.max(maxX, px.x); minY = Math.min(minY, px.y); maxY = Math.max(maxY, px.y);
    }
  }
  assert.ok(minX >= 360 - 1 && maxX <= W - 300 + 1, `x range ${minX}..${maxX}`);
  assert.ok(minY >= 60 - 1 && maxY <= H - 40 + 1, `y range ${minY}..${maxY}`);
  assert.ok(Math.abs((minX + maxX) / 2 - (360 + W - 300) / 2) < 25, 'centred horizontally in free area');
  pv.setPadding(null);
  assert.deepEqual(pv.getPadding(), { left: 0, right: 0, top: 0, bottom: 0 });
  pv.dispose();
});

for (const [W, H] of [[800, 600], [1280, 720], [400, 800], [1600, 800]]) {
  test(`podium: 3 steps with liveried cars, whole podium visible during the orbit (${W}x${H})`, () => {
    const pv = new CarPreviewController({ quality: 'low' });
    pv.resize(W, H);
    pv.showPodium([
      { teamId: TEAMS[3].id, position: 3, name: 'C' },
      { teamId: TEAMS[1].id, position: 1, name: 'A' },
      { teamId: TEAMS[2].id, position: 2, name: 'B' },
    ]);
    assert.equal(pv.podium.visible, true);
    assert.equal(pv._podiumCars.length, 3);
    const box = new THREE.Box3().setFromObject(pv.podium);
    const corners = boxCorners({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, 0);
    for (let t = 0; t < 60; t += 1.5) {
      pv.update(1.5, null);
      for (const p of corners) {
        const px = toPx(pv.camera, p, W, H);
        assert.ok(px.x >= 0 && px.x <= W && px.y >= 0 && px.y <= H, `t=${t} corner ${px.x.toFixed(0)},${px.y.toFixed(0)}`);
      }
    }
    // P1 centre, P2 left, P3 right (cars were given as P3, P1, P2)
    assert.deepEqual(pv._podiumCars.map((c) => c.position.x), [3.7, 0, -3.7]);
    pv.dispose();
  });
}

test('showPodium tolerates short / odd lists and unknown teams', () => {
  const pv = new CarPreviewController({ quality: 'low' });
  pv.showPodium([]);
  pv.showPodium([{ teamId: 'nope', position: 1, name: 'X' }]);
  pv.showPodium([{ teamId: TEAMS[0].id }, { teamId: TEAMS[1].id, position: 1 }, { teamId: TEAMS[2].id, position: 1 }, { teamId: TEAMS[3].id }]);
  assert.equal(pv._podiumCars.length, 3);
  assert.equal(new Set(pv._podiumCars.map((c) => c.position.x)).size, 3);
  pv.showTeam(TEAMS[0].id, 1);
  assert.equal(pv.podium.visible, false);
  pv.dispose();
});

test('solveFraming: a short free band between two panels keeps the subject in that band', () => {
  const e = { uMin: -0.33, uMax: 0.33, vMin: -0.14, vMax: 0.09 };
  const fr = solveFraming(e, 414, 700, { left: 44, right: 44, top: 61, bottom: 465 }, 0.8);   // 174 px band, 25% of H = 175
  assert.ok(Math.abs(fr.free.y + fr.free.h / 2 - (61 + 174 / 2)) < 1);
  assert.ok(fr.offsetY > 150);
});
