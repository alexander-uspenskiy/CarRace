import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRacingLine, brakeForceLimit } from '../../src/sim/ai/racingLine.js';
import { TRACK_IDS, getTrackModel, mclarenStats, calibrationStats } from './helpers.js';

const stats = calibrationStats();

for (const id of TRACK_IDS) {
  test(`racing line on ${id}: shorter than centreline, gentler curvature, inside the track, continuous`, () => {
    const m = getTrackModel(id);
    const line = buildRacingLine(m, stats);
    assert.equal(line.offset.length, m.N);
    assert.ok(line.length < m.length, `line ${line.length} vs centre ${m.length}`);
    let kc = 0, kl = 0, maxStep = 0, maxOff = 0;
    for (let i = 0; i < m.N; i++) {
      kc = Math.max(kc, Math.abs(m.curvature[i]));
      kl = Math.max(kl, Math.abs(line.curvature[i]));
      maxOff = Math.max(maxOff, Math.abs(line.offset[i]));
      maxStep = Math.max(maxStep, Math.abs(line.offset[i] - line.offset[(i + 1) % m.N]));
    }
    assert.ok(kl <= kc + 1e-9, `max line curvature ${kl} > centre ${kc}`);
    assert.ok(maxOff <= m.halfWidth - 1.8 + 1e-6, `offset ${maxOff}`);
    assert.ok(maxStep <= 0.15 + 1e-6, `offset step ${maxStep}`);
  });

  test(`speed profile on ${id}: <= top speed, continuous, braking & acceleration feasible`, () => {
    const m = getTrackModel(id);
    const line = buildRacingLine(m, stats);
    const top = stats.derived.topSpeed;
    const mass = stats.mass;
    const drag = (u) => 0.5 * 1.2 * stats.cdA * u * u;
    let maxDecel = 0, maxAccel = 0;
    for (let i = 0; i < m.N; i++) {
      const v0 = line.speed[i], v1 = line.speed[(i + 1) % m.N];
      assert.ok(v0 > 3 && v0 <= 0.99 * top + 1e-3, `speed ${v0} at ${i}`);
      const d = line.dsl[i];
      const a = (v1 * v1 - v0 * v0) / (2 * d);          // m/s^2 along the line
      if (-a > maxDecel) maxDecel = -a;
      if (a > maxAccel) maxAccel = a;
      assert.ok(Math.abs(v1 - v0) < 3, `profile jump ${v0} -> ${v1} at ${i}`);
    }
    // decel limit: brake force + drag (+ a little rolling), well under the grip limit at top speed
    const limit = (stats.brakeForceMax + drag(top)) / mass * 1.02 + 0.3;
    assert.ok(maxDecel <= limit, `decel ${maxDecel} > ${limit}`);
    const accLimit = stats.power / (mass * 4);           // absolute upper bound (u>=4)
    assert.ok(maxAccel <= accLimit, `accel ${maxAccel}`);
  });
}

test('profile reference values: tight corners slow, aero-unlimited corners fall to the top-speed cap', () => {
  const m = getTrackModel('ridgeback');
  const line = buildRacingLine(m, mclarenStats());
  let vmin = 1e9, vmax = 0;
  for (const v of line.speed) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  assert.ok(vmin < 26, `slowest corner ${vmin}`);
  assert.ok(vmax > 60);
});

test('cached per (track, stats): same object returned, different stats differ', () => {
  const m = getTrackModel('monte-veloce');
  const a = buildRacingLine(m, stats), b = buildRacingLine(m, stats);
  assert.equal(a, b);
  const c = buildRacingLine(m, mclarenStats());
  assert.notEqual(a, c);
});

test('brakeForceLimit: full braking in a straight line, much less when cornering hard', () => {
  const s = mclarenStats();
  const straight = brakeForceLimit(s, 50, 0);
  const corner = brakeForceLimit(s, 50, 20);
  assert.ok(straight > 0.9 * s.brakeForceMax);
  assert.ok(corner < 0.6 * straight);
  assert.ok(brakeForceLimit(s, 50, 40) >= 0);
});
