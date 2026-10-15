import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWall, resolveCarCar } from '../../src/sim/collisions.js';
import { createCarState, stepCarDynamics, filterInput, SIM_DT } from '../../src/sim/carPhysics.js';
import { stepCar } from '../../src/sim/carStep.js';
import { getTrackModel, mclarenStats } from './helpers.js';
import { wrapAngle } from '../../src/core/mathUtil.js';

const stats = mclarenStats();
const model = getTrackModel('monte-veloce');

function placeOnTrack(s, d, headingOffset = 0, speed = 0) {
  const p = model.sampleAt(s);
  const car = createCarState({ x: p.x + d * p.nx, y: p.y + d * p.ny, heading: p.heading + headingOffset, speed }, stats);
  const pr = model.project(car.x, car.y, p.index);
  car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading; car.mode = 'ai';
  return car;
}

test('resolveWall: a car beyond the barrier is pushed back inside', () => {
  const car = placeOnTrack(500, model.wallOffset + 0.4, 0.0, 30);   // centre already past the wall line
  const impact = resolveWall(car, model, stats);
  const dAfter = model.project(car.x, car.y, car.index).d;
  assert.ok(Math.abs(dAfter) < model.wallOffset, `d after ${dAfter}`);
  assert.ok(impact >= 0);
});

test('resolveWall: oblique impact removes normal speed, keeps most tangential speed, bounded yaw nudge', () => {
  const car = placeOnTrack(800, model.wallOffset - 1.0, 0.35, 60);    // heading ~20 deg towards the right wall
  const speed0 = Math.hypot(car.u, car.v);
  const impact = resolveWall(car, model, stats);
  assert.ok(impact > 5, `impact ${impact}`);
  const speed1 = Math.hypot(car.u, car.v);
  assert.ok(speed1 < speed0 && speed1 > 0.7 * speed0, `${speed0} -> ${speed1}`);
  assert.ok(Math.abs(car.yawRate) <= 3.5);
});

test('resolveWall: returns 0 for cars well inside', () => {
  const car = placeOnTrack(800, 2, 0, 60);
  assert.equal(resolveWall(car, model, stats), 0);
});

test('no tunnelling: 90 m/s at 25 degrees into the barrier never ends outside it (both sides)', () => {
  for (const side of [1, -1]) {
    const car = placeOnTrack(300, 0, side * 0.45, 88);
    car.mode = 'ai';
    const ctx = { trackModel: model, config: { difficulty: 'normal', tyreWearBase: 0.001 }, locked: false, draft: 0 };
    let maxD = 0, hit = false;
    for (let i = 0; i < 120 * 6; i++) {
      stepCar(car, stats, { steer: 0, throttle: 1, brake: 0 }, ctx, SIM_DT);
      maxD = Math.max(maxD, Math.abs(car.d));
      if (car.wallImpact > 3) hit = true;
      assert.ok(Number.isFinite(car.x + car.y + car.u + car.v));
    }
    assert.ok(hit, 'should have hit the wall');
    assert.ok(maxD < model.wallOffset + 1.5, `max |d| ${maxD} vs wallOffset ${model.wallOffset}`);
  }
});

test('wall impact speed at 88 m/s is bounded by the closing speed (no energy injection)', () => {
  const car = placeOnTrack(300, 0, 0.45, 88);
  const ctx = { trackModel: model, config: { difficulty: 'normal', tyreWearBase: 0.001 }, locked: false, draft: 0 };
  let maxImpact = 0, maxSpeed = 0;
  for (let i = 0; i < 120 * 8; i++) {
    stepCar(car, stats, { steer: 0, throttle: 0, brake: 0 }, ctx, SIM_DT);
    maxImpact = Math.max(maxImpact, car.wallImpact);
    maxSpeed = Math.max(maxSpeed, Math.hypot(car.u, car.v));
  }
  assert.ok(maxImpact < 40, `impact ${maxImpact}`);
  assert.ok(maxSpeed < 92);
});

test('resolveCarCar: overlapping cars are separated, impulses bounded, no damage to speeds beyond closing', () => {
  const a = placeOnTrack(200, 0, 0, 60);
  const b = placeOnTrack(200 + 4.3, 0.5, 0, 40);          // b in front, slower: overlap
  const closing0 = a.u - b.u;
  const sp = resolveCarCar(a, b, stats, stats);
  assert.ok(sp > 0 && sp <= closing0 + 1, `contact speed ${sp}`);
  // after repeated resolution they no longer overlap
  for (let i = 0; i < 20; i++) resolveCarCar(a, b, stats, stats);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(dist > 2.5, `centre distance ${dist}`);
  assert.ok(a.u <= 60 + 1e-9 && b.u >= 40 - 1e-9, 'rear car slows, front car does not slow');
  assert.ok(Math.abs(a.yawRate) <= 1.2 && Math.abs(b.yawRate) <= 1.2);   // a clear spin kick, still bounded
});

test('resolveCarCar: no contact beyond the circle radii', () => {
  const a = placeOnTrack(200, 0, 0, 60);
  const b = placeOnTrack(200 + 8.0, 0, 0, 30);
  assert.equal(resolveCarCar(a, b, stats, stats), 0);
  const c = placeOnTrack(200, 2.2, 0, 60);                 // alongside, 2.2 m apart > 2.0
  assert.equal(resolveCarCar(a, c, stats, stats), 0);
});

test('resolveCarCar: head-on at 60 m/s relative speed keeps velocity change modest', () => {
  const a = placeOnTrack(200, 0, 0, 30);
  const b = placeOnTrack(206, 0, Math.PI, 30);              // facing back at a
  const sp = resolveCarCar(a, b, stats, stats);
  assert.ok(sp > 0);
  assert.ok(Math.hypot(a.u, a.v) < 100 && Math.hypot(b.u, b.v) < 100);
  assert.ok(Math.abs(wrapAngle(a.heading - b.heading)) > 3);
});
