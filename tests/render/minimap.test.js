import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMapTransform, mapX, mapY } from '../../src/render/minimap.js';
import { TRACKS, getTrackModel } from '../../src/data/tracks/index.js';

test('computeMapTransform fits the bbox uniformly and centres it, north-up (y down)', () => {
  const t = computeMapTransform({ minX: -100, maxX: 100, minY: -50, maxY: 50 }, 200, 200, 10);
  assert.ok(Math.abs(t.scale - 0.9) < 1e-9);
  assert.ok(Math.abs(mapX(t, -100) - 10) < 1e-9 && Math.abs(mapX(t, 100) - 190) < 1e-9);
  assert.ok(Math.abs(mapY(t, -50) - 55) < 1e-9 && Math.abs(mapY(t, 50) - 145) < 1e-9);
  assert.ok(mapY(t, 10) > mapY(t, -10), 'sim +y (south) is down the canvas');
});

test('every track fits inside its map box', () => {
  for (const d of TRACKS) {
    const m = getTrackModel(d.id);
    const t = computeMapTransform(m.bbox, 200, 200, 14);
    for (const [x, y] of [[m.bbox.minX, m.bbox.minY], [m.bbox.maxX, m.bbox.maxY]]) {
      assert.ok(mapX(t, x) >= 13.9 && mapX(t, x) <= 186.1);
      assert.ok(mapY(t, y) >= 13.9 && mapY(t, y) <= 186.1);
    }
  }
});
