import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore, SAVE_KEY, defaultSave, normalizeSave } from '../../src/data/saveStore.js';
import { createMemoryStorage } from '../../src/core/storage.js';
import { createEventBus } from '../../src/core/eventBus.js';
import { UPGRADE_COSTS, emptyLevels } from '../../src/data/upgrades.js';

test('defaults when storage is empty', () => {
  const s = createSaveStore(createMemoryStorage());
  assert.deepEqual(s.get(), {
    version: 1, playerName: 'PLAYER', credits: 1000, upgrades: {},
    last: { teamId: 'mclaren', driverIndex: 0, trackId: 'monte-veloce', minutes: 5, difficulty: 'normal' },
    settings: { volume: 0.7, quality: 'high', units: 'kph', steerAssist: 0.5, defaultCamera: 'chase' },
    stats: { races: 0, creditsEarned: 0 },
  });
  assert.equal(SAVE_KEY, 'carrace.save.v1');
});

test('persists and reloads', () => {
  const st = createMemoryStorage();
  const a = createSaveStore(st);
  a.setPlayerName('Alex');
  a.addCredits(500);
  a.buyUpgrade('ferrari', 'engine');
  const b = createSaveStore(st);
  assert.equal(b.get().playerName, 'Alex');
  assert.equal(b.get().credits, 1000 + 500 - 400);
  assert.equal(b.getUpgrades('ferrari').engine, 1);
  assert.deepEqual(b.getUpgrades('mclaren'), emptyLevels());
});

test('corrupt JSON -> defaults, never throws, backup kept', () => {
  for (const bad of ['{not json', '', 'null', '[]', '42', '"str"', '{"version":1,"credits":"lots"}']) {
    const st = createMemoryStorage({ [SAVE_KEY]: bad });
    let s;
    assert.doesNotThrow(() => (s = createSaveStore(st)));
    assert.equal(s.get().version, 1);
    assert.equal(s.get().credits, 1000);
    assert.equal(s.get().playerName, 'PLAYER');
    assert.doesNotThrow(() => s.addCredits(1));
  }
  const st = createMemoryStorage({ [SAVE_KEY]: '{oops' });
  createSaveStore(st);
  assert.equal(st.getItem(SAVE_KEY + '.corrupt'), '{oops');
});

test('partially invalid data is repaired field by field', () => {
  const raw = {
    version: 1, playerName: '   ', credits: -50.7,
    upgrades: { mclaren: { engine: 9, aero: -2, brakes: 'x', tyres: 2.9 }, bogus: { engine: 3 } },
    last: { teamId: 'nope', driverIndex: 7, trackId: 'ridgeback', minutes: 8, difficulty: 'hard' },
    settings: { volume: 5, quality: 'ultra', units: 'mph', steerAssist: -1, defaultCamera: 'cockpit' },
    stats: { races: 3.9, creditsEarned: 'a' },
  };
  const s = normalizeSave(raw);
  assert.equal(s.playerName, 'PLAYER');
  assert.equal(s.credits, 0);
  assert.deepEqual(s.upgrades, { mclaren: { engine: 5, aero: 0, brakes: 0, tyres: 2, cooling: 0 } });
  assert.deepEqual(s.last, { teamId: 'mclaren', driverIndex: 0, trackId: 'ridgeback', minutes: 5, difficulty: 'hard' });
  assert.deepEqual(s.settings, { volume: 1, quality: 'high', units: 'mph', steerAssist: 0, defaultCamera: 'cockpit' });
  assert.deepEqual(s.stats, { races: 3, creditsEarned: 0 });
});

test('unknown / future version data still loads sanitised and is written back as v1', () => {
  const st = createMemoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 99, credits: 1234, playerName: 'Zed', extra: 1 }) });
  const s = createSaveStore(st);
  assert.equal(s.get().credits, 1234);
  assert.equal(s.get().playerName, 'Zed');
  assert.equal(s.get().version, 1);
  assert.ok(!('extra' in s.get()));
});

test('buyUpgrade: success, funds, maxed, unknown', () => {
  const s = createSaveStore(createMemoryStorage());
  assert.equal(s.canAfford('mclaren', 'engine'), true);
  assert.deepEqual(s.buyUpgrade('mclaren', 'engine'), { ok: true, level: 1, cost: 400, credits: 600 });
  assert.equal(s.get().credits, 600);
  assert.equal(s.canAfford('mclaren', 'engine'), false); // 700 needed
  const poor = s.buyUpgrade('mclaren', 'engine');
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'funds');
  assert.equal(poor.cost, 700);
  assert.equal(s.get().credits, 600);
  assert.equal(s.getUpgrades('mclaren').engine, 1);
  assert.deepEqual(s.buyUpgrade('mclaren', 'warp'), { ok: false, reason: 'unknown' });
  assert.deepEqual(s.buyUpgrade('nobody', 'engine'), { ok: false, reason: 'unknown' });
  assert.equal(s.canAfford('nobody', 'engine'), false);

  s.addCredits(100000);
  const before = s.get().credits;
  let spent = 400;
  for (let L = 1; L < 5; L++) {
    const r = s.buyUpgrade('mclaren', 'engine');
    assert.equal(r.ok, true);
    assert.equal(r.level, L + 1);
    assert.equal(r.cost, UPGRADE_COSTS[L]);
    spent += r.cost;
  }
  assert.equal(spent, 6500);
  assert.equal(s.get().credits, before - 6100);
  const maxed = s.buyUpgrade('mclaren', 'engine');
  assert.equal(maxed.ok, false);
  assert.equal(maxed.reason, 'maxed');
  assert.equal(s.canAfford('mclaren', 'engine'), false);
  assert.equal(s.getUpgrades('mclaren').engine, 5);
});

test('upgrade levels are stored per team', () => {
  const s = createSaveStore(createMemoryStorage());
  s.buyUpgrade('mclaren', 'aero');
  s.buyUpgrade('haas', 'brakes');
  assert.equal(s.getUpgrades('mclaren').aero, 1);
  assert.equal(s.getUpgrades('mclaren').brakes, 0);
  assert.equal(s.getUpgrades('haas').brakes, 1);
  assert.equal(s.getUpgrades('haas').aero, 0);
  // getUpgrades returns a copy
  s.getUpgrades('haas').brakes = 5;
  assert.equal(s.getUpgrades('haas').brakes, 1);
});

test('refundUpgrades returns 70% of spent and resets that team only', () => {
  const s = createSaveStore(createMemoryStorage());
  s.addCredits(10000);
  s.buyUpgrade('mclaren', 'engine'); // 400
  s.buyUpgrade('mclaren', 'engine'); // 700
  s.buyUpgrade('mclaren', 'tyres'); // 400
  s.buyUpgrade('ferrari', 'tyres'); // 400
  const credits = s.get().credits;
  const r = s.refundUpgrades('mclaren');
  assert.equal(r.ok, true);
  assert.equal(r.refunded, Math.floor(1500 * 0.7));
  assert.equal(s.get().credits, credits + 1050);
  assert.deepEqual(s.getUpgrades('mclaren'), emptyLevels());
  assert.equal(s.getUpgrades('ferrari').tyres, 1);
  assert.equal(s.refundUpgrades('mclaren').ok, false); // nothing left to refund
  assert.equal(s.refundUpgrades('mclaren').refunded, 0);
  assert.equal(s.refundUpgrades('zzz').ok, false);
  // full refund of a maxed category: 70% of 6500
  const t = createSaveStore(createMemoryStorage());
  t.addCredits(10000);
  for (let i = 0; i < 5; i++) t.buyUpgrade('sauber', 'cooling');
  assert.equal(t.refundUpgrades('sauber').refunded, 4550);
});

test('update() persists and emits save:changed on the bus', () => {
  const st = createMemoryStorage();
  const bus = createEventBus();
  const events = [];
  bus.on('save:changed', (p) => events.push(p));
  const s = createSaveStore(st, bus);
  s.update((d) => {
    d.stats.races++;
    d.stats.creditsEarned += 300;
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].save, s.get());
  assert.equal(JSON.parse(st.getItem(SAVE_KEY)).stats.races, 1);
  s.addCredits(5);
  s.buyUpgrade('mclaren', 'engine');
  s.setPlayerName('Q');
  s.setSettings({ volume: 0.2 });
  s.setLast({ minutes: 7 });
  assert.equal(events.length, 6);
  s.buyUpgrade('mclaren', 'warp'); // failed purchase: nothing changed, no event
  assert.equal(events.length, 6);
});

test('addCredits ignores junk, never goes negative', () => {
  const s = createSaveStore(createMemoryStorage());
  s.addCredits(NaN);
  s.addCredits('5');
  assert.equal(s.get().credits, 1000);
  s.addCredits(-5000);
  assert.equal(s.get().credits, 0);
  s.addCredits(250.4);
  assert.equal(s.get().credits, 250);
});

test('setPlayerName trims, caps at 16, falls back to PLAYER', () => {
  const s = createSaveStore(createMemoryStorage());
  assert.equal(s.setPlayerName('  Bob  '), 'Bob');
  assert.equal(s.setPlayerName('A'.repeat(40)), 'A'.repeat(16));
  assert.equal(s.setPlayerName('   '), 'PLAYER');
  assert.equal(s.setPlayerName(undefined), 'PLAYER');
  assert.equal(s.setPlayerName('a\u0000b\nc'), 'abc');
  assert.equal(s.get().playerName, 'abc');
});

test('setLast / setSettings merge partial values and validate', () => {
  const s = createSaveStore(createMemoryStorage());
  s.setLast({ teamId: 'alpine', driverIndex: 1 });
  assert.deepEqual(s.get().last, { teamId: 'alpine', driverIndex: 1, trackId: 'monte-veloce', minutes: 5, difficulty: 'normal' });
  s.setLast({ trackId: 'costa-marina', minutes: 10, difficulty: 'easy' });
  assert.equal(s.get().last.teamId, 'alpine');
  assert.equal(s.get().last.trackId, 'costa-marina');
  assert.equal(s.get().last.minutes, 10);
  s.setLast({ teamId: 'ghost', minutes: 3, trackId: 'nowhere', difficulty: 'insane', driverIndex: 3 });
  assert.deepEqual(s.get().last, { teamId: 'alpine', driverIndex: 1, trackId: 'costa-marina', minutes: 10, difficulty: 'easy' });
  s.setSettings({ volume: 0.3, units: 'mph' });
  assert.deepEqual(s.get().settings, { volume: 0.3, quality: 'high', units: 'mph', steerAssist: 0.5, defaultCamera: 'chase' });
  s.setSettings({ volume: 9, steerAssist: -3, quality: 'low', defaultCamera: 'cockpit' });
  assert.deepEqual(s.get().settings, { volume: 1, quality: 'low', units: 'mph', steerAssist: 0, defaultCamera: 'cockpit' });
});

test('reset restores defaults and persists them', () => {
  const st = createMemoryStorage();
  const s = createSaveStore(st);
  s.addCredits(999);
  s.buyUpgrade('mclaren', 'engine');
  s.reset();
  assert.deepEqual(s.get(), defaultSave());
  assert.deepEqual(JSON.parse(st.getItem(SAVE_KEY)), defaultSave());
});

test('a throwing storage adapter never breaks the store', () => {
  const bad = {
    getItem() {
      throw new Error('no read');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {},
  };
  const s = createSaveStore(bad);
  assert.equal(s.get().credits, 1000);
  assert.doesNotThrow(() => s.addCredits(10));
  assert.equal(s.get().credits, 1010);
  assert.equal(s.buyUpgrade('mclaren', 'engine').ok, true);
});

test('defaultSave returns independent objects', () => {
  const a = defaultSave();
  a.settings.volume = 0;
  assert.equal(defaultSave().settings.volume, 0.7);
});

import { migrateSave, MIGRATIONS, SAVE_VERSION, MAX_CREDITS } from '../../src/data/saveStore.js';

test('numeric strings are coerced (credits "4321" -> 4321), garbage strings fall back, values are clamped', () => {
  const s = normalizeSave({
    version: 1, credits: '4321', playerName: 'Zed',
    upgrades: { mclaren: { engine: '3', aero: ' 2 ', brakes: '9', tyres: '-1', cooling: 'x' } },
    last: { driverIndex: '1', minutes: '10', difficulty: 'hard' },
    settings: { volume: '0.25', steerAssist: '7' },
    stats: { races: '12', creditsEarned: '9999.9' },
  });
  assert.equal(s.credits, 4321);
  assert.deepEqual(s.upgrades.mclaren, { engine: 3, aero: 2, brakes: 5, tyres: 0, cooling: 0 });
  assert.equal(s.last.driverIndex, 1);
  assert.equal(s.last.minutes, 10);
  assert.equal(s.settings.volume, 0.25);
  assert.equal(s.settings.steerAssist, 1);
  assert.deepEqual(s.stats, { races: 12, creditsEarned: 9999 });
  assert.equal(normalizeSave({ version: 1, credits: 'lots' }).credits, 1000);
  assert.equal(normalizeSave({ version: 1, credits: '' }).credits, 1000);
  assert.equal(normalizeSave({ version: 1, credits: 1e300 }).credits, MAX_CREDITS);
  assert.equal(normalizeSave({ version: 1, credits: '-5' }).credits, 0);
  // and through the store round trip
  const st = createMemoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 1, credits: '4321' }) });
  assert.equal(createSaveStore(st).get().credits, 4321);
});

test('migrate chain: v0 / missing version -> current, field renames and per-team upgrades', () => {
  assert.equal(SAVE_VERSION, 1);
  assert.equal(typeof MIGRATIONS[0], 'function');
  const old = { name: 'Old Timer', money: '2500', upgrades: { engine: 2, tyres: 1 }, last: { teamId: 'ferrari' }, racesRun: 7, settings: { sound: false } };
  const m = migrateSave(old);
  assert.deepEqual([m.from, m.to, m.migrated], [0, 1, true]);
  assert.equal(m.save.version, 1);
  assert.equal(m.save.playerName, 'Old Timer');
  assert.equal(m.save.credits, '2500');                                   // migrate renames; normalize coerces
  assert.deepEqual(m.save.upgrades, { ferrari: { engine: 2, tyres: 1 } });
  assert.ok(!('name' in m.save) && !('money' in m.save) && !('racesRun' in m.save));
  assert.deepEqual(old.upgrades, { engine: 2, tyres: 1 }, 'input not mutated');
  const s = normalizeSave(old);
  assert.equal(s.version, 1);
  assert.equal(s.playerName, 'Old Timer');
  assert.equal(s.credits, 2500);
  assert.deepEqual(s.upgrades.ferrari, { engine: 2, aero: 0, brakes: 0, tyres: 1, cooling: 0 });
  assert.equal(s.stats.races, 7);
  assert.equal(s.settings.volume, 0);
  // no `last` -> flat upgrades go to mclaren; coins alias
  assert.deepEqual(normalizeSave({ coins: 99, upgrades: { aero: 4 } }).upgrades.mclaren.aero, 4);
  assert.equal(normalizeSave({ coins: 99 }).credits, 99);
  // current-version objects are untouched by the chain
  const cur = { version: 1, playerName: 'Now', credits: 5 };
  assert.deepEqual([migrateSave(cur).migrated, migrateSave(cur).save], [false, cur]);
  // a v1 save that happens to carry a `name` field is NOT reinterpreted
  assert.equal(normalizeSave({ version: 1, name: 'Nope', playerName: 'Real', credits: 5 }).playerName, 'Real');
});

test('loading an old-version save writes the upgraded v1 copy back to storage', () => {
  const st = createMemoryStorage({ [SAVE_KEY]: JSON.stringify({ name: 'Legacy', money: 700 }) });
  const s = createSaveStore(st);
  assert.equal(s.get().playerName, 'Legacy');
  const stored = JSON.parse(st.getItem(SAVE_KEY));
  assert.equal(stored.version, 1);
  assert.equal(stored.playerName, 'Legacy');
  assert.equal(stored.credits, 700);
  assert.ok(!('money' in stored));
});

test('player names are truncated on code-point boundaries (emoji safe) everywhere they enter the save', () => {
  const s = createSaveStore(createMemoryStorage());
  const name = s.setPlayerName('R\u{1F3CE}'.repeat(12));            // 24 code points
  assert.equal(Array.from(name).length, 16);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name));
  const st = createMemoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 1, playerName: '\u{1F600}'.repeat(40) }) });
  assert.equal(createSaveStore(st).get().playerName, '\u{1F600}'.repeat(16));
});
