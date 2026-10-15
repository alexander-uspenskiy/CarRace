import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { smoothAngle, chaseFov, chasePose, carFrameToWorld, CameraRig, CHASE } from '../../src/render/cameras.js';

test('smoothAngle takes the shortest arc across +-PI', () => {
  let a = 3.0;
  for (let i = 0; i < 200; i++) a = smoothAngle(a, -3.0, 6, 1 / 60);
  // target -3.0 == 3.283 rad: shortest path from 3.0 is +0.283 (through PI), never through 0
  let minAbs = Infinity;
  a = 3.0;
  for (let i = 0; i < 200; i++) {
    a = smoothAngle(a, -3.0, 6, 1 / 60);
    minAbs = Math.min(minAbs, Math.abs(a));
  }
  assert.ok(minAbs > 2.9, 'must not swing through 0');
  assert.ok(Math.abs(Math.abs(a) - 3.0) < 1e-3);
  assert.ok(Math.abs(smoothAngle(1, 1, 6, 0.1) - 1) < 1e-12);
});

test('chaseFov: 60 + 0.14 v, capped at 80', () => {
  assert.equal(chaseFov(0), 60);
  assert.ok(Math.abs(chaseFov(50) - 67) < 1e-9);
  assert.equal(chaseFov(1000), 80);
});

test('chasePose: 7.5 m behind along heading, 2.7 up, looks 6 m ahead (sim y == world z)', () => {
  const o = {};
  chasePose(o, 100, 50, 0);
  assert.ok(Math.abs(o.px - 92.5) < 1e-9 && Math.abs(o.pz - 50) < 1e-9 && o.py === CHASE.up);
  assert.ok(Math.abs(o.lx - 106) < 1e-9);
  chasePose(o, 0, 0, Math.PI / 2); // facing +y (south, world +z)
  assert.ok(Math.abs(o.px) < 1e-9 && Math.abs(o.pz + 7.5) < 1e-9 && Math.abs(o.lz - 6) < 1e-9);
});

test('carFrameToWorld: right of travel is (-sin h, cos h)', () => {
  const o = {};
  carFrameToWorld(o, 0, 0, 0, 0, 1, 0); // facing east, right = south = +z
  assert.ok(Math.abs(o.x) < 1e-12 && Math.abs(o.z - 1) < 1e-12);
});

test('CameraRig chase: camera ends behind the car, looking along the heading; modes blend', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.7, 0.4, 3000);
  const rig = new CameraRig(cam);
  const car = { x: 20, y: 30, heading: 1.0, speed: 40, steerAngle: 0, ay: 0, surface: 'asphalt', contact: 0 };
  for (let i = 0; i < 120; i++) rig.update(1 / 60, car, 'racing', 0);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  assert.ok(fwd.x * Math.cos(1) + fwd.z * Math.sin(1) > 0.9, 'looks forward');
  const toCar = new THREE.Vector3(car.x - cam.position.x, 0, car.y - cam.position.z);
  assert.ok(Math.abs(toCar.length() - 7.5) < 0.2);
  assert.ok(cam.position.y > 2.5 && cam.position.y < 3);
  assert.ok(Math.abs(cam.fov - chaseFov(40)) < 0.05);
  rig.setMode('cockpit');
  for (let i = 0; i < 60; i++) rig.update(1 / 60, car, 'racing', 0);
  assert.ok(Math.abs(cam.fov - 75 - Math.min(8, 40 * 0.04)) < 0.2);
  assert.ok(Math.hypot(cam.position.x - car.x, cam.position.z - car.y) < 0.2);
  for (const v of [cam.position.x, cam.position.y, cam.quaternion.w]) assert.ok(Number.isFinite(v));
});

test('CameraRig intro ends where the chase camera starts, orbit when finished', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.7, 0.4, 3000);
  const rig = new CameraRig(cam);
  const car = { x: 0, y: 0, heading: 0.3, speed: 0, steerAngle: 0, ay: 0, surface: 'asphalt', contact: 0 };
  rig.update(0.016, car, 'intro', 0);
  const p0 = cam.position.clone();
  rig.update(0.016, car, 'intro', 1);
  const pIntroEnd = cam.position.clone();
  rig.update(0.016, car, 'lights', 0);
  assert.ok(pIntroEnd.distanceTo(cam.position) < 0.5, 'no jump from intro to chase');
  assert.ok(p0.distanceTo(pIntroEnd) > 20, 'intro really sweeps');
  rig.update(0.016, car, 'finished', 0);
  for (let i = 0; i < 120; i++) rig.update(0.016, car, 'finished', 0);
  const d = Math.hypot(cam.position.x, cam.position.z);
  assert.ok(Math.abs(d - 13) < 0.5, `orbit radius ${d}`);
});

import { isDiscontinuity, SNAP } from '../../src/render/cameras.js';

test('isDiscontinuity: first frame, time jumps, restarts and teleports snap; normal driving does not', () => {
  const p = { time: 10, x: 100, y: 50 };
  assert.equal(isDiscontinuity(null, p), true);
  assert.equal(isDiscontinuity(p, { time: 10 + 1 / 60, x: 101.4, y: 50 }, 1 / 60), false); // 84 m/s
  assert.equal(isDiscontinuity(p, { time: 10, x: 100, y: 50 }, 1 / 60), false); // paused (same snapshot)
  assert.equal(isDiscontinuity(p, { time: 55, x: 100, y: 50 }, 0.016), true); // fastForward(45)
  assert.equal(isDiscontinuity(p, { time: 0.1, x: 100, y: 50 }, 0.016), true); // restart (time goes backwards)
  assert.equal(isDiscontinuity(p, { time: 10.01, x: 400, y: 50 }, 0.016), true); // teleport
  assert.equal(isDiscontinuity(p, { time: 10.01, x: 100.5, y: 50 }, SNAP.maxWallDt + 0.1), true); // tab was throttled
});

function mkCar(x, y, heading) {
  return { x, y, heading, speed: 60, steerAngle: 0, ay: 0, surface: 'asphalt', contact: 0 };
}

test('CameraRig snaps (no heading lag) after a big sim-time jump, and ignores NaN input', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 3500);
  const rig = new CameraRig(cam);
  for (let i = 0; i < 60; i++) rig.update(1 / 60, mkCar(10 + i, 0, 0), 'racing', 0, i / 60);
  // 45 s later the car is somewhere else, facing the opposite way
  const car = mkCar(-300, 800, Math.PI);
  rig.update(1 / 60, car, 'racing', 0, 46);
  const want = {};
  chasePose(want, car.x, car.y, car.heading);
  assert.ok(Math.abs(cam.position.x - want.px) < 0.05 && Math.abs(cam.position.z - want.pz) < 0.05, 'camera must be exactly behind the car on the first frame');
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  assert.ok(fwd.x < -0.8, 'looks along the new heading');
  // NaN guard: pose untouched, state stays finite
  const before = cam.position.clone();
  rig.update(1 / 60, mkCar(NaN, 0, 0), 'racing', 0, 46.02);
  rig.update(1 / 60, mkCar(0, 0, NaN), 'racing', 0, 46.03);
  assert.ok(cam.position.equals(before));
  rig.update(1 / 60, mkCar(car.x - 1, car.y, car.heading), 'racing', 0, 46.04);
  assert.ok(Number.isFinite(cam.position.x) && Number.isFinite(cam.quaternion.w));
});

test('CameraRig still smooths heading on ordinary frames', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 3500);
  const rig = new CameraRig(cam);
  rig.update(1 / 60, mkCar(0, 0, 0), 'racing', 0, 0);
  rig.update(1 / 60, mkCar(1, 0, 0.5), 'racing', 0, 1 / 60);
  assert.ok(rig.hs > 0 && rig.hs < 0.2, 'heading lags a little');
});
