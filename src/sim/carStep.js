// One fixed step of a single car's physics pipeline (shared by RaceSim and solo/calibration runs).
import { wrapAngle } from '../core/mathUtil.js';
import { stepCarDynamics, filterInput, TUNING } from './carPhysics.js';
import { stepTyreWear, stepThermal } from './tyres.js';
import { resolveWall } from './collisions.js';

const ENV = { gripFront: 1, gripRear: 1, rollExtra: 0, draft: 0, locked: false };

/** Sets car.surface / car.wheelsGrass / wheelsKerb and fills env grips. */
export function computeSurfaceEnv(car, stats, model, env) {
  const hw = model.halfWidth, kw = hw + model.kerbWidth;
  const dpsi = wrapAngle(car.heading - car.trackHeading);
  const sd = Math.sin(dpsi), cd = Math.cos(dpsi);
  const off = TUNING.wheelOffset * cd;
  let grass = 0, kerb = 0;
  let gF = 0, gR = 0;
  for (let ax = 0; ax < 2; ax++) {
    const xs = ax === 0 ? stats.cgToFront : -stats.cgToRear;
    const base = car.d + xs * sd;
    let g = 0;
    for (let w = -1; w <= 1; w += 2) {
      const ad = Math.abs(base + w * off);
      if (ad <= hw) g += TUNING.asphaltGrip;
      else if (ad <= kw) { g += TUNING.kerbGrip; kerb++; }
      else { g += TUNING.grassGrip; grass++; }
    }
    if (ax === 0) gF = g * 0.5; else gR = g * 0.5;
  }
  env.gripFront = gF; env.gripRear = gR;
  env.rollExtra = TUNING.grassRoll * grass * 0.25;
  car.wheelsGrass = grass; car.wheelsKerb = kerb;
  car.surface = grass >= 2 ? 'grass' : kerb > 0 ? 'kerb' : 'asphalt';
  return env;
}

/**
 * ctx = { trackModel, config, locked, draft }
 * Returns nothing; sets car.wallImpact (m/s) and car.overheatEvent for the caller.
 */
export function stepCar(car, stats, raw, ctx, dt) {
  const model = ctx.trackModel;
  car.prevS = car.s;
  const drive = filterInput(car, raw, dt);
  car.wantBoost = drive.boost;
  car.overheatEvent = stepThermal(car, stats, dt, ctx.draft || 0);
  const env = ENV;
  computeSurfaceEnv(car, stats, model, env);
  env.draft = ctx.draft || 0;
  env.locked = !!ctx.locked;
  stepCarDynamics(car, stats, drive, env, dt);
  const p = model.project(car.x, car.y, car.index);
  car.s = p.s; car.d = p.d; car.index = p.index; car.trackHeading = p.heading;
  car.wallImpact = resolveWall(car, model, stats, dt);
  if (!ctx.locked) stepTyreWear(car, stats, ctx.config, dt);
}
