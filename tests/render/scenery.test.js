import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACKS, getTrackModel } from '../../src/data/tracks/index.js';
import { buildScenery } from '../../src/render/scenery.js';

for (const def of TRACKS) {
  for (const quality of ['high', 'low']) {
    test(`scenery ${def.id}/${quality}: nothing within wallOffset+6 of any centreline sample`, () => {
      const model = getTrackModel(def.id);
      const g = buildScenery(model, def, { quality });
      const min = model.wallOffset + 6;
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      let total = 0;
      // coarse grid of centreline samples for speed
      for (const im of g.userData.instanced) {
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, m);
          v.setFromMatrixPosition(m);
          total++;
          let best = Infinity;
          for (let i = 0; i < model.N; i++) {
            const d = Math.hypot(v.x - model.x[i], v.z - model.y[i]);
            if (d < best) best = d;
          }
          assert.ok(best >= min, `${im.name}[${k}] at ${best.toFixed(2)} m (< ${min})`);
        }
      }
      assert.ok(total > 50);
      g.userData.dispose();
    });
  }
}

test('quality low places fewer instances', () => {
  const def = TRACKS[0];
  const model = getTrackModel(def.id);
  const hi = buildScenery(model, def, { quality: 'high' });
  const lo = buildScenery(model, def, { quality: 'low' });
  const sum = (g) => Object.values(g.userData.counts).reduce((a, b) => a + b, 0);
  assert.ok(sum(lo) < sum(hi) * 0.7);
});

test('scenery is deterministic for a seed', () => {
  const def = TRACKS[1];
  const model = getTrackModel(def.id);
  const a = buildScenery(model, def, {});
  const b = buildScenery(model, def, {});
  assert.deepEqual(a.userData.counts, b.userData.counts);
});
