import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_OVERHEAD, AI_PACE_FACTOR, LENGTH_WINDOW, winnerLapEstimate, computeLaps, estimateRaceSeconds, formatTime, formatGap, formatGapLaps } from '../../src/core/lapMath.js';
import { TRACKS } from '../../src/data/tracks/index.js';

const dev = (laps, ref, diff, minutes) => estimateRaceSeconds(laps, ref, diff) / (minutes * 60) - 1;

test('constants: overhead and per-difficulty winner pace factors', () => {
  assert.equal(START_OVERHEAD, 4.5);
  assert.ok(AI_PACE_FACTOR.easy > AI_PACE_FACTOR.normal && AI_PACE_FACTOR.normal > AI_PACE_FACTOR.hard);
  for (const f of Object.values(AI_PACE_FACTOR)) assert.ok(f > 0.9 && f < 1.02);
  assert.ok(Math.abs(winnerLapEstimate(60, 'normal') - 60 * AI_PACE_FACTOR.normal) < 1e-12);
  assert.equal(winnerLapEstimate(60, 'bogus'), winnerLapEstimate(60, 'normal'));
});

test('fixed vectors: reference 60 s, normal', () => {
  // winner lap 58.5 s: 5 laps = 297 s (-1%) | 7 min: 7 laps = 414 s (-1.4%), 8 = 472.5 s (+12.5%) | 10 min: 10 laps = 589.5 s (-1.75%)
  // and 11 laps = 648 s (+8%) are both inside the window, 11 is closer to its +3.5% centre
  assert.deepEqual([5, 7, 10].map((m) => computeLaps(m, 60)), [5, 7, 11]);
  assert.deepEqual([5, 7, 10].map((m) => computeLaps(m, 55)), [6, 8, 11]);
  assert.ok(Math.abs(estimateRaceSeconds(5, 60) - (5 * 58.5 + 4.5)) < 1e-9);
});

test('formula tracks the real winner: ceil-biased, lands inside the inner window whenever a lap count fits', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    for (let ref = 55; ref <= 80; ref += 0.5) {
      for (const minutes of [5, 7, 10]) {
        const lap = winnerLapEstimate(ref, diff);
        const n = computeLaps(minutes, ref, diff);
        const d = dev(n, ref, diff, minutes);
        const fits = [n - 1, n, n + 1].some((k) => k >= 3 && dev(k, ref, diff, minutes) >= LENGTH_WINDOW.lo - 1e-9 && dev(k, ref, diff, minutes) <= LENGTH_WINDOW.hi + 1e-9);
        if (fits) assert.ok(d >= LENGTH_WINDOW.lo - 1e-9 && d <= LENGTH_WINDOW.hi + 1e-9, `${diff} ref ${ref} ${minutes}min -> ${n} laps ${(d * 100).toFixed(1)}%`);
        else assert.ok(Math.abs(d) <= 0.5 * lap / (minutes * 60) + 0.05, `${diff} ref ${ref} ${minutes}min -> ${n} laps ${(d * 100).toFixed(1)}%`);
      }
    }
  }
});

test('minimum 3 laps', () => {
  assert.equal(computeLaps(1, 90), 3);
  assert.equal(computeLaps(0, 60), 3);
});

test('every track x difficulty: laps in 4..14, strictly increasing, estimate never short by more than ~7% or long by more than ~13%', () => {
  for (const t of TRACKS) {
    for (const diff of ['easy', 'normal', 'hard']) {
      const laps = [5, 7, 10].map((m) => computeLaps(m, t.referenceLapTime, diff));
      assert.ok(laps[0] < laps[1] && laps[1] < laps[2], `${t.id} ${laps}`);
      laps.forEach((n, i) => {
        assert.ok(n >= 4 && n <= 14, `${t.id} laps ${n}`);
        const d = dev(n, t.referenceLapTime, diff, [5, 7, 10][i]);
        assert.ok(d >= -0.075 && d <= 0.13, `${t.id} ${diff} ${[5, 7, 10][i]} min: ${(d * 100).toFixed(1)}%`);
      });
    }
  }
});

test('10-minute races (and 7 on most tracks) land inside -3%..+10% on every track and difficulty', () => {
  for (const t of TRACKS) for (const diff of ['easy', 'normal', 'hard']) {
    const d = dev(computeLaps(10, t.referenceLapTime, diff), t.referenceLapTime, diff, 10);
    assert.ok(d >= -0.03 && d <= 0.10, `${t.id} ${diff} 10 min ${(d * 100).toFixed(1)}%`);
  }
});

test('formatTime', () => {
  assert.equal(formatTime(61.234), '1:01.234');
  assert.equal(formatTime(0), '0:00.000');
  assert.equal(formatTime(59.9996), '1:00.000');
  assert.equal(formatTime(612.3456), '10:12.346');
  assert.equal(formatTime(null), '--:--.---');
  assert.equal(formatTime(NaN), '--:--.---');
  assert.equal(formatTime(undefined), '--:--.---');
});

test('formatGap / formatGapLaps', () => {
  assert.equal(formatGap(1.234), '+1.234');
  assert.equal(formatGap(0), '+0.000');
  assert.equal(formatGap(62.34), '+1:02.3');
  assert.equal(formatGap(125), '+2:05.0');
  assert.equal(formatGap(59.9999), '+1:00.0');
  assert.equal(formatGap(null), '--.---');
  assert.equal(formatGapLaps(1), '+1 LAP');
  assert.equal(formatGapLaps(2), '+2 LAPS');
});
