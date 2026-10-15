import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACKS, getTrackModel } from '../../src/data/tracks/index.js';
import { buildTrackMesh, findCornerRuns, gridSlotPose, GRID_SLOTS, computeLandMargins } from '../../src/render/trackMesh.js';
import { eachTriangle } from './_util.js';

for (const def of TRACKS) {
  test(`trackMesh ${def.id}: builds, sane counts, ribbon at +-halfWidth with +Y normals`, () => {
    const model = getTrackModel(def.id);
    const g = buildTrackMesh(model, def, { quality: 'high' });
    const ud = g.userData;
    assert.equal(typeof ud.dispose, 'function');
    const meshes = [];
    g.traverse((o) => o.isMesh && meshes.push(o));
    assert.ok(meshes.length >= 8 && meshes.length <= 14, `meshes ${meshes.length}`);
    for (const k of ['asphalt', 'kerbs', 'barriers', 'startLine', 'gridBoxes', 'gantry', 'ground']) assert.ok(ud.meshes[k], k);
    assert.ok(ud.stats.triangles > 5000 && ud.stats.triangles < 250000, `tris ${ud.stats.triangles}`);

    const asphalt = ud.meshes.asphalt.geometry;
    const p = asphalt.attributes.position;
    const hw = model.halfWidth;
    // vertices alternate L,R per row: row i -> index 2i, 2i+1
    for (let i = 0; i < model.N; i += 17) {
      const L = new THREE.Vector3().fromBufferAttribute(p, 2 * i);
      const R = new THREE.Vector3().fromBufferAttribute(p, 2 * i + 1);
      const dl = (L.x - model.x[i]) * model.nx[i] + (L.z - model.y[i]) * model.ny[i];
      const dr = (R.x - model.x[i]) * model.nx[i] + (R.z - model.y[i]) * model.ny[i];
      assert.ok(Math.abs(dl + hw) < 1e-3, `left edge ${dl}`);
      assert.ok(Math.abs(dr - hw) < 1e-3, `right edge ${dr}`);
    }
    let bad = 0;
    let tri = 0;
    eachTriangle(asphalt, (A, B, C, n, len) => {
      if (len < 1e-9) return;
      tri++;
      if (n.y < 0.999) bad++;
    });
    assert.ok(tri >= model.N * 2);
    assert.equal(bad, 0, 'all asphalt triangles must face +Y');

    // barriers: wall normals face the track
    const bar = ud.meshes.barriers.geometry;
    const pos = bar.attributes.position;
    const nor = bar.attributes.normal;
    let wrong = 0;
    let checked = 0;
    for (let i = 0; i < pos.count; i += 4 * 37) {
      if (Math.abs(nor.getY(i)) > 0.5) continue; // top caps
      // distance from centreline of the vertex along the normal direction should shrink
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const proj = model.project(x, z);
      const inward = new THREE.Vector3(nor.getX(i), 0, nor.getZ(i));
      const toCentre = new THREE.Vector3(model.x[proj.index] - x, 0, model.y[proj.index] - z);
      if (toCentre.length() < 8) continue; // ad-board posts etc.
      if (Math.abs(proj.d) < model.wallOffset - 0.5 || Math.abs(proj.d) > model.wallOffset + 0.6) continue;
      checked++;
      if (inward.dot(toCentre) <= 0) wrong++;
    }
    assert.ok(checked > 5);
    assert.equal(wrong, 0, 'barrier faces must look at the track');
    for (const m of meshes) {
      const a = m.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 211) assert.ok(Number.isFinite(a[i]));
    }
    ud.dispose();
  });

  test(`trackMesh ${def.id}: grid boxes lie on the start straight, corner runs found`, () => {
    const model = getTrackModel(def.id);
    for (let slot = 0; slot < GRID_SLOTS; slot++) {
      const gp = gridSlotPose(model, slot);
      const pr = model.project(gp.x, gp.y);
      assert.ok(Math.abs(Math.abs(pr.d) - 2.5) < 0.05, `slot ${slot} d=${pr.d}`);
      assert.equal(Math.sign(pr.d), slot % 2 === 0 ? -1 : 1);
    }
    const runs = findCornerRuns(model);
    assert.ok(runs.length >= 3);
    for (const r of runs) assert.ok(r.count >= 1 && r.i0 >= 0 && r.i0 < model.N);
  });
}

test('computeLandMargins keeps land beyond the walls (capped by local curvature radius)', () => {
  const def = TRACKS.find((t) => t.id === 'costa-marina');
  const model = getTrackModel(def.id);
  const m = computeLandMargins(model, def);
  for (let i = 0; i < model.N; i += 7) {
    assert.ok(m.left[i] >= model.wallOffset + 1.9);
    assert.ok(m.right[i] >= model.wallOffset + 1.9);
  }
});

for (const def of TRACKS) {
  test(`trackMesh ${def.id}: ground / sea / infield / runoff / gravel / kerb / start-line triangles face +Y`, () => {
    const model = getTrackModel(def.id);
    const g = buildTrackMesh(model, def, {});
    for (const name of ['ground', 'water', 'beach', 'runoff', 'gravel', 'kerbs', 'startLine', 'gridBoxes']) {
      const m = g.userData.meshes[name];
      if (!m) continue;
      let bad = 0;
      let n = 0;
      eachTriangle(m.geometry, (A, B, C, nrm, len) => {
        if (len < 1e-9) return;
        n++;
        // beach strips are sloped, everything else is flat
        if (nrm.y < (name === 'beach' ? 0.5 : 0.999)) bad++;
      });
      assert.ok(n > 0, name);
      // the land ribbon of a water theme folds on tight inside corners (culled, the infield polygon covers it)
      const tol = g.userData.meshes.water && (name === 'ground' || name === 'beach') ? 0.12 : 0;
      assert.ok(bad <= n * tol, `${name}: ${bad}/${n} triangles face away from +Y`);
    }
    g.userData.dispose();
  });
}
