// Rain: one LineSegments draw call. Every drop's fall and its wrap-around the camera happen in the vertex shader (no CPU
// work per frame beyond two uniforms), so it costs nothing when it is not raining (the controller then never builds it).
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uTime;
attribute float aEnd;
varying float vA;
void main() {
  vec3 p = position + uVel * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;     // drops live in a box that follows the camera
  float dist = length(p - uCam);
  p -= normalize(uVel) * 0.8 * aEnd;                            // the tail trails up along the fall direction
  vA = (1.0 - 0.85 * aEnd) * (1.0 - smoothstep(14.0, 30.0, dist)) * smoothstep(0.6, 2.0, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float uAlpha;
varying float vA;
void main() {
  gl_FragColor = vec4(0.82, 0.88, 0.95, vA * uAlpha);
}`;

const BOX = new THREE.Vector3(56, 32, 56);

export function buildRain({ quality = 'high', intensity = 0.5 } = {}) {
  const max = quality === 'low' ? 900 : 2600;
  const pos = new Float32Array(max * 2 * 3);
  const end = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) {
    const x = Math.random() * BOX.x, y = Math.random() * BOX.y, z = Math.random() * BOX.z;
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      end[i * 2 + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uVel: { value: new THREE.Vector3(-3, -24, 1.5) },
      uTime: { value: 0 },
      uAlpha: { value: 0.8 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const setCount = (hi) => {
    const n = Math.round(max * Math.min(1, intensity * (hi ? 1.4 : 1.1)));
    geo.setDrawRange(0, n * 2);
  };
  setCount(quality !== 'low');
  return {
    mesh,
    update(camPos, t) {
      mat.uniforms.uCam.value.copy(camPos);
      mat.uniforms.uTime.value = t;
    },
    setQuality(hi) { setCount(hi); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
