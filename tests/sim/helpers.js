// Shared helpers for tests/sim (not a test file itself).
import { TEAMS } from '../../src/data/teams.js';
import { computeCarStats } from '../../src/data/carStats.js';
import { getTrackModel, getTrackDef } from '../../src/data/tracks/index.js';
import { createRaceConfig } from '../../src/data/raceConfig.js';
import { RaceSim } from '../../src/sim/raceSim.js';

export const TRACK_IDS = ['monte-veloce', 'ridgeback', 'costa-marina'];
export const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false };
export const FULL = process.env.FULL === '1';

export function mclarenStats() {
  return computeCarStats(TEAMS.find((t) => t.id === 'mclaren'));
}
export function calibrationStats() {
  return computeCarStats(TEAMS.find((t) => t.id === 'racingbulls'));
}

export function makeConfig(over = {}) {
  return createRaceConfig({
    trackId: 'monte-veloce', minutes: 5, difficulty: 'normal', teamId: 'mclaren', driverIndex: 0,
    playerName: 'PLAYER', seed: 7, upgrades: {}, ...over,
  });
}

/** Runs a race headless until 'finished' (or maxSteps). Returns {sim, events:[{name,payload,t}], stats}. */
export function runRace(over = {}, { autopilot = true, pace = null, input = NEUTRAL, maxSeconds = 1500, skipIntro = true, onStep = null } = {}) {
  const config = makeConfig(over);
  const model = getTrackModel(config.trackId);
  const events = [];
  const counts = {};
  let sim;
  sim = new RaceSim({
    config, trackModel: model,
    emit: (name, payload) => { counts[name] = (counts[name] || 0) + 1; events.push({ name, payload, t: sim ? sim.time : 0 }); },
  });
  if (autopilot) sim.setPlayerAutopilot(true, pace != null ? { pace } : null);
  if (skipIntro) sim.skipIntro();
  const maxSteps = Math.round(maxSeconds * 120);
  let steps = 0, nan = false, maxOffTrack = 0, offTrackCarSteps = 0, wallHits = 0, maxWall = 0, maxContact = 0;
  const t0 = performance.now();
  while (sim.phase !== 'finished' && steps < maxSteps) {
    sim.stepFixed(typeof input === 'function' ? input(sim) : input);
    steps++;
    if (onStep) onStep(sim, steps);
    for (const c of sim.cars) {
      if (!Number.isFinite(c.x + c.y + c.u + c.v + c.heading + c.yawRate + c.progress)) nan = true;
      const ad = Math.abs(c.d);
      if (ad > maxOffTrack) maxOffTrack = ad;
      if (ad > model.halfWidth + model.kerbWidth + 0.3) offTrackCarSteps++;
    }
  }
  for (const e of events) {
    if (e.name === 'car:wall') { wallHits++; maxWall = Math.max(maxWall, e.payload.speed); }
    if (e.name === 'car:contact') maxContact = Math.max(maxContact, e.payload.speed);
  }
  return {
    sim, events, counts, config, model, steps, nan, maxOffTrack, wallHits, maxWall, maxContact,
    offTrackCarSeconds: offTrackCarSteps / 120, wallMs: performance.now() - t0,
  };
}

export { getTrackModel, getTrackDef, RaceSim };
