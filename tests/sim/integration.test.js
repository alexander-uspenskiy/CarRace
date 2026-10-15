import test from 'node:test';
import assert from 'node:assert/strict';
import { runRace, makeConfig, getTrackModel, getTrackDef, FULL, TRACK_IDS, NEUTRAL } from './helpers.js';
import { RaceSim } from '../../src/sim/raceSim.js';
import { estimateRaceSeconds } from '../../src/core/lapMath.js';
import { createAiDriver } from '../../src/sim/ai/aiDriver.js';
import { mulberry32 } from '../../src/core/mathUtil.js';

function checkRace(r, { minutes, lo = -0.075, hi = 0.13 }) {
  const { sim } = r;
  assert.equal(sim.phase, 'finished', 'race must finish');
  assert.ok(!r.nan, 'NaN in car state');
  assert.equal(r.counts['race:finished'], 1);
  const res = sim.getResult();
  assert.ok(res);
  assert.equal(res.rows.length, 20);
  assert.deepEqual(res.rows.map((x) => x.position), [...Array(20).keys()].map((i) => i + 1));
  assert.equal(new Set(res.rows.map((x) => x.carId)).size, 20);
  assert.equal(res.rows.filter((x) => x.isPlayer).length, 1);
  assert.equal(res.date, null);
  assert.equal(res.playerFinished, true);
  assert.ok(res.rows[0].finished && res.rows[0].lapsDown === 0 && res.rows[0].gapToWinner === 0);
  // winner duration close to the nominal race length: the lap formula targets -3%..+10%, whole-lap quantisation can add a few % on slow tracks
  const nominal = minutes * 60;
  const win = res.rows[0].totalTime;
  assert.ok(win > nominal * (1 + lo) && win < nominal * (1 + hi), `winner ${win.toFixed(1)} s vs nominal ${nominal}`);
  const expected = estimateRaceSeconds(r.config.laps, getTrackDef(r.config.trackId).referenceLapTime, r.config.difficulty);
  assert.ok(win > expected * 0.93 && win < expected * 1.07, `winner ${win.toFixed(1)} vs formula ${expected.toFixed(1)}`);
  // sanity of the whole field: nobody leaves the track for long, no huge impacts
  assert.ok(r.maxWall < 30, `wall impact ${r.maxWall}`);
  assert.ok(r.offTrackCarSeconds < 80, `off-track car-seconds ${r.offTrackCarSeconds}`);
  assert.ok(r.maxOffTrack < r.model.wallOffset + 1.5, `max |d| ${r.maxOffTrack}`);
  assert.ok(r.maxContact < 60, `contact ${r.maxContact}`);
  // lap events are sane
  const laps = r.events.filter((e) => e.name === 'race:lap');
  assert.ok(laps.length > 20);
  for (const e of laps) assert.ok(e.payload.lapTime > 20 && Number.isFinite(e.payload.lapTime));
  assert.ok(res.fastestLap && res.fastestLap.time > 30);
  // player-only events
  for (const e of r.events) if (e.name === 'race:position' || e.name === 'car:surface') assert.equal(e.payload.carId, sim.playerId);
}

test('full AI-only 5-minute race on monte-veloce (normal): finishes, 20 classified, <= 12 s wall clock', () => {
  const r = runRace({ trackId: 'monte-veloce', minutes: 5, difficulty: 'normal' });
  checkRace(r, { minutes: 5 });
  assert.ok(r.wallMs < 12000, `took ${r.wallMs} ms`);
  const ms = r.wallMs / r.steps;
  assert.ok(ms < 0.3, `${ms} ms/step`);
});

test('determinism: identical config gives identical result', () => {
  const a = runRace({ trackId: 'ridgeback', minutes: 5, seed: 11 }, { maxSeconds: 500 }).sim.getResult();
  const b = runRace({ trackId: 'ridgeback', minutes: 5, seed: 11 }, { maxSeconds: 500 }).sim.getResult();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = runRace({ trackId: 'ridgeback', minutes: 5, seed: 12 }, { maxSeconds: 500 }).sim.getResult();
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
});

test('lapped player (autopilot pace 0.6) still finishes: playerFinished, lapsDown >= 1', () => {
  const r = runRace({ trackId: 'monte-veloce' }, { pace: 0.6 });
  const res = r.sim.getResult();
  assert.equal(res.playerFinished, true);
  assert.ok(res.playerLapsDown >= 1, `lapsDown ${res.playerLapsDown}`);
  assert.ok(res.playerTotalTime > res.rows[0].totalTime);
  assert.equal(res.rows.find((x) => x.isPlayer).gapToWinner, null);
  assert.ok(res.playerPosition >= 15);
});

test('player-input car with a scripted simple controller completes the race, clean laps', () => {
  // The controller is a pure-pursuit driver at 85% pace whose commands are fed through the PLAYER input path
  // (keyboard filter, steer assist), not the autopilot.
  const config = makeConfig({ trackId: 'ridgeback', minutes: 5, teamId: 'ferrari', driverIndex: 1, steerAssist: 0.5 });
  const model = getTrackModel('ridgeback');
  const events = [];
  const sim = new RaceSim({ config, trackModel: model, emit: (n, p) => events.push({ n, p }) });
  const car = sim.cars[sim.playerId];
  const ctl = createAiDriver({ trackModel: model, stats: sim.stats[sim.playerId], driver: { skill: 1 }, difficulty: 'normal', rng: mulberry32(1), paceOverride: 0.85, noMistakes: true });
  sim.skipIntro();
  let steps = 0, wall = 0, off = 0;
  while (sim.phase !== 'finished' && steps < 120 * 1200) {
    const o = ctl.drive(car, sim.world, 1 / 120);
    sim.stepFixed({ steer: o.steer, throttle: o.throttle, brake: o.brake, boost: o.boost, handbrake: false, reset: false });
    steps++;
    if (Math.abs(car.d) > model.halfWidth + model.kerbWidth) off++;
  }
  wall = events.filter((e) => e.n === 'car:wall' && e.p.carId === sim.playerId).length;
  const res = sim.getResult();
  assert.equal(res.playerFinished, true);
  assert.equal(wall, 0);
  assert.ok(off / 120 < 2, `off track ${off / 120} s`);
  assert.ok(car.lapsDone >= config.laps);
  assert.ok(res.playerBestLap > 50 && res.playerBestLap < 120);
});

test('keyboard-style bang-bang controller (full-lock steering, binary pedals) never explodes the physics', () => {
  const config = makeConfig({ trackId: 'costa-marina', steerAssist: 0.5 });
  const model = getTrackModel('costa-marina');
  const sim = new RaceSim({ config, trackModel: model });
  const car = sim.cars[sim.playerId];
  sim.skipIntro();
  let nan = false, maxD = 0;
  for (let i = 0; i < 120 * 150; i++) {
    // steer to keep d near 0 and heading along the track; throttle on while slow, brake when fast
    const err = -car.d * 0.15 - Math.atan2(Math.sin(car.heading - car.trackHeading), Math.cos(car.heading - car.trackHeading)) * 1.5;
    const steer = Math.abs(err) < 0.05 ? 0 : Math.sign(err);
    const speed = Math.hypot(car.u, car.v);
    sim.stepFixed({ steer, throttle: speed < 35 ? 1 : 0, brake: speed > 45 ? 1 : 0, boost: false, handbrake: false, reset: i % 3000 === 2999 });
    if (!Number.isFinite(car.x + car.y + car.u + car.v + car.yawRate)) { nan = true; break; }
    maxD = Math.max(maxD, Math.abs(car.d));
  }
  assert.equal(nan, false);
  assert.ok(maxD < model.wallOffset + 1.5);
});

test('snapshot: complete, finite, interpolated, fresh numbers; order consistent', () => {
  const r = runRace({ trackId: 'monte-veloce' }, { maxSeconds: 40 });
  const sim = r.sim;
  const snap = sim.getSnapshot(0.5);
  for (const k of ['phase', 'time', 'raceTime', 'introT', 'lights', 'laps', 'minutes', 'playerId', 'leaderId', 'order', 'fastestLap', 'cars']) assert.ok(k in snap, k);
  assert.equal(snap.cars.length, 20);
  assert.equal(snap.order.length, 20);
  assert.equal(new Set(snap.order).size, 20);
  assert.equal(snap.leaderId, snap.order[0]);
  const carKeys = ['id', 'isPlayer', 'teamId', 'code', 'number', 'color', 'x', 'y', 'heading', 'speed', 'u', 'v', 'yawRate', 'steerAngle', 'ax', 'ay',
    'throttle', 'brake', 'gear', 'rpm', 'slip', 'surface', 's', 'd', 'progress', 'lap', 'position', 'grid', 'lapTime', 'lastLap', 'bestLap', 'gapAhead',
    'gapLeader', 'tyreWear', 'tyreGrip', 'heat', 'ers', 'boosting', 'wrongWay', 'finished', 'finishTime', 'contact'];
  snap.cars.forEach((c, i) => {
    assert.equal(c.id, i);
    for (const k of carKeys) assert.ok(k in c, `${k} missing`);
    for (const k of ['x', 'y', 'heading', 'speed', 'ax', 'ay', 'tyreWear', 'heat', 'ers', 'lapTime', 'gapAhead']) assert.ok(Number.isFinite(c[k]), `${k} not finite`);
    assert.ok(c.speed >= 0 && c.rpm >= 0 && c.rpm <= 1 && c.gear >= 1 && c.gear <= 8);
    assert.equal(snap.order[c.position - 1], i);
    assert.ok(c.grid >= 1 && c.grid <= 20);
  });
  assert.equal(snap.cars.filter((c) => c.isPlayer).length, 1);
  // interpolation: alpha 0 -> previous pose, alpha 1 -> current pose
  const c0 = sim.getSnapshot(0).cars[3], c1 = sim.getSnapshot(1).cars[3], ch = sim.getSnapshot(0.5).cars[3];
  assert.ok(Math.abs(ch.x - (c0.x + c1.x) / 2) < 1e-9 && Math.abs(ch.y - (c0.y + c1.y) / 2) < 1e-9);
  assert.equal(JSON.stringify(sim.getSnapshot()).includes('null,') && /"(x|y|speed|heading)":null/.test(JSON.stringify(sim.getSnapshot())), false);
});

test('metas: ids, player seat keeps displaced driver id, custom name/code, AI keep their own', () => {
  const config = makeConfig({ teamId: 'ferrari', driverIndex: 1, playerName: 'Max Power' });
  const sim = new RaceSim({ config, trackModel: getTrackModel(config.trackId) });
  assert.equal(sim.carMetas.length, 20);
  assert.equal(sim.playerId, 3);
  const p = sim.carMetas[3];
  assert.equal(p.isPlayer, true);
  assert.equal(p.driverId, 'ham');
  assert.equal(p.driverName, 'Max Power');
  assert.equal(p.code, 'POW');
  assert.equal(p.teamId, 'ferrari');
  assert.equal(p.color, '#E8002D');
  assert.equal(sim.carMetas[2].driverId, 'lec');
  assert.equal(sim.carMetas.filter((m) => m.isPlayer).length, 1);
  sim.carMetas.forEach((m, i) => assert.equal(m.id, i));
  assert.ok(p.stats && p.stats.mass > 0);
});

test('events: lap payloads, fastest lap improvements, carFinished order, position changes player-only', () => {
  const r = runRace({ trackId: 'ridgeback', minutes: 5, seed: 3 });
  const lapEv = r.events.filter((e) => e.name === 'race:lap');
  for (const e of lapEv) {
    for (const k of ['carId', 'lap', 'lapTime', 'isPlayer', 'isPersonalBest', 'isFastest']) assert.ok(k in e.payload);
    assert.equal(e.payload.isPlayer, e.payload.carId === r.sim.playerId);
  }
  const fl = r.events.filter((e) => e.name === 'race:fastestLap');
  assert.ok(fl.length >= 1);
  for (let i = 1; i < fl.length; i++) assert.ok(fl[i].payload.time < fl[i - 1].payload.time);
  const fin = r.events.filter((e) => e.name === 'race:carFinished');
  fin.forEach((e, i) => assert.equal(e.payload.position, i + 1));
  const res = r.sim.getResult();
  assert.equal(res.fastestLap.time, fl[fl.length - 1].payload.time);
});

if (FULL) {
  for (const id of TRACK_IDS) for (const minutes of [5, 7, 10]) for (const difficulty of ['easy', 'normal', 'hard']) {
    test(`FULL: ${id} ${minutes} min ${difficulty}`, () => {
      const r = runRace({ trackId: id, minutes, difficulty, seed: 21 + minutes });
      // rounding to whole laps is up to +-1/2 lap (~12% of a 5-min race) and hard AI cars are a few % faster
      checkRace(r, { minutes });
    });
  }
}
