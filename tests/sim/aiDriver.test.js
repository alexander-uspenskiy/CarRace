import test from 'node:test';
import assert from 'node:assert/strict';
import { runSolo } from '../../src/sim/soloRun.js';
import { createAiDriver } from '../../src/sim/ai/aiDriver.js';
import { createCarState } from '../../src/sim/carPhysics.js';
import { TEAMS } from '../../src/data/teams.js';
import { computeCarStats } from '../../src/data/carStats.js';
import { TRACK_IDS, getTrackModel, getTrackDef, calibrationStats } from './helpers.js';

const team = TEAMS.find((t) => t.id === 'racingbulls');
const law = team.drivers.find((d) => d.id === 'law') || team.drivers[1];

for (const id of TRACK_IDS) {
  test(`AI alone on ${id}: 4 laps, inside the walls, no wall hits, lap time within the calibrated reference`, () => {
    const model = getTrackModel(id);
    const r = runSolo({ trackModel: model, stats: calibrationStats(), driver: law, difficulty: 'normal', seed: 1, laps: 4 });
    assert.ok(r.completed && !r.nan);
    assert.equal(r.wallHits, 0, 'no wall hits');
    assert.ok(r.maxD < model.wallOffset - 1, `max |d| ${r.maxD}`);
    assert.ok(r.offTrackTime < 1, `off track ${r.offTrackTime}s`);
    const ref = getTrackDef(id).referenceLapTime;
    for (const lap of r.lapTimes.slice(1, 3)) {
      const err = Math.abs(lap - ref) / ref;
      if (err > 0.12) console.warn(`WARN ${id}: lap ${lap.toFixed(2)} vs reference ${ref} (${(err * 100).toFixed(1)}%)`);
      assert.ok(err <= 0.25, `lap ${lap.toFixed(2)} vs reference ${ref}`);
    }
    // lateral load stays below what the tyres can give
    assert.ok(r.maxLat < 3.2);
  });
}

test('AI is deterministic for a given seed and differs between skill levels', () => {
  const model = getTrackModel('ridgeback');
  const s = calibrationStats();
  const a = runSolo({ trackModel: model, stats: s, driver: { skill: 0.9 }, seed: 5, laps: 3 });
  const b = runSolo({ trackModel: model, stats: s, driver: { skill: 0.9 }, seed: 5, laps: 3 });
  assert.deepEqual(a.lapTimes, b.lapTimes);
  const fast = runSolo({ trackModel: model, stats: s, driver: { skill: 0.99 }, seed: 5, laps: 3, noMistakes: true });
  const slow = runSolo({ trackModel: model, stats: s, driver: { skill: 0.85 }, seed: 5, laps: 3, noMistakes: true });
  assert.ok(fast.lapTimes[1] < slow.lapTimes[1], 'higher skill is faster');
});

test('difficulty scales pace: easy < normal < hard lap times', () => {
  const model = getTrackModel('monte-veloce');
  const s = calibrationStats();
  const lap = (d) => runSolo({ trackModel: model, stats: s, driver: law, difficulty: d, seed: 2, laps: 3, noMistakes: true }).lapTimes[1];
  const e = lap('easy'), n = lap('normal'), h = lap('hard');
  assert.ok(e > n && n > h, `${e} ${n} ${h}`);
});

test('all teams x hard difficulty (level-1 upgrades) lap monte-veloce cleanly alone', () => {
  const model = getTrackModel('monte-veloce');
  for (const t of TEAMS) {
    const stats = computeCarStats(t, { engine: 1, aero: 1, brakes: 1, tyres: 1, cooling: 1 });
    const r = runSolo({ trackModel: model, stats, driver: t.drivers[0], difficulty: 'hard', seed: 3, laps: 3 });
    assert.ok(r.completed, t.id);
    assert.equal(r.wallHits, 0, `${t.id} wall hits`);
    assert.ok(r.offTrackTime < 1, `${t.id} off track ${r.offTrackTime}`);
  }
});

test('AI does not crash on a fully upgraded (level 5) car either', () => {
  const model = getTrackModel('ridgeback');
  const stats = computeCarStats(TEAMS[0], { engine: 5, aero: 5, brakes: 5, tyres: 5, cooling: 5 });
  const r = runSolo({ trackModel: model, stats, driver: { skill: 1 }, difficulty: 'hard', seed: 3, laps: 3, noMistakes: true });
  assert.ok(r.completed); assert.equal(r.wallHits, 0);
});

test('drive() returns well-formed InputState and waits for the launch delay', () => {
  const model = getTrackModel('monte-veloce');
  const stats = calibrationStats();
  const ai = createAiDriver({ trackModel: model, stats, driver: law, difficulty: 'normal', rng: () => 0.5 });
  const p = model.sampleAt(-20 + model.length);
  const car = createCarState({ x: p.x, y: p.y, heading: p.heading, speed: 0 }, stats);
  const pr = model.project(car.x, car.y, 0);
  car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading;
  const world = { cars: [car], playerId: -1, raceTime: 0.05, phase: 'racing' };
  let o = ai.drive(car, world, 1 / 120);
  assert.equal(o.throttle, 0);
  world.raceTime = 1.0;
  o = ai.drive(car, world, 1 / 120);
  assert.ok(o.throttle > 0, "launches after the delay");
  for (const k of ['steer', 'throttle', 'brake']) assert.ok(Number.isFinite(o[k]));
  assert.ok(o.steer >= -1 && o.steer <= 1 && o.brake >= 0 && o.brake <= 1);
  assert.equal(o.reset, false);
});
