// Track registry. TRACKS entries carry the EFFECTIVE referenceLapTime (calibration override applied).
import { buildTrackModel } from '../../core/trackModel.js';
import { CALIBRATION } from './calibration.js';
import { monteVeloce } from './monteVeloce.js';
import { ridgeback } from './ridgeback.js';
import { costaMarina } from './costaMarina.js';

export const RAW_TRACKS = [monteVeloce, ridgeback, costaMarina];

/** Returns a copy of `def` whose referenceLapTime is `calibration[def.id] ?? def.referenceLapTime`. */
export function applyCalibration(def, calibration = CALIBRATION) {
  const c = calibration && calibration[def.id];
  const ref = typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : def.referenceLapTime;
  return { ...def, referenceLapTime: ref };
}

export const TRACKS = RAW_TRACKS.map((d) => applyCalibration(d));

export function getTrackDef(id) {
  const def = TRACKS.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown track id: ${id}`);
  return def;
}

const modelCache = new Map();
/** Memoised buildTrackModel(getTrackDef(id)). */
export function getTrackModel(id) {
  let m = modelCache.get(id);
  if (!m) {
    m = buildTrackModel(getTrackDef(id));
    modelCache.set(id, m);
  }
  return m;
}
