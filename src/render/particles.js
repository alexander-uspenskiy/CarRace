// Tiny pooled particle system (tyre smoke, grass dust) rendered as one Points draw call.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vA;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  vA = aAlpha;
  vC = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC, a);
}`;

export class ParticleSystem {
  constructor(max = 180) {
    this.max = max;
    this.cursor = 0;
    this.active = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.pos.fill(0);
    this.geometry = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.pos, 3);
    this.attrCol = new THREE.BufferAttribute(this.col, 3);
    this.attrSize = new THREE.BufferAttribute(this.size, 1);
    this.attrAlpha = new THREE.BufferAttribute(this.alpha, 1);
    this.attrPos.setUsage(THREE.DynamicDrawUsage);
    this.attrSize.setUsage(THREE.DynamicDrawUsage);
    this.attrAlpha.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.attrPos);
    this.geometry.setAttribute('aColor', this.attrCol);
    this.geometry.setAttribute('aSize', this.attrSize);
    this.geometry.setAttribute('aAlpha', this.attrAlpha);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'particles';
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, alpha) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.col[o] = r;
    this.col[o + 1] = g;
    this.col[o + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.a0[i] = alpha;
    this.alpha[i] = alpha;
    this.active++;
  }
  update(dt, uScale) {
    this.material.uniforms.uScale.value = uScale;
    if (this.active <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const o = i * 3;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * (this.life[i] / this.maxLife[i]);
    }
    this.active = alive;
    this.attrPos.needsUpdate = true;
    this.attrSize.needsUpdate = true;
    this.attrAlpha.needsUpdate = true;
    this.attrCol.needsUpdate = true;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
