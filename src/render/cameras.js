// Camera rig: chase / cockpit (T-cam) / intro crane / finish orbit, with smooth blends. Pure maths exported for tests.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, angleDiff, wrapAngle, TAU } from './geomUtil.js';

export const CHASE = Object.freeze({ back: 7.5, up: 2.7, lookAhead: 6, lookUp: 0.9, rate: 6, fovBase: 60, fovPerSpeed: 0.14, fovMax: 80 });
export const COCKPIT = Object.freeze({ x: 0.08, y: 0.99, fov: 75 });

/** Exponential smoothing of an angle (shortest arc; safe across +-PI). */
export function smoothAngle(cur, target, rate, dt) {
  return wrapAngle(cur + angleDiff(target, cur) * (1 - Math.exp(-rate * dt)));
}
export function chaseFov(speed) {
  return Math.min(CHASE.fovMax, CHASE.fovBase + CHASE.fovPerSpeed * Math.max(0, speed));
}
/** Chase pose in WORLD coordinates. Car at sim (x,y) -> world (x,0,y); heading h -> forward (cos h, 0, sin h). */
export function chasePose(out, x, y, heading, back = CHASE.back, up = CHASE.up, lookAhead = CHASE.lookAhead) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.px = x - c * back;
  out.py = up;
  out.pz = y - s * back;
  out.lx = x + c * lookAhead;
  out.ly = CHASE.lookUp;
  out.lz = y + s * lookAhead;
  return out;
}
/** Offset in the car frame (forward f, right r, up u) -> world position. */
export function carFrameToWorld(out, x, y, heading, f, r, u) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.x = x + c * f - s * r;
  out.y = u;
  out.z = y + s * f + c * r;
  return out;
}

/** Thresholds for a camera "snap" (no smoothing). */
export const SNAP = Object.freeze({ maxSimJump: 0.75, maxWallDt: 0.5, baseDist: 8, speedDist: 110 });

/**
 * True when the followed car moved discontinuously between two camera updates (fastForward, restart, teleport, first frame):
 * sim time went backwards or jumped, wall dt was huge, or the car covered more ground than any real car could.
 * prev = { time, x, y } | null, cur = { time, x, y }.
 */
export function isDiscontinuity(prev, cur, wallDt = 0) {
  if (!prev) return true;
  if (!(Number.isFinite(cur.x) && Number.isFinite(cur.y))) return false; // garbage input is ignored elsewhere
  if (wallDt > SNAP.maxWallDt) return true;
  const dtSim = Number.isFinite(cur.time) && Number.isFinite(prev.time) ? cur.time - prev.time : 0;
  if (dtSim < -1e-6 || dtSim > SNAP.maxSimJump) return true;
  const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
  return d > SNAP.baseDist + SNAP.speedDist * Math.max(0, dtSim);
}

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.hs = 0; // smoothed heading
    this.hsInit = false;
    this.t = 0;
    this.orbit = 0;
    this.roll = 0;
    this.kick = 0; // impact shake (0..1), decays quickly
    this.trans = 0; // seconds of blend left
    this.transT = 0.35;
    this._phase = '';
    // scratch (no per-frame allocation)
    this._pose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0 };
    this._tp = new THREE.Vector3();
    this._tl = new THREE.Vector3();
    this._tq = new THREE.Quaternion();
    this._rq = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._fp = new THREE.Vector3();
    this._fq = new THREE.Quaternion();
    this._ff = 60;
    this._tf = 60;
    this._v = { x: 0, y: 0, z: 0 };
    this._lastFov = -1;
    this._hasPrev = false;
    this._prev = null; // { time, x, y } of the last followed pose (discontinuity detection)
  }

  /** Forget all smoothing/blend state: the next update() places the camera exactly on its target pose. */
  snap() {
    this.hsInit = false;
    this.trans = 0;
    this.orbit = 0;
    this.roll = 0;
    this._phase = '';
    this._hasPrev = false;
    this._prev = null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._beginBlend(0.35);
  }
  _beginBlend(T) {
    if (!this._hasPrev) return;
    this._fp.copy(this.camera.position);
    this._fq.copy(this.camera.quaternion);
    this._ff = this.camera.fov;
    this.trans = T;
    this.transT = T;
  }

  /** car: CarSnapshot of the followed car; phase: snapshot.phase; introT: 0..1; time: snapshot.time (sim seconds, optional) */
  update(dt, car, phase, introT, time) {
    this.kick *= Math.exp(-4.5 * dt);
    if (this.kick < 0.003) this.kick = 0;
    // never let NaN/Infinity reach the camera matrices (it would blank the whole view permanently)
    if (!car || !Number.isFinite(car.x) || !Number.isFinite(car.y) || !Number.isFinite(car.heading)) return;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    const cur = { time: time === undefined ? NaN : time, x: car.x, y: car.y };
    if (isDiscontinuity(this._prev, cur, dt)) this.snap();
    this._prev = cur;
    this.t += dt;
    const cam = this.camera;
    const tp = this._tp;
    const tl = this._tl;
    let fov;
    let roll = 0;
    const hd = car.heading;
    if (!this.hsInit) {
      this.hs = hd;
      this.hsInit = true;
    }
    const kind = phase === 'intro' ? 'intro' : phase === 'finished' ? 'orbit' : this.mode;
    if (kind !== this._phase) {
      // blend on phase-kind changes, except intro->chase which is continuous by construction
      if (!(this._phase === 'intro' && kind === 'chase')) this._beginBlend(this._phase === '' ? 0 : kind === 'orbit' ? 1.2 : 0.35);
      this._phase = kind;
    }
    const speed = car.speed || 0;

    if (kind === 'intro') {
      this.hs = hd;
      const e = smoothstep(0, 1, clamp(introT, 0, 1));
      const psi = lerp(Math.PI - 2.5, Math.PI, e); // azimuth around the car, PI = straight behind
      const r = lerp(70, CHASE.back, e);
      const h = lerp(32, CHASE.up, e);
      carFrameToWorld(this._v, car.x, car.y, hd, r * Math.cos(psi), r * Math.sin(psi), h);
      tp.set(this._v.x, this._v.y, this._v.z);
      const la = lerp(25, CHASE.lookAhead, e);
      tl.set(car.x + Math.cos(hd) * la, lerp(0.5, CHASE.lookUp, e), car.y + Math.sin(hd) * la);
      fov = lerp(48, chaseFov(0), e);
    } else if (kind === 'orbit') {
      this.orbit += dt * 0.32;
      const a = hd + Math.PI + this.orbit;
      tp.set(car.x + Math.cos(a) * 13, 4.2, car.y + Math.sin(a) * 13);
      tl.set(car.x, 0.7, car.y);
      fov = 52;
      this.hs = smoothAngle(this.hs, hd, CHASE.rate, dt);
    } else if (kind === 'cockpit') {
      this.hs = hd;
      const lean = clamp(car.steerAngle || 0, -0.5, 0.5) * 0.1;
      carFrameToWorld(this._v, car.x, car.y, hd, COCKPIT.x, 0, COCKPIT.y);
      tp.set(this._v.x, this._v.y, this._v.z);
      const yaw = hd + lean;
      tl.set(tp.x + Math.cos(yaw) * 30, COCKPIT.y - 0.15, tp.z + Math.sin(yaw) * 30);
      const rr = clamp(-(car.ay || 0) * 0.0016, -0.05, 0.05);
      this.roll += (rr - this.roll) * Math.min(1, dt * 8);
      roll = this.roll;
      fov = COCKPIT.fov + Math.min(8, speed * 0.04);
    } else {
      this.hs = smoothAngle(this.hs, hd, CHASE.rate, dt);
      chasePose(this._pose, car.x, car.y, this.hs);
      const p = this._pose;
      tp.set(p.px, p.py, p.pz);
      tl.set(p.lx, p.ly, p.lz);
      fov = chaseFov(speed);
    }

    // shake: kerb / grass / contact / speed vibration
    const surf = car.surface;
    const sAmp = surf === 'grass' ? 0.06 : surf === 'kerb' ? 0.025 : 0;
    const amp = (sAmp * Math.min(1, speed / 40) + (car.contact || 0) * 0.14 + this.kick * 0.45 + 0.003 * Math.min(1, speed / 90)) * (kind === 'cockpit' ? 0.5 : 1);
    if (amp > 1e-4 && kind !== 'intro') {
      const t = this.t;
      tp.x += amp * (Math.sin(t * 53.1) + Math.sin(t * 31.7 + 1.3)) * 0.5;
      tp.y += amp * (Math.sin(t * 61.7 + 0.4) + Math.sin(t * 37.9)) * 0.5;
      tp.z += amp * (Math.sin(t * 47.3 + 2.1) + Math.sin(t * 29.3)) * 0.5;
    }

    // target orientation
    this._m.lookAt(tp, tl, UP);
    this._tq.setFromRotationMatrix(this._m);
    if (roll !== 0) {
      this._rq.setFromAxisAngle(Z_AXIS, roll);
      this._tq.multiply(this._rq);
    }

    if (this.trans > 0) {
      this.trans = Math.max(0, this.trans - dt);
      const k = smoothstep(0, 1, 1 - this.trans / this.transT);
      cam.position.lerpVectors(this._fp, tp, k);
      cam.quaternion.slerpQuaternions(this._fq, this._tq, k);
      fov = lerp(this._ff, fov, k);
    } else {
      cam.position.copy(tp);
      cam.quaternion.copy(this._tq);
    }
    if (Math.abs(fov - this._lastFov) > 0.02) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this._lastFov = fov;
    }
    this._hasPrev = true;
  }
}
