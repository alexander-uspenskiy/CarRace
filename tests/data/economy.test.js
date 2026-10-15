import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY, RACE_MINUTES, LENGTH_CREDIT_MULT, STARTING_CREDITS, payoutForPosition, computeCredits, FASTEST_LAP_BONUS, POSITION_GAINED_BONUS, POSITION_GAINED_CAP, BEAT_TEAMMATE_BONUS } from '../../src/data/economy.js';

function makeResult(o = {}) {
  const rows = [];
  for (let p = 1; p <= 20; p++) rows.push({ position: p, carId: p - 1, teamId: 't' + p, isPlayer: false });
  const r = {
    trackId: 'monte-veloce', minutes: 5, laps: 5, difficulty: 'normal',
    playerCarId: 6, playerTeamId: 'mclaren', playerPosition: 7, playerGridPosition: 7, playerFinished: true,
    playerTotalTime: 300, playerBestLap: 60, fastestLap: { carId: 1, time: 59, lap: 3 }, rows,
    ...o,
  };
  rows[r.playerPosition - 1] = { position: r.playerPosition, carId: r.playerCarId, teamId: r.playerTeamId, isPlayer: true };
  return r;
}
const cfg = (minutes = 5, difficulty = 'normal') => ({ minutes, difficulty });

test('constants', () => {
  assert.deepEqual(RACE_MINUTES, [5, 7, 10]);
  assert.deepEqual(LENGTH_CREDIT_MULT, { 5: 1.0, 7: 1.45, 10: 2.14 });   // minutes^1.1, 2 decimals
  assert.equal(STARTING_CREDITS, 1000);
  assert.deepEqual(DIFFICULTY.easy, { paceScale: 0.935, aiUpgradeLevel: 0, creditMult: 0.8, mistakeRate: 0.1, rubber: 0.03, tyreWearMult: 0.8 });
  assert.deepEqual(DIFFICULTY.normal, { paceScale: 0.97, aiUpgradeLevel: 0, creditMult: 1.0, mistakeRate: 0.05, rubber: 0.02, tyreWearMult: 1.0 });
  assert.deepEqual(DIFFICULTY.hard, { paceScale: 1.0, aiUpgradeLevel: 1, creditMult: 1.25, mistakeRate: 0.02, rubber: 0.01, tyreWearMult: 1.2 });
});

test('payout table', () => {
  assert.equal(payoutForPosition(1), 2160);   // 1.8 x the original 1200 (balance pass)
  assert.equal(payoutForPosition(2), 1771);
  assert.equal(payoutForPosition(3), 1452);
  assert.equal(payoutForPosition(5), 977);
  assert.equal(payoutForPosition(10), 362);
  assert.equal(payoutForPosition(20), 90); // floor
  for (let p = 2; p <= 20; p++) assert.ok(payoutForPosition(p) <= payoutForPosition(p - 1));
});

test('plain finish: P7 from P7, no bonuses', () => {
  const c = computeCredits(makeResult(), cfg());
  assert.equal(c.lines.length, 1);
  assert.equal(c.lines[0].label, 'Finish P7');
  assert.equal(c.lines[0].amount, payoutForPosition(7)); // 2160*0.82^6 = 656.7 -> 657
  assert.equal(c.subtotal, 657);
  assert.equal(c.lengthMult, 1);
  assert.equal(c.diffMult, 1);
  assert.equal(c.total, 660); // round10
});

test('fastest lap +270, positions gained +72 each (cap 576), beat teammate +180', () => {
  assert.deepEqual([FASTEST_LAP_BONUS, POSITION_GAINED_BONUS, POSITION_GAINED_CAP, BEAT_TEAMMATE_BONUS], [270, 72, 576, 180]);
  const base = makeResult({ playerPosition: 4, playerGridPosition: 4 });
  assert.equal(computeCredits(base, cfg()).subtotal, payoutForPosition(4));

  const fl = computeCredits(makeResult({ fastestLap: { carId: 6, time: 58, lap: 2 } }), cfg());
  assert.ok(fl.lines.some((l) => l.label === 'Fastest lap' && l.amount === 270));
  assert.equal(fl.subtotal, 657 + 270);

  const g3 = computeCredits(makeResult({ playerPosition: 4, playerGridPosition: 7 }), cfg());
  assert.equal(g3.lines.find((l) => l.label.startsWith('Positions gained')).amount, 216);
  const g15 = computeCredits(makeResult({ playerPosition: 2, playerGridPosition: 17 }), cfg());
  assert.equal(g15.lines.find((l) => l.label.startsWith('Positions gained')).amount, 576); // capped
  const lost = computeCredits(makeResult({ playerPosition: 9, playerGridPosition: 5 }), cfg());
  assert.ok(!lost.lines.some((l) => l.label.startsWith('Positions gained')));

  const r = makeResult({ playerPosition: 5, playerGridPosition: 5 });
  r.rows[9] = { position: 10, carId: 9, teamId: 'mclaren', isPlayer: false }; // teammate P10
  assert.ok(computeCredits(r, cfg()).lines.some((l) => l.label === 'Beat teammate' && l.amount === 180));
  const r2 = makeResult({ playerPosition: 12, playerGridPosition: 12 });
  r2.rows[3] = { position: 4, carId: 3, teamId: 'mclaren', isPlayer: false }; // teammate P4 ahead
  assert.ok(!computeCredits(r2, cfg()).lines.some((l) => l.label === 'Beat teammate'));
});

test('unfinished player gets half the position payout (lapped-but-flagged finishers do not)', () => {
  const dnf = computeCredits(makeResult({ playerFinished: false, playerPosition: 18, playerGridPosition: 18 }), cfg());
  const full = payoutForPosition(18);
  assert.equal(dnf.lines[0].amount, full);
  assert.equal(dnf.lines[1].amount, Math.round(full * 0.5) - full);
  assert.equal(dnf.subtotal, Math.round(full * 0.5));
  const lapped = computeCredits(makeResult({ playerFinished: true, playerPosition: 18, playerGridPosition: 18 }), cfg());
  assert.equal(lapped.subtotal, full);
  // bonuses still apply on top of the halved payout
  const dnf2 = computeCredits(makeResult({ playerFinished: false, playerPosition: 10, playerGridPosition: 14 }), cfg());
  assert.equal(dnf2.subtotal, Math.round(payoutForPosition(10) / 2) + 4 * 72);
});

test('length and difficulty multipliers, total rounded to 10', () => {
  const r = makeResult({ playerPosition: 1, playerGridPosition: 1, fastestLap: { carId: 6, time: 1, lap: 1 } });
  r.rows[0] = { position: 1, carId: 6, teamId: 'mclaren', isPlayer: true };
  r.rows[1] = { position: 2, carId: 7, teamId: 'mclaren', isPlayer: false };
  const sub = 2160 + 270 + 180;
  const c = computeCredits(r, cfg(10, 'hard'));
  assert.equal(c.subtotal, sub);
  assert.equal(c.lengthMult, 2.14);
  assert.equal(c.diffMult, 1.25);
  assert.equal(c.total, Math.round((sub * 2.14 * 1.25) / 10) * 10);
  assert.equal(computeCredits(r, cfg(7, 'easy')).total, Math.round((sub * 1.45 * 0.8) / 10) * 10);
  assert.equal(computeCredits(r, cfg(5, 'normal')).total, 2610);
  for (const m of RACE_MINUTES) for (const d of Object.keys(DIFFICULTY)) assert.equal(computeCredits(r, cfg(m, d)).total % 10, 0);
});

test('missing rows / unknown config do not throw', () => {
  const r = makeResult();
  delete r.rows;
  const c = computeCredits(r, { minutes: 99, difficulty: 'weird' });
  assert.equal(c.lengthMult, 1);
  assert.equal(c.diffMult, 1);
  assert.ok(c.total >= 0);
});

test('longer races pay at least as much per real minute as a 5-minute race (payout ~ minutes^1.1)', () => {
  const r = makeResult({ playerPosition: 5, playerGridPosition: 10 });
  const per = (m) => computeCredits(r, cfg(m)).total / m;
  for (const m of [7, 10]) assert.ok(per(m) >= per(5), `${m} min pays ${per(m).toFixed(1)}/min vs ${per(5).toFixed(1)}/min`);
  assert.ok(LENGTH_CREDIT_MULT[10] / LENGTH_CREDIT_MULT[5] >= 2);
});

test('economy pacing: mid-table 5-minute races fund a fully upgraded team (32 500 credits) in ~18..25 races', () => {
  const total = 32500;
  // average mid-table race: finish P5 from grid P10, beating the teammate half the time, fastest lap never
  const withMate = makeResult({ playerPosition: 5, playerGridPosition: 10 });
  withMate.rows[5] = { position: 6, carId: 5, teamId: 'mclaren', isPlayer: false };    // teammate behind
  const noMate = makeResult({ playerPosition: 5, playerGridPosition: 10 });
  const perRace = (computeCredits(withMate, cfg(5)).total + computeCredits(noMate, cfg(5)).total) / 2;
  const races = total / perRace;
  assert.ok(races >= 18 && races <= 25, `${races.toFixed(1)} races at ${perRace} credits`);
  // a clear front-runner (P2 from P6) gets there roughly twice as fast; a backmarker (P12 from P14) needs < 100 races (was ~150)
  const front = computeCredits(makeResult({ playerPosition: 2, playerGridPosition: 6 }), cfg(5)).total;
  assert.ok(total / front >= 9 && total / front <= 18, `${total / front}`);
  const back = computeCredits(makeResult({ playerPosition: 12, playerGridPosition: 14 }), cfg(5)).total;
  assert.ok(total / back < 100, `${total / back}`);
});
