import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRaceConfig, aiLevelsFor } from '../../src/data/raceConfig.js';
import { computeLaps, estimateRaceSeconds } from '../../src/core/lapMath.js';
import { getTrackDef, TRACKS } from '../../src/data/tracks/index.js';
import { emptyLevels } from '../../src/data/upgrades.js';

test('defaults and derived fields', () => {
  const c = createRaceConfig({ trackId: 'monte-veloce', minutes: 7, difficulty: 'hard', teamId: 'ferrari', driverIndex: 1, playerName: 'Al', seed: 99, upgrades: { engine: 2 } });
  const ref = getTrackDef('monte-veloce').referenceLapTime;
  assert.equal(c.trackId, 'monte-veloce');
  assert.equal(c.minutes, 7);
  assert.equal(c.difficulty, 'hard');
  assert.equal(c.teamId, 'ferrari');
  assert.equal(c.driverIndex, 1);
  assert.equal(c.playerName, 'Al');
  assert.equal(c.seed, 99);
  assert.deepEqual(c.upgrades, { engine: 2, aero: 0, brakes: 0, tyres: 0, cooling: 0 });
  assert.equal(c.steerAssist, 0.5);
  assert.equal(c.laps, computeLaps(7, ref));
  assert.equal(c.raceSeconds, 420);
  assert.ok(Math.abs(c.tyreWearBase - 0.62 / (0.55 * c.expectedSeconds)) < 1e-12);
});

test('minimal options get spec defaults', () => {
  const c = createRaceConfig({ trackId: 'ridgeback' });
  assert.equal(c.minutes, 5);
  assert.equal(c.difficulty, 'normal');
  assert.equal(c.teamId, 'mclaren');
  assert.equal(c.driverIndex, 0);
  assert.equal(c.playerName, 'PLAYER');
  assert.equal(c.seed, 12345);
  assert.deepEqual(c.upgrades, emptyLevels());
});

test('explicit trackDef argument overrides lookup; upgrades are copied', () => {
  const def = { ...getTrackDef('ridgeback'), referenceLapTime: 50 };
  const up = { engine: 1 };
  const c = createRaceConfig({ trackId: 'ridgeback', minutes: 10, upgrades: up, steerAssist: 0.9 }, def);
  assert.equal(c.laps, computeLaps(10, 50));
  assert.equal(c.steerAssist, 0.9);
  c.upgrades.engine = 5;
  assert.equal(up.engine, 1);
});

test('tyreWearBase: flat-out stint ends at ~0.62 wear for any race length', () => {
  for (const m of [5, 7, 10]) {
    const c = createRaceConfig({ trackId: 'costa-marina', minutes: m });
    assert.ok(Math.abs(c.tyreWearBase * 0.55 * c.expectedSeconds - 0.62) < 1e-12);
  }
});

test('laps strictly increase with length on every track', () => {
  for (const t of TRACKS) {
    const l = [5, 7, 10].map((m) => createRaceConfig({ trackId: t.id, minutes: m }).laps);
    assert.ok(l[0] < l[1] && l[1] < l[2]);
  }
});

test('unknown track throws; aiLevelsFor', () => {
  assert.throws(() => createRaceConfig({ trackId: 'nowhere' }));
  assert.deepEqual(aiLevelsFor('easy'), emptyLevels());
  assert.deepEqual(aiLevelsFor('normal'), emptyLevels());
  assert.deepEqual(aiLevelsFor('hard'), { engine: 1, aero: 1, brakes: 1, tyres: 1, cooling: 1 });
  assert.deepEqual(aiLevelsFor('???'), emptyLevels());
});

test('laps follow the track x difficulty winner pace; expectedSeconds is the formula winner time', () => {
  for (const t of TRACKS) for (const d of ['easy', 'normal', 'hard']) for (const m of [5, 7, 10]) {
    const c = createRaceConfig({ trackId: t.id, minutes: m, difficulty: d });
    assert.equal(c.laps, computeLaps(m, t.referenceLapTime, d));
    assert.ok(Math.abs(c.expectedSeconds - estimateRaceSeconds(c.laps, t.referenceLapTime, d)) < 1e-9);
    assert.ok(c.expectedSeconds > 0.9 * m * 60 && c.expectedSeconds < 1.13 * m * 60, `${t.id} ${d} ${m}: ${c.expectedSeconds}`);
  }
  // a harder (faster) field needs at least as many laps
  const laps = (d) => createRaceConfig({ trackId: 'monte-veloce', minutes: 10, difficulty: d }).laps;
  assert.ok(laps('hard') >= laps('normal') && laps('normal') >= laps('easy'));
});
