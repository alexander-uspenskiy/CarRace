// Hall of Fame: per-track best laps, per-track/length best races, stats, history. Injectable storage + clock.
import { getDefaultStorage, runMigrations } from '../core/storage.js';
import { sanitizeName, coerceNum } from '../core/text.js';

export const HOF_KEY = 'carrace.hof.v1';
export const HOF_VERSION = 1;
const TOP_N = 10;
const HISTORY_MAX = 100;

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = coerceNum;   // finite numbers and numeric strings

export function defaultHof() {
  return { version: HOF_VERSION, bestLaps: {}, bestRaces: {}, stats: { races: 0, wins: 0, podiums: 0, finishes: 0 }, history: [] };
}

function sanitizeEntries(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e) => (isObj(e) ? { ...e, time: num(e.time, NaN) } : e))
    .filter((e) => isObj(e) && isNum(e.time) && e.time > 0)
    .map((e) => ({ ...e, id: String(e.id ?? ''), name: sanitizeName(e.name) }))
    .sort((a, b) => a.time - b.time)
    .slice(0, TOP_N);
}

// MIGRATIONS[v] upgrades a version-v hall-of-fame object to v+1 (core/storage.js runMigrations).
export const MIGRATIONS = {
  // v0 = unversioned prototype: `records` (best laps per track) and `races` (history list); v1 renamed them.
  0(old) {
    const out = { ...old };
    if (out.bestLaps === undefined && isObj(out.records)) out.bestLaps = out.records;
    if (out.history === undefined && Array.isArray(out.races)) out.history = out.races;
    delete out.records; delete out.races;
    return out;
  },
};

/** Brings any stored hall-of-fame object up to HOF_VERSION: `migrateHof(raw) -> { data, from, to, migrated }`. */
export function migrateHof(raw) {
  return runMigrations(raw, MIGRATIONS, HOF_VERSION);
}

export function normalizeHof(input) {
  const d = defaultHof();
  if (!isObj(input)) return d;
  const raw = migrateHof(input).data;
  if (isObj(raw.bestLaps)) for (const [k, v] of Object.entries(raw.bestLaps)) d.bestLaps[k] = sanitizeEntries(v);
  if (isObj(raw.bestRaces)) {
    for (const [k, byMin] of Object.entries(raw.bestRaces)) {
      if (!isObj(byMin)) continue;
      d.bestRaces[k] = {};
      for (const [m, v] of Object.entries(byMin)) d.bestRaces[k][m] = sanitizeEntries(v);
    }
  }
  if (isObj(raw.stats)) {
    for (const k of Object.keys(d.stats)) d.stats[k] = Math.max(0, Math.floor(num(raw.stats[k], 0)));
  }
  if (Array.isArray(raw.history)) {
    d.history = raw.history.filter((r) => isObj(r) && typeof r.id === 'string').slice(0, HISTORY_MAX).map((r) => ({ ...r, name: sanitizeName(r.name) }));
  }
  return d;
}

export function createHallOfFame(storage = getDefaultStorage(), now = () => Date.now()) {
  function load() {
    let text = null;
    try {
      text = storage.getItem(HOF_KEY);
    } catch {
      text = null;
    }
    if (text == null) return defaultHof();
    try {
      const parsed = JSON.parse(text);
      const out = normalizeHof(parsed);
      if (isObj(parsed) && parsed.version !== HOF_VERSION) pendingWrite = true;
      return out;
    } catch {
      try {
        storage.setItem(HOF_KEY + '.corrupt', text);
      } catch {
        /* ignore */
      }
      return defaultHof();
    }
  }
  let pendingWrite = false;
  let data = load();

  function persist() {
    try {
      storage.setItem(HOF_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
  if (pendingWrite) persist();   // data was migrated from an older version: write the upgraded copy back

  let seq = 0;
  const seedSeq = () => {
    seq = 0;
    for (const r of data.history) {
      const n = parseInt(String(r.id).split('-')[1] ?? '', 36);
      if (Number.isFinite(n) && n >= seq) seq = n + 1;
    }
  };
  seedSeq();
  function newId(ms) {
    return `${ms.toString(36)}-${(seq++).toString(36)}`;
  }

  /** Insert into a sorted top-N list (ties rank after existing). Returns {rank|null, personalBest}. */
  function insert(list, entry) {
    let idx = 0;
    while (idx < list.length && list[idx].time <= entry.time) idx++;
    const nameKey = entry.name.toLowerCase();
    const personalBest = !list.some((e) => e.name.toLowerCase() === nameKey && e.time <= entry.time);
    if (idx >= TOP_N) return { rank: null, personalBest };
    list.splice(idx, 0, entry);
    if (list.length > TOP_N) list.length = TOP_N;
    return { rank: idx + 1, personalBest };
  }

  return {
    recordRace(result, meta = {}) {
      const t = now();
      const ms = isNum(t) ? t : 0;
      const date = new Date(ms).toISOString();
      const id = newId(ms);
      const name = sanitizeName(meta.playerName ?? result.playerName);
      const difficulty = meta.difficulty ?? result.difficulty;
      const playerRow = (result.rows || []).find((r) => r.isPlayer) ?? (result.rows || []).find((r) => r.carId === result.playerCarId);
      const lapsDown = playerRow?.lapsDown ?? 0;
      const finished = !!result.playerFinished;
      const base = { id, name, teamId: result.playerTeamId, trackId: result.trackId, minutes: result.minutes, difficulty, date };
      const newRecords = [];

      if (isNum(result.playerBestLap)) {
        const list = (data.bestLaps[result.trackId] ??= []);
        const r = insert(list, { ...base, time: result.playerBestLap });
        if (r.rank) newRecords.push({ kind: 'bestLap', trackId: result.trackId, minutes: result.minutes, time: result.playerBestLap, rank: r.rank, isPersonalBest: r.personalBest });
      }
      if (finished && lapsDown === 0 && isNum(result.playerTotalTime)) {
        const byMin = (data.bestRaces[result.trackId] ??= {});
        const list = (byMin[result.minutes] ??= []);
        const r = insert(list, { ...base, time: result.playerTotalTime });
        if (r.rank) newRecords.push({ kind: 'bestRace', trackId: result.trackId, minutes: result.minutes, time: result.playerTotalTime, rank: r.rank, isPersonalBest: r.personalBest });
      }

      const st = data.stats;
      st.races++;
      if (result.playerPosition === 1) st.wins++;
      if (result.playerPosition <= 3) st.podiums++;
      if (finished) st.finishes++;

      data.history.unshift({
        id, date, name, teamId: result.playerTeamId, trackId: result.trackId, minutes: result.minutes, difficulty,
        laps: result.laps, position: result.playerPosition, grid: result.playerGridPosition,
        totalTime: finished && isNum(result.playerTotalTime) ? result.playerTotalTime : null,
        bestLap: isNum(result.playerBestLap) ? result.playerBestLap : null,
        credits: meta.creditsEarned ?? 0, finished, lapsDown,
      });
      if (data.history.length > HISTORY_MAX) data.history.length = HISTORY_MAX;
      persist();
      return { entryId: id, newRecords };
    },
    renamePlayer(entryId, name) {
      const n = sanitizeName(name);
      let found = false;
      const touch = (e) => {
        if (e.id === entryId) {
          e.name = n;
          found = true;
        }
      };
      data.history.forEach(touch);
      Object.values(data.bestLaps).forEach((l) => l.forEach(touch));
      Object.values(data.bestRaces).forEach((byMin) => Object.values(byMin).forEach((l) => l.forEach(touch)));
      if (found) persist();
      return found;
    },
    getBestLaps: (trackId) => (data.bestLaps[trackId] ?? []).slice(),
    getBestRaces: (trackId, minutes) => (data.bestRaces[trackId]?.[minutes] ?? []).slice(),
    getStats: () => ({ ...data.stats }),
    getHistory: (limit) => (limit == null ? data.history.slice() : data.history.slice(0, limit)),
    getData: () => data,
    clear() {
      data = defaultHof();
      seedSeq();
      persist();
    },
  };
}
