// Stuck-car handling (QA: nose-first pin against the barrier freed only by R): reverse, wall response, auto-recovery for ALL cars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceSim, RECOVERY } from '../../src/sim/raceSim.js';
import { createCarState, SIM_DT } from '../../src/sim/carPhysics.js';
import { stepCar } from '../../src/sim/carStep.js';
import { getTrackModel, makeConfig, mclarenStats, NEUTRAL } from './helpers.js';
import { mulberry32 } from '../../src/core/mathUtil.js';
import { createAiDriver } from '../../src/sim/ai/aiDriver.js';

const stats = mclarenStats();

function pinnedCar(model, d, headingOffset) {
  const p = model.sampleAt(500);
  const car = createCarState({ x: p.x + d * p.nx, y: p.y + d * p.ny, heading: p.heading + headingOffset, speed: 0 }, stats);
  const pr = model.project(car.x, car.y, p.index);
  car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading; car.mode = 'player';
  return car;
}
const ctxFor = (model) => ({ trackModel: model, config: { difficulty: 'normal', tyreWearBase: 0.001 }, locked: false, draft: 0 });

for (const tid of ['monte-veloce', 'ridgeback', 'costa-marina']) {
  test(`nose-first against the barrier (${tid}): throttle alone frees the car (wall swings the body parallel), no reset needed`, () => {
    const model = getTrackModel(tid);
    for (const side of [-1, 1]) {
      const car = pinnedCar(model, side * (model.wallOffset - 3.1), side * (Math.PI / 2));   // nose perpendicular, touching
      let maxD = 0;
      for (let i = 0; i < 120 * 5; i++) {
        stepCar(car, stats, { steer: 0, throttle: 1, brake: 0 }, ctxFor(model), SIM_DT);
        maxD = Math.max(maxD, Math.abs(car.d));
      }
      assert.ok(Math.hypot(car.u, car.v) > 8, `side ${side}: speed ${car.u}`);
      assert.ok(maxD < model.wallOffset + 0.5, `never through the wall (${maxD})`);
    }
  });
}

test('nose-first against the barrier: holding the brake reverses out within ~2 s; full lock + throttle also escapes', () => {
  const model = getTrackModel('ridgeback');
  const a = pinnedCar(model, -(model.wallOffset - 3.1), -Math.PI / 2);
  let freeAt = null;
  for (let i = 0; i < 120 * 4; i++) {
    stepCar(a, stats, { steer: 0, throttle: 0, brake: 1 }, ctxFor(model), SIM_DT);
    if (freeAt === null && Math.abs(a.d) < model.wallOffset - 5) freeAt = i / 120;
  }
  assert.ok(freeAt !== null && freeAt < 2.5, `freed after ${freeAt}`);
  for (const steer of [-1, 1]) {
    const b = pinnedCar(model, -(model.wallOffset - 3.1), -Math.PI / 2);
    let maxU = 0;
    for (let i = 0; i < 120 * 6; i++) {
      stepCar(b, stats, { steer, throttle: 1, brake: 0 }, ctxFor(model), SIM_DT);
      maxU = Math.max(maxU, b.u);
    }
    assert.ok(maxU > 6, `steer ${steer}: max speed ${maxU}`);
  }
});

function startedSim(over = {}, emit) {
  const config = makeConfig({ trackId: 'ridgeback', ...over });
  const model = getTrackModel('ridgeback');
  const events = [];
  const sim = new RaceSim({ config, trackModel: model, emit: (n, p) => { events.push({ n, p, t: sim.raceTime }); if (emit) emit(n, p); } });
  sim.skipIntro();
  while (sim.phase !== 'racing') sim.stepFixed(NEUTRAL);
  return { sim, model, events };
}
const place = (sim, model, car, s, d, headingOffset = 0, u = 0) => {
  const p = model.sampleAt(s);
  car.x = p.x + d * p.nx; car.y = p.y + d * p.ny; car.heading = p.heading + headingOffset;
  car.prevX = car.x; car.prevY = car.y; car.prevHeading = car.heading; car.u = u; car.v = 0; car.yawRate = 0;
  const pr = model.project(car.x, car.y, p.index);
  car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading; car.prevS = pr.s;
};

test('human player stuck (no input) for > 5 s of racing is put back on the track centre, facing forward, with car:reset and a ghost period', () => {
  const { sim, model, events } = startedSim();
  const car = sim.cars[sim.playerId];
  for (let i = 0; i < 120 * 6; i++) sim.stepFixed(NEUTRAL);          // past the start grace
  assert.ok(sim.raceTime > RECOVERY.startGrace);
  events.length = 0;
  place(sim, model, car, 800, -(model.wallOffset - 3.1), -Math.PI / 2);   // wedged
  car.stuckT = 0;
  const t0 = sim.raceTime;
  let resetAt = null;
  for (let i = 0; i < 120 * 8 && resetAt === null; i++) {
    sim.stepFixed(NEUTRAL);
    if (events.some((e) => e.n === 'car:reset')) resetAt = sim.raceTime - t0;
  }
  assert.ok(resetAt !== null, 'reset happened');
  assert.ok(resetAt > 4.9 && resetAt < 5.3, `reset after ${resetAt}`);
  const ev = events.find((e) => e.n === 'car:reset');
  assert.deepEqual([ev.p.carId, ev.p.reason, ev.p.auto], [sim.playerId, 'stuck', true]);
  assert.ok(Number.isFinite(ev.p.x) && Number.isFinite(ev.p.y));
  assert.ok(Math.abs(car.d) < 0.5, `on the centre line (d=${car.d})`);
  assert.ok(Math.abs(car.heading - car.trackHeading) < 0.05, 'facing forward');
  assert.ok(Math.hypot(car.u, car.v) < 1);
  assert.ok(Math.abs(car.s - model.project(car.x, car.y).s) < 1e-6);
  assert.ok(car.ghost > 0 && sim.getSnapshot().cars[sim.playerId].ghost > 0, 'ghost flag in snapshot');
  // progress stays continuous (no lap-skip) and the car can drive away
  const prog0 = car.progress;
  const aim = createAiDriver({ trackModel: model, stats: sim.stats[sim.playerId], driver: { skill: 1 }, difficulty: 'normal', rng: mulberry32(1), paceOverride: 0.8, noMistakes: true });
  for (let i = 0; i < 120 * 4; i++) {
    const o = aim.drive(car, sim.world, SIM_DT);
    sim.stepFixed({ steer: o.steer, throttle: o.throttle, brake: o.brake, boost: false, handbrake: false, reset: false });
  }
  assert.ok(car.progress - prog0 > 60, `drove away: ${car.progress - prog0} m`);
  assert.equal(events.filter((e) => e.n === 'car:reset').length, 1, 'no repeated resets');
});

test('no recovery during the start grace, while moving, or while the brake-reverse is getting the car out', () => {
  const { sim, model, events } = startedSim();
  const car = sim.cars[sim.playerId];
  for (let i = 0; i < 120 * 3; i++) sim.stepFixed(NEUTRAL);           // standing still on the grid for 3 s of racing
  assert.equal(events.filter((e) => e.n === 'car:reset').length, 0);
  // creeping at 3 m/s (> stuck speed) never counts as stuck
  for (let i = 0; i < 120 * 10; i++) { place(sim, model, car, 800, 0, 0, 3); sim.stepFixed(NEUTRAL); }
  assert.equal(events.filter((e) => e.n === 'car:reset').length, 0);
  // wedged but reversing out with the brake: gets out well before 5 s
  place(sim, model, car, 1200, -(model.wallOffset - 3.1), -Math.PI / 2);
  for (let i = 0; i < 120 * 3; i++) sim.stepFixed({ steer: 0, throttle: 0, brake: 1, boost: false, handbrake: false, reset: false });
  assert.ok(Math.abs(car.d) < model.wallOffset - 4);
  assert.equal(events.filter((e) => e.n === 'car:reset').length, 0);
});

test('far off the track for > 8 s (even while "moving") is recovered with reason offtrack', () => {
  const { sim, model, events } = startedSim();
  const car = sim.cars[sim.playerId];
  for (let i = 0; i < 120 * 5; i++) sim.stepFixed(NEUTRAL);
  events.length = 0;
  const far = model.halfWidth + model.kerbWidth + RECOVERY.offTrackMargin + 0.6;
  assert.ok(far < model.wallOffset - 1.2);
  let at = null;
  const t0 = sim.raceTime;
  for (let i = 0; i < 120 * 12 && at === null; i++) {
    place(sim, model, car, 900, far, 0.3, 12);
    sim.stepFixed(NEUTRAL);
    if (events.some((e) => e.n === 'car:reset')) at = sim.raceTime - t0;
  }
  assert.ok(at !== null && at > 7.8 && at < 8.4, `reset after ${at}`);
  assert.equal(events.find((e) => e.n === 'car:reset').p.reason, 'offtrack');
});

test('AI cars are recovered too (stuck 4 s) and a recovered car is ghost: no car-car contact with the car it overlaps', () => {
  const { sim, model, events } = startedSim();
  for (let i = 0; i < 120 * 6; i++) sim.stepFixed(NEUTRAL);
  const victim = sim.cars.find((c) => c.id !== sim.playerId);
  const other = sim.cars.find((c) => c.id !== sim.playerId && c.id !== victim.id);
  events.length = 0;
  const t0 = sim.raceTime;
  let at = null;
  for (let i = 0; i < 120 * 6 && at === null; i++) {
    place(sim, model, victim, 1500, -(model.wallOffset - 3.1), -Math.PI / 2);
    sim.stepFixed(NEUTRAL);
    if (events.some((e) => e.n === 'car:reset' && e.p.carId === victim.id)) at = sim.raceTime - t0;
  }
  assert.ok(at !== null && at > 3.8 && at < 4.4, `AI reset after ${at}`);
  assert.equal(events.find((e) => e.n === 'car:reset' && e.p.carId === victim.id).p.reason, 'stuck');
  // overlap another car on the spot for the ghost period: the contacts are ignored
  events.length = 0;
  place(sim, model, other, victim.s, 0, 0, 0); other.prevX = other.x; other.prevY = other.y;
  const x0 = other.x, y0 = other.y;
  for (let i = 0; i < 30; i++) sim.stepFixed(NEUTRAL);
  assert.equal(events.filter((e) => e.n === 'car:contact').length, 0);
  assert.ok(Math.hypot(other.x - x0, other.y - y0) < 5);
});

test('manual reset (R) emits car:reset {reason: manual, auto: false} and still works within ~1 s of an auto recovery', () => {
  const { sim, model, events } = startedSim();
  for (let i = 0; i < 120 * 6; i++) sim.stepFixed(NEUTRAL);
  events.length = 0;
  sim.stepFixed({ ...NEUTRAL, reset: true });
  const ev = events.find((e) => e.n === 'car:reset');
  assert.ok(ev && ev.p.reason === 'manual' && ev.p.auto === false && ev.p.carId === sim.playerId);
  // auto cooldown is short, so a player can still press R right after
  assert.ok(RECOVERY.cooldown <= 1.5);
});

test('random-input fuzz: the player is never stuck for more than 8 s (QA: 1.8 episodes/min, median 21 s before)', () => {
  const runs = 9;
  const tracks = ['monte-veloce', 'ridgeback', 'costa-marina'];
  let worst = 0, stuckRuns = 0;
  for (let run = 0; run < runs; run++) {
    const tid = tracks[run % 3];
    const model = getTrackModel(tid);
    const sim = new RaceSim({ config: makeConfig({ trackId: tid, seed: 500 + run, teamId: 'haas', upgrades: {} }), trackModel: model });
    sim.skipIntro();
    const R = mulberry32(1000 + run);
    let steer = 0, thr = 0, brk = 0, hb = false, boost = false, hold = 0, still = 0, maxStill = 0;
    const pc = sim.cars[sim.playerId];
    for (let k = 0; k < 120 * 70; k++) {
      if (hold <= 0) {
        hold = Math.floor(24 + R() * 150);
        steer = R() < 0.25 ? (R() < 0.5 ? -1 : 1) : R() * 2 - 1;
        thr = R() < 0.6 ? 0.5 + R() * 0.5 : R();
        brk = R() < 0.15 ? R() : 0;
        hb = R() < 0.03; boost = R() < 0.3;
      }
      hold--;
      sim.stepFixed({ steer, throttle: thr, brake: brk, handbrake: hb, boost, reset: false });
      assert.ok(Number.isFinite(pc.x + pc.y + pc.u + pc.v + pc.heading), 'finite');
      assert.ok(Math.abs(pc.d) < model.wallOffset + 2, 'inside the barriers');
      if (sim.phase === 'racing' && Math.hypot(pc.u, pc.v) < 0.5) { still++; maxStill = Math.max(maxStill, still); } else still = 0;
    }
    worst = Math.max(worst, maxStill / 120);
    if (maxStill / 120 > 8) stuckRuns++;
  }
  assert.ok(stuckRuns / runs < 0.1, `${stuckRuns}/${runs} runs stuck > 8 s (worst ${worst.toFixed(1)} s)`);
  assert.ok(worst < 8, `worst stationary stretch ${worst.toFixed(1)} s`);
});
