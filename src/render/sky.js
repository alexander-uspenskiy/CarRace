// Sky dome (gradient, sun glow, drifting clouds, horizon haze), lights and fog for a track theme + weather
// (theme.weather comes from data/weather.js themeForWeather; without it the sky is a fair-weather day).
import * as THREE from 'three';
import { WEATHER } from '../data/weather.js';

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
uniform vec3 uFog;
uniform vec3 uCloudLight;
uniform vec3 uCloudShade;
uniform float uCover;
uniform float uHaze;
uniform float uTime;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.2, d.y));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float sunVis = 1.0 - 0.92 * uCover;      // a heavy overcast hides the sun disc and most of its glow
  col += uSunColor * sunVis * (0.55 * pow(sd, 6.0) + 0.5 * pow(sd, 64.0) + 3.0 * smoothstep(0.9993, 0.9998, sd));
  // clouds: a flat layer projected from the dome, drifting with the wind; thick cores are grey, thin edges catch the sun
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.14) * 1.5 + vec2(uTime * 0.012, uTime * 0.005);
    float n = fbm(cp);
    float thr = mix(0.78, 0.28, uCover);
    float c = smoothstep(thr, thr + 0.2, n) * smoothstep(0.015, 0.24, d.y);
    float thick = smoothstep(thr + 0.08, thr + 0.5, n);
    vec3 cc = mix(uCloudLight, uCloudShade, thick * (0.35 + 0.65 * uCover));
    cc += uSunColor * 0.35 * pow(sd, 6.0) * (1.0 - thick) * sunVis;
    col = mix(col, cc, c * (0.55 + 0.4 * uCover));
  }
  // horizon haze (and mist: the dome fades into the fog colour so the far track does not float on a clear sky)
  col = mix(col, uFog, uHaze * (1.0 - smoothstep(0.0, 0.42, d.y)));
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

  const wx = theme.weather || WEATHER.clear;
  const grey = new THREE.Color('#9aa3ad');
  const cloudLight = new THREE.Color('#ffffff').lerp(new THREE.Color('#d6dde6'), wx.grey);
  const cloudShade = new THREE.Color('#aab4c0').lerp(grey, 0.5).multiplyScalar(1 - 0.35 * wx.dark);
  const geo = new THREE.SphereGeometry(1000, 24, 14);
  const mat = new THREE.ShaderMaterial({
    defines: { OCT: quality === 'low' ? 3 : 5 },
    uniforms: {
      uFog: { value: fogColor.clone() },
      uCloudLight: { value: cloudLight },
      uCloudShade: { value: cloudShade },
      uCover: { value: wx.cover },
      uHaze: { value: wx.id === 'fog' ? 0.95 : 0.35 + 0.3 * wx.grey },
      uTime: { value: 0 },
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
  const hemi = new THREE.HemisphereLight(top.clone().lerp(horizon, 0.5), grass.clone().multiplyScalar(0.55), 1.55 * wx.hemi);
  // overcast light is cooler and softer; the sun still casts a (faint) shadow so the cars stay grounded
  const sun = new THREE.DirectionalLight(new THREE.Color(0xfff1d6).lerp(new THREE.Color(0xdfe7f0), wx.grey), 3.0 * wx.sun + 0.25);
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

  const fog = new THREE.Fog(fogColor, wx.fogNear, Math.min(wx.fogFar, quality === 'low' ? 700 : 1100));

  const api = {
    mesh,
    lights: [hemi, sun],
    hemi,
    sun,
    sunDir,
    fog,
    weatherFogFar: wx.fogFar,
    /** follow the camera with the dome, and the focus (player car) with the sun/shadow frustum */
    update(camPos, fx, fz, t) {
      mesh.position.copy(camPos);
      if (t !== undefined) mat.uniforms.uTime.value = t;
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
