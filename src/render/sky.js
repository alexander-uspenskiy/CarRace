// Sky dome (gradient + sun glow), lights and fog for a track theme.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.2, d.y));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (0.55 * pow(sd, 6.0) + 0.5 * pow(sd, 64.0) + 3.0 * smoothstep(0.9993, 0.9998, sd));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildSky(theme = {}, { quality = 'high' } = {}) {
  const top = new THREE.Color((theme.sky && theme.sky[0]) || '#5aa7ff');
  const horizon = new THREE.Color((theme.sky && theme.sky[1]) || '#cfe8ff');
  const fogColor = new THREE.Color(theme.fog || '#cfe3f5');
  const sd = theme.sunDir || [-0.4, 0.8, 0.3];
  const sunDir = new THREE.Vector3(sd[0], sd[1], sd[2]).normalize();

  const geo = new THREE.SphereGeometry(1000, 24, 14);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: top },
      uHorizon: { value: horizon },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color('#fff2c4') },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  const grass = new THREE.Color(theme.grass || '#3f7d2e');
  const hemi = new THREE.HemisphereLight(top.clone().lerp(horizon, 0.5), grass.clone().multiplyScalar(0.55), 1.55);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.name = 'sun';
  sun.castShadow = false;
  const SH = 14;
  const cam = sun.shadow.camera;
  cam.left = -SH;
  cam.right = SH;
  cam.top = SH;
  cam.bottom = -SH;
  cam.near = 1;
  cam.far = 120;
  sun.shadow.mapSize.set(quality === 'low' ? 512 : 2048, quality === 'low' ? 512 : 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  sun.position.copy(sunDir).multiplyScalar(50);

  const fog = new THREE.Fog(fogColor, 160, quality === 'low' ? 700 : 1100);

  const api = {
    mesh,
    lights: [hemi, sun],
    hemi,
    sun,
    sunDir,
    fog,
    /** follow the camera with the dome, and the focus (player car) with the sun/shadow frustum */
    update(camPos, fx, fz) {
      mesh.position.copy(camPos);
      if (fx !== undefined) {
        // snap the shadow window to ~0.5 m to limit shimmer
        const sx = Math.round(fx * 2) / 2;
        const sz = Math.round(fz * 2) / 2;
        sun.position.set(sx + sunDir.x * 50, sunDir.y * 50, sz + sunDir.z * 50);
        sun.target.position.set(sx, 0, sz);
        sun.target.updateMatrixWorld();
      }
    },
    setShadow(on) {
      sun.castShadow = !!on;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
    },
  };
  return api;
}
