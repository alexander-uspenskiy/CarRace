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
