// AI driver: pure-pursuit steering on the racing line, speed-profile throttle/brake,
// simple overtaking, mistakes, launch delay, rubber-banding (spec §4.5).
import { clamp, lerp } from '../../core/mathUtil.js';
import { DIFFICULTY } from '../../data/economy.js';
import { buildRacingLine, brakeForceLimit } from './racingLine.js';
import { steerLimit } from '../carPhysics.js';

export const AI_TUNING = {
  lookBase: 8, lookGain: 0.35,
  steerRate: 14,              // 1/s command smoothing
  passRange: 30, passLateral: 2.8, passBlend: 2.0, passClear: 8, passFasterBy: 1.5, passMaxAdj: 3.2, passMinStraight: 260, passAbortDist: 190, passStraight: 140, passMaxCurv: 1 / 250,
  noPassCurv: 1 / 60, heldBeforePass: 1.5, noPassBefore: 8,
  keepGap: 8, brakeGain: 2.0, brakeLead: 0.2, wearLead: 1.5,
  laneHoldDecay: 0.35,        // m/s: grid lane offset decays towards the line after launch
  returnRate: 3.0, sideGap: 2.4, avoidMax: 1.5, govStart: 0.9, govGain: 2.5,               // minimum lateral gap to a car alongside
  bodyLen: 5.7,
  edgeMargin: 1.0,
  parkedRange: 150, parkedSpeed: 4,   // a (nearly) stationary car in our lane is passed from this far out, whatever the speed/straight rules
  boostCurv: 1 / 400,         // AI deploys ERS boost only where the line is straighter than this
  boostHeatMax: 0.95,         // AI is not heat-smart: it keeps boosting until the engine is nearly cooked
};

function wrapDs(ds, L) {
  if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
  return ds;
}

/**
 * `profile` (optional, from aiProfile.js) gives this driver a character: form on the day, mistakes by experience, tyre and
 * engine management, aggression in traffic, wet-weather craft. Without it the driver behaves exactly as the plain model.
 */
export function createAiDriver({ trackModel, stats, driver, difficulty = 'normal', rng, racingLine, paceOverride, noMistakes, profile }) {
  const T = AI_TUNING;
  const model = trackModel;
  const line = racingLine || buildRacingLine(model, stats);
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const skill = driver && driver.skill != null ? driver.skill : 0.9;
  const skillNorm = clamp((skill - 0.85) / 0.14, 0, 1);
  const pf = profile || null;
  const basePace = lerp(0.955, 1.0, skillNorm) * diff.paceScale * (pf ? 1 + pf.paceBias : 1);
  const mistakeProb = diff.mistakeRate * (1 - skillNorm * 0.5) * (pf ? pf.mistakeScale : 1);
  const rand = rng || (() => 0.5);
  const launchDelay = 0.18 + 0.25 * (1 - skillNorm) + 0.15 * rand() + (pf ? pf.launchExtra : 0);
  // aggression: eager drivers need less of a speed advantage and less time stuck behind a car before going for a pass,
  // and follow closer; cautious ones wait for a clear chance
  const aggr = pf ? pf.aggression : 0.6;
  const passFaster = pf ? T.passFasterBy * (1.45 - 0.75 * aggr) : T.passFasterBy;
  const heldBefore = pf ? T.heldBeforePass * (1.3 - 0.6 * aggr) : T.heldBeforePass;
  const keepGap = pf ? T.keepGap * (1.25 - 0.5 * aggr) : T.keepGap;
  const boostHeatMax = pf ? pf.boostHeatMax : T.boostHeatMax;
  const N = model.N, ds = model.ds, L = model.length;
  const Lw = stats.cgToFront + stats.cgToRear;
  const top = (stats.derived && stats.derived.topSpeed) || 90;
  const hw = model.halfWidth;
  const lim = hw - T.edgeMargin;
  const kdf = 0.5 * 1.2 * stats.clA;
  const out = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false };

  const st = {
    init: false, adj: 0, passSide: 0, passId: -1, steer: 0, passCool: 0, heldT: 0,
    mistake: false, prevCurvHi: false,
    paceMult: 1,       // cool-down multiplier etc.
    launchDelay,
    debug: { vt: 0, e: 0 },
  };

  // distance (m) ahead until the speed profile drops well below the current speed (braking zone), capped at 400 m
  function distToBrake(idx, u) {
    const ref = 0.85 * Math.max(u, 30), sp = line.speed;
    const n = Math.ceil(400 / ds);
    for (let q = 0; q < n; q += 3) if (sp[(idx + q) % N] < ref) return q * ds;
    return 400;
  }

  function drive(car, world, dt) {
    const u = car.u;
    const idx = car.index;
    const offs = line.offset, spd = line.speed, curv = line.curvature;
    const others = world.cars;
    if (!st.init) { st.init = true; st.adj = car.d - offs[idx]; }
    if (st.passCool > 0) st.passCool -= dt;
    const lookIdx = (idx + Math.ceil((T.lookBase + T.lookGain * u) / ds)) % N;
    const kHere = Math.abs(curv[idx]), kAhead = Math.abs(curv[lookIdx]);

    // ---- unobstructed target speed ----
    const lead = (idx + Math.ceil((T.brakeLead + T.wearLead * (1 - car.tyreGrip)) * u / ds)) % N;   // brake earlier on worn tyres
    const vProfile = spd[lead];
    if (!noMistakes) {
      const hi = Math.abs(curv[lookIdx]) > 1 / 120;
      if (hi && !st.prevCurvHi) st.mistake = rand() < mistakeProb;
      else if (!hi && Math.abs(curv[lookIdx]) < 1 / 200) st.mistake = false;
      st.prevCurvHi = hi;
    }
    let pace;
    if (paceOverride != null) pace = paceOverride;
    else {
      let rubber = 1;
      const pl = others[world.playerId];
      if (pl && pl !== car && !pl.finished) {
        const gapSec = (pl.progress - car.progress) / Math.max(u, 25);
        if (gapSec > 6) rubber = 1 + diff.rubber * clamp((gapSec - 6) / 6, 0, 1);       // player ahead => speed up
        else if (gapSec < -6) rubber = 1 - diff.rubber * clamp((-gapSec - 6) / 6, 0, 1); // player far behind => ease off
      }
      pace = basePace * rubber;
    }
    if (pf && paceOverride == null) {
      // slow swing in form over the race, wet-weather craft, and lifting off when the engine runs hot or the car is hurt
      pace *= (1 + pf.formAmp * Math.sin(world.raceTime * (Math.PI * 2) / pf.formPeriod + pf.formPhase)) * pf.wetPace;
      if (car.heat > pf.heatEase) pace *= 1 - 0.12 * clamp((car.heat - pf.heatEase) / 0.2, 0, 1);
    }
    pace *= st.paceMult;
    let vt0 = vProfile * pace;
    if (vProfile < 0.9 * top) {
      vt0 *= Math.sqrt(car.tyreGrip);
      if (st.mistake) vt0 *= 1.04;
    }
    const eLat = car.d - (offs[idx] + st.adj);
    const aE = Math.abs(eLat);
    if (aE > 2.5) vt0 *= clamp(1 - 0.04 * (aE - 2.5), 0.6, 1);

    // ---- traffic ----
    let blocker = null, blockGap = 1e9;
    let parked = null, parkGap = 1e9;
    let alongside = null, alongDs = 1e9;
    for (let k = 0; k < others.length; k++) {
      const o = others[k];
      if (o === car) continue;
      const dS = wrapDs(o.s - car.s, L);
      if (dS > -6.5 && dS < 6.5 && Math.abs(o.d - car.d) < 3.4) {
        if (Math.abs(dS) < alongDs) { alongside = o; alongDs = Math.abs(dS); }
      }
      if (dS > 0 && dS < T.passRange) {
        if (Math.abs(o.d - car.d) < 2.2 && dS < blockGap) { blocker = o; blockGap = dS; }
      }
      if (dS > 0 && dS < T.parkedRange && o.u < T.parkedSpeed && Math.abs(o.d - car.d) < 2.6 && dS < parkGap) { parked = o; parkGap = dS; }
    }
    const parkedPass = parked && (!blocker || blocker === parked) && world.raceTime > T.noPassBefore;
    // pass state machine
    if (st.passSide !== 0) {
      const po = others[st.passId];
      const dS = po ? wrapDs(po.s - car.s, L) : -99;
      let kAbort = 0;
      for (let q = 0; q < Math.ceil(100 / ds); q += 2) { const kk = Math.abs(curv[(idx + q) % N]); if (kk > kAbort) kAbort = kk; }
      const brakeZone = distToBrake(idx, u) < T.passAbortDist || kAbort > T.passMaxCurv * 1.3;
      const poParked = po && po.u < T.parkedSpeed;
      if (!po || dS < -T.passClear || dS > (poParked ? T.parkedRange + 10 : T.passRange + 10) || (brakeZone && !poParked)) { st.passSide = 0; st.passId = -1; st.passCool = 1.5; }
    }
    // held-up timer: how long the car ahead has been slowing us
    if (blocker && Math.abs(blocker.d - car.d) < 2.2 && blockGap - T.bodyLen < 22 &&
        blocker.u + clamp((blockGap - T.bodyLen - keepGap) * 0.6, -12, 14) < vt0 - 1.0) st.heldT += dt;
    else st.heldT = Math.max(0, st.heldT - 2 * dt);
    let canPass = false;
    if (st.passSide === 0 && blocker && st.passCool <= 0 && st.heldT > heldBefore &&
        kHere < T.noPassCurv && kAhead < T.noPassCurv && world.raceTime > T.noPassBefore && u > 25) {
      // genuinely faster than the car ahead (compare at the blocker's own track position, so braking-zone
      // speed gradients in a pack do not count), and no real corner within the pass distance
      const vMeHere = spd[blocker.index] * pace * Math.sqrt(car.tyreGrip);
      if (vMeHere > blocker.u + passFaster) {
        const span = Math.ceil(T.passStraight / ds);
        let kmax = 0;
        for (let q = 0; q < span; q += 2) { const kk = Math.abs(curv[(idx + q) % N]); if (kk > kmax) kmax = kk; }
        canPass = kmax < T.passMaxCurv && distToBrake(idx, u) > T.passMinStraight;
      }
      if (canPass) {
        // one pass at a time in a neighbourhood: nobody within 45 m is passing / being passed
        for (let k = 0; k < others.length; k++) {
          const o = others[k];
          if (o === car || !o.ai) continue;
          const dS = wrapDs(o.s - car.s, L);
          if (dS > -45 && dS < 45 && (o.ai.passSide !== 0 || o.ai.passId === car.id)) { canPass = false; break; }
        }
      }
    }
    let passTarget = blocker, passGap = blockGap;
    if (!canPass && parkedPass && st.passSide === 0 && st.passCool <= 0) {
      // a stopped car (crash, AFK player, recovered car) in our lane: always go round it
      canPass = true; passTarget = parked; passGap = parkGap;
    }
    if (canPass) {
      let best = 0, bestRoom = -1e9;
      for (let sd = -1; sd <= 1; sd += 2) {
        const dT = passTarget.d + sd * T.passLateral;
        const room = lim - Math.abs(dT);
        if (room < -0.3) continue;
        // occupied by another car?
        let occ = false;
        for (let k = 0; k < others.length; k++) {
          const o = others[k];
          if (o === car || o === passTarget) continue;
          const dS = wrapDs(o.s - car.s, L);
          if (dS > -9 && dS < passGap + 9 && Math.abs(o.d - dT) < 2.4) { occ = true; break; }
        }
        if (!occ && room > bestRoom) { bestRoom = room; best = sd; }
      }
      if (best !== 0) { st.passSide = best; st.passId = passTarget.id; }
    }

    // ---- lateral target (relative to the racing line) ----
    const lineOffAhead = offs[(idx + Math.max(1, Math.round((T.lookBase + T.lookGain * u) / ds))) % N];
    let adjDesired, rate;
    if (st.passSide !== 0) {
      const po = others[st.passId];
      const dT = clamp(po.d + st.passSide * T.passLateral, -lim, lim);
      adjDesired = clamp(dT - lineOffAhead, -T.passMaxAdj, T.passMaxAdj);
      rate = T.passBlend;
    } else if (world.raceTime <= 2) {
      adjDesired = st.adj; rate = 0;
    } else {
      adjDesired = 0; rate = T.laneHoldDecay;
      if (world.raceTime > 6 && Math.abs(st.adj) > 0.3) rate = T.returnRate;
    }
    if (alongside) {
      const dInt = lineOffAhead + adjDesired;
      if (Math.abs(dInt - alongside.d) < T.sideGap) {
        const side = car.d >= alongside.d ? 1 : -1;
        const avoid = clamp(alongside.d + side * T.sideGap, -lim + 0.5, lim - 0.5) - lineOffAhead;
        // evasive moves stay small (large moves out of the groove cost more than a light touch)
        const base = st.passSide !== 0 ? adjDesired : 0;
        adjDesired = clamp(avoid, base - T.avoidMax, base + T.avoidMax);
        rate = Math.max(rate, 1.5);
      }
    }
    st.adj += clamp(adjDesired - st.adj, -rate * dt, rate * dt);

    // ---- steering: pure pursuit to a point on the (offset) line ----
    const Ld = T.lookBase + T.lookGain * u;
    const j = (idx + Math.max(1, Math.round(Ld / ds))) % N;
    // lateral position of the aim point, never outside the usable track width
    const dj = clamp(offs[j] + st.adj, -lim - 0.3, lim + 0.3);
    const tx = model.x[j] + dj * model.nx[j];
    const ty = model.y[j] + dj * model.ny[j];
    const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    const dx = tx - car.x, dy = ty - car.y;
    const lx = dx * ch + dy * sh, ly = -dx * sh + dy * ch;
    const dist = Math.max(Math.hypot(lx, ly), 1);
    let delta = Math.atan2(2 * Lw * (ly / dist), dist);
    if (lx < 0) delta = (ly >= 0 ? 1 : -1) * 1.0;      // target behind: full lock
    const target = clamp(delta / steerLimit(stats, Math.max(u, 0)), -1, 1);
    const m = T.steerRate * dt;
    st.steer += clamp(target - st.steer, -m, m);
    out.steer = clamp(st.steer, -1, 1);

    // ---- speed control ----
    let vt = vt0;
    {   // grip governor: if lateral load is close to the limit, shed speed smoothly (before the tyres let go)
      const aymaxG = stats.tyreMu * car.tyreGrip * (9.81 + kdf * u * u / stats.mass);
      const rr = Math.abs(car.ay) / aymaxG;
      if (rr > T.govStart) vt = Math.min(vt, u * clamp(1 - T.govGain * (rr - T.govStart), 0.8, 1));
    }
    if (blocker) {
      const gap = blockGap - T.bodyLen;
      if (Math.abs(blocker.d - car.d) < 2.0 && gap < 22) {
        const vlim = blocker.u + clamp((gap - keepGap) * 0.6, -12, 14);
        if (vlim < vt) vt = Math.max(vlim, 0);
      }
    }
    st.debug.vt = vt; st.debug.e = eLat;
    const launching = world.raceTime < st.launchDelay;
    if (launching) vt = 0;

    // friction-circle awareness: lateral usage limits throttle/brake
    const aymax = stats.tyreMu * car.tyreGrip * (9.81 + kdf * u * u / stats.mass);
    const r = Math.min(1, Math.abs(car.ay) / aymax);
    const circ = Math.max(0.12, Math.sqrt(1 - r * r));
    let throttle = clamp((vt - u) / 3, 0, 1);
    let brake = clamp((u - 1.02 * vt) / T.brakeGain, 0, 1);
    if (brake > 0) throttle = 0;
    throttle = Math.min(throttle, circ);
    {   // rear-axle traction circle: leave grip for the lateral force the corner needs
      const DF = kdf * u * u;
      const Fzr = stats.mass * 9.81 * stats.cgToFront / Lw + DF * (1 - stats.aeroBalanceFront);
      const ayReq = Math.max(Math.abs(car.ay), u * u * Math.abs(curv[(idx + 4) % N]));
      const FyReq = 1.12 * stats.mass * ayReq * stats.cgToFront / Lw;
      const cap = 0.95 * stats.tyreMu * car.tyreGrip * Fzr;
      const FxAllow = Math.sqrt(Math.max(0, cap * cap - FyReq * FyReq));
      const thrMax = FxAllow * Math.max(u, 4) / stats.power;
      if (thrMax < throttle) throttle = Math.max(thrMax, 0);
    }
    {   // keep both axles able to corner while braking
      const ayReq = Math.max(Math.abs(car.ay), u * u * Math.abs(curv[(idx + 4) % N]));
      const bl = brakeForceLimit(stats, u, ayReq, car.tyreGrip) / stats.brakeForceMax;
      if (brake > bl) brake = bl;
    }
    if (Math.abs(car.alphaR) > 0.14 && throttle > 0.4) throttle = 0.4;     // traction cut
    if (launching) { throttle = 0; brake = 0; }
    out.throttle = throttle;
    out.brake = brake;
    out.boost = !!(car.ers > 0.3 && car.heat < boostHeatMax && kAhead < T.boostCurv && kHere < T.boostCurv &&
      throttle > 0.9 && u < 0.97 * top && !blocker);
    return out;
  }

  return {
    drive,
    line,
    state: st,
    setPaceMult(x) { st.paceMult = x; },
    get paceMult() { return st.paceMult; },
  };
}
