import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHallOfFame, HOF_KEY, defaultHof, normalizeHof } from '../../src/data/hallOfFame.js';
import { createMemoryStorage } from '../../src/core/storage.js';

let clock = Date.parse('2026-10-15T12:00:00Z');
const fixedNow = () => clock;

function result(o = {}) {
  const r = {
    trackId: 'monte-veloce', minutes: 5, laps: 5, difficulty: 'normal', seed: 1, date: null,
    playerCarId: 6, playerTeamId: 'williams', playerName: 'Alex', playerPosition: 3, playerGridPosition: 8,
    playerFinished: true, playerTotalTime: 300.5, playerBestLap: 59.1, fastestLap: null,
    rows: [],
    ...o,
  };
  if (!o.rows) r.rows = [{ position: r.playerPosition, carId: r.playerCarId, teamId: r.playerTeamId, isPlayer: true, finished: r.playerFinished, lapsDown: 0 }];
  return r;
}
const meta = (o = {}) => ({ playerName: 'Alex', creditsEarned: 700, difficulty: 'normal', ...o });
const mk = () => createHallOfFame(createMemoryStorage(), fixedNow);

test('empty defaults', () => {
  const h = mk();
  assert.deepEqual(h.getData(), { version: 1, bestLaps: {}, bestRaces: {}, stats: { races: 0, wins: 0, podiums: 0, finishes: 0 }, history: [] });
  assert.deepEqual(h.getBestLaps('monte-veloce'), []);
  assert.deepEqual(h.getBestRaces('monte-veloce', 5), []);
  assert.deepEqual(h.getHistory(), []);
  assert.equal(HOF_KEY, 'carrace.hof.v1');
});

test('first finished race creates lap + race entries (rank 1, personal best) and a history record', () => {
  const h = mk();
  const { entryId, newRecords } = h.recordRace(result(), meta());
  assert.ok(entryId);
  assert.deepEqual(newRecords, [
    { kind: 'bestLap', trackId: 'monte-veloce', minutes: 5, time: 59.1, rank: 1, isPersonalBest: true },
    { kind: 'bestRace', trackId: 'monte-veloce', minutes: 5, time: 300.5, rank: 1, isPersonalBest: true },
  ]);
  const lap = h.getBestLaps('monte-veloce')[0];
  assert.deepEqual(lap, {
    id: entryId, name: 'Alex', teamId: 'williams', trackId: 'monte-veloce', minutes: 5, difficulty: 'normal',
    time: 59.1, date: '2026-10-15T12:00:00.000Z',
  });
  assert.equal(h.getBestRaces('monte-veloce', 5)[0].time, 300.5);
  assert.deepEqual(h.getHistory(1)[0], {
    id: entryId, date: '2026-10-15T12:00:00.000Z', name: 'Alex', teamId: 'williams', trackId: 'monte-veloce', minutes: 5,
    difficulty: 'normal', laps: 5, position: 3, grid: 8, totalTime: 300.5, bestLap: 59.1, credits: 700, finished: true, lapsDown: 0,
  });
  assert.deepEqual(h.getStats(), { races: 1, wins: 0, podiums: 1, finishes: 1 });
});

test('date comes from the injected now(), not from result.date', () => {
  const st = createMemoryStorage();
  const h = createHallOfFame(st, () => Date.parse('2030-01-02T03:04:05Z'));
  h.recordRace(result({ date: '1999-01-01T00:00:00Z' }), meta());
  assert.equal(h.getHistory()[0].date, '2030-01-02T03:04:05.000Z');
  assert.equal(h.getBestLaps('monte-veloce')[0].date, '2030-01-02T03:04:05.000Z');
});

test('bestRaces only for finished AND not lapped; bestLaps whenever there is a lap', () => {
  const h = mk();
  const lapped = result({ playerPosition: 15, rows: [{ position: 15, carId: 6, isPlayer: true, finished: true, lapsDown: 1 }] });
  const r1 = h.recordRace(lapped, meta());
  assert.deepEqual(r1.newRecords.map((r) => r.kind), ['bestLap']);
  assert.deepEqual(h.getBestRaces('monte-veloce', 5), []);
  assert.equal(h.getHistory()[0].lapsDown, 1);
  assert.equal(h.getHistory()[0].finished, true);
  assert.equal(h.getHistory()[0].totalTime, 300.5);

  const dnf = result({ playerFinished: false, playerTotalTime: null, playerBestLap: null, playerPosition: 20, rows: [{ position: 20, carId: 6, isPlayer: true, finished: false, lapsDown: 3 }] });
  const r2 = h.recordRace(dnf, meta());
  assert.deepEqual(r2.newRecords, []);
  assert.equal(h.getHistory()[0].finished, false);
  assert.equal(h.getHistory()[0].totalTime, null);
  assert.equal(h.getHistory()[0].bestLap, null);
  assert.deepEqual(h.getStats(), { races: 2, wins: 0, podiums: 0, finishes: 1 });
});

test('stats: wins and podiums', () => {
  const h = mk();
  h.recordRace(result({ playerPosition: 1 }), meta());
  h.recordRace(result({ playerPosition: 3 }), meta());
  h.recordRace(result({ playerPosition: 4 }), meta());
  assert.deepEqual(h.getStats(), { races: 3, wins: 1, podiums: 2, finishes: 3 });
});

test('top-10 sorting ascending, trimming, rank reporting, ties rank after existing', () => {
  const h = mk();
  const times = [70, 65, 80, 62, 90, 61, 75, 68, 85, 72];
  for (const t of times) h.recordRace(result({ playerBestLap: t, playerTotalTime: t * 5 }), meta());
  assert.deepEqual(h.getBestLaps('monte-veloce').map((e) => e.time), [...times].sort((a, b) => a - b));
  // slower than all 10: no record
  let r = h.recordRace(result({ playerBestLap: 95 }), meta());
  assert.ok(!r.newRecords.some((x) => x.kind === 'bestLap'));
  assert.equal(h.getBestLaps('monte-veloce').length, 10);
  // between: replaces the worst
  r = h.recordRace(result({ playerBestLap: 66 }), meta());
  const lap = r.newRecords.find((x) => x.kind === 'bestLap');
  assert.equal(lap.rank, 4);
  assert.equal(h.getBestLaps('monte-veloce').length, 10);
  assert.ok(!h.getBestLaps('monte-veloce').some((e) => e.time === 90));
  // tie: ranks after the existing equal time
  r = h.recordRace(result({ playerBestLap: 61 }), meta());
  assert.equal(r.newRecords.find((x) => x.kind === 'bestLap').rank, 2);
  // new best
  r = h.recordRace(result({ playerBestLap: 50 }), meta());
  assert.equal(r.newRecords.find((x) => x.kind === 'bestLap').rank, 1);
  assert.equal(h.getBestLaps('monte-veloce')[0].time, 50);
});

test('isPersonalBest compares with earlier entries by the same name', () => {
  const h = mk();
  h.recordRace(result({ playerBestLap: 60 }), meta({ playerName: 'Ann' }));
  const slower = h.recordRace(result({ playerBestLap: 61 }), meta({ playerName: 'Ann' }));
  assert.equal(slower.newRecords.find((x) => x.kind === 'bestLap').isPersonalBest, false);
  const other = h.recordRace(result({ playerBestLap: 62 }), meta({ playerName: 'Bob' }));
  assert.equal(other.newRecords.find((x) => x.kind === 'bestLap').isPersonalBest, true);
  const faster = h.recordRace(result({ playerBestLap: 59 }), meta({ playerName: 'ann' }));
  assert.equal(faster.newRecords.find((x) => x.kind === 'bestLap').isPersonalBest, true);
});

test('separate boards per track and per race length', () => {
  const h = mk();
  h.recordRace(result({ trackId: 'ridgeback', minutes: 5 }), meta());
  h.recordRace(result({ trackId: 'ridgeback', minutes: 7, playerTotalTime: 420 }), meta());
  h.recordRace(result({ trackId: 'costa-marina', minutes: 10, playerTotalTime: 600 }), meta());
  assert.equal(h.getBestRaces('ridgeback', 5).length, 1);
  assert.equal(h.getBestRaces('ridgeback', 7).length, 1);
  assert.equal(h.getBestRaces('ridgeback', 10).length, 0);
  assert.equal(h.getBestRaces('costa-marina', 10)[0].time, 600);
  assert.equal(h.getBestLaps('ridgeback').length, 2); // laps are per track, regardless of length
  assert.equal(h.getBestLaps('monte-veloce').length, 0);
});

test('difficulty is a column, not a key', () => {
  const h = mk();
  h.recordRace(result({ difficulty: 'easy' }), meta({ difficulty: 'easy' }));
  h.recordRace(result({ difficulty: 'hard', playerBestLap: 58 }), meta({ difficulty: 'hard' }));
  const laps = h.getBestLaps('monte-veloce');
  assert.equal(laps.length, 2);
  assert.deepEqual(laps.map((l) => l.difficulty), ['hard', 'easy']);
});

test('renamePlayer updates history and every board entry with that id', () => {
  const h = mk();
  const { entryId } = h.recordRace(result(), meta());
  const other = h.recordRace(result({ playerBestLap: 70, playerTotalTime: 350 }), meta());
  assert.equal(h.renamePlayer(entryId, '  Maxi  '), true);
  assert.equal(h.getBestLaps('monte-veloce')[0].name, 'Maxi');
  assert.equal(h.getBestRaces('monte-veloce', 5)[0].name, 'Maxi');
  assert.equal(h.getHistory().find((r) => r.id === entryId).name, 'Maxi');
  assert.equal(h.getHistory().find((r) => r.id === other.entryId).name, 'Alex');
  assert.equal(h.renamePlayer('missing', 'X'), false);
  assert.equal(h.renamePlayer(entryId, ''), true);
  assert.equal(h.getBestLaps('monte-veloce')[0].name, 'PLAYER');
});

test('history is newest first, capped at 100, getHistory(limit)', () => {
  const h = mk();
  for (let i = 0; i < 105; i++) {
    clock += 1000;
    h.recordRace(result({ playerPosition: 10, playerBestLap: 100 + i, laps: i }), meta());
  }
  const hist = h.getHistory();
  assert.equal(hist.length, 100);
  assert.equal(hist[0].laps, 104);
  assert.equal(hist[99].laps, 5);
  assert.equal(h.getHistory(3).length, 3);
  assert.equal(h.getHistory(3)[0].laps, 104);
  assert.equal(h.getStats().races, 105);
  assert.equal(new Set(hist.map((r) => r.id)).size, 100); // unique ids even with identical clocks within a ms? (clock advances here)
});

test('ids stay unique when the clock does not advance, also across reloads', () => {
  const st = createMemoryStorage();
  const a = createHallOfFame(st, () => 1000);
  const ids = new Set();
  for (let i = 0; i < 5; i++) ids.add(a.recordRace(result({ playerBestLap: 60 + i }), meta()).entryId);
  const b = createHallOfFame(st, () => 1000);
  for (let i = 0; i < 5; i++) ids.add(b.recordRace(result({ playerBestLap: 70 + i }), meta()).entryId);
  assert.equal(ids.size, 10);
});

test('persists across instances; clear() wipes and persists', () => {
  const st = createMemoryStorage();
  const a = createHallOfFame(st, fixedNow);
  a.recordRace(result(), meta());
  const b = createHallOfFame(st, fixedNow);
  assert.equal(b.getBestLaps('monte-veloce').length, 1);
  assert.equal(b.getStats().races, 1);
  b.clear();
  assert.deepEqual(b.getData(), defaultHof());
  assert.deepEqual(createHallOfFame(st, fixedNow).getData(), defaultHof());
});

test('corrupt / wrong-shaped JSON recovers to defaults, never throws', () => {
  for (const bad of ['{{{', '', 'null', '[]', '7', '{"bestLaps":5,"history":"x","stats":null}']) {
    const st = createMemoryStorage({ [HOF_KEY]: bad });
    let h;
    assert.doesNotThrow(() => (h = createHallOfFame(st, fixedNow)));
    assert.deepEqual(h.getBestLaps('monte-veloce'), []);
    assert.equal(h.getStats().races, 0);
    assert.doesNotThrow(() => h.recordRace(result(), meta()));
    assert.equal(h.getStats().races, 1);
  }
  const st = createMemoryStorage({ [HOF_KEY]: '{{{' });
  createHallOfFame(st, fixedNow);
  assert.equal(st.getItem(HOF_KEY + '.corrupt'), '{{{');
});

test('normalizeHof repairs garbage entries, re-sorts and trims', () => {
  const entries = [{ id: 'a', time: 70 }, { id: 'b', time: 'x' }, null, { id: 'c', time: 60, name: ' Zed ' }, { id: 'd', time: -1 }];
  for (let i = 0; i < 15; i++) entries.push({ id: 'e' + i, time: 100 + i });
  const d = normalizeHof({ version: 7, bestLaps: { t: entries }, bestRaces: { t: { 5: entries, 7: 'bad' }, u: 3 }, stats: { races: 2.7, wins: -4, podiums: 'q' }, history: [{ id: 'h1' }, { nope: 1 }, 5] });
  assert.equal(d.version, 1);
  assert.equal(d.bestLaps.t.length, 10);
  assert.deepEqual(d.bestLaps.t.slice(0, 2).map((e) => e.id), ['c', 'a']);
  assert.equal(d.bestLaps.t[0].name, 'Zed');
  assert.equal(d.bestLaps.t[1].name, 'PLAYER');
  assert.equal(d.bestRaces.t[5].length, 10);
  assert.deepEqual(d.bestRaces.t[7], []);
  assert.deepEqual(d.stats, { races: 2, wins: 0, podiums: 0, finishes: 0 });
  assert.deepEqual(d.history.map((h) => h.id), ['h1']);
});

test('throwing storage does not break recording', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); }, removeItem() {} };
  const h = createHallOfFame(bad, fixedNow);
  assert.doesNotThrow(() => h.recordRace(result(), meta()));
  assert.equal(h.getStats().races, 1);
});

test('getters return copies of the lists (callers cannot reorder internals)', () => {
  const h = mk();
  h.recordRace(result(), meta());
  h.getBestLaps('monte-veloce').length = 0;
  h.getHistory().length = 0;
  h.getBestRaces('monte-veloce', 5).length = 0;
  assert.equal(h.getBestLaps('monte-veloce').length, 1);
  assert.equal(h.getHistory().length, 1);
  assert.equal(h.getBestRaces('monte-veloce', 5).length, 1);
});

import { migrateHof, HOF_VERSION } from '../../src/data/hallOfFame.js';

test('numeric strings in stored entries are coerced (time "61.5"), garbage still dropped', () => {
  const h = normalizeHof({
    version: 1,
    bestLaps: { 'monte-veloce': [
      { id: 'a', name: 'Fast', time: '61.5' }, { id: 'b', name: 'Slow', time: 70 }, { id: 'c', name: 'Bad', time: 'fast' }, { id: 'd', name: 'Zero', time: '0' },
    ] },
    stats: { races: '12', wins: '3.9', podiums: 'x', finishes: 4 },
  });
  assert.deepEqual(h.bestLaps['monte-veloce'].map((e) => [e.id, e.time]), [['a', 61.5], ['b', 70]]);
  assert.deepEqual(h.stats, { races: 12, wins: 3, podiums: 0, finishes: 4 });
});

test('HoF migrate chain: v0 / missing version -> current; old data is written back as v1', () => {
  assert.equal(HOF_VERSION, 1);
  const old = { records: { 'ridgeback': [{ id: 'z', name: 'Old', time: 65 }] }, races: [{ id: 'h1', name: 'Old' }] };
  const m = migrateHof(old);
  assert.deepEqual([m.from, m.to, m.migrated], [0, 1, true]);
  assert.ok(m.data.bestLaps && m.data.history && !('records' in m.data));
  const n = normalizeHof(old);
  assert.equal(n.version, 1);
  assert.equal(n.bestLaps.ridgeback[0].time, 65);
  assert.equal(n.history[0].id, 'h1');
  const st = createMemoryStorage({ [HOF_KEY]: JSON.stringify(old) });
  const hof = createHallOfFame(st);
  assert.equal(hof.getBestLaps('ridgeback').length, 1);
  assert.equal(JSON.parse(st.getItem(HOF_KEY)).version, 1);
  // a current-version object is not reinterpreted
  assert.equal(migrateHof({ version: 1, records: 5 }).migrated, false);
});

test('HoF names are emoji-safe when truncated', () => {
  const h = normalizeHof({ version: 1, bestLaps: { t: [{ id: 'e', name: '\u{1F600}'.repeat(30), time: 50 }] } });
  assert.equal(h.bestLaps.t[0].name, '\u{1F600}'.repeat(16));
});
