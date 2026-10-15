// Pure framing maths for the preview scenes (no three.js dependency; unit-tested).
// "tan space": for a pinhole camera, a camera-space point (x, y, z<0 forward) maps to u = x / -z, v = y / -z.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Project a world point into tan space for a camera at `pos` looking at `target` (world up = +Y). null if behind the camera. */
export function projectTan(p, pos, target) {
  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, pos);
  const z = dot(d, f);
  if (z < 0.2) return null;
  return [dot(d, r) / z, dot(d, u) / z];
}

/** Axis-aligned box corners {min:[x,y,z], max:[x,y,z]} rotated about +Y by `a` (radians) around the origin. */
export function boxCorners(box, a = 0) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) out.push([c * x + s * z, y, -s * x + c * z]);
    }
  }
  return out;
}

/**
 * Union of the tan-space extents of `pointSets` (arrays of world points) seen from every camera position in `cams`.
 * Returns { uMin, uMax, vMin, vMax }.
 */
export function sweepExtents(pointSets, cams, target) {
  const e = { uMin: Infinity, uMax: -Infinity, vMin: Infinity, vMax: -Infinity };
  for (const cam of cams) {
    for (const pts of pointSets) {
      for (const p of pts) {
        const t = projectTan(p, cam, target);
        if (!t) continue;
        if (t[0] < e.uMin) e.uMin = t[0];
        if (t[0] > e.uMax) e.uMax = t[0];
        if (t[1] < e.vMin) e.vMin = t[1];
        if (t[1] > e.vMax) e.vMax = t[1];
      }
    }
  }
  if (!Number.isFinite(e.uMin)) return { uMin: -0.3, uMax: 0.3, vMin: -0.2, vMax: 0.2 };
  return e;
}

/**
 * Solve the camera zoom + principal-point shift so that extents `e` fit centred inside the free rectangle of a W x H canvas.
 * pad = { left, right, top, bottom } px, margin = fraction of the free rectangle the subject may fill (0..1).
 * Returns { fov (vertical, degrees), f (focal length px), offsetX, offsetY (for camera.setViewOffset(W, H, offsetX, offsetY, W, H)), free: {x,y,w,h} }.
 */
export function solveFraming(e, W, H, pad = {}, margin = 0.85) {
  const l = Math.max(0, pad.left || 0);
  const r = Math.max(0, pad.right || 0);
  const t = Math.max(0, pad.top || 0);
  const b = Math.max(0, pad.bottom || 0);
  // never let the free area collapse (huge paddings on tiny canvases)
  let fw = W - l - r;
  let fh = H - t - b;
  let x0 = l;
  let y0 = t;
  // keep the free rectangle's CENTRE when it is widened (a short gap between two panels on a phone must still hold the car there,
  // not drag it to the middle of the canvas behind a panel); only shift it back inside the canvas
  const minW = W * 0.12, minH = H * 0.12;
  if (fw < minW) { const c = x0 + fw / 2; fw = minW; x0 = Math.min(W - fw, Math.max(0, c - fw / 2)); }
  if (fh < minH) { const c = y0 + fh / 2; fh = minH; y0 = Math.min(H - fh, Math.max(0, c - fh / 2)); }
  const su = Math.max(1e-4, e.uMax - e.uMin);
  const sv = Math.max(1e-4, e.vMax - e.vMin);
  let f = Math.min((fw * margin) / su, (fh * margin) / sv);
  let fov = (2 * Math.atan(H / (2 * f)) * 180) / Math.PI;
  fov = Math.min(110, Math.max(4, fov));
  f = H / (2 * Math.tan((fov * Math.PI) / 360));
  // put the extent centre on the free-rect centre: axis pixel = centre - f * mid (u right, v up; screen y down)
  const cx = x0 + fw / 2;
  const cy = y0 + fh / 2;
  const axisX = cx - f * (e.uMin + e.uMax) * 0.5;
  const axisY = cy + f * (e.vMin + e.vMax) * 0.5;
  return { fov, f, offsetX: W / 2 - axisX, offsetY: H / 2 - axisY, free: { x: x0, y: y0, w: fw, h: fh } };
}
