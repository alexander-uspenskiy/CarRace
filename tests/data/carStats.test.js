import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CAR, computeCarStats, teamBaseMultipliers, statSummary, computeDerived } from '../../src/data/carStats.js';
import { TEAMS, getTeam } from '../../src/data/teams.js';
import { UPGRADE_CATEGORIES, emptyLevels } from '../../src/data/upgrades.js';

const lvl = (cat, n) => ({ ...emptyLevels(), [cat]: n });
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (+-${tol})`);

test('BASE_CAR matches the spec and its derived values', () => {
  assert.equal(BASE_CAR.mass, 800);
  assert.equal(BASE_CAR.power, 400000);
  assert.equal(BASE_CAR.boostPower, 80000);
  assert.equal(BASE_CAR.cdA, 0.85);
  assert.equal(BASE_CAR.clA, 3.0);
  assert.equal(BASE_CAR.brakeForceMax, 12500);   // balance pass: was 21000 (never the limiting factor, so Brakes did nothing)
  assert.equal(BASE_CAR.heatLimit, 0.8);
  assert.equal(BASE_CAR.tyreMu, 1.55);
  assert.equal(BASE_CAR.cgToFront + BASE_CAR.cgToRear, 3.6);
  near(BASE_CAR.derived.topSpeed, 89.8, 0.2);
  near(BASE_CAR.derived.maxLatG60, 2.83, 0.02);
  near(BASE_CAR.derived.accel0to100, 3.3, 0.15);
});

test('derived topSpeed solves the power balance and is below the drag-only estimate', () => {
  const s = BASE_CAR;
  const u = s.derived.topSpeed;
  const balance = 0.6 * s.cdA * u ** 3 + s.crr * (s.mass * 9.81 + 0.6 * s.clA * u * u) * u;
  near(balance, s.power, 50);
  const dragOnly = (s.power / (0.6 * s.cdA)) ** (1 / 3);
  assert.ok(u < dragOnly);
});

test('teamBaseMultipliers', () => {
  assert.deepEqual(teamBaseMultipliers(1), { power: 1, cl: 1, cd: 1, mu: 1 });
  const last = teamBaseMultipliers(0.65);
  near(last.power, 0.97, 1e-9);
  near(last.cl, 0.95, 1e-9);
  near(last.cd, 1.02, 1e-9);
  near(last.mu, 0.99, 1e-9);
});

test('computeCarStats returns a fresh object and never mutates BASE_CAR', () => {
  const before = JSON.stringify(BASE_CAR);
  const a = computeCarStats(getTeam('sauber'), { engine: 5, aero: 5, brakes: 5, tyres: 5, cooling: 5 });
  a.mass = 1;
  a.derived.topSpeed = 0;
  assert.equal(JSON.stringify(BASE_CAR), before);
  const b = computeCarStats(getTeam('sauber'));
  assert.notEqual(a, b);
  assert.notEqual(b, BASE_CAR);
  assert.notEqual(b.derived, BASE_CAR.derived);
  assert.equal(b.mass, 800);
});

test('all fields present and finite for every team', () => {
  for (const t of TEAMS) {
    const s = computeCarStats(t, emptyLevels());
    for (const k of Object.keys(BASE_CAR)) {
      assert.ok(k in s, `${t.id} missing ${k}`);
      if (k !== 'derived') assert.ok(Number.isFinite(s[k]), `${t.id}.${k}`);
    }
    for (const k of ['topSpeed', 'maxLatG60', 'accel0to100']) assert.ok(Number.isFinite(s.derived[k]) && s.derived[k] > 0);
  }
});

test('top team is the reference; weaker teams are slower (power) and have less grip', () => {
  const mc = computeCarStats(getTeam('mclaren'));
  near(mc.power, BASE_CAR.power, 1e-6);
  near(mc.derived.topSpeed, BASE_CAR.derived.topSpeed, 1e-6);
  let prev = Infinity;
  for (const t of TEAMS) {
    const s = computeCarStats(t);
    assert.ok(s.derived.topSpeed <= prev + 1e-9);
    prev = s.derived.topSpeed;
    assert.ok(s.derived.maxLatG60 <= mc.derived.maxLatG60 + 1e-9);
  }
  // accepts team id string too
  assert.equal(computeCarStats('ferrari').power, computeCarStats(getTeam('ferrari')).power);
  assert.throws(() => computeCarStats('zzz'));
});

test('upgrade effects match the spec table', () => {
  const t = getTeam('mclaren');
  const base = computeCarStats(t);
  const e3 = computeCarStats(t, lvl('engine', 3));
  near(e3.power / base.power, 1.15, 1e-9);
  near(e3.boostPower / base.boostPower, 1.27, 1e-9);
  const a5 = computeCarStats(t, lvl('aero', 5));
  near(a5.clA / base.clA, 1.19, 1e-9);
  near(a5.cdA / base.cdA, 1.06, 1e-9);
  near(computeCarStats(t, lvl('brakes', 2)).brakeForceMax / base.brakeForceMax, 1.28, 1e-9);
  const ty = computeCarStats(t, lvl('tyres', 4));
  near(ty.tyreMu / base.tyreMu, 1.028, 1e-9);
  near(ty.tyreWearMult / base.tyreWearMult, 0.9 ** 4, 1e-9);
  const co = computeCarStats(t, lvl('cooling', 5));
  near(co.heatGain / base.heatGain, 0.75, 1e-9);
  near(co.coolRate / base.coolRate, 1.6, 1e-9);
  near(co.heatLimit / base.heatLimit, 1.2, 1e-9);
});

test('each category improves monotonically with level on its own metric', () => {
  const t = getTeam('williams');
  const metric = {
    engine: (s) => s.derived.topSpeed,
    aero: (s) => s.derived.maxLatG60,
    brakes: (s) => s.brakeForceMax,
    tyres: (s) => s.tyreMu / s.tyreWearMult,
    cooling: (s) => (s.coolRate / s.heatGain) * s.heatLimit,
  };
  for (const cat of UPGRADE_CATEGORIES) {
    let prev = -Infinity;
    for (let L = 0; L <= 5; L++) {
      const v = metric[cat](computeCarStats(t, lvl(cat, L)));
      assert.ok(v > prev, `${cat} L${L}`);
      prev = v;
    }
  }
  // engine upgrade raises accel too; aero raises cornering at the price of cdA
  assert.ok(computeCarStats(t, lvl('engine', 5)).derived.accel0to100 <= computeCarStats(t).derived.accel0to100);
});

test('engine level 2 gives about +3.2% top speed (+10% power; balance pass)', () => {
  const t = getTeam('mclaren');
  const r = computeCarStats(t, lvl('engine', 2)).derived.topSpeed / computeCarStats(t).derived.topSpeed;
  near(r, 1.031, 0.004);
});

test('extraLevelOffset (AI) behaves like added levels and is clamped to 0..5', () => {
  const t = getTeam('haas');
  const viaOffset = computeCarStats(t, emptyLevels(), 2);
  const viaLevels = computeCarStats(t, { engine: 2, aero: 2, brakes: 2, tyres: 2, cooling: 2 });
  assert.deepEqual(viaOffset, viaLevels);
  assert.deepEqual(computeCarStats(t, emptyLevels(), 99), computeCarStats(t, { engine: 5, aero: 5, brakes: 5, tyres: 5, cooling: 5 }));
  assert.deepEqual(computeCarStats(t, emptyLevels(), -3), computeCarStats(t));
  assert.deepEqual(computeCarStats(t, undefined, 1), computeCarStats(t, { engine: 1, aero: 1, brakes: 1, tyres: 1, cooling: 1 }));
});

test('fully upgraded car: proxy gains in corner grip / top speed (the real lap-time gain is ~8%, tests/sim/upgrades.test.js)', () => {
  const t = getTeam('mclaren');
  const stock = computeCarStats(t);
  const maxed = computeCarStats(t, { engine: 5, aero: 5, brakes: 5, tyres: 5, cooling: 5 });
  assert.ok(maxed.derived.maxLatG60 / stock.derived.maxLatG60 > 1.1);
  assert.ok(maxed.derived.topSpeed >= stock.derived.topSpeed * 0.99);
});

test('statSummary: 0..100 bars, mid-field stock = 50, per-metric best car = 100, upgrades raise their bars', () => {
  const keys = ['topSpeed', 'accel', 'cornering', 'braking', 'tyreLife', 'cooling'];
  const mid = statSummary(computeCarStats(getTeam('williams')));
  for (const k of keys) assert.equal(mid[k], 50, k);
  const best = (cats) => {
    const l = emptyLevels();
    for (const c of cats) l[c] = 5;
    return statSummary(computeCarStats(getTeam('mclaren'), l));
  };
  assert.equal(best(['engine']).topSpeed, 100);
  assert.equal(best(['aero', 'tyres']).cornering, 100);
  assert.equal(best(['brakes']).braking, 100);
  assert.equal(best(['tyres']).tyreLife, 100);
  assert.equal(best(['cooling']).cooling, 100);
  const all = best(UPGRADE_CATEGORIES);
  for (const k of keys) assert.ok(all[k] >= 70, `${k} ${all[k]}`);
  for (const t of TEAMS) {
    const s = statSummary(computeCarStats(t));
    for (const k of keys) assert.ok(s[k] >= 0 && s[k] <= 100 && Number.isInteger(s[k]));
  }
  const last = statSummary(computeCarStats(getTeam('sauber')));
  assert.ok(last.topSpeed < 50 && last.cornering < 50);
  const up = (cat, key) => statSummary(computeCarStats(getTeam('williams'), lvl(cat, 3)))[key];
  assert.ok(up('engine', 'topSpeed') > 50);
  assert.ok(up('engine', 'accel') > 50);
  assert.ok(up('aero', 'cornering') > 50);
  assert.ok(up('aero', 'topSpeed') < 50); // downforce costs top speed
  assert.ok(up('brakes', 'braking') > 50);
  assert.ok(up('tyres', 'tyreLife') > 50);
  assert.ok(up('tyres', 'cornering') > 50);
  assert.ok(up('cooling', 'cooling') > 50);
});

test('computeDerived is pure on its input', () => {
  const d = computeDerived({ ...BASE_CAR, power: 500000 });
  assert.ok(d.topSpeed > BASE_CAR.derived.topSpeed);
  assert.equal(BASE_CAR.power, 400000);
});
