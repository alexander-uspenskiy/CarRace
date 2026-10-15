// Natural-race features: weather, AI driver character (experience, tyre compounds), random car trouble.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER, WEATHER_IDS, pickWeather, themeForWeather, weatherGrip, mixHex } from '../../src/data/weather.js';
import { createRaceConfig } from '../../src/data/raceConfig.js';
import { buildAiProfile, pickCompound } from '../../src/sim/ai/aiProfile.js';
import { planFault, stepFault, faultChance, neutralFaultFx } from '../../src/sim/carFaults.js';
import { createCarState } from '../../src/sim/carPhysics.js';
import { stepTyreWear } from '../../src/sim/tyres.js';
import { COMPOUNDS } from '../../src/data/driverTraits.js';
import { mulberry32 } from '../../src/core/mathUtil.js';
import { getDriver } from '../../src/data/teams.js';
import { getTrackDef } from '../../src/data/tracks/index.js';
import { mclarenStats, makeConfig, runRace } from './helpers.js';

test('weather: deterministic per seed, every id valid, all conditions reachable', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const w = pickWeather(seed, 'monte-veloce');
    assert.equal(w, pickWeather(seed, 'monte-veloce'));
    assert.ok(WEATHER[w]);
    seen.add(w);
  }
  assert.deepEqual([...seen].sort(), [...WEATHER_IDS].sort());
  // the sunny coast rains less than the mountain circuit
  const rainy = (track) => { let n = 0; for (let s = 1; s <= 600; s++) if (pickWeather(s, track) === 'drizzle') n++; return n; };
  assert.ok(rainy('costa-marina') < rainy('ridgeback'));
});

test('weather: dry is the baseline, rain costs grip, theme gets greyer and darker', () => {
  assert.equal(weatherGrip('clear'), 1);
  assert.equal(weatherGrip('nope'), 1);
  assert.ok(weatherGrip('drizzle') < 1 && weatherGrip('drizzle') > 0.85);
  const base = getTrackDef('monte-veloce').theme;
  const dry = themeForWeather(base, 'clear');
  const wet = themeForWeather(base, 'drizzle');
  assert.equal(dry.asphalt, base.asphalt);
  assert.notEqual(wet.asphalt, base.asphalt);
  assert.equal(wet.weather.rain > 0, true);
  assert.equal(dry.weather.rain, 0);
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('race config: weather option wins, otherwise seeded; a wet race is sized for the slower laps', () => {
  const a = createRaceConfig({ trackId: 'monte-veloce', seed: 3, weather: 'drizzle' });
  assert.equal(a.weather, 'drizzle');
  const b = createRaceConfig({ trackId: 'monte-veloce', seed: 3 });
  assert.equal(b.weather, pickWeather(3, 'monte-veloce'));
  assert.equal(createRaceConfig({ trackId: 'monte-veloce', seed: 3, weather: 'bogus' }).weather, b.weather);
  const dry = createRaceConfig({ trackId: 'ridgeback', minutes: 10, weather: 'clear' });
  const wet = createRaceConfig({ trackId: 'ridgeback', minutes: 10, weather: 'drizzle' });
  assert.ok(wet.laps <= dry.laps);
});

test('tyre grip follows weather and car trouble multipliers', () => {
  const stats = mclarenStats();
  const car = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats);
  stepTyreWear(car, stats, makeConfig({ weather: 'clear' }), 1 / 120);
  const dry = car.tyreGrip;
  stepTyreWear(car, stats, makeConfig({ weather: 'drizzle' }), 1 / 120);
  assert.ok(car.tyreGrip < dry * 0.95);
  car.gripMult = 0.9;
  const before = car.tyreGrip;
  stepTyreWear(car, stats, makeConfig({ weather: 'drizzle' }), 1 / 120);
  assert.ok(car.tyreGrip < before);
  // a puncture (wearMult) wears the tyre faster
  const a = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats), b = createCarState({ x: 0, y: 0, heading: 0, speed: 50 }, stats);
  a.ay = 20; b.ay = 20; b.wearMult = 3;
  for (let i = 0; i < 600; i++) { stepTyreWear(a, stats, makeConfig(), 1 / 120); stepTyreWear(b, stats, makeConfig(), 1 / 120); }
  assert.ok(b.tyreWear > a.tyreWear * 2);
});

test('AI profile: deterministic, rookies are wilder than veterans, compounds are valid', () => {
  const ant = getDriver('ant').driver, alo = getDriver('alo').driver;
  const cfg = makeConfig({ weather: 'drizzle' });
  const p1 = buildAiProfile({ driver: ant, config: cfg, rng: mulberry32(5) });
  assert.deepEqual(p1, buildAiProfile({ driver: ant, config: cfg, rng: mulberry32(5) }));
  const rookie = buildAiProfile({ driver: ant, config: cfg, rng: mulberry32(9) });
  const vet = buildAiProfile({ driver: alo, config: cfg, rng: mulberry32(9) });
  assert.ok(rookie.mistakeScale > vet.mistakeScale);
  assert.ok(rookie.wearMgmt > vet.wearMgmt);
  assert.ok(rookie.heatEase > vet.heatEase);
  assert.ok(COMPOUNDS[rookie.compound] && COMPOUNDS[vet.compound]);
  for (const p of [rookie, vet]) assert.ok(Math.abs(p.paceBias) < 0.005 && Math.abs(p.wetPace - 1) < 0.02);
  // nobody gambles on soft tyres on a wet track as much as in the dry
  const softShare = (weather) => { let n = 0; for (let i = 0; i < 400; i++) if (pickCompound(mulberry32(i), { experience: 0.9, minutes: 5, weather }) === 'soft') n++; return n; };
  assert.ok(softShare('drizzle') < softShare('clear'));
});

test('car trouble: plan is seeded and rare, effects apply and clear', () => {
  assert.ok(faultChance(1) < faultChance(0.65));
  let planned = 0;
  for (let i = 0; i < 300; i++) if (planFault(mulberry32(i), { strength: 0.8, expectedSeconds: 300 })) planned++;
  assert.ok(planned > 20 && planned < 120, `planned ${planned}/300`);
  const plan = { kind: 'cooling', at: 10, duration: 20, severity: 0.5, started: false, ended: false };
  const car = createCarState({ x: 0, y: 0, heading: 0, speed: 0 }, mclarenStats());
  assert.equal(stepFault(plan, car, 5), null);
  assert.equal(car.coolMult, 1);
  assert.equal(stepFault(plan, car, 10), 'start');
  assert.ok(car.coolMult < 0.7);
  assert.equal(stepFault(plan, car, 15), null);
  assert.equal(stepFault(plan, car, 31), 'end');
  assert.equal(car.coolMult, 1);
  assert.equal(stepFault(null, car, 5), null);
  neutralFaultFx(car);
  assert.equal(car.powerMult, 1);
});

test('race: AI cars get compounds and some trouble, race is deterministic, rain slows the field', () => {
  const over = { seed: 21, minutes: 5 };
  const dry = runRace({ ...over, weather: 'clear' });
  const dry2 = runRace({ ...over, weather: 'clear' });
  assert.deepEqual(dry.sim.getResult().rows.map((r) => r.carId), dry2.sim.getResult().rows.map((r) => r.carId));
  const comps = new Set(dry.sim.metas.filter((m) => !m.isPlayer).map((m) => m.compound));
  assert.ok(comps.size >= 2 && [...comps].every((c) => COMPOUNDS[c]), `compounds ${[...comps]}`);
  assert.equal(dry.sim.metas[dry.sim.playerId].compound, null);
  const wet = runRace({ ...over, weather: 'drizzle' });
  const winDry = dry.sim.getResult().rows[0].totalTime / dry.config.laps;
  const winWet = wet.sim.getResult().rows[0].totalTime / wet.config.laps;
  assert.ok(winWet > winDry * 1.01 && winWet < winDry * 1.12, `lap ${winDry.toFixed(1)} dry vs ${winWet.toFixed(1)} wet`);
  for (const r of [dry, wet]) {
    for (const row of r.sim.getResult().rows) assert.ok(row.finished, `car ${row.carId} finished`);
    assert.equal(r.events.filter((e) => e.name === 'car:wall' && e.payload.speed > 25).length, 0, 'no big crashes');
  }
});
