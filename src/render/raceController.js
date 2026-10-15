// RaceController: SceneController for the race (track, scenery, sky, 20 cars, camera rig, shadows, effects).
import * as THREE from 'three';
import { getTeam } from '../data/teams.js';
import { buildTrackMesh } from './trackMesh.js';
import { buildScenery } from './scenery.js';
import { buildSky } from './sky.js';
import { buildCarModel, updateCarModel, disposeCarModel, setCarShadow } from './carModel.js';
import { CameraRig, carFrameToWorld } from './cameras.js';
import { ParticleSystem } from './particles.js';

const MODES = ['chase', 'cockpit'];
const CULL_DIST2 = 650 * 650;
const FX_DIST2 = 140 * 140;

export class RaceController {
  constructor({ trackDef, trackModel, carMetas, playerId, quality = 'high' }) {
    this.trackDef = trackDef;
    this.trackModel = trackModel;
    this.carMetas = carMetas;
    this.playerId = playerId;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 3500);
    this.rig = new CameraRig(this.camera);
    this.cameraMode = 'chase';
    this._lastSnapTime = -1;
    this._viewPx = 720;
    this.pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2) : 1;

    // sky + lights + fog
    const theme = (trackDef && trackDef.theme) || {};
    this.sky = buildSky(theme, { quality });
    this.scene.add(this.sky.mesh, this.sky.hemi, this.sky.sun, this.sky.sun.target);
    this.scene.fog = this.sky.fog;

    // track + scenery
    this.track = buildTrackMesh(trackModel, trackDef, { quality });
    this.scene.add(this.track);
    this.scenery = buildScenery(trackModel, trackDef, { quality });
    this.scene.add(this.scenery);

    // cars
    this.models = [];
    for (let i = 0; i < carMetas.length; i++) {
      const meta = carMetas[i];
      const team = getTeam(meta.teamId);
      let driverIdx = team.drivers.findIndex((d) => d.id === meta.driverId);
      if (driverIdx < 0) driverIdx = 0;
      const m = buildCarModel(team, { driverIdx, helmet: true, quality });
      m.name = `car${meta.id}`;
      m.userData.carId = meta.id;
      this.models[meta.id] = m;
      this.scene.add(m);
    }
    this.playerModel = this.models[playerId] || null;

    // effects
    this.fx = new ParticleSystem(quality === 'low' ? 90 : 200);
    this.scene.add(this.fx.points);
    this._acc = new Float32Array(32);
    this._v = { x: 0, y: 0, z: 0 };

    this._applyQuality();
    this.rig.setMode('chase');
  }

  // ---- SceneController
  resize(w, h) {
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._viewPx = h * this.pixelRatio;
  }
  onActivate() {}
  onDeactivate() {}

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : 2) : 1;
    this._applyQuality();
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
  }
  _applyQuality() {
    const hi = this.quality !== 'low';
    this.sky.setShadow(hi);
    this.track.userData.setShadowReceive(hi);
    if (this.playerModel) setCarShadow(this.playerModel, hi, !hi);
    this.sky.fog.far = hi ? 1100 : 700;
  }

  // ---- camera
  setCameraMode(mode) {
    if (!MODES.includes(mode)) return;
    this.cameraMode = mode;
    this.rig.setMode(mode);
    if (this.playerModel && this.playerModel.userData.helmet) this.playerModel.userData.helmet.visible = mode !== 'cockpit';
  }
  /** Drop camera smoothing so the next frame is placed exactly behind the car (call after teleports/restarts if needed). */
  snapCamera() {
    this.rig.snap();
  }
  getCameraMode() {
    return this.cameraMode;
  }
  cycleCamera() {
    this.setCameraMode(MODES[(MODES.indexOf(this.cameraMode) + 1) % MODES.length]);
    return this.cameraMode;
  }

  // ---- per frame
  update(dt, snap) {
    if (!snap || !snap.cars) return;
    const cars = snap.cars;
    // while paused the same snapshot is replayed: don't advance wheel spin / effects
    const sdt = snap.time === this._lastSnapTime ? 0 : dt;
    this._lastSnapTime = snap.time;
    const n = Math.min(cars.length, this.models.length);
    for (let i = 0; i < n; i++) {
      const m = this.models[i];
      if (m) updateCarModel(m, cars[i], sdt);
    }
    const player = cars[this.playerId];
    if (!player) return;
    this.rig.update(dt, player, snap.phase, snap.introT || 0, snap.time);
    const cp = this.camera.position;
    this.sky.update(cp, player.x, player.y);
    // distance culling (fog hides them anyway)
    for (let i = 0; i < n; i++) {
      const m = this.models[i];
      if (!m) continue;
      const dx = m.position.x - cp.x;
      const dz = m.position.z - cp.z;
      m.visible = dx * dx + dz * dz < CULL_DIST2;
    }
    if (sdt > 0) this._effects(sdt, cars, cp);
    const fovRad = (this.camera.fov * Math.PI) / 360;
    this.fx.update(dt, (this._viewPx * 0.5) / Math.tan(fovRad));
    this.track.userData.update(dt);
  }

  _effects(dt, cars, cp) {
    const fx = this.fx;
    const v = this._v;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const dx = c.x - cp.x;
      const dz = c.y - cp.z;
      if (dx * dx + dz * dz > FX_DIST2) continue;
      let rate = 0;
      let kind = 0;
      if (c.slip > 0.45 && c.speed > 6 && c.surface !== 'grass') {
        rate = (c.slip - 0.3) * 70;
      } else if (c.surface === 'grass' && c.speed > 10) {
        rate = c.speed * 0.5;
        kind = 1;
      }
      if (rate <= 0) {
        this._acc[i & 31] = 0;
        continue;
      }
      let a = this._acc[i & 31] + rate * dt;
      while (a >= 1) {
        a -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        carFrameToWorld(v, c.x, c.y, c.heading, -1.62, side * 0.8, 0.12);
        const bx = -Math.cos(c.heading) * c.speed * 0.15;
        const bz = -Math.sin(c.heading) * c.speed * 0.15;
        const j = () => (Math.random() - 0.5) * 1.2;
        if (kind === 0) fx.emit(v.x, v.y, v.z, bx * 0.4 + j(), 0.8 + Math.random() * 0.6, bz * 0.4 + j(), 0.9, 0.8, 3.0, 0.88, 0.88, 0.9, 0.45);
        else fx.emit(v.x, v.y, v.z, bx + j() * 2, 1.2 + Math.random() * 1.5, bz + j() * 2, 0.8, 0.7, 2.2, 0.42, 0.36, 0.24, 0.4);
      }
      this._acc[i & 31] = a;
    }
  }

  getCarModel(id) {
    return this.models[id] || null;
  }

  dispose() {
    this.track.userData.dispose();
    this.scenery.userData.dispose();
    this.sky.dispose();
    this.fx.dispose();
    this.models.forEach((m) => m && disposeCarModel(m));
    this.scene.clear();
    this.models = [];
  }
}
