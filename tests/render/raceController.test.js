import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TEAMS } from '../../src/data/teams.js';
import { TRACKS, getTrackModel } from '../../src/data/tracks/index.js';
import { RaceController } from '../../src/render/raceController.js';
import { CarPreviewController } from '../../src/render/carPreview.js';
import { gridSlotPose } from '../../src/render/trackMesh.js';

function metas() {
  const out = [];
  for (let ti = 0; ti < TEAMS.length; ti++) {
    for (let s = 0; s < 2; s++) {
      const t = TEAMS[ti];
      out.push({ id: ti * 2 + s, teamId: t.id, driverId: t.drivers[s].id, isPlayer: ti === 0 && s === 0, color: t.livery.primary });
    }
  }
  return out;
}
function snapshot(model, time, phase = 'racing') {
  const cars = [];
  for (let id = 0; id < 20; id++) {
    const gp = gridSlotPose(model, id);
    cars.push({
      id, x: gp.x + time * 3, y: gp.y, heading: gp.heading, speed: 30 + id, u: 30, v: 0, yawRate: 0, steerAngle: 0.05,
      ax: 1, ay: 5, throttle: 1, brake: 0, gear: 4, rpm: 0.5, slip: id === 3 ? 0.8 : 0, surface: id === 5 ? 'grass' : 'asphalt', contact: 0,
    });
  }
  return { phase, time, raceTime: time, introT: Math.min(1, time / 4), cars };
}

for (const def of TRACKS) {
  test(`RaceController ${def.id}: builds, updates, stays inside the draw budget, disposes`, () => {
    const model = getTrackModel(def.id);
    const rc = new RaceController({ trackDef: def, trackModel: model, carMetas: metas(), playerId: 0, quality: 'high' });
    rc.resize(1280, 720);
    // draw-call proxy: visible meshes/points (each non-instanced Mesh = 1 call, Points = 1)
    for (let i = 0; i < 90; i++) rc.update(1 / 60, snapshot(model, i / 60, i < 30 ? 'intro' : 'racing'));
    let calls = 0;
    rc.scene.traverse((o) => {
      if ((o.isMesh || o.isPoints) && o.visible) {
        let vis = true;
        for (let p = o.parent; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) calls++;
      }
    });
    assert.ok(calls <= 260 + 40, `draw calls ~${calls}`);
    assert.ok(Number.isFinite(rc.camera.position.x) && Number.isFinite(rc.camera.quaternion.w));
    // camera is near the player car
    const p = snapshot(model, 90 / 60).cars[0];
    assert.ok(Math.hypot(rc.camera.position.x - p.x, rc.camera.position.z - p.y) < 20);
    assert.equal(rc.getCameraMode(), 'chase');
    assert.equal(rc.cycleCamera(), 'cockpit');
    assert.equal(rc.playerModel.userData.helmet.visible, false);
    rc.setCameraMode('chase');
    assert.equal(rc.playerModel.userData.helmet.visible, true);
    // same snapshot twice (paused): wheel spin must not advance
    const snap = snapshot(model, 5);
    rc.update(1 / 60, snap);
    const r = rc.models[2].userData.wheels.fl.rotation.z;
    rc.update(1 / 60, snap);
    assert.equal(rc.models[2].userData.wheels.fl.rotation.z, r);
    // shadows: only the player casts
    let casters = 0;
    rc.models.forEach((m, i) => m.traverse((o) => o.isMesh && o.castShadow && (casters += i === 0 ? 0 : 1)));
    assert.equal(casters, 0);
    assert.ok(rc.playerModel.getObjectByName('bodyMesh').castShadow);
    assert.ok(rc.sky.sun.castShadow);
    rc.setQuality('low');
    assert.ok(!rc.sky.sun.castShadow);
    rc.dispose();
  });
}

test('CarPreviewController: team turntable and podium', () => {
  const pv = new CarPreviewController({ quality: 'high' });
  pv.resize(800, 600);
  for (const t of TEAMS) pv.showTeam(t.id, 1);
  const y0 = pv.turntable.rotation.y;
  pv.update(0.5, {});
  assert.ok(Math.abs(pv.turntable.rotation.y - y0 - 0.175) < 1e-6, 'spin 0.35 rad/s');
  pv.update(0.016, { pointerDragDelta: 50 });
  assert.ok(pv.turntable.rotation.y > y0 + 0.5);
  pv.setSpin(false);
  const y1 = pv.turntable.rotation.y;
  pv.update(5, {});
  assert.equal(pv.turntable.rotation.y, y1);
  pv.showPodium([{ teamId: 'ferrari', position: 1, name: 'A' }, { teamId: 'ferrari', position: 2, name: 'B' }, { teamId: 'haas', position: 3, name: 'C' }]);
  for (let i = 0; i < 30; i++) pv.update(0.1, {});
  assert.ok(Number.isFinite(pv.camera.position.x));
  assert.equal(pv._podiumCars.length, 3);
  pv.showTeam('mclaren', 0);
  assert.equal(pv._podiumCars.length, 0);
  pv.dispose();
});
