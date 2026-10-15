// Calibrates TrackDef.referenceLapTime (spec §9).
//   node tools/calibrate.mjs [--write]
// Calibration car: Racing Bulls / LAW (strength 0.72, skill 0.88), 'normal', no upgrades, solo, flying start.
// reference = mean of laps 2-4 (lap 1 discarded), rounded to 0.1 s. With --write regenerates
// src/data/tracks/calibration.js (the only sanctioned cross-package write).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRACKS, getTrackModel } from '../src/data/tracks/index.js';
import { TEAMS } from '../src/data/teams.js';
import { computeCarStats } from '../src/data/carStats.js';
import { runSolo } from '../src/sim/soloRun.js';

export function measureReferenceLap(trackId, seed = 1) {
  const team = TEAMS.find((t) => t.id === 'racingbulls');
  const driver = team.drivers.find((d) => d.id === 'law') || team.drivers[1];
  const stats = computeCarStats(team);               // no upgrades, normal difficulty (AI level 0)
  const model = getTrackModel(trackId);
  const r = runSolo({ trackModel: model, stats, driver, difficulty: 'normal', seed, laps: 4, raceSeconds: 300 });
  if (!r.completed || r.nan) throw new Error(`calibration run failed on ${trackId} (completed=${r.completed}, nan=${r.nan})`);
  const laps = r.lapTimes.slice(1, 4);
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  return { value: Math.round(mean * 10) / 10, laps: r.lapTimes, wallHits: r.wallHits, maxD: r.maxD };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const write = process.argv.includes('--write');
  const out = {};
  for (const def of TRACKS) {
    const r = measureReferenceLap(def.id);
    out[def.id] = r.value;
    console.log(`${def.id.padEnd(14)} reference ${r.value.toFixed(1)} s  (laps ${r.laps.map((x) => x.toFixed(2)).join(', ')}; wall hits ${r.wallHits}, max |d| ${r.maxD.toFixed(1)} m)`);
  }
  if (write) {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = join(here, '..', 'src', 'data', 'tracks', 'calibration.js');
    const body = `// Written ONLY by tools/calibrate.mjs (package B) — measured solo flying-lap times (s) of the calibration car.\n` +
      `// Shape: { 'monte-veloce': 61.3, ... }. Empty means "use each TrackDef.referenceLapTime guess".\n` +
      `export const CALIBRATION = {\n${Object.entries(out).map(([k, v]) => `  '${k}': ${v.toFixed(1)},`).join('\n')}\n};\n`;
    writeFileSync(file, body);
    console.log(`wrote ${file}`);
  } else {
    console.log('(dry run; pass --write to update src/data/tracks/calibration.js)');
  }
}
