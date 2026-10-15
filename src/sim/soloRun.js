// Headless single-car runs (calibration, tests, AI tuning). No other cars, no race logic.
import { createCarState, SIM_DT } from './carPhysics.js';
import { stepCar } from './carStep.js';
import { createAiDriver } from './ai/aiDriver.js';
import { mulberry32 } from '../core/mathUtil.js';

/**
 * Runs one car alone and returns lap times.
 * opts: { onStep?(car, t), trackModel, stats, driver, difficulty, seed, laps, raceSeconds, noMistakes, paceOverride, startSpeed, maxSeconds }
 */
export function runSolo(opts) {
  const model = opts.trackModel, stats = opts.stats;
  const laps = opts.laps ?? 4;
  const raceSeconds = opts.raceSeconds ?? 300;
  const config = { difficulty: opts.difficulty || 'normal', tyreWearBase: 0.62 / (0.55 * raceSeconds) };
  const p0 = model.sampleAt(0);
  const car = createCarState({ x: p0.x, y: p0.y, heading: p0.heading, speed: opts.startSpeed ?? 40 }, stats);
  car.mode = 'ai';
  const ai = createAiDriver({
    trackModel: model, stats, driver: opts.driver || { skill: 0.9 }, difficulty: config.difficulty,
    rng: mulberry32(opts.seed ?? 1), noMistakes: opts.noMistakes, paceOverride: opts.paceOverride,
  });
  const p = model.project(car.x, car.y, 0);
  car.s = p.s; car.d = p.d; car.index = p.index; car.trackHeading = p.heading;
  const world = { cars: [car], playerId: -1, raceTime: 10, phase: 'racing' };
  const ctx = { trackModel: model, config, locked: false, draft: 0 };
  const lapTimes = [];
  let t = 0, progress = 0, lapsDone = 0, lastCross = 0;
  let maxD = 0, wallHits = 0, offTrackTime = 0, maxLat = 0, nan = false, wallImpactMax = 0;
  const maxT = opts.maxSeconds ?? laps * 200 + 30;
  while (lapsDone < laps && t < maxT) {
    const raw = ai.drive(car, world, SIM_DT);
    const px = car.x, py = car.y;
    stepCar(car, stats, raw, ctx, SIM_DT);
    t += SIM_DT; world.raceTime = 10 + t;
    let ds = car.s - car.prevS;
    if (ds < -model.length / 2) ds += model.length; else if (ds > model.length / 2) ds -= model.length;
    const pp = progress; progress += ds;
    while (progress >= (lapsDone + 1) * model.length) {
      const frac = ((lapsDone + 1) * model.length - pp) / (progress - pp);
      const tc = t - SIM_DT + SIM_DT * frac;
      lapTimes.push(tc - lastCross); lastCross = tc; lapsDone++;
      if (lapsDone >= laps) break;
    }
    const ad = Math.abs(car.d);
    if (ad > maxD) maxD = ad;
    if (ad > model.halfWidth + model.kerbWidth) offTrackTime += SIM_DT;
    if (car.wallImpact > 3) wallHits++;
    if (car.wallImpact > wallImpactMax) wallImpactMax = car.wallImpact;
    if (opts.onStep) opts.onStep(car, t);
    const lat = Math.abs(car.ay) / 9.81; if (lat > maxLat) maxLat = lat;
    if (!Number.isFinite(car.x + car.y + car.u + car.v + car.heading + car.yawRate)) { nan = true; break; }
  }
  return { lapTimes, car, time: t, maxD, wallHits, wallImpactMax, offTrackTime, maxLat, nan, completed: lapsDone >= laps };
}
