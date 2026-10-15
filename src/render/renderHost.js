// Single WebGL context shared by all scene controllers (race, car preview).
import * as THREE from 'three';

export class RenderHost {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.controller = null;
    this._w = 0;
    this._h = 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x9fc4e8, 1);
    this._pr = this._pixelRatio();
    r.setPixelRatio(this._pr);
    this._onLost = (e) => e.preventDefault();
    canvas.addEventListener('webglcontextlost', this._onLost);
    this.resize();
  }

  _pixelRatio() {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return this.quality === 'low' ? 1 : Math.min(dpr, 2);
  }

  setController(ctrl) {
    if (this.controller === ctrl) return;
    if (this.controller && this.controller.onDeactivate) this.controller.onDeactivate();
    this.controller = ctrl || null;
    if (ctrl) {
      if (ctrl.onActivate) ctrl.onActivate();
      this._w = 0; // force resize propagation
      this.resize();
    }
  }

  render(dt, data) {
    const c = this.controller;
    if (!c) return;
    c.update(dt, data);
    this.renderer.render(c.scene, c.camera);
  }

  resize() {
    const cv = this.canvas;
    const w = cv.clientWidth || cv.width || 1;
    const h = cv.clientHeight || cv.height || 1;
    const pr = this._pixelRatio(); // devicePixelRatio can change (browser zoom, moving between monitors)
    if (pr !== this._pr) { this._pr = pr; this.renderer.setPixelRatio(pr); this._w = 0; }
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    if (this.controller && this.controller.resize) this.controller.resize(w, h);
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const r = this.renderer;
    this._pr = this._pixelRatio();
    r.setPixelRatio(this._pr);
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.needsUpdate = true;
    this._w = 0;
    this.resize();
    if (this.controller && this.controller.setQuality) this.controller.setQuality(q);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    if (this.controller && this.controller.onDeactivate) this.controller.onDeactivate();
    this.controller = null;
    this.renderer.dispose();
  }
}
