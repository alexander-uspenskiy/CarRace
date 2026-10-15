// Versioned save store over an injectable StorageAdapter. Never throws on corrupt/missing data.
import { getDefaultStorage, runMigrations } from '../core/storage.js';
import { clamp } from '../core/mathUtil.js';
import { sanitizeName, coerceNum } from '../core/text.js';
import { TEAMS } from './teams.js';
import { TRACKS } from './tracks/index.js';
import { RACE_MINUTES, DIFFICULTY, STARTING_CREDITS } from './economy.js';
import { UPGRADE_CATEGORIES, MAX_LEVEL, UPGRADE_COSTS, emptyLevels } from './upgrades.js';

export const SAVE_KEY = 'carrace.save.v1';
export const SAVE_VERSION = 1;
export const MAX_CREDITS = 999_999_999;
export { sanitizeName };

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const num = coerceNum;   // finite numbers and numeric strings ("4321"); anything else -> default

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    playerName: 'PLAYER',
    credits: STARTING_CREDITS,
    upgrades: {},
    last: { teamId: 'mclaren', driverIndex: 0, trackId: 'monte-veloce', minutes: 5, difficulty: 'normal' },
    settings: { volume: 0.7, quality: 'high', units: 'kph', steerAssist: 0.5, defaultCamera: 'chase' },
    stats: { races: 0, creditsEarned: 0 },
  };
}

const TEAM_IDS = TEAMS.map((t) => t.id);
const TRACK_IDS = TRACKS.map((t) => t.id);

function sanitizeLevels(raw) {
  const out = emptyLevels();
  if (isObj(raw)) for (const c of UPGRADE_CATEGORIES) out[c] = clamp(Math.floor(num(raw[c], 0)), 0, MAX_LEVEL);
  return out;
}
function sanitizeLast(raw, base) {
  const out = { ...base };
  if (!isObj(raw)) return out;
  if (TEAM_IDS.includes(raw.teamId)) out.teamId = raw.teamId;
  const di = num(raw.driverIndex, -1);
  if (di === 0 || di === 1) out.driverIndex = di;
  if (TRACK_IDS.includes(raw.trackId)) out.trackId = raw.trackId;
  const mins = num(raw.minutes, -1);
  if (RACE_MINUTES.includes(mins)) out.minutes = mins;
  if (Object.hasOwn(DIFFICULTY, raw.difficulty)) out.difficulty = raw.difficulty;
  return out;
}
function sanitizeSettings(raw, base) {
  const out = { ...base };
  if (!isObj(raw)) return out;
  out.volume = clamp(num(raw.volume, out.volume), 0, 1);
  if (raw.quality === 'high' || raw.quality === 'low') out.quality = raw.quality;
  if (raw.units === 'kph' || raw.units === 'mph') out.units = raw.units;
  out.steerAssist = clamp(num(raw.steerAssist, out.steerAssist), 0, 1);
  if (raw.defaultCamera === 'chase' || raw.defaultCamera === 'cockpit') out.defaultCamera = raw.defaultCamera;
  return out;
}

// ---- versioning --------------------------------------------------------------------------------------------------
// MIGRATIONS[v] upgrades a version-v save object to v+1 (see core/storage.js runMigrations). Add a step here whenever
// SAVE_VERSION is bumped; every step must be tolerant (the result still goes through normalizeSave's field sanitising).
export const MIGRATIONS = {
  // v0 = the unversioned prototype format: `name` / `money` (or `coins`) / `racesRun`, a flat `upgrades` map for the
  // single car, `settings.sound` (boolean). v1 renamed these and made upgrades per team.
  0(old) {
    const out = { ...old };
    if (out.playerName === undefined && out.name !== undefined) out.playerName = out.name;
    if (out.credits === undefined) out.credits = out.money !== undefined ? out.money : out.coins;
    if (isObj(out.upgrades) && UPGRADE_CATEGORIES.some((c) => c in out.upgrades)) {
      const team = isObj(out.last) && TEAM_IDS.includes(out.last.teamId) ? out.last.teamId : 'mclaren';
      out.upgrades = { [team]: out.upgrades };
    }
    if (out.stats === undefined && out.racesRun !== undefined) out.stats = { races: out.racesRun };
    if (isObj(out.settings) && out.settings.volume === undefined && typeof out.settings.sound === 'boolean') {
      out.settings = { ...out.settings, volume: out.settings.sound ? 0.7 : 0 };
    }
    delete out.name; delete out.money; delete out.coins; delete out.racesRun;
    return out;
  },
};

/** Brings any stored save object up to SAVE_VERSION: `migrateSave(raw) -> { save, from, to, migrated }` (not yet sanitised). */
export function migrateSave(raw) {
  const r = runMigrations(raw, MIGRATIONS, SAVE_VERSION);
  return { save: r.data, from: r.from, to: r.to, migrated: r.migrated };
}

/** Validate/repair arbitrary parsed JSON into a SaveData (runs the migration chain first). */
export function normalizeSave(input) {
  const d = defaultSave();
  if (!isObj(input)) return d;
  const raw = migrateSave(input).save;
  // Future / unknown versions are sanitised field-by-field (best effort) and rewritten as SAVE_VERSION.
  d.playerName = sanitizeName(raw.playerName);
  d.credits = clamp(Math.floor(num(raw.credits, d.credits)), 0, MAX_CREDITS);
  if (isObj(raw.upgrades)) {
    for (const id of TEAM_IDS) if (isObj(raw.upgrades[id])) d.upgrades[id] = sanitizeLevels(raw.upgrades[id]);
  }
  d.last = sanitizeLast(raw.last, d.last);
  d.settings = sanitizeSettings(raw.settings, d.settings);
  if (isObj(raw.stats)) {
    d.stats.races = clamp(Math.floor(num(raw.stats.races, 0)), 0, MAX_CREDITS);
    d.stats.creditsEarned = clamp(Math.floor(num(raw.stats.creditsEarned, 0)), 0, MAX_CREDITS * 10);
  }
  return d;
}

export function createSaveStore(storage = getDefaultStorage(), bus) {
  function load() {
    let text = null;
    try {
      text = storage.getItem(SAVE_KEY);
    } catch {
      text = null;
    }
    if (text == null) return defaultSave();
    try {
      const parsed = JSON.parse(text);
      const out = normalizeSave(parsed);
      if (isObj(parsed) && parsed.version !== SAVE_VERSION) pendingWrite = true;   // upgraded in memory: write it back
      return out;
    } catch {
      // corrupt JSON: keep a backup copy for manual recovery, start fresh
      try {
        storage.setItem(SAVE_KEY + '.corrupt', text);
      } catch {
        /* ignore */
      }
      return defaultSave();
    }
  }

  let pendingWrite = false;
  let data = load();

  function persist() {
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* quota/unavailable: keep in-memory state */
    }
  }
  if (pendingWrite) persist();
  function changed() {
    persist();
    bus?.emit('save:changed', { save: data });
  }
  function ensureLevels(teamId) {
    if (!data.upgrades[teamId]) data.upgrades[teamId] = emptyLevels();
    return data.upgrades[teamId];
  }

  const store = {
    get: () => data,
    update(fn) {
      fn(data);
      changed();
      return data;
    },
    getUpgrades(teamId) {
      return { ...ensureLevels(teamId) };
    },
    canAfford(teamId, cat) {
      if (!TEAM_IDS.includes(teamId) || !UPGRADE_CATEGORIES.includes(cat)) return false;
      const lvl = ensureLevels(teamId)[cat];
      return lvl < MAX_LEVEL && data.credits >= UPGRADE_COSTS[lvl];
    },
    buyUpgrade(teamId, cat) {
      if (!TEAM_IDS.includes(teamId) || !UPGRADE_CATEGORIES.includes(cat)) return { ok: false, reason: 'unknown' };
      const levels = ensureLevels(teamId);
      const lvl = levels[cat];
      if (lvl >= MAX_LEVEL) return { ok: false, reason: 'maxed', level: lvl, credits: data.credits };
      const cost = UPGRADE_COSTS[lvl];
      if (data.credits < cost) return { ok: false, reason: 'funds', level: lvl, cost, credits: data.credits };
      data.credits -= cost;
      levels[cat] = lvl + 1;
      changed();
      return { ok: true, level: lvl + 1, cost, credits: data.credits };
    },
    refundUpgrades(teamId) {
      if (!TEAM_IDS.includes(teamId)) return { ok: false, refunded: 0, reason: 'unknown' };
      const levels = ensureLevels(teamId);
      let spent = 0;
      for (const c of UPGRADE_CATEGORIES) for (let i = 0; i < levels[c]; i++) spent += UPGRADE_COSTS[i];
      if (spent === 0) return { ok: false, refunded: 0, reason: 'nothing' };
      const refunded = Math.floor(spent * 0.7);
      data.credits += refunded;
      data.upgrades[teamId] = emptyLevels();
      changed();
      return { ok: true, refunded };
    },
    addCredits(n) {
      if (typeof n === 'number' && Number.isFinite(n)) {
        data.credits = clamp(Math.round(data.credits + n), 0, MAX_CREDITS);
        changed();
      }
      return data.credits;
    },
    setPlayerName(name) {
      data.playerName = sanitizeName(name);
      changed();
      return data.playerName;
    },
    setLast(partial) {
      data.last = sanitizeLast({ ...data.last, ...(partial || {}) }, data.last);
      changed();
      return data.last;
    },
    setSettings(partial) {
      data.settings = sanitizeSettings({ ...data.settings, ...(partial || {}) }, data.settings);
      changed();
      return data.settings;
    },
    reset() {
      data = defaultSave();
      changed();
      return data;
    },
  };
  return store;
}
