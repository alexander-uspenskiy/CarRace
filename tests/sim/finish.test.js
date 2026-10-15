// Regression: after the leader takes the flag every running car must complete its lap, cross the line and get a time.
// (Bug: the race ended 3 s after the PLAYER finished, so the other 19 cars were classified unfinished / lapsDown 1.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRace, FULL, TRACK_IDS } from './helpers.js';
import { cutoffSeconds } from '../../src/sim/raceDirector.js';
import { getTrackDef } from './helpers.js';

function checkFinish(r) {
  const { sim } = r;
  assert.equal(sim.phase, 'finished');
  assert.equal(r.counts['race:finished'], 1);
  const res = sim.getResult();
  assert.equal(res.rows.length, 20);
  assert.deepEqual(res.rows.map((x) => x.position), [...Array(20).keys()].map((i) => i + 1));
  const snap = sim.getSnapshot();
  const win = res.rows[0];
  const cutoff = cutoffSeconds(getTrackDef(r.config.trackId).referenceLapTime);
  for (const row of res.rows) {
    const car = snap.cars[row.carId];
    assert.equal(row.finished, true, `car ${row.carId} (P${row.position}) must be classified finished`);
    assert.ok(Number.isFinite(row.totalTime) && row.totalTime >= win.totalTime, `totalTime of P${row.position}`);
    assert.ok(row.totalTime <= win.totalTime + cutoff + 1, `P${row.position} finished within the cut-off`);
    assert.equal(car.finished, true);
    assert.equal(car.finishTime, row.totalTime, 'snapshot finishTime set');
    assert.ok(row.lapsDown >= 0 && row.lapsDown <= 2, `lapsDown ${row.lapsDown}`);
  }
  // classification: laps completed desc, then finish time asc
  for (let i = 1; i < 20; i++) {
    const a = res.rows[i - 1], b = res.rows[i];
    assert.ok(a.lapsCompleted > b.lapsCompleted || (a.lapsCompleted === b.lapsCompleted && a.totalTime <= b.totalTime), `order ${i}`);
  }
  // player's HoF/credit time is the real finish time
  const prow = res.rows.find((x) => x.isPlayer);
  assert.equal(res.playerFinished, true);
  assert.equal(res.playerTotalTime, prow.totalTime);
  const fin = r.events.find((e) => e.name === 'race:carFinished' && e.payload.carId === res.playerCarId);
  assert.ok(fin && Math.abs(fin.payload.time - res.playerTotalTime) < 1e-9);
  // everyone who was on the lead lap at the flag finishes on laps === laps
  assert.equal(res.rows.filter((x) => x.lapsDown === 0).length >= 5, true, 'several cars on the lead lap');
}

test('regression: monte-veloce 10 min autopilot - whole field finishes after the flag, race ends after the last car', () => {
  const r = runRace({ trackId: 'monte-veloce', minutes: 10, difficulty: 'normal' }, { maxSeconds: 800 });
  checkFinish(r);
  const lastFinish = Math.max(...r.sim.getResult().rows.map((x) => x.totalTime));
  assert.ok(r.sim.raceTime >= lastFinish && r.sim.raceTime < lastFinish + 1, 'race ended when the last car crossed the line');
});

test('a player finishing first no longer ends the race 3 s later', () => {
  const r = runRace({ trackId: 'monte-veloce', minutes: 5 }, { maxSeconds: 500 });
  const res = r.sim.getResult();
  const ends = r.events.filter((e) => e.name === 'race:carFinished');
  assert.equal(ends.length, 20);
  assert.ok(res.rows.every((x) => x.finished));
});

if (FULL) {
  for (const trackId of TRACK_IDS) for (const minutes of [5, 7, 10]) for (const difficulty of ['easy', 'normal', 'hard']) {
    test(`FULL finish: ${trackId} ${minutes} min ${difficulty}`, () => {
      checkFinish(runRace({ trackId, minutes, difficulty }, { maxSeconds: 1200 }));
    });
  }
}
