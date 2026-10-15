import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackModel, getReferenceSpeed } from '../../src/core/trackModel.js';
import { TRACKS } from '../../src/data/tracks/index.js';
import { wrapAngle } from '../../src/core/mathUtil.js';

function circleDef(R = 200, n = 48, cw = true, extra = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (cw ? 1 : -1) * ((2 * Math.PI * i) / n);
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return { id: 'circle', controlPoints: pts, width: 12, runoff: 8, kerbWidth: 1.4, referenceLapTime: 60, ...extra };
}

test('closed loop with uniform spacing', () => {
  const m = buildTrackModel(circleDef());
  assert.ok(Math.abs(m.length - 2 * Math.PI * 200) / m.length < 0.005);
  assert.equal(m.N, Math.round(m.length / 2));
  assert.ok(Math.abs(m.ds - 2) < 0.05);
  for (let i = 0; i < m.N; i++) {
    const j = (i + 1) % m.N; // includes the wrap pair last->first
    const d = Math.hypot(m.x[j] - m.x[i], m.y[j] - m.y[i]);
    assert.ok(Math.abs(d / m.ds - 1) < 0.01, `gap ${i}: ${d}`);
  }
  assert.ok(Math.abs(Math.hypot(m.x[0] - m.x[m.N - 1], m.y[0] - m.y[m.N - 1]) - m.ds) < 0.02 * m.ds);
});

test('unit tangents/normals; right normal = (-ty, tx); heading = atan2', () => {
  const m = buildTrackModel(circleDef());
  for (let i = 0; i < m.N; i += 7) {
    assert.ok(Math.abs(Math.hypot(m.tx[i], m.ty[i]) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(m.nx[i], m.ny[i]) - 1) < 1e-9);
    assert.ok(Math.abs(m.nx[i] + m.ty[i]) < 1e-12 && Math.abs(m.ny[i] - m.tx[i]) < 1e-12);
    assert.ok(Math.abs(wrapAngle(m.heading[i] - Math.atan2(m.ty[i], m.tx[i]))) < 1e-12);
    assert.ok(Math.abs(m.tx[i] * m.nx[i] + m.ty[i] * m.ny[i]) < 1e-12);
  }
});

test('curvature sign: clockwise (heading increasing) is positive, magnitude 1/R', () => {
  const cw = buildTrackModel(circleDef(200, 48, true));
  const ccw = buildTrackModel(circleDef(200, 48, false));
  for (let i = 0; i < cw.N; i += 5) {
    assert.ok(Math.abs(cw.curvature[i] - 1 / 200) < 0.015 / 200, `cw ${cw.curvature[i]}`);
    assert.ok(Math.abs(ccw.curvature[i] + 1 / 200) < 0.015 / 200, `ccw ${ccw.curvature[i]}`);
  }
  // turning right => right normal points to the centre for a clockwise loop
  const i = 10;
  const toCentreX = -cw.x[i];
  const toCentreY = -cw.y[i];
  assert.ok(toCentreX * cw.nx[i] + toCentreY * cw.ny[i] > 0);
});

test('wrapS / sampleAt / offsetPoint', () => {
  const m = buildTrackModel(circleDef());
  assert.ok(Math.abs(m.wrapS(-1) - (m.length - 1)) < 1e-9);
  assert.ok(Math.abs(m.wrapS(m.length + 5) - 5) < 1e-9);
  const p0 = m.sampleAt(0);
  assert.equal(p0.index, 0);
  assert.ok(Math.abs(p0.x - m.x[0]) < 1e-12);
  const p = m.sampleAt(m.length * 3 + 10.7);
  assert.ok(Math.abs(p.s - 10.7) < 1e-6);
  assert.equal(p.index, Math.floor(10.7 / m.ds));
  const q = m.offsetPoint(10.7, 5);
  assert.ok(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - 5) < 1e-9);
  assert.ok(Math.abs((q.x - p.x) * p.nx + (q.y - p.y) * p.ny - 5) < 1e-9);
});

test('project(offsetPoint(s,d)) round-trips within 0.05 m (global and hinted)', () => {
  for (const def of [circleDef(), ...TRACKS]) {
    const m = buildTrackModel(def);
    for (let s = 3.3; s < m.length; s += m.length / 97) {
      for (const d of [-6, 0, 3.5]) {
        const p = m.offsetPoint(s, d);
        const g = m.project(p.x, p.y);
        const ds = Math.min(Math.abs(g.s - s), m.length - Math.abs(g.s - s));
        assert.ok(ds < 0.05, `${def.id} s=${s} d=${d} got s=${g.s}`);
        assert.ok(Math.abs(g.d - d) < 0.05, `${def.id} d=${d} got ${g.d}`);
        assert.ok(Math.abs(g.dist - Math.abs(d)) < 0.05);
        const h = m.project(p.x, p.y, Math.floor(s / m.ds) - 20);
        assert.ok(Math.abs(h.s - g.s) < 1e-6 || Math.abs(Math.abs(h.s - g.s) - m.length) < 1e-6);
        assert.ok(Math.abs(h.d - g.d) < 1e-6);
        assert.equal(g.index, Math.floor(g.s / m.ds) % m.N);
      }
    }
  }
});

test('project: sign of d is positive to the right; hint falls back to global when far off', () => {
  const m = buildTrackModel(circleDef());
  const right = m.offsetPoint(100, 4);
  assert.ok(m.project(right.x, right.y).d > 3.9);
  const left = m.offsetPoint(100, -4);
  assert.ok(m.project(left.x, left.y).d < -3.9);
  // wrong hint on the opposite side of the circle: |d| from the hinted window is huge -> global search
  const far = m.project(right.x, right.y, Math.floor(m.N / 2));
  assert.ok(Math.abs(far.s - 100) < 0.1 && Math.abs(far.d - 4) < 0.05);
});

test('project handles the start/finish wrap', () => {
  const m = buildTrackModel(circleDef());
  const p = m.offsetPoint(m.length - 0.3, 2);
  const r = m.project(p.x, p.y);
  assert.ok(r.s > m.length - 0.5 || r.s < 0.1);
  assert.ok(r.s >= 0 && r.s < m.length);
  const p2 = m.offsetPoint(0.4, 0);
  const r2 = m.project(p2.x, p2.y, m.N - 3);
  assert.ok(Math.abs(r2.s - 0.4) < 0.05);
});

test('surfaceAt thresholds', () => {
  const m = buildTrackModel(circleDef(200, 48, true, { width: 14, runoff: 10, kerbWidth: 1.4 }));
  assert.equal(m.halfWidth, 7);
  assert.equal(m.wallOffset, 17);
  assert.equal(m.surfaceAt(0), 'asphalt');
  assert.equal(m.surfaceAt(7), 'asphalt');
  assert.equal(m.surfaceAt(-7.2), 'kerb');
  assert.equal(m.surfaceAt(8.4), 'kerb');
  assert.equal(m.surfaceAt(8.5), 'grass');
  assert.equal(m.surfaceAt(16.9), 'grass');
  assert.equal(m.surfaceAt(17), 'wall');
  assert.equal(m.surfaceAt(-40), 'wall');
});

test('stats, bbox, reference speed', () => {
  const def = circleDef(100);
  const m = buildTrackModel(def);
  assert.equal(m.stats.length, m.length);
  assert.equal(m.stats.corners, 1);
  assert.equal(m.stats.longestStraight, 0);
  assert.ok(Math.abs(m.stats.avgCurvature - 1 / 100) < 0.0002);
  assert.ok(Math.abs(m.bbox.maxX - 100) < 1 && Math.abs(m.bbox.minY + 100) < 1);
  assert.ok(Math.abs(getReferenceSpeed(m, def) - m.length / 60) < 1e-9);
  assert.equal(m.id, 'circle');
});

test('degenerate input throws a clear error', () => {
  assert.throws(() => buildTrackModel({ id: 'x', controlPoints: [[0, 0], [1, 1]], width: 10, runoff: 5, kerbWidth: 1 }));
});
