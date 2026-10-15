// Car dynamics: 2-axle "bicycle" model with friction circle (spec §4.3).
// Pure module: no three, no DOM. Units SI, heading cw-positive (sim y == world z).
import { clamp, wrapAngle } from '../core/mathUtil.js';

export const SIM_HZ = 120;
export const SIM_DT = 1 / 120;

/** Global tuning knobs (change numbers, not APIs). */
export const TUNING = {
  rho: 1.2, g: 9.81,
  wheelOffset: 0.85,          // wheel lateral offset from centreline (m)
  grassGrip: 0.55, kerbGrip: 0.95, asphaltGrip: 1.0,
  grassRoll: 0.25,            // extra crr on grass
  handbrakeRearMu: 0.45,
  subStepBelow: 10,           // m/s: sub-step x2 below this speed
  kinLo: 3, kinHi: 6,         // kinematic blend band (m/s)
  maxYawRate: 3.5,
  steerRise: 5.5, steerFall: 8.0,         // keyboard steering rates (1/s)
  aiSteerRate: 14.0,
  pedalUp: 5, pedalDown: 10,
  accelSmooth: 0.05,          // ax/ay smoothing time constant (s)
  coolFloor: 0, coolSpeedRef: 100,   // airflow = floor + (1-floor)*min(1, u/ref)
  coolBase: 0.25, coolRefHeat: 0.8,   // cooling = coolRate*airflow*(base + (1-base)*heat/refHeat)
  boostCutMargin: 0.12,       // ERS boost cuts out above heatLimit + margin
  boostHeat: 0.08,            // extra heat/s while ERS boost is active
  maxDerate: 0.08,            // max power loss from engine heat (reached 0.2 above stats.heatLimit)
  derateSpan: 0.2,
  dirtyAirCooling: 0.3,       // fraction of cooling lost when fully in a slipstream (dirty air)
  reverseMax: 8,              // m/s: reverse speed cap
  reverseAccel: 5,            // m/s^2 while reversing
  reverseDelay: 0.3,          // s stopped with brake held before the car starts to reverse
  reverseStop: 12,            // m/s^2 rolling stop when the brake is released in reverse
  wearLoadNorm: 1.25,         // spec 1.6; tuned so a normal-difficulty AI stint ends ~0.55 wear (see docs/NOTES-B.md)
};

export function steerLimit(stats, u) {
  const r = u / 28;
  return stats.steerMax * (0.12 + 0.88 / (1 + r * r));
}

export function createCarState(pose, stats) {
  const x = pose.x, y = pose.y, h = pose.heading;
  return {
    id: 0, x, y, heading: h, prevX: x, prevY: y, prevHeading: h,
    u: pose.speed || 0, v: 0, yawRate: 0, steerAngle: 0, ax: 0, ay: 0,
    inThrottle: 0, inBrake: 0, inSteer: 0,
    tyreWear: 0, tyreGrip: 1, heat: 0, ers: 1, boosting: false, wantBoost: false,
    s: 0, d: 0, index: 0, surface: 'asphalt', progress: 0,
    lap: 1, lapStartT: 0, lastLap: null, bestLap: null, wrongWayT: 0,
    position: 0, grid: 0, finished: false, finishTime: null, ai: null, stats,
    // extras
    slip: 0, alphaF: 0, alphaR: 0, contact: 0, trackHeading: h, trackCurv: 0,
    lapsDone: 0, lapsCompleted: 0, assist: 0, mode: 'player', handbrake: false,
    overheated: false, wrongWay: false, lastGood: null, lastGoodT: 0,
    resetCooldown: 0, wallCooldown: 0, contactCooldown: 0, stuckT: 0, offTrackT: 0, ghost: 0, revT: 0,
    wheelsGrass: 0, wheelsKerb: 0, throttleOut: 0, brakeOut: 0,
    _drive: { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false },
  };
}

/** Power multiplier from engine heat: 1 below stats.heatLimit, down to 1 - maxDerate at heatLimit + derateSpan (smooth). */
export function heatDerate(heat, stats) {
  const lim = stats && stats.heatLimit != null ? stats.heatLimit : 0.8;
  const x = clamp((heat - lim) / TUNING.derateSpan, 0, 1);
  return 1 - TUNING.maxDerate * x * x * (3 - 2 * x);
}

const GEAR_TOP = [24, 40, 54, 66, 76, 85, 93, 105];
export function gearAndRpm(speed) {
  const s = Math.max(0, speed);
  let g = 0;
  while (g < 7 && s > GEAR_TOP[g]) g++;
  const lo = g === 0 ? 0 : GEAR_TOP[g - 1] * 0.82;
  const hi = GEAR_TOP[g];
  const f = clamp((s - lo) / (hi - lo), 0, 1);
  const rpm = g === 0 ? 0.25 + 0.75 * f : 0.5 + 0.5 * f;
  return { gear: g + 1, rpm: clamp(rpm, 0, 1) };
}

/** Keyboard smoothing, speed-sensitive steering limit is applied in the dynamics; assist here. */
export function filterInput(car, raw, dt) {
  const out = car._drive;
  const ai = car.mode === 'ai';
  const tSteer = clamp(raw.steer || 0, -1, 1);
  const tThr = clamp(raw.throttle || 0, 0, 1);
  const tBrk = clamp(raw.brake || 0, 0, 1);
  // steering
  let st = car.inSteer;
  if (ai) {
    const m = TUNING.aiSteerRate * dt;
    st += clamp(tSteer - st, -m, m);
  } else {
    const rising = Math.abs(tSteer) > Math.abs(st) && tSteer * st >= 0 && tSteer !== 0;
    const rate = (rising ? TUNING.steerRise : TUNING.steerFall) * dt;
    st += clamp(tSteer - st, -rate, rate);
  }
  car.inSteer = st;
  // pedals
  const up = TUNING.pedalUp * dt, dn = TUNING.pedalDown * dt;
  car.inThrottle += clamp(tThr - car.inThrottle, -dn, up);
  car.inBrake += clamp(tBrk - car.inBrake, -dn, up);
  if (ai) { car.inThrottle = tThr; car.inBrake = tBrk; }
  let steer = st;
  const assist = ai ? 0 : (car.assist || 0);
  if (assist > 0 && car.u > 8) {
    const counter = 0.35 * clamp(car.alphaR / 0.15, -1.5, 1.5);       // steer into rear slide
    const smax = steerLimit(car.stats, car.u);
    const wref = car.u * Math.tan(st * smax) / (car.stats.cgToFront + car.stats.cgToRear);
    const damp = clamp((car.yawRate - wref) * 0.25, -0.3, 0.3);        // yaw-rate damping
    steer = clamp(st + assist * (counter - damp), -1, 1);
  }
  out.steer = steer;
  out.throttle = car.inThrottle;
  out.brake = car.inBrake;
  out.handbrake = !!raw.handbrake;
  out.boost = !!raw.boost;
  return out;
}

function substep(car, stats, input, env, h, hDerate, rev) {
  const T = TUNING;
  const a = stats.cgToFront, b = stats.cgToRear, L = a + b, m = stats.mass;
  const u = car.u, v = car.v, w = car.yawRate;
  const W = m * T.g;
  const DF = 0.5 * T.rho * stats.clA * u * u;
  const Fzf = W * (b / L) + DF * stats.aeroBalanceFront;
  const Fzr = W * (a / L) + DF * (1 - stats.aeroBalanceFront);
  const muBase = stats.tyreMu * car.tyreGrip;
  const muF = muBase * env.gripFront;
  const muR = muBase * env.gripRear * (input.handbrake ? T.handbrakeRearMu : 1);

  const smax = steerLimit(stats, u);
  const delta = clamp(input.steer, -1, 1) * smax;
  car.steerAngle = delta;

  // longitudinal forces
  const throttle = input.throttle;
  const Peff = (stats.power + (car.boosting ? stats.boostPower : 0)) * throttle;
  let Fdrive = Math.min(Peff / Math.max(u, 4), 0.95 * muR * Fzr) * hDerate;   // overheated engine: less torque everywhere
  if (Fdrive < 0) Fdrive = 0;
  let Fxf = 0, Fxr = Fdrive;
  const moving = u > 0.05 && !rev;
  if (rev) {
    // reverse: brake held at standstill -> gentle backwards drive (speed-capped below)
    Fdrive = 0; Fxr = -Math.min(T.reverseAccel * m * clamp(input.brake, 0.3, 1), 0.9 * muR * Fzr);
  }
  if (input.brake > 0 && moving) {
    const Fb = stats.brakeForceMax * input.brake;
    const front = Math.min(0.6 * Fb, muF * Fzf);
    const rear = Math.min(Fb - front, muR * Fzr);
    Fxf -= front;
    Fxr -= rear;
  }
  if (input.handbrake && moving) Fxr -= 0.85 * muR * Fzr;
  Fxr = clamp(Fxr, -muR * Fzr, muR * Fzr);

  // lateral forces with friction circle
  const uAbs = Math.max(Math.abs(u), 1);
  const alphaF = Math.atan2(v + a * w, uAbs) - delta;
  const alphaR = Math.atan2(v - b * w, uAbs);
  const limF = Math.sqrt(Math.max(0, (muF * Fzf) ** 2 - Fxf * Fxf));
  const limR = Math.sqrt(Math.max(0, (muR * Fzr) ** 2 - Fxr * Fxr));
  const Fyf = clamp(-muF * Fzf * Math.tanh(stats.slipStiff * alphaF), -limF, limF);
  const Fyr = clamp(-muR * Fzr * Math.tanh(stats.slipStiff * alphaR), -limR, limR);

  // resistance
  const drag = 0.5 * T.rho * stats.cdA * u * u * (1 - env.draft);
  const roll = (stats.crr + env.rollExtra) * (W + DF);
  const res = u > 0.05 ? drag + roll : 0;

  const cd = Math.cos(delta), sd = Math.sin(delta);
  // In the kinematic blend band (< kinHi) the lateral dynamics are overwritten, so the front tyre's steering scrub
  // (-Fyf*sin(delta)) must fade out too, otherwise a car at full lock and crawling speed (grass, wall) cannot pull away.
  const kw0 = clamp((T.kinHi - u) / (T.kinHi - T.kinLo), 0, 1);
  const axTot = (Fxf * cd - Fyf * sd * (1 - kw0) + Fxr - res) / m;         // u' - v w
  const ayTot = (Fyf * cd + Fxf * sd + Fyr) / m;               // v' + u w
  const wDot = (a * (Fyf * cd + Fxf * sd) - b * Fyr) / stats.yawInertia;

  let nu = u + (axTot + v * w) * h;
  let nv = v + (ayTot - u * w) * h;
  let nw = w + wDot * h;

  if (rev) {
    if (nu < -T.reverseMax) nu = -T.reverseMax;
  } else if (nu < 0) {
    // rolling stop: reverse never persists without the brake held
    nu = Math.min(0, nu + T.reverseStop * h);
  }
  // not yet reversing: stay stopped under brake at standstill
  if (!rev && nu >= 0 && nu < 0.5 && input.brake > 0.05 && throttle < 0.05) { nu = 0; nv *= 0.5; nw *= 0.5; }

  // kinematic blend at low speed
  const kw = clamp((T.kinHi - nu) / (T.kinHi - T.kinLo), 0, 1);
  if (kw > 0) {
    const wk = nu * Math.tan(delta) / L;
    nw += (wk - nw) * kw;
    nv += (b * wk - nv) * kw;
  }
  nw = clamp(nw, -T.maxYawRate, T.maxYawRate);

  car.u = nu; car.v = nv; car.yawRate = nw;
  car.heading = wrapAngle(car.heading + nw * h);
  const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
  car.x += (nu * ch - nv * sh) * h;
  car.y += (nu * sh + nv * ch) * h;
  car.alphaF = alphaF; car.alphaR = alphaR;
  return { ax: axTot, ay: ayTot };
}

/**
 * env = { gripFront, gripRear, rollExtra, draft, locked }
 * input = DriveInput (already filtered).
 */
export function stepCarDynamics(car, stats, input, env, dt) {
  if (env.locked) {
    car.u = 0; car.v = 0; car.yawRate = 0; car.ax = 0; car.ay = 0; car.slip = 0;
    car.steerAngle = 0;
    return;
  }
  const n = car.u < TUNING.subStepBelow ? 2 : 1;
  const h = dt / n;
  const hd = heatDerate(car.heat, stats);
  // reverse: brake held (no throttle) with the car at a standstill for reverseDelay s
  if (input.brake > 0.05 && input.throttle < 0.05 && car.u < 0.5 && !input.handbrake) car.revT += dt;
  else car.revT = 0;
  const rev = car.revT > TUNING.reverseDelay;
  let r = null;
  for (let k = 0; k < n; k++) r = substep(car, stats, input, env, h, hd, rev);
  const f = Math.min(1, dt / TUNING.accelSmooth);
  car.ax += (r.ax - car.ax) * f;
  car.ay += (r.ay - car.ay) * f;
  const sp = Math.hypot(car.u, car.v);
  const sa = Math.max(Math.abs(car.alphaF), Math.abs(car.alphaR));
  car.slip = sp < 3 ? 0 : clamp((sa - 0.05) / 0.12, 0, 1);
}
