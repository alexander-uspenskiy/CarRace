// Race length (QA: 5-minute races finished 5-16% short). The winner's total time must track the lap formula
// (core/lapMath.js) and land near the chosen length. FULL=1 sweeps every track x {5,7,10} x {easy,normal,hard}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRace, getTrackDef, FULL, TRACK_IDS } from './helpers.js';
import { estimateRaceSeconds } from '../../src/core/lapMath.js';

function check(trackId, minutes, difficulty) {
  const r = runRace({ trackId, minutes, difficulty, seed: 7 + minutes });
  assert.equal(r.sim.phase, 'finished');
  const res = r.sim.getResult();
  const win = res.rows[0].totalTime;
  const nominal = minutes * 60;
  const predicted = estimateRaceSeconds(r.config.laps, getTrackDef(trackId).referenceLapTime, difficulty);
  const dev = win / nominal - 1;
  // whole-lap quantisation can still cost a few % on slow tracks in 5-minute races (a lap is ~20% of the race there)
  assert.ok(dev >= -0.075 && dev <= 0.13, `${trackId} ${minutes} min ${difficulty}: winner ${win.toFixed(1)} s = ${(dev * 100).toFixed(1)}% vs nominal (laps ${r.config.laps})`);
  assert.ok(Math.abs(win / predicted - 1) < 0.03, `${trackId} ${minutes} ${difficulty}: winner ${win.toFixed(1)} vs formula ${predicted.toFixed(1)}`);
  if (minutes === 10) assert.ok(dev >= -0.03 && dev <= 0.10, `10-minute race ${trackId} ${difficulty}: ${(dev * 100).toFixed(1)}%`);
  return dev;
}

if (FULL) {
  for (const id of TRACK_IDS) for (const minutes of [5, 7, 10]) for (const difficulty of ['easy', 'normal', 'hard']) {
    test(`FULL race length: ${id} ${minutes} min ${difficulty}`, () => { check(id, minutes, difficulty); });
  }
} else {
  test('race length: monte-veloce 5 min normal, ridgeback 7 min hard, costa-marina 10 min easy', () => {
    const devs = [check('monte-veloce', 5, 'normal'), check('ridgeback', 7, 'hard'), check('costa-marina', 10, 'easy')];
    for (const d of devs) assert.ok(d > -0.06, `no longer finishing 5-16% short: ${devs.map((x) => (x * 100).toFixed(1))}`);
  });
}
