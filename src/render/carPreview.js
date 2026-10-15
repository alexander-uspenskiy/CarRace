// CarPreviewController: studio turntable for team select / garage and a podium scene for the results screen.
import * as THREE from 'three';
import { getTeam } from '../data/teams.js';
import { buildCarModel, disposeCarModel, setCarShadow } from './carModel.js';
import { createGradientTexture, createRadialTexture, createPlateTexture } from './textures.js';
import { TEAMS } from '../data/teams.js';
import { boxCorners, sweepExtents, solveFraming } from './framing.js';

const DRAG_SENS = 0.012;
const TEAM_CAM = Object.freeze({ x: 6.4, y: 2.1, z: 7.2, bob: 0.1, ty: 0.45, margin: 0.8 });
const PODIUM_CAM = Object.freeze({ r: 15.5, y: 3.6, bob: 0.25, sway: 0.75, ty: 1.3, margin: 0.9 });
const MEDAL = { 1: 0xf5c542, 2: 0xc3c9d4, 3: 0xcd8a45 };

export class CarPreviewController {
  constructor({ quality = 'high' } = {}) {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
    this.camera.position.set(6.4, 2.1, 7.2);
    this.camera.lookAt(0, 0.45, 0);
    this.mode = 'team';
    this.spin = true;
    this.t = 0;
    this.dragHold = 0;
    this._tex = [];
    this._cache = new Map();
    this._podiumCars = [];
    this._podiumObjs = [];
    this._w = 1280;
    this._h = 720;
    this._pad = { left: 0, right: 0, top: 0, bottom: 0 };
    this._ext = null; // tan-space extents of the current subject over its whole camera path
    this._extMargin = TEAM_CAM.margin;
    this._ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const bgTex = createGradientTexture('#0d1017', '#232a3a');
    if (bgTex) {
      this._tex.push(bgTex);
      this.scene.background = bgTex;
    } else {
      this.scene.background = new THREE.Color('#1a1f2b');
    }
    this.scene.fog = new THREE.Fog(0x14171f, 18, 50);

    // lights: key + fill + rim + hemisphere
    this.scene.add(new THREE.HemisphereLight(0xbfd2ff, 0x1a1c22, 1.2));
    const key = new THREE.DirectionalLight(0xfff3e0, 3.2);
    key.position.set(6, 9, 7);
    const rim = new THREE.DirectionalLight(0x9bb8ff, 2.0);
    rim.position.set(-8, 4, -6);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-6, 3, 8);
    this.scene.add(key, rim, fill);
    // podium-only spotlight (gold-ish, from above/front)
    this._spot = new THREE.SpotLight(0xffe6b0, 6, 0, 0.62, 0.55, 0);
    this._spot.position.set(0, 14, 9);
    this._spot.target.position.set(0, 1, 0);
    this._spot.visible = false;
    this.scene.add(this._spot, this._spot.target);

    // studio floor
    this.studio = new THREE.Group();
    this.scene.add(this.studio);
    const floorTex = createRadialTexture('rgba(90,100,125,1)', 'rgba(20,23,31,1)', 256);
    if (floorTex) this._tex.push(floorTex);
    this._floorMat = new THREE.MeshStandardMaterial({ color: floorTex ? 0xffffff : 0x2a2f3c, map: floorTex || null, roughness: 0.55, metalness: 0.4 });
    this._floorGeo = new THREE.CircleGeometry(40, 64);
    this._floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(this._floorGeo, this._floorMat);
    floor.position.y = -0.002;
    this.studio.add(floor);
    this._ringGeo = new THREE.TorusGeometry(4.2, 0.03, 8, 96);
    this._ringGeo.rotateX(Math.PI / 2);
    this.ring = new THREE.Mesh(this._ringGeo, this._ringMat);
    this.ring.position.y = 0.02;
    this.studio.add(this.ring);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.podium = new THREE.Group();
    this.podium.visible = false;
    this.scene.add(this.podium);
    this.current = null;
  }

  _carFor(teamId, driverIdx) {
    const key = `${teamId}:${driverIdx}`;
    let m = this._cache.get(key);
    if (!m) {
      const team = getTeam(teamId);
      m = buildCarModel(team, { driverIdx, helmet: true, quality: this.quality });
      setCarShadow(m, false, true);
      // local bounding box (car detached, identity pose) used to fit the camera for any turntable angle
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      m.userData.previewBox = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
      this._cache.set(key, m);
    }
    return m;
  }

  showTeam(teamId, driverIdx = 0) {
    this.mode = 'team';
    this._clearPodium();
    this.podium.visible = false;
    this.studio.visible = true;
    this.turntable.visible = true;
    this._spot.visible = false;
    this.ring.scale.setScalar(1);
    if (this.current) this.turntable.remove(this.current);
    const m = this._carFor(teamId || TEAMS[0].id, driverIdx);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    // shift so that the visual centre (not the CG) sits at the turntable axis
    m.position.x = -0.45;
    this.turntable.add(m);
    this.current = m;
    const team = getTeam(teamId) || TEAMS[0];
    this._ringMat.color.set(team.livery.primary);
    this.turntable.rotation.y = this.turntable.rotation.y || 0.6;
    this.camera.position.set(TEAM_CAM.x, TEAM_CAM.y, TEAM_CAM.z);
    this.camera.lookAt(0, TEAM_CAM.ty, 0);
    this._fitTeam(m.userData.previewBox);
  }

  /** Whole car (incl. wings) at any turntable angle, over the camera bob. */
  _fitTeam(box) {
    const bx = box || { min: [-2.35, 0, -1.02], max: [3.3, 1.2, 1.02] };
    const shifted = { min: [bx.min[0] - 0.45, bx.min[1], bx.min[2]], max: [bx.max[0] - 0.45, bx.max[1], bx.max[2]] };
    const sets = [];
    for (let i = 0; i < 24; i++) sets.push(boxCorners(shifted, (i / 24) * Math.PI * 2));
    const cams = [-1, 0, 1].map((k) => [TEAM_CAM.x, TEAM_CAM.y + k * TEAM_CAM.bob, TEAM_CAM.z]);
    this._ext = sweepExtents(sets, cams, [0, TEAM_CAM.ty, 0]);
    this._extMargin = TEAM_CAM.margin;
    this._applyFraming();
  }

  _fitPodium() {
    this.podium.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.podium);
    const box = b.isEmpty() ? { min: [-5.4, 0, -2.9], max: [5.4, 2.6, 2.9] } : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    const cams = [];
    for (let i = -10; i <= 10; i++) {
      const a = (i / 10) * PODIUM_CAM.sway;
      for (const k of [-1, 1]) cams.push([Math.sin(a) * PODIUM_CAM.r, PODIUM_CAM.y + k * PODIUM_CAM.bob, Math.cos(a) * PODIUM_CAM.r]);
    }
    this._ext = sweepExtents([boxCorners(box, 0)], cams, [0, PODIUM_CAM.ty, 0]);
    this._extMargin = PODIUM_CAM.margin;
    this._applyFraming();
  }

  /**
   * Fit the current subject into the free rectangle of the canvas (canvas minus padding): zoom via fov, centring via view offset.
   * Called on resize / setPadding / showTeam / showPodium; cheap.
   */
  _applyFraming() {
    if (!this._ext) return;
    const W = this._w;
    const H = this._h;
    const fr = solveFraming(this._ext, W, H, this._pad, this._extMargin);
    const cam = this.camera;
    cam.aspect = W / H;
    cam.fov = fr.fov;
    if (Math.abs(fr.offsetX) < 0.5 && Math.abs(fr.offsetY) < 0.5) cam.clearViewOffset();
    else cam.setViewOffset(W, H, fr.offsetX, fr.offsetY, W, H);
    cam.updateProjectionMatrix();
  }

  /**
   * Keep the car clear of UI panels. Values are CSS px measured from the canvas edges; the subject is fitted and centred in
   * [left, W-right] x [top, H-bottom]. setPadding() / setPadding(null) resets. Persists across showTeam/showPodium.
   */
  setPadding(p) {
    const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    this._pad = p ? { left: n(p.left), right: n(p.right), top: n(p.top), bottom: n(p.bottom) } : { left: 0, right: 0, top: 0, bottom: 0 };
    this._applyFraming();
  }
  getPadding() {
    return { ...this._pad };
  }

  setSpin(on) {
    this.spin = !!on;
  }

  showPodium(entries) {
    this.mode = 'podium';
    if (this.current) {
      this.turntable.remove(this.current);
      this.current = null;
    }
    this.turntable.visible = false;
    this.studio.visible = true;
    this._spot.visible = true;
    this.ring.scale.setScalar(1.6);
    this._ringMat.color.set('#f5c542');
    this._clearPodium();
    this.podium.visible = true;
    const spec = {
      1: { x: 0, h: 1.15, rot: 0 },
      2: { x: -3.7, h: 0.8, rot: 0.28 },
      3: { x: 3.7, h: 0.55, rot: -0.28 },
    };
    const stepGeo = new THREE.BoxGeometry(3.3, 1, 5.6);
    this._podiumObjs.push(stepGeo);
    const plateGeo = new THREE.PlaneGeometry(2.8, 1.0);
    this._podiumObjs.push(plateGeo);
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x555b69, roughness: 0.6, metalness: 0.2 });
    this._podiumObjs.push(stepMat);
    const capGeo = new THREE.BoxGeometry(3.3, 0.06, 5.6);
    this._podiumObjs.push(capGeo);
    const list = (entries || []).filter(Boolean).slice(0, 3).map((e, i) => ({ ...e, position: [1, 2, 3].includes(e.position) ? e.position : i + 1 }));
    const taken = new Set();
    for (const e of list) {
      // never stack two cars on one step (bad/duplicate positions): take the first free one
      if (taken.has(e.position)) e.position = [1, 2, 3].find((p) => !taken.has(p)) || 3;
      taken.add(e.position);
    }
    for (const e of list) {
      const sp = spec[e.position] || spec[3];
      const team = getTeam(e.teamId) || TEAMS[0];
      const capMat = new THREE.MeshStandardMaterial({ color: MEDAL[e.position], roughness: 0.3, metalness: 0.8 });
      this._podiumObjs.push(capMat);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(sp.x, sp.h + 0.03, 0);
      const step = new THREE.Mesh(stepGeo, stepMat);
      step.scale.y = sp.h;
      step.position.set(sp.x, sp.h / 2, 0);
      this.podium.add(step, cap);
      const plateTex = createPlateTexture(e.position, e.name, team.livery.primary);
      const plateMat = new THREE.MeshBasicMaterial({ map: plateTex || null, color: plateTex ? 0xffffff : new THREE.Color(team.livery.primary) });
      if (plateTex) this._podiumObjs.push(plateTex);
      this._podiumObjs.push(plateMat);
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(sp.x, sp.h * 0.5, 2.82);
      this.podium.add(plate);
      let driverIdx = Number.isInteger(e.driverIdx) ? e.driverIdx : 0;
      if (e.driverId) driverIdx = Math.max(0, team.drivers.findIndex((d) => d.id === e.driverId));
      const car = buildCarModel(team, { driverIdx, helmet: true, quality: this.quality });
      setCarShadow(car, false, true);
      car.position.set(sp.x, sp.h + 0.06, 0);
      car.rotation.y = -Math.PI / 2 + sp.rot;
      // +X forward -> faces +Z (towards the camera); shift back so the 5.65 m car is centred on the step
      car.position.z = -0.45;
      this.podium.add(car);
      this._podiumCars.push(car);
    }
    this._fitPodium();
  }

  _clearPodium() {
    for (const c of this._podiumCars) {
      this.podium.remove(c);
      disposeCarModel(c);
    }
    this._podiumCars.length = 0;
    this.podium.clear();
    for (const o of this._podiumObjs) o.dispose();
    this._podiumObjs.length = 0;
  }

  update(dt, data) {
    this.t += dt;
    if (this.mode === 'team') {
      const drag = data && data.pointerDragDelta ? data.pointerDragDelta : 0;
      if (drag) {
        this.turntable.rotation.y += drag * DRAG_SENS;
        this.dragHold = 1.2;
      }
      if (this.dragHold > 0) this.dragHold -= dt;
      else if (this.spin) this.turntable.rotation.y += dt * 0.35;
      // gentle idle bob of the camera
      this.camera.position.y = TEAM_CAM.y + Math.sin(this.t * 0.4) * TEAM_CAM.bob;
      this.camera.lookAt(0, TEAM_CAM.ty, 0);
    } else if (this.mode === 'podium') {
      const a = Math.sin(this.t * 0.25) * PODIUM_CAM.sway;
      const r = PODIUM_CAM.r;
      this.camera.position.set(Math.sin(a) * r, PODIUM_CAM.y + Math.sin(this.t * 0.31) * PODIUM_CAM.bob, Math.cos(a) * r);
      this.camera.lookAt(0, PODIUM_CAM.ty, 0);
    }
  }

  /** Canvas size in CSS px (RenderHost forwards it automatically). Re-fits the subject. */
  resize(w, h) {
    if (!(w > 0) || !(h > 0)) return;
    this._w = w;
    this._h = h;
    this._applyFraming();
  }
  setViewport(w, h) {
    this.resize(w, h);
  }
  onActivate() {}
  onDeactivate() {}
  setQuality(q) {
    this.quality = q;
  }

  dispose() {
    this._clearPodium();
    for (const m of this._cache.values()) disposeCarModel(m);
    this._cache.clear();
    this._spot.dispose();
    this._floorGeo.dispose();
    this._floorMat.dispose();
    this._ringGeo.dispose();
    this._ringMat.dispose();
    this._tex.forEach((t) => t.dispose());
    this.scene.clear();
  }
}
