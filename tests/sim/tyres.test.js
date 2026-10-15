import test from 'node:test';
import assert from 'node:assert/strict';
import { tyreGripFromWear, stepTyreWear, stepThermal } from '../../src/sim/tyres.js';
import { createCarState, TUNING } from '../../src/sim/carPhysics.js';
import { computeCarStats } from '../../src/data/carStats.js';
import { TEAMS } from '../../src/data/teams.js';
import { mclarenStats, makeConfig, runRace, FULL, TRACK_IDS } from './helpers.js';

const stats = mclarenStats();

test('grip curve is monotone, 1.0 at new, ~0.88 at 75%, cliff to ~0.63', () => {
  let prev = 2;
  for (let w = 0; w <= 1.0001; w += 0.01) {
    const g = tyreGripFromWear(w);
    assert.ok(g <= prev + 1e-12, `monotone at ${w}`);
    prev = g;
  }
  assert.equal(tyreGripFromWear(0), 1);
  assert.ok(Math.abs(tyreGripFromWear(0.75) - 0.91) < 0.04);
  assert.ok(Math.abs(tyreGripFromWear(1) - 0.63) < 0.01);
});

test('wear rises faster with load and slower on grass', () => {
  const cfg = makeConfig();
  const wear = (ax, ay, surface) => {
    const c = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats);
    c.ax = ax; c.ay = ay; c.surface = surface;
    for (let i = 0; i < 1200; i++) stepTyreWear(c, stats, cfg, 1 / 120);
    return c.tyreWear;
  };
  const idle = wear(0, 0, 'asphalt'), mid = wear(0, 15, 'asphalt'), hard = wear(0, 35, 'asphalt');
  assert.ok(idle < mid && mid < hard, `${idle} ${mid} ${hard}`);
  assert.ok(wear(0, 35, 'grass') < hard * 0.6);
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats);
  for (let i = 0; i < 1200; i++) stepTyreWear(c, stats, cfg, 1 / 120);
  assert.ok(Math.abs(c.tyreGrip - tyreGripFromWear(c.tyreWear)) < 1e-12);
});

test('heat rises on full throttle, derate near 1.0, overheat event once and re-arms', () => {
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 20 }, stats);   // slow => poor cooling
  c.inThrottle = 1; c.wantBoost = false;
  let events = 0, t = 0;
  while (c.heat < 1.19 && t < 400) { if (stepThermal(c, stats, 1 / 120)) events++; t += 1 / 120; }
  assert.equal(events, 1);
  assert.ok(c.heat <= 1.2 + 1e-9);
  c.inThrottle = 0;
  for (let i = 0; i < 120 * 60; i++) stepThermal(c, stats, 1 / 120);
  assert.ok(c.heat < 0.8);
  c.inThrottle = 1;
  events = 0;
  while (c.heat < 1.0 && t < 1000) { if (stepThermal(c, stats, 1 / 120)) events++; t += 1 / 120; }
  assert.equal(events, 1, 're-armed');
});

test('ERS: boost drains ~8 s, auto-cuts at 0, recharges when lifting/braking', () => {
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 80 }, stats);
  c.inThrottle = 1; c.wantBoost = true;
  let t = 0;
  while (c.boosting || t < 0.1) { c.heat = 0; stepThermal(c, stats, 1 / 120); t += 1 / 120; if (t > 20) break; }   // heat pinned: this test is about the ERS store
  assert.ok(Math.abs(t - 8) < 0.5, `boost lasted ${t}`);
  assert.equal(c.ers, 0);
  c.inThrottle = 0; c.inBrake = 1; c.wantBoost = true;
  for (let i = 0; i < 120 * 5; i++) stepThermal(c, stats, 1 / 120);
  assert.ok(c.ers > 0.4, `recharged ${c.ers}`);       // 0.05*(1+1)/s * 5 s = 0.5
});

test('heat settles to an equilibrium (no run-away) that depends on cooling level, speed and throttle', () => {
  const eq = (levels, u, thr, boost = false, draft = 0) => {
    const st = computeCarStats(TEAMS.find((t) => t.id === 'mclaren'), levels);
    const c = createCarState({ x: 0, y: 0, heading: 0, speed: u }, st);
    c.inThrottle = thr; c.wantBoost = boost; c.ers = 1;
    for (let i = 0; i < 120 * 200; i++) { c.ers = 1; stepThermal(c, st, 1 / 120, draft); }
    return c.heat;
  };
  const hot = eq({}, 70, 1), cool5 = eq({ cooling: 5 }, 70, 1);
  assert.ok(hot > 0.8 && hot <= 1.2, `stock full-throttle heat ${hot}`);
  assert.ok(cool5 < hot - 0.3, `cooling 5 ${cool5} vs ${hot}`);
  assert.ok(cool5 < computeCarStats(TEAMS[0], { cooling: 5 }).heatLimit, 'level 5 stays below its derate threshold at full throttle');
  assert.ok(eq({}, 70, 0.3) < hot - 0.25, 'part throttle runs cooler');
  assert.ok(eq({}, 25, 0.5) > eq({}, 90, 0.5) + 0.1, 'low airflow runs hotter');
  assert.ok(eq({ cooling: 3 }, 70, 0.55, true) > eq({ cooling: 3 }, 70, 0.55, false) + 0.05, 'ERS boost adds heat');
  assert.ok(eq({ cooling: 3 }, 70, 0.5, false, 0.18) > eq({ cooling: 3 }, 70, 0.5, false, 0) + 0.15, 'dirty air (slipstream) reduces cooling');
  // monotone in cooling level
  let prev = Infinity;
  for (let L = 0; L <= 5; L++) { const h = eq({ cooling: L }, 70, 0.6); assert.ok(h < prev, `L${L} ${h}`); prev = h; }
});

test('ERS boost cuts out when the engine is cooked (heat > heatLimit + margin) and cooling raises that point', () => {
  const st = computeCarStats(TEAMS[0], {});
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 80 }, st);
  c.inThrottle = 1; c.wantBoost = true; c.heat = st.heatLimit + TUNING.boostCutMargin + 0.01;
  stepThermal(c, st, 1 / 120);
  assert.equal(c.boosting, false);
  c.heat = st.heatLimit + 0.02;
  stepThermal(c, st, 1 / 120);
  assert.equal(c.boosting, true);
  const st5 = computeCarStats(TEAMS[0], { cooling: 5 });
  const d = createCarState({ x: 0, y: 0, heading: 0, speed: 80 }, st5);
  d.inThrottle = 1; d.wantBoost = true; d.heat = st.heatLimit + TUNING.boostCutMargin + 0.01;
  stepThermal(d, st5, 1 / 120);
  assert.equal(d.boosting, true, 'level-5 cooling still boosts at a heat that cuts a stock car');
});

test('overheat event: once per excursion, not re-armed while hovering near the limit', () => {
  const c = createCarState({ x: 0, y: 0, heading: 0, speed: 20 }, stats);
  c.inThrottle = 0; c.heat = 0.99; c.overheatT = 100;
  let events = 0;
  for (let i = 0; i < 120 * 60; i++) {
    c.inThrottle = (i % 240) < 120 ? 1 : 0.35;      // heat wobbles around 0.9..1.05
    c.heat = Math.max(c.heat, 0.85);
    if (stepThermal(c, stats, 1 / 120)) events++;
  }
  assert.ok(events <= 1, `events ${events}`);
});

test('AI race: end-of-race tyre wear ~0.35..0.70 (monte-veloce, 5 min)', () => {
  const r = runRace({ trackId: 'monte-veloce' });
  const wears = r.sim.cars.map((c) => c.tyreWear);
  const avg = wears.reduce((a, b) => a + b, 0) / wears.length;
  assert.ok(avg > 0.35 && avg < 0.7, `avg wear ${avg.toFixed(2)}`);
  for (const w of wears) assert.ok(w >= 0 && w <= 1);
});

if (FULL) {
  for (const id of TRACK_IDS.slice(1)) {
    test(`AI race wear on ${id}`, () => {
      const r = runRace({ trackId: id });
      const avg = r.sim.cars.reduce((a, c) => a + c.tyreWear, 0) / 20;
      assert.ok(avg > 0.35 && avg < 0.7, `avg wear ${avg.toFixed(2)}`);
    });
  }
}
