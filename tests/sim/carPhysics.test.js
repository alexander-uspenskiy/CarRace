import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarState, stepCarDynamics, filterInput, gearAndRpm, steerLimit, SIM_DT } from '../../src/sim/carPhysics.js';
import { mclarenStats } from './helpers.js';

const stats = mclarenStats();
const asphalt = () => ({ gripFront: 1, gripRear: 1, rollExtra: 0, draft: 0, locked: false });
const grass = () => ({ gripFront: 0.55, gripRear: 0.55, rollExtra: 0.25, draft: 0, locked: false });

function mkCar(speed = 0) {
  const c = createCarState({ x: 0, y: 0, heading: 0, speed }, stats);
  c.mode = 'ai';             // raw pedals/steer pass straight through
  return c;
}
/** Steps until fn(car,t) returns true or T seconds. fn returns the raw input via car._next */
function run(car, env, T, controller, stopWhen = null) {
  let t = 0;
  while (t < T) {
    const raw = controller(car, t);
    const d = filterInput(car, raw, SIM_DT);
    stepCarDynamics(car, stats, d, env, SIM_DT);
    t += SIM_DT;
    if (stopWhen && stopWhen(car, t)) break;
  }
  return t;
}
const FULLTHR = { steer: 0, throttle: 1, brake: 0 };
const FULLBRK = { steer: 0, throttle: 0, brake: 1 };

test('0-100 kph in 2.8..3.6 s', () => {
  const c = mkCar(0);
  const t = run(c, asphalt(), 10, () => FULLTHR, (car) => car.u >= 100 / 3.6);
  assert.ok(t > 2.8 && t < 3.6, `0-100 took ${t.toFixed(2)}`);
});

test('top speed 88..96 m/s and stable', () => {
  const c = mkCar(60);
  run(c, asphalt(), 60, () => FULLTHR);
  assert.ok(c.u > 88 && c.u < 96, `top speed ${c.u.toFixed(1)}`);
  assert.ok(Math.abs(c.v) < 0.01 && Math.abs(c.y) < 0.01, 'straight-line stability');
});

test('100->0 kph braking distance 15..30 m', () => {
  const c = mkCar(100 / 3.6);
  run(c, asphalt(), 10, () => FULLBRK, (car) => car.u < 0.05);
  assert.ok(c.x >= 15 && c.x <= 30, `brake dist ${c.x.toFixed(1)}`);
  assert.ok(c.u >= 0, 'never reverses');
});

test('peak lateral acceleration 2.5..3.0 g @60 m/s and 3.5..4.0 g @80 m/s', () => {
  const peak = (speed) => {
    let best = 0;
    for (const st of [0.03, 0.04, 0.05, 0.06, 0.08]) {
      const c2 = mkCar(speed);
      let mx = 0;
      run(c2, asphalt(), 3, (car) => { mx = Math.max(mx, Math.abs(car.ay) / 9.81); return { steer: st / steerLimit(stats, car.u), throttle: car.u < speed ? 1 : 0.4, brake: 0 }; });
      best = Math.max(best, mx);
    }
    return best;
  };
  const g60 = peak(60), g80 = peak(80);
  assert.ok(g60 >= 2.5 && g60 <= 3.0, `g60 ${g60.toFixed(2)}`);
  assert.ok(g80 >= 3.5 && g80 <= 4.0, `g80 ${g80.toFixed(2)}`);
});

test('grass: top speed >= 20% lower, 20 m/s braking distance >= 1.3x', () => {
  const a = mkCar(60), g = mkCar(60);
  run(a, asphalt(), 60, () => FULLTHR);
  run(g, grass(), 60, () => FULLTHR);
  assert.ok(g.u <= a.u * 0.8, `grass ${g.u.toFixed(1)} vs asphalt ${a.u.toFixed(1)}`);
  const ba = mkCar(20), bg = mkCar(20);
  run(ba, asphalt(), 10, () => FULLBRK, (car) => car.u < 0.05);
  run(bg, grass(), 10, () => FULLBRK, (car) => car.u < 0.05);
  assert.ok(bg.x >= 1.3 * ba.x, `grass ${bg.x.toFixed(1)} asphalt ${ba.x.toFixed(1)}`);
});

test('determinism: identical inputs give identical state', () => {
  const sim = () => {
    const c = mkCar(30);
    run(c, asphalt(), 8, (car, t) => ({ steer: Math.sin(t * 1.3) * 0.6, throttle: 0.7 + 0.3 * Math.sin(t), brake: t > 5 ? 0.5 : 0 }));
    return JSON.stringify([c.x, c.y, c.heading, c.u, c.v, c.yawRate]);
  };
  assert.equal(sim(), sim());
});

test('handbrake breaks the rear loose (yaw rate response larger than without)', () => {
  const drive = (hb) => {
    const c = mkCar(50);
    c.mode = 'ai';
    let maxYaw = 0;
    run(c, asphalt(), 2, (car, t) => {
      maxYaw = Math.max(maxYaw, Math.abs(car.yawRate));
      return { steer: t > 0.3 && t < 0.8 ? 0.03 / steerLimit(stats, car.u) : 0, throttle: 0.3, brake: 0, handbrake: hb && t > 0.3 };
    });
    return maxYaw;
  };
  assert.ok(drive(true) > drive(false) * 3, 'handbrake should spin the rear round');
});

test('no explosions at high speed under violent inputs', () => {
  const c = mkCar(85);
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let maxYaw = 0;
  run(c, asphalt(), 40, (car) => {
    maxYaw = Math.max(maxYaw, Math.abs(car.yawRate));
    assert.ok(Number.isFinite(car.x + car.y + car.u + car.v + car.yawRate + car.heading));
    return { steer: rnd() * 2 - 1, throttle: rnd(), brake: rnd() < 0.2 ? 1 : 0, handbrake: rnd() < 0.05 };
  });
  assert.ok(maxYaw <= 3.5 + 1e-9);
  assert.ok(c.u >= 0 && c.u < 100);
});

test('low-speed stability (sub-stepping / kinematic blend): full lock at 1..8 m/s stays bounded', () => {
  for (const sp of [0.5, 1, 2, 3, 4, 5, 6, 8]) {
    const c = mkCar(sp);
    run(c, asphalt(), 10, () => ({ steer: 1, throttle: 0.15, brake: 0 }));
    assert.ok(Number.isFinite(c.u + c.v + c.yawRate), `speed ${sp}`);
    assert.ok(Math.abs(c.yawRate) < 3.5, `yaw ${c.yawRate} at ${sp}`);
  }
});

test('locked car (grid hold) does not move', () => {
  const c = mkCar(0);
  const env = asphalt(); env.locked = true;
  run(c, env, 2, () => FULLTHR);
  assert.equal(c.x, 0); assert.equal(c.u, 0);
});

test('keyboard steering filter: rises at 5.5/s, returns at 8/s, speed-sensitive limit', () => {
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 30 }, stats);   // player mode
  for (let i = 0; i < 12; i++) filterInput(c, { steer: 1, throttle: 0, brake: 0 }, SIM_DT);   // 0.1 s
  assert.ok(Math.abs(c.inSteer - 0.55) < 0.02, `after 0.1 s ${c.inSteer}`);
  for (let i = 0; i < 30; i++) filterInput(c, { steer: 0, throttle: 0, brake: 0 }, SIM_DT);   // 0.25 s release
  assert.ok(c.inSteer < 0.01);
  assert.ok(steerLimit(stats, 80) < steerLimit(stats, 10) * 0.35);
});

test('gearAndRpm ranges', () => {
  let lastGear = 0;
  for (let s = 0; s <= 100; s += 1) {
    const { gear, rpm } = gearAndRpm(s);
    assert.ok(gear >= 1 && gear <= 8 && rpm >= 0 && rpm <= 1);
    assert.ok(gear >= lastGear); lastGear = gear;
  }
  assert.equal(gearAndRpm(0).gear, 1);
  assert.equal(gearAndRpm(95).gear, 8);
});

import { heatDerate, TUNING } from '../../src/sim/carPhysics.js';

test('reverse: brake held at a standstill backs the car up gently (cap ~8 m/s); releasing stops it; throttle drives forward again', () => {
  const c = mkCar(0);
  let t = run(c, asphalt(), 0.2, () => FULLBRK);
  assert.ok(c.u >= -0.01 && c.x > -0.01, 'no reversing during the 0.3 s stop delay');
  let minU = 0;
  run(c, asphalt(), 6, () => FULLBRK, (car) => { minU = Math.min(minU, car.u); return false; });
  assert.ok(c.u < -5 && c.u >= -TUNING.reverseMax - 1e-9, `reverse speed ${c.u}`);
  assert.ok(minU >= -TUNING.reverseMax - 1e-9, `never beyond the cap (${minU})`);
  assert.ok(c.x < -10, `moved backwards ${c.x}`);
  assert.ok(Math.abs(c.heading) < 1e-6 && Math.abs(c.y) < 1e-6, 'straight reverse stays straight');
  // release the brake: rolling stop, never creeps on
  run(c, asphalt(), 2, () => ({ steer: 0, throttle: 0, brake: 0 }));
  assert.ok(Math.abs(c.u) < 1e-6, `stopped, u=${c.u}`);
  const x0 = c.x;
  run(c, asphalt(), 1, () => ({ steer: 0, throttle: 0, brake: 0 }));
  assert.ok(Math.abs(c.x - x0) < 1e-6);
  // reverse then full throttle: goes forward
  run(c, asphalt(), 4, () => FULLBRK);
  run(c, asphalt(), 3, () => FULLTHR);
  assert.ok(c.u > 10, `forward again ${c.u}`);
});

test('reverse steering is natural (steer right while reversing swings the nose left), and braking a moving car does not start a reverse', () => {
  const c = mkCar(0);
  run(c, asphalt(), 2.5, () => ({ steer: 1, throttle: 0, brake: 1 }));
  assert.ok(c.u < -1);
  assert.ok(c.heading < -0.05, `heading ${c.heading}`);     // heading decreases (nose to the left) when reversing with right lock
  const b = mkCar(30);
  let minU = 1e9;
  run(b, asphalt(), 3, () => FULLBRK, (car) => { minU = Math.min(minU, car.u); return false; });
  assert.ok(b.u <= 0.4 && b.u >= -TUNING.reverseMax, `${b.u}`);
  // while still moving forward the brake never produced reverse before the 0.3 s standstill delay elapsed
  const d = mkCar(10);
  let reversedEarly = false, tStop = null;
  run(d, asphalt(), 4, () => FULLBRK, (car, t) => { if (tStop === null && car.u < 0.5) tStop = t; if (car.u < -0.05 && tStop !== null && t - tStop < 0.28) reversedEarly = true; return false; });
  assert.equal(reversedEarly, false);
});

test('full lock + full throttle at crawling speed pulls away on grass (steering scrub fades in the kinematic band)', () => {
  const c = mkCar(0);
  run(c, grass(), 4, () => ({ steer: 1, throttle: 1, brake: 0 }));
  assert.ok(c.u > 4, `u ${c.u}`);
  const d = mkCar(0);
  run(d, asphalt(), 2, () => ({ steer: -1, throttle: 1, brake: 0 }));
  assert.ok(d.u > 6, `u ${d.u}`);
});

test('heatDerate: 1 below the threshold, smooth, bottoms out at -8%; a higher heatLimit delays it', () => {
  const lo = { heatLimit: 0.8 }, hi = { heatLimit: 0.96 };
  assert.equal(heatDerate(0, lo), 1);
  assert.equal(heatDerate(0.8, lo), 1);
  assert.ok(heatDerate(0.9, lo) < 1 && heatDerate(0.9, lo) > 1 - TUNING.maxDerate);
  assert.ok(Math.abs(heatDerate(1.0, lo) - (1 - TUNING.maxDerate)) < 1e-9);
  assert.ok(Math.abs(heatDerate(1.2, lo) - (1 - TUNING.maxDerate)) < 1e-9);
  assert.ok(TUNING.maxDerate > 0.06 && TUNING.maxDerate <= 0.1);
  let prev = 2;
  for (let h = 0; h <= 1.2; h += 0.01) { const d = heatDerate(h, lo); assert.ok(d <= prev + 1e-12); prev = d; }
  assert.equal(heatDerate(0.95, hi), 1);
  assert.ok(heatDerate(1.0, hi) > heatDerate(1.0, lo));
});

test('overheated engine: the same pedal gives measurably less acceleration', () => {
  const run0 = (heat) => {
    const c = mkCar(60); c.heat = heat;
    run(c, asphalt(), 4, () => FULLTHR);
    return c.u;
  };
  assert.ok(run0(1.2) < run0(0) - 0.5, `${run0(1.2)} vs ${run0(0)}`);
});
