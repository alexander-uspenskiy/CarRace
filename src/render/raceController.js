// RaceController: SceneController for the race (track, scenery, sky, 20 cars, camera rig, shadows, effects).
import * as THREE from 'three';
import { getTeam } from '../data/teams.js';
import { buildTrackMesh } from './trackMesh.js';
import { buildScenery } from './scenery.js';
import { buildSky } from './sky.js';
import { buildRain } from './rain.js';
import { themeForWeather } from '../data/weather.js';
import { buildCarModel, updateCarModel, disposeCarModel, setCarShadow } from './carModel.js';
import { CameraRig, carFrameToWorld } from './cameras.js';
import { ParticleSystem } from './particles.js';

const MODES = ['chase', 'cockpit'];
const CULL_DIST2 = 650 * 650;
const FX_DIST2 = 140 * 140;

export class RaceController {
  constructor({ trackDef: baseDef, trackModel, carMetas, playerId, quality = 'high', weather = 'clear' }) {
    // the weather re-tints the circuit's theme (greyer sky / fog, damp asphalt and grass) for every renderer below
    const trackDef = baseDef ? { ...baseDef, theme: themeForWeather(baseDef.theme, weather) } : baseDef;
    this.weather = weather;
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
    this.rain = theme.weather && theme.weather.rain > 0 ? buildRain({ quality, intensity: theme.weather.rain }) : null;
    if (this.rain) this.scene.add(this.rain.mesh);

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
    this._dmgAcc = new Float32Array(32);
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
    this.sky.fog.far = Math.min(this.sky.weatherFogFar, hi ? 1100 : 700);
    if (this.rain) this.rain.setQuality(hi);
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
    this.sky.update(cp, player.x, player.y, snap.time);
    if (this.rain) this.rain.update(cp, snap.time);
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
      // a damaged car smokes (grey, then black and thick when it is badly hurt) and sheds the odd spark
      if (c.damage > 0.2 && c.speed > 3) {
        const heavy = c.damage > 0.55;
        const dr = (c.damage - 0.1) * (heavy ? 26 : 14);
        const da = (this._dmgAcc[i & 31] || 0) + dr * dt;
        const n = Math.floor(da);
        this._dmgAcc[i & 31] = da - n;
        for (let q = 0; q < n; q++) {
          carFrameToWorld(v, c.x, c.y, c.heading, 0.8, (Math.random() - 0.5) * 0.5, 0.55);
          const g = heavy ? 0.1 : 0.5;
          fx.emit(v.x, v.y, v.z, (Math.random() - 0.5) * 0.8, 1.2 + Math.random(), (Math.random() - 0.5) * 0.8, 1.0, 0.7, 2.6, g, g, g + 0.03, heavy ? 0.7 : 0.45);
        }
      }
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

  /**
   * Crash effects at sim position (x, y): a burst of sparks, flying debris and a smoke puff, plus a camera kick if it is near
   * the player. strength: closing / impact speed in m/s.
   */
  impactFx(x, y, strength, near = true) {
    const fx = this.fx;
    const k = Math.min(1, Math.max(0, strength - 1) / 25);
    if (k <= 0) return;
    const sparks = Math.round(6 + 26 * k), bits = Math.round(2 + 10 * k), puff = Math.round(2 + 6 * k);
    const r = (a) => (Math.random() - 0.5) * a;
    for (let i = 0; i < sparks; i++) {
      const sp = 4 + Math.random() * (8 + 14 * k);
      const ang = Math.random() * Math.PI * 2;
      fx.emit(x, 0.45, y, Math.cos(ang) * sp, 2 + Math.random() * 5, Math.sin(ang) * sp, 0.25 + Math.random() * 0.35, 0.28, -0.3, 1, 0.78 + Math.random() * 0.2, 0.25, 1);
    }
    for (let i = 0; i < bits; i++) {   // carbon debris
      const sp = 3 + Math.random() * (5 + 10 * k);
      const ang = Math.random() * Math.PI * 2;
      fx.emit(x, 0.5, y, Math.cos(ang) * sp, 3 + Math.random() * 6, Math.sin(ang) * sp, 0.9 + Math.random() * 0.8, 0.45, 0, 0.08, 0.08, 0.09, 0.95);
    }
    for (let i = 0; i < puff; i++) {
      fx.emit(x + r(1.4), 0.4, y + r(1.4), r(3), 0.9 + Math.random() * 1.2, r(3), 1.1 + Math.random() * 0.7, 1.3, 3.8, 0.62, 0.62, 0.66, 0.5);
    }
    if (near) this.rig.kick = Math.max(this.rig.kick, Math.min(1, 0.25 + k));
  }

  getCarModel(id) {
    return this.models[id] || null;
  }

  dispose() {
    this.track.userData.dispose();
    this.scenery.userData.dispose();
    this.sky.dispose();
    if (this.rain) this.rain.dispose();
    this.fx.dispose();
    this.models.forEach((m) => m && disposeCarModel(m));
    this.scene.clear();
    this.models = [];
  }
}
