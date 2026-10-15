import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, gridPose, createDirector, INTRO_SECONDS } from '../../src/sim/raceDirector.js';
import { RaceSim, SIM_DT } from '../../src/sim/raceSim.js';
import { TEAMS } from '../../src/data/teams.js';
import { mulberry32, gaussian } from '../../src/core/mathUtil.js';
import { createCarState } from '../../src/sim/carPhysics.js';
import { makeConfig, getTrackModel, TRACK_IDS, NEUTRAL, mclarenStats } from './helpers.js';

test('buildGrid: 20 unique cars sorted by score, one player, deterministic', () => {
  const cfg = makeConfig({ teamId: 'williams', driverIndex: 1 });
  const g = buildGrid(cfg, TEAMS, mulberry32(99));
  assert.equal(g.length, 20);
  assert.deepEqual(g.map((x) => x.slot), [...Array(20).keys()]);
  assert.equal(new Set(g.map((x) => x.carId)).size, 20);
  assert.equal(g.filter((x) => x.isPlayer).length, 1);
  assert.equal(g.find((x) => x.isPlayer).carId, TEAMS.findIndex((t) => t.id === 'williams') * 2 + 1);
  // recompute scores with the same rng stream
  const rng = mulberry32(99);
  const score = [];
  for (let ti = 0; ti < 10; ti++) for (let di = 0; di < 2; di++) {
    const d = TEAMS[ti].drivers[di];
    score[ti * 2 + di] = TEAMS[ti].strength + 0.30 * (d.skill - 0.9) + 0.08 * gaussian(rng);
  }
  for (let i = 1; i < 20; i++) assert.ok(score[g[i - 1].carId] >= score[g[i].carId], `order at ${i}`);
  assert.deepEqual(buildGrid(cfg, TEAMS, mulberry32(99)), g);
  assert.notDeepEqual(buildGrid(cfg, TEAMS, mulberry32(100)).map((x) => x.carId), g.map((x) => x.carId));
});

test('buildGrid: strong teams start ahead of weak teams on average', () => {
  const cfg = makeConfig();
  let top = 0, bottom = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = buildGrid(cfg, TEAMS, mulberry32(seed));
    top += g.findIndex((x) => x.teamId === 'mclaren');
    bottom += g.findIndex((x) => x.teamId === 'sauber');
  }
  assert.ok(top / 30 < 6 && bottom / 30 > 12);
});

for (const id of TRACK_IDS) {
  test(`gridPose on ${id}: 20 distinct poses, two columns, on the start straight, facing along the track`, () => {
    const m = getTrackModel(id);
    const poses = [...Array(20).keys()].map((s) => gridPose(m, s));
    for (let i = 0; i < 20; i++) {
      const p = m.project(poses[i].x, poses[i].y);
      assert.ok(Math.abs(p.d - (i % 2 === 0 ? -2.5 : 2.5)) < 0.05, `slot ${i} d ${p.d}`);
      const expectedS = m.wrapS(-(10 + 8 * i));
      let ds = p.s - expectedS;
      ds -= Math.round(ds / m.length) * m.length;
      assert.ok(Math.abs(ds) < 0.1, `slot ${i} s off by ${ds}`);
      assert.ok(Math.abs(Math.atan2(Math.sin(poses[i].heading - p.heading), Math.cos(poses[i].heading - p.heading))) < 0.02);
      for (let j = 0; j < i; j++) assert.ok(Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y) > 4, `slots ${i},${j} overlap`);
    }
  });
}

function newSim(over = {}) {
  const config = makeConfig(over);
  const events = [];
  let sim;
  sim = new RaceSim({ config, trackModel: getTrackModel(config.trackId), emit: (name, payload) => events.push({ name, payload, t: sim.time }) });
  return { sim, events, config };
}

test('phases: intro lasts 4 s with static cars, then lights 1..5 each second, random hold 0.6..2.0 s, then GO', () => {
  const { sim, events } = newSim();
  assert.equal(sim.phase, 'intro');
  const x0 = sim.cars.map((c) => c.x);
  for (let i = 0; i < 120 * 3.9; i++) sim.stepFixed(NEUTRAL);
  assert.equal(sim.phase, 'intro');
  assert.ok(sim.getSnapshot().introT > 0.9 && sim.getSnapshot().introT <= 1);
  for (let i = 0; i < 120 * 0.2; i++) sim.stepFixed(NEUTRAL);
  assert.equal(sim.phase, 'lights');
  const tLights = events.find((e) => e.name === 'race:phase' && e.payload.phase === 'lights').t;
  assert.ok(Math.abs(tLights - INTRO_SECONDS) < 0.02);
  while (sim.phase === 'lights') sim.stepFixed(NEUTRAL);
  const lights = events.filter((e) => e.name === 'race:lights');
  assert.deepEqual(lights.map((e) => e.payload.lit), [1, 2, 3, 4, 5, 0]);
  for (let k = 0; k < 5; k++) assert.ok(Math.abs(lights[k].t - (tLights + k + 1)) < 0.02, `lit ${k + 1} at ${lights[k].t - tLights}`);
  const hold = lights[5].t - lights[4].t;
  assert.ok(hold >= 0.6 - 0.02 && hold <= 2.0 + 0.02, `hold ${hold}`);
  assert.equal(sim.phase, 'racing');
  assert.equal(sim.raceTime, 0);
  // cars did not move before GO (grid hold)
  sim.cars.forEach((c, i) => { assert.equal(c.x, x0[i]); assert.equal(c.u, 0); });
  const snap = sim.getSnapshot();
  assert.deepEqual(snap.lights, { lit: 0, out: true });
  const phases = events.filter((e) => e.name === 'race:phase').map((e) => e.payload.phase);
  assert.deepEqual(phases.slice(0, 3), ['intro', 'lights', 'racing']);
});

test('lights hold varies with the seed but stays in [0.6, 2.0]', () => {
  const holds = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const { sim, events } = newSim({ seed });
    sim.skipIntro();
    while (sim.phase === 'lights') sim.stepFixed(NEUTRAL);
    const l = events.filter((e) => e.name === 'race:lights');
    const h = l[5].t - l[4].t;
    assert.ok(h >= 0.58 && h <= 2.02);
    holds.add(h.toFixed(2));
  }
  assert.ok(holds.size > 3);
});

test('skipIntro and update(): fixed-step accumulator, clamp 0.25 s, alpha in [0,1)', () => {
  const { sim } = newSim();
  sim.skipIntro();
  assert.equal(sim.phase, 'lights');
  assert.equal(sim.update(1 / 60, NEUTRAL), 2);
  assert.equal(sim.update(0.001, NEUTRAL), 0);
  const n = sim.update(5, NEUTRAL);                 // clamped to 0.25 s
  assert.ok(n >= 29 && n <= 31, `steps ${n}`);
  assert.ok(sim.alpha >= 0 && sim.alpha < 1);
});

function mkDirector(laps = 3) {
  const model = getTrackModel('monte-veloce');
  const stats = mclarenStats();
  const cars = [];
  const metas = [];
  for (let i = 0; i < 3; i++) {
    const c = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats);
    c.id = i; c.grid = i + 1; c.progress = -10 - 8 * i;
    cars.push(c);
    metas.push({ id: i, isPlayer: i === 0, code: 'C' + i, driverName: 'D' + i, teamId: 'mclaren' });
  }
  const events = [];
  const config = { trackId: 'monte-veloce', minutes: 5, laps, difficulty: 'normal', seed: 1 };
  const dir = createDirector({ config, trackModel: model, cars, metas, emit: (n, p) => events.push({ n, p }), rng: mulberry32(1), onCarFinished: () => {} });
  dir.skipIntro();
  let guard = 0;
  while (dir.phase !== 'racing' && guard++ < 120 * 10) dir.step(SIM_DT);
  return { dir, cars, events, model };
}

test('lap counting: crossing time interpolated inside the step, lap 1 measured from lights out', () => {
  const { dir, cars, events, model } = mkDirector(3);
  const L = model.length;
  const c = cars[0];
  // advance 30 s at constant speed with progress exactly consistent
  c.progress = L - 0.25; // crosses within next step (speed 50 m/s * dt = 0.4167 m)
  const prev = c.progress;
  dir.step(SIM_DT);
  c.progress = prev + 50 * SIM_DT;
  dir.onProgress(c, prev, SIM_DT);
  const lap = events.find((e) => e.n === 'race:lap');
  assert.ok(lap, 'lap event');
  assert.equal(lap.p.lap, 1);
  const frac = 0.25 / (50 * SIM_DT);
  assert.ok(Math.abs(lap.p.lapTime - (dir.raceTime - SIM_DT + SIM_DT * frac)) < 1e-9);
  assert.equal(lap.p.isPlayer, true);
  assert.equal(lap.p.isFastest, true);
  assert.equal(c.lap, 2);
});

test('flag, F1 finish rule, classification, race:finished once', () => {
  const { dir, cars, events, model } = mkDirector(2);
  const L = model.length;
  const [a, b, c] = cars;
  const cross = (car, laps, t) => {
    const prev = laps * L - 0.1;
    car.progress = laps * L + 0.1; car.u = 50;
    dir.onProgress(car, prev, SIM_DT);
  };
  // leader completes the race
  a.progress = 2 * L - 0.1; b.progress = 1.7 * L; c.progress = 0.4 * L;
  dir.step(SIM_DT); cross(a, 2);
  assert.equal(dir.phase, 'finishing');
  assert.ok(a.finished && a.lapsCompleted === 2);
  // b crosses the line at the end of its lap 1 after the flag => finishes a lap down; but first lap 1 crossing before flag? b has lapsDone 0
  b.lapsDone = 1; b.progress = 2 * L - 0.05;       // b is on its 2nd lap: crossing completes lap 2 => 2 laps
  dir.step(SIM_DT); cross(b, 2);
  assert.ok(b.finished && b.lapsCompleted === 2);
  c.lapsDone = 0; c.progress = 1 * L - 0.1;
  dir.step(SIM_DT); cross(c, 1);                    // lapped car: finishes with 1 lap at its next crossing
  assert.ok(c.finished && c.lapsCompleted === 1);
  dir.updateStandings(0);
  assert.deepEqual(dir.order.slice(0, 3), [0, 1, 2]);
  const fin = events.filter((e) => e.n === 'race:carFinished');
  assert.deepEqual(fin.map((e) => e.p.carId), [0, 1, 2]);
  assert.deepEqual(fin.map((e) => e.p.position), [1, 2, 3]);
  dir.finish(0);
  dir.finish(0);
  assert.equal(events.filter((e) => e.n === 'race:finished').length, 1);
  const res = dir.result;
  assert.equal(res.rows[2].lapsDown, 1);
  assert.equal(res.rows[2].gapToWinner, null);
  assert.ok(res.rows[1].gapToWinner >= 0);
  assert.equal(res.date, null);
});

test('positions: ordered by progress while racing; ties are stable; gaps use max(speed,25)', () => {
  const { dir, cars } = mkDirector(5);
  cars[0].progress = 1000; cars[1].progress = 1100; cars[2].progress = 900;
  cars[1].u = 60; cars[0].u = 50; cars[2].u = 10;
  dir.updateStandings(0);
  assert.deepEqual(dir.order, [1, 0, 2]);
  assert.equal(cars[1].position, 1);
  assert.equal(cars[1].gapAhead, 0);
  assert.ok(Math.abs(cars[0].gapAhead - 100 / 60) < 1e-9);
  assert.ok(Math.abs(cars[2].gapLeader - 200 / 60) < 1e-9);
  assert.ok(Math.abs(cars[2].gapAhead - 100 / 50) < 1e-9);
});

test('a stationary player (no input, no autopilot) still ends the race through the 90 s cut-off', () => {
  const config = makeConfig();
  const events = [];
  const sim = new RaceSim({ config, trackModel: getTrackModel(config.trackId), emit: (n, p) => events.push({ n, p }) });
  sim.skipIntro();
  let t = 0;
  while (sim.phase !== 'finished' && t < 1500) { sim.stepFixed(NEUTRAL); t += SIM_DT; }
  assert.equal(sim.phase, 'finished');
  const res = sim.getResult();
  assert.equal(res.playerFinished, false);
  assert.equal(res.playerTotalTime, null);
  assert.equal(res.rows.length, 20);
  const prow = res.rows.find((r) => r.isPlayer);
  assert.equal(prow.finished, false);
  assert.ok(prow.lapsDown >= 1);
  const flagT = events.find((e) => e.n === 'race:carFinished');
  assert.ok(flagT, 'someone took the flag');
  assert.equal(events.filter((e) => e.n === 'race:finished').length, 1);
});

test('input.reset is latched across 0-step frames and puts the player back on the track (3 s cooldown)', () => {
  const { sim } = newSim();
  sim.skipIntro();
  while (sim.phase !== 'racing') sim.stepFixed(NEUTRAL);
  for (let i = 0; i < 120 * 6; i++) sim.stepFixed({ ...NEUTRAL, throttle: 1 });
  const car = sim.cars[sim.playerId];
  // teleport onto the grass off to the side
  const m = sim.trackModel;
  const p = m.sampleAt(car.s);
  car.x = p.x + 11 * p.nx; car.y = p.y + 11 * p.ny; car.heading = p.heading + 2.5;
  sim.stepFixed(NEUTRAL);
  assert.ok(Math.abs(car.d) > 8);
  assert.equal(sim.update(0.001, { ...NEUTRAL, reset: true }), 0);      // 0 steps this frame; reset must survive
  assert.equal(sim.update(1 / 60, NEUTRAL) >= 1, true);
  assert.ok(Math.abs(car.d) < m.halfWidth, `d after reset ${car.d}`);
  assert.ok(car.u < 1.0);
  assert.ok(Math.abs(Math.atan2(Math.sin(car.heading - car.trackHeading), Math.cos(car.heading - car.trackHeading))) < 0.3);
  // second reset inside the cooldown is ignored
  car.x = p.x + 11 * p.nx; car.y = p.y + 11 * p.ny;
  sim.update(1 / 60, { ...NEUTRAL, reset: true });
  assert.ok(Math.abs(car.d) > 8);
});

test('wrong way flag after 1.5 s driving against the track', () => {
  const { sim } = newSim();
  sim.skipIntro();
  while (sim.phase !== 'racing') sim.stepFixed(NEUTRAL);
  for (let i = 0; i < 120 * 4; i++) sim.stepFixed({ ...NEUTRAL, throttle: 1 });
  const car = sim.cars[sim.playerId];
  const p = sim.trackModel.sampleAt(sim.trackModel.length * 0.8);            // an empty piece of road
  car.x = p.x; car.y = p.y; car.heading = p.heading + Math.PI; car.u = 30; car.v = 0;
  let flagged = false;
  for (let i = 0; i < 120 * 1.2; i++) sim.stepFixed(NEUTRAL);
  assert.equal(sim.getSnapshot().cars[sim.playerId].wrongWay, false);
  for (let i = 0; i < 120 * 0.6; i++) sim.stepFixed(NEUTRAL);
  flagged = sim.getSnapshot().cars[sim.playerId].wrongWay;
  assert.equal(flagged, true);
});
