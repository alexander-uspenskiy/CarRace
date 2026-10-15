import test from 'node:test';
import assert from 'node:assert/strict';
import { crashDamage, MAX_DAMAGE, createCarState, filterInput } from '../../src/sim/carPhysics.js';

test('crashDamage: nothing for scrapes, grows with speed, scales, walls hurt more than contacts', () => {
  assert.equal(crashDamage(2, 1), 0);
  assert.equal(crashDamage(30, 0), 0);
  assert.ok(crashDamage(20, 1) > crashDamage(10, 1));
  assert.equal(crashDamage(20, 0.5), crashDamage(20, 1) / 2);
  assert.ok(crashDamage(10, 1, true) < crashDamage(10, 1));
  assert.ok(MAX_DAMAGE < 1);
});

test('steerEase softens steering lock at speed only for the player', () => {
  const stats = { cgToFront: 1.6, cgToRear: 1.7, steerMax: 0.3 };
  const mk = (ease, u) => { const c = createCarState({ x: 0, y: 0, heading: 0, speed: u }, stats); c.steerEase = ease; c.inSteer = 1; return c; };
  const full = filterInput(mk(0, 70), { steer: 1 }, 1 / 120).steer;
  const eased = filterInput(mk(1, 70), { steer: 1 }, 1 / 120).steer;
  assert.ok(eased < full);
  assert.equal(filterInput(mk(1, 5), { steer: 1 }, 1 / 120).steer, 1);
});

import { RaceSim } from '../../src/sim/raceSim.js';
import { makeConfig, getTrackModel } from './helpers.js';

function crashRun(difficulty) {
  const config = makeConfig({ trackId: 'monte-veloce', difficulty });
  const sim = new RaceSim({ config, trackModel: getTrackModel('monte-veloce') });
  sim.skipIntro();
  const events = [];
  sim.emit = (n, p) => events.push({ n, p });
  const me = sim.cars[sim.playerId];
  for (let i = 0; i < 120 * 40; i++) sim.stepFixed({ steer: 0, throttle: 1, brake: 0, boost: false, handbrake: false, reset: false });
  return { dmg: me.damage, hits: events.filter((e) => e.n === 'car:wall' && e.p.carId === sim.playerId).length, snap: sim.getSnapshot(1) };
}

test('player car: no damage on easy, some on normal, more on hard (same crash)', () => {
  const easy = crashRun('easy'), normal = crashRun('normal'), hard = crashRun('hard');
  assert.ok(normal.hits > 0, 'the run must actually hit the wall');
  assert.equal(easy.dmg, 0);
  assert.ok(normal.dmg > 0);
  assert.ok(hard.dmg >= normal.dmg);
  assert.ok(hard.dmg <= MAX_DAMAGE);
  assert.equal(easy.snap.damageOn, false);
  assert.equal(normal.snap.damageOn, true);
  assert.equal(normal.snap.cars[0].damage !== undefined, true);
});

test('a damaged car is slower than a healthy one', () => {
  const run = (damage) => {
    const sim = new RaceSim({ config: makeConfig({ difficulty: 'hard' }), trackModel: getTrackModel('monte-veloce') });
    sim.skipIntro();
    const me = sim.cars[sim.playerId];
    me.damage = damage;
    for (let i = 0; i < 120 * 12; i++) sim.stepFixed({ steer: 0, throttle: 1, brake: 0, boost: false, handbrake: false, reset: false });
    return me.progress;
  };
  assert.ok(run(0.6) < run(0));
});

import { buildAiProfile } from '../../src/sim/ai/aiProfile.js';
import { mulberry32 } from '../../src/core/mathUtil.js';
import { resolveCarCar } from '../../src/sim/collisions.js';

test('driver character: rookies wander, slump and vary lap to lap more than veterans', () => {
  const avg = (id, f) => { let s = 0; for (let i = 1; i <= 40; i++) s += f(buildAiProfile({ driver: { id, skill: 0.9 }, rng: mulberry32(i), config: {} })); return s / 40; };
  for (const key of ['wanderAmp', 'slumpRate', 'lapVar', 'brakeJitter']) {
    assert.ok(avg('bor', (p) => p[key]) > 1.5 * avg('ham', (p) => p[key]), key);
  }
});

test('easy/medium lane keeping steers a hands-off car back from the edge; hard does not', () => {
  const run = (laneAssist) => {
    const model = getTrackModel('monte-veloce');
    const sim = new RaceSim({ config: makeConfig({ difficulty: 'hard' }), trackModel: model });
    sim.skipIntro();
    const me = sim.cars[sim.playerId];
    for (let i = 0; i < 120 * 8; i++) sim.stepFixed({ steer: 0, throttle: 0, brake: 1, boost: false, handbrake: false, reset: false });
    const p = model.sampleAt(400);
    me.x = p.x + 5.2 * p.nx; me.y = p.y + 5.2 * p.ny; me.heading = p.heading + 0.12; me.u = 45; me.v = 0; me.yawRate = 0; me.index = p.index; me.resetCooldown = 99;
    me.laneAssist = laneAssist;
    for (let i = 0; i < 120 * 3; i++) sim.stepFixed({ steer: 0, throttle: 0.5, brake: 0, boost: false, handbrake: false, reset: false });
    return Math.abs(me.d);
  };
  assert.ok(run(0.45) < 4);
  assert.ok(run(0) > 10);
});

test('car-car contact rebounds: the rear car loses clearly more speed than before and both get a yaw kick', () => {
  const mk = (x, y, u) => ({ x, y, heading: 0, u, v: 0, yawRate: 0 });
  const stats = { mass: 800, yawInertia: 1000 };
  const a = mk(0, 0, 60), b = mk(4.2, 0.3, 40);
  resolveCarCar(a, b, stats, stats);
  assert.ok(a.u < 52, `rear car ${a.u}`);
  assert.ok(Math.abs(a.yawRate) + Math.abs(b.yawRate) > 0.01);
});
