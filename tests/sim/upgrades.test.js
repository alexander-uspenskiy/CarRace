// Upgrade balance (QA: brakes 0.0%, cooling 0.00%, tyres ~2x engine per credit, all-max 8-12% faster).
// Measured on solo autopilot laps (pace 0.96, no mistakes) - the cleanest measure, no traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from '../../src/data/teams.js';
import { computeCarStats, statSummary } from '../../src/data/carStats.js';
import { UPGRADE_CATEGORIES } from '../../src/data/upgrades.js';
import { runSolo } from '../../src/sim/soloRun.js';
import { createCarState, stepCarDynamics, filterInput, SIM_DT } from '../../src/sim/carPhysics.js';
import { buildRacingLine, brakeConfidence } from '../../src/sim/ai/racingLine.js';
import { getTrackModel, TRACK_IDS } from './helpers.js';

const mclaren = TEAMS.find((t) => t.id === 'mclaren');
const lv = (cat, n) => ({ engine: 0, aero: 0, brakes: 0, tyres: 0, cooling: 0, [cat]: n });
const ALL5 = { engine: 5, aero: 5, brakes: 5, tyres: 5, cooling: 5 };
const cache = new Map();
function solo(tid, levels) {
  const key = tid + JSON.stringify(levels);
  if (!cache.has(key)) {
    const stats = computeCarStats(mclaren, levels);
    const r = runSolo({ trackModel: getTrackModel(tid), stats, driver: { skill: 1 }, difficulty: 'normal', seed: 3, laps: 5, raceSeconds: 300, noMistakes: true, paceOverride: 0.96, startSpeed: 0 });
    assert.ok(r.completed && !r.nan && r.wallHits === 0, `${tid} ${key}: clean run`);
    const laps = r.lapTimes.slice(1);
    cache.set(key, { best: Math.min(...laps), avg: laps.reduce((a, b) => a + b, 0) / laps.length, wear: r.car.tyreWear });
  }
  return cache.get(key);
}
/** mean over tracks of the lap-time gain (%) of `levels` vs stock, on 'best' or 'avg' laps */
function gain(levels, kind = 'best') {
  let sum = 0;
  for (const tid of TRACK_IDS) sum += (1 - solo(tid, levels)[kind] / solo(tid, lv('engine', 0))[kind]) * 100;
  return sum / TRACK_IDS.length;
}

test('level-5 solo gain per category is measurable and sensible; nothing is a dud, nothing dominates', () => {
  const g = {};
  for (const c of UPGRADE_CATEGORIES) g[c] = gain(lv(c, 5));
  console.log('level-5 best-lap gain %:', Object.fromEntries(Object.entries(g).map(([k, v]) => [k, +v.toFixed(2)])));
  assert.ok(g.engine > 1.2 && g.engine < 3.5, `engine ${g.engine}`);
  assert.ok(g.aero > 1.2 && g.aero < 3.5, `aero ${g.aero}`);
  assert.ok(g.brakes > 0.4 && g.brakes < 2.2, `brakes ${g.brakes}`);
  assert.ok(g.tyres > 1.5 && g.tyres < 3.5, `tyres ${g.tyres}`);
  assert.ok(g.cooling > 0.2 && g.cooling < 1.5, `cooling ${g.cooling}`);
  const hi = Math.max(...Object.values(g)), lo = Math.min(...Object.values(g));
  assert.ok(hi / lo < 7, `spread ${hi}/${lo}`);
  assert.ok(g.tyres < 1.5 * g.engine, 'tyres are no longer ~2x engine per credit');
});

test('all five categories maxed: ~8% faster than stock (not 8-12%), levels are monotone', () => {
  const all = gain(ALL5), allAvg = gain(ALL5, 'avg');
  assert.ok(all > 6.5 && all <= 8.6, `all-max best-lap gain ${all}`);
  assert.ok(allAvg > 6.5 && allAvg <= 9.2, `all-max avg-lap gain ${allAvg}`);
  for (const c of UPGRADE_CATEGORIES) {
    const l2 = gain(lv(c, 2), 'avg'), l5 = gain(lv(c, 5), 'avg');
    assert.ok(l2 > -0.05 && l5 > l2, `${c}: L2 ${l2} L5 ${l5}`);
  }
});

test('tyres: wear drops clearly (x0.9^L), cooling: hot circuits are quicker with level 5 on average laps', () => {
  for (const tid of TRACK_IDS) assert.ok(solo(tid, lv('tyres', 5)).wear < 0.75 * solo(tid, lv('engine', 0)).wear, tid);
  assert.ok(gain(lv('cooling', 5), 'avg') > gain(lv('cooling', 5), 'best') - 1e-9, 'heat builds over a stint, so average laps gain at least as much as the best lap');
  assert.ok((1 - solo('monte-veloce', lv('cooling', 5)).avg / solo('monte-veloce', {}).avg) * 100 > 0.4, 'Monte Veloce (long straights) needs the cooling');
});

test('brakes: the AI uses the stat (confidence, profile) and a human stops from 80 m/s far shorter', () => {
  const stock = computeCarStats(mclaren, {}), b5 = computeCarStats(mclaren, lv('brakes', 5));
  assert.equal(brakeConfidence(stock), 0);
  assert.ok(Math.abs(brakeConfidence(b5) - 1) < 1e-9, `${brakeConfidence(b5)}`);
  const model = getTrackModel('monte-veloce');
  const t = (stats) => { const l = buildRacingLine(model, stats); let s = 0; for (let i = 0; i < model.N; i++) s += l.dsl[i] / l.speed[i]; return s; };
  assert.ok(t(b5) < t(stock) * 0.992, `profile ${t(b5)} vs ${t(stock)}`);
  const stopDist = (stats, v0) => {
    const c = createCarState({ x: 0, y: 0, heading: 0, speed: v0 }, stats);
    c.mode = 'ai';
    const env = { gripFront: 1, gripRear: 1, rollExtra: 0, draft: 0, locked: false };
    for (let i = 0; i < 120 * 12 && c.u > 0.05; i++) stepCarDynamics(c, stats, filterInput(c, { steer: 0, throttle: 0, brake: 1 }, SIM_DT), env, SIM_DT);
    return c.x;
  };
  assert.ok(stopDist(b5, 80) < 0.8 * stopDist(stock, 80), `${stopDist(b5, 80)} vs ${stopDist(stock, 80)}`);
  assert.ok(stopDist(b5, 27.8) < stopDist(stock, 27.8) + 1e-9, 'never longer');
  assert.ok(stopDist(stock, 27.8) <= 30 && stopDist(stock, 27.8) >= 15);
});

test('display stat bars stay consistent with the stats (statSummary)', () => {
  const keys = ['topSpeed', 'accel', 'cornering', 'braking', 'tyreLife', 'cooling'];
  const base = statSummary(computeCarStats(mclaren, {}));
  const bar = (cat) => statSummary(computeCarStats(mclaren, lv(cat, 5)));
  assert.ok(bar('engine').topSpeed > base.topSpeed + 20);
  assert.ok(bar('aero').cornering > base.cornering + 10);
  assert.ok(bar('brakes').braking > base.braking + 20);
  assert.ok(bar('tyres').tyreLife > base.tyreLife + 20);
  assert.ok(bar('cooling').cooling > base.cooling + 20);
  for (const c of UPGRADE_CATEGORIES) for (const k of keys) assert.ok(bar(c)[k] >= base[k] - 12, `${c} must not tank ${k}`);
});
