import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, RAW_TRACKS, getTrackDef, getTrackModel, applyCalibration } from '../../src/data/tracks/index.js';
import { CALIBRATION } from '../../src/data/tracks/calibration.js';
import { buildTrackModel } from '../../src/core/trackModel.js';
import { maxAbsCurvature, minRadius, ring, countSelfIntersections, minSeparation, totalTurning } from './trackChecks.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const LIMITS = {
  'monte-veloce': { len: [3600, 4100], bbox: [1600, 1000], width: 15, runoff: 12 },
  ridgeback: { len: [2200, 2600], bbox: [900, 800], width: 13, runoff: 9 },
  'costa-marina': { len: [2900, 3400], bbox: [1300, 900], width: 13.5, runoff: 5 },
};

test('registry: 3 tracks, ids, lookup, memoised models', () => {
  assert.deepEqual(TRACKS.map((t) => t.id), ['monte-veloce', 'ridgeback', 'costa-marina']);
  for (const t of TRACKS) {
    assert.equal(getTrackDef(t.id), t);
    assert.equal(getTrackModel(t.id), getTrackModel(t.id));
    assert.equal(getTrackModel(t.id).id, t.id);
  }
  assert.throws(() => getTrackDef('nope'));
});

test('calibration override is applied by the registry', () => {
  const raw = RAW_TRACKS[0];
  assert.equal(applyCalibration(raw, {}).referenceLapTime, raw.referenceLapTime);
  assert.equal(applyCalibration(raw, { [raw.id]: 55.5 }).referenceLapTime, 55.5);
  assert.equal(applyCalibration(raw, { [raw.id]: NaN }).referenceLapTime, raw.referenceLapTime);
  assert.equal(raw.referenceLapTime, RAW_TRACKS[0].referenceLapTime); // raw untouched
  for (const t of TRACKS) {
    const rawDef = RAW_TRACKS.find((r) => r.id === t.id);
    assert.equal(t.referenceLapTime, CALIBRATION[t.id] ?? rawDef.referenceLapTime);
  }
});

for (const def of TRACKS) {
  const lim = LIMITS[def.id];
  const m = buildTrackModel(def);
  const wo = m.wallOffset;

  test(`${def.id}: TrackDef fields`, () => {
    assert.equal(def.width, lim.width);
    assert.equal(def.runoff, lim.runoff);
    assert.equal(m.wallOffset, def.width / 2 + def.runoff);
    assert.ok(def.kerbWidth > 0 && def.kerbWidth < 3);
    assert.ok(def.name && def.country && def.blurb);
    assert.ok(def.rating.speed >= 1 && def.rating.speed <= 5 && def.rating.technical >= 1 && def.rating.technical <= 5);
    assert.ok(def.referenceLapTime >= 40 && def.referenceLapTime <= 80);
    assert.ok(Number.isInteger(def.seed));
    const th = def.theme;
    for (const c of [...th.sky, th.fog, th.grass, th.asphalt, th.kerbA, th.kerbB]) assert.match(c, HEX);
    assert.equal(th.sky.length, 2);
    assert.equal(th.sunDir.length, 3);
    assert.ok(Array.isArray(th.scenery) && th.scenery.length > 0);
    assert.ok(th.treeDensity >= 0 && th.treeDensity <= 1);
    assert.ok(def.controlPoints.every((p) => p.length === 2 && p.every(Number.isFinite)));
  });

  test(`${def.id}: length / bbox / lengthHint`, () => {
    assert.ok(m.length >= lim.len[0] && m.length <= lim.len[1], `length ${m.length}`);
    assert.ok(Math.abs(m.length - def.lengthHint) / def.lengthHint <= 0.03, `hint ${def.lengthHint} vs ${m.length}`);
    assert.ok(m.bbox.maxX - m.bbox.minX <= lim.bbox[0], `bbox w ${m.bbox.maxX - m.bbox.minX}`);
    assert.ok(m.bbox.maxY - m.bbox.minY <= lim.bbox[1], `bbox h ${m.bbox.maxY - m.bbox.minY}`);
    // centred near the origin
    assert.ok(Math.abs((m.bbox.maxX + m.bbox.minX) / 2) < 30 && Math.abs((m.bbox.maxY + m.bbox.minY) / 2) < 30);
  });

  test(`${def.id}: simple closed loop, clockwise, uniform samples`, () => {
    assert.ok(Math.abs(totalTurning(m) - 2 * Math.PI) < 0.05, `turning ${totalTurning(m)}`);
    for (let i = 0; i < m.N; i++) {
      const j = (i + 1) % m.N;
      assert.ok(Math.abs(Math.hypot(m.x[j] - m.x[i], m.y[j] - m.y[i]) / m.ds - 1) < 0.01);
    }
  });

  test(`${def.id}: ribbon edges and barrier rings do not self-intersect`, () => {
    for (const d of [m.halfWidth, -m.halfWidth, wo, -wo]) {
      assert.equal(countSelfIntersections(ring(m, d)), 0, `ring d=${d}`);
    }
  });

  test(`${def.id}: min radius >= max(1.15*halfWidth, 1.05*wallOffset)`, () => {
    const need = Math.max(1.15 * m.halfWidth, 1.05 * wo);
    const r = minRadius(m);
    assert.ok(r.radius >= need, `min radius ${r.radius.toFixed(1)} at s=${r.s.toFixed(0)} < ${need.toFixed(1)}`);
  });

  test(`${def.id}: start/finish straight |k| < 1/600 on s in [-185, +25]`, () => {
    assert.ok(maxAbsCurvature(m, -185, 25) < 1 / 600);
  });

  test(`${def.id}: non-adjacent sections keep >= 2*wallOffset+6 apart`, () => {
    const sep = minSeparation(m, 150);
    assert.ok(sep.dist >= 2 * wo + 6, `separation ${sep.dist.toFixed(1)} at s=${sep.s1.toFixed(0)}/${sep.s2.toFixed(0)}`);
  });

  test(`${def.id}: model is flat data only (finite arrays)`, () => {
    for (const a of [m.x, m.y, m.tx, m.ty, m.nx, m.ny, m.heading, m.curvature]) {
      assert.equal(a.length, m.N);
      assert.ok(a.every(Number.isFinite));
    }
  });
}

test('character: monte-veloce has a 1 km+ straight and fast corners', () => {
  const m = getTrackModel('monte-veloce');
  assert.ok(m.stats.longestStraight >= 1000, `longest straight ${m.stats.longestStraight}`);
  assert.ok(minRadius(m).radius >= 20.5);
});

test('character: ridgeback is technical with a hairpin (R >= 22) and 10+ corners', () => {
  const m = getTrackModel('ridgeback');
  const r = minRadius(m).radius;
  assert.ok(r >= 22 && r < 40, `hairpin radius ${r}`);
  assert.ok(m.stats.corners >= 10 && m.stats.corners <= 18, `corners ${m.stats.corners}`);
});

test('character: costa-marina has a long seafront straight and tight street corners', () => {
  const m = getTrackModel('costa-marina');
  assert.ok(m.stats.longestStraight >= 800, `longest straight ${m.stats.longestStraight}`);
  const r = minRadius(m).radius;
  assert.ok(r >= 14 && r < 45, `street corner radius ${r}`);
  assert.deepEqual(getTrackDef('costa-marina').theme.scenery, ['palms', 'buildings', 'grandstands']);
});

test('tracks differ in length ordering monte > costa > ridgeback', () => {
  const L = (id) => getTrackModel(id).length;
  assert.ok(L('monte-veloce') > L('costa-marina') && L('costa-marina') > L('ridgeback'));
});
