// Tyre wear, engine heat, ERS (spec §4.4).
import { clamp } from '../core/mathUtil.js';
import { DIFFICULTY } from '../data/economy.js';
import { TUNING } from './carPhysics.js';

export function tyreGripFromWear(w) {
  const c = clamp((w - 0.75) / 0.25, 0, 1);
  return 1 - 0.12 * w - 0.25 * c * c;
}

export function stepTyreWear(car, stats, config, dt) {
  const diff = DIFFICULTY[config.difficulty] || DIFFICULTY.normal;
  const mu = stats.tyreMu;
  const load = clamp(Math.hypot(car.ax, car.ay) / (mu * TUNING.g * TUNING.wearLoadNorm), 0, 1.5);
  let rate = config.tyreWearBase * stats.tyreWearMult * diff.tyreWearMult * (0.25 + 0.75 * load * load);
  if (car.surface === 'grass') rate *= 0.5;
  car.tyreWear = Math.min(1, car.tyreWear + rate * dt);
  car.tyreGrip = tyreGripFromWear(car.tyreWear);
}

/**
 * Heat & ERS. Uses car.inThrottle/inBrake/wantBoost. Returns true on the step heat crosses 1.0.
 * Heat builds with throttle (+ ERS boost); cooling needs airflow (speed) and is reduced in dirty air (`draft` 0..0.18,
 * slipstream of a car ahead). Above `stats.heatLimit` the engine derates (see heatDerate in carPhysics.js, up to -8% power).
 */
export function stepThermal(car, stats, dt, draft = 0) {
  const thr = car.inThrottle, brk = car.inBrake;
  const lim = stats.heatLimit != null ? stats.heatLimit : 0.8;
  // ERS boost cuts out when the engine is cooked (heat well above the derate threshold)
  car.boosting = !!(car.wantBoost && car.ers > 0 && thr > 0.5 && car.heat < lim + TUNING.boostCutMargin);
  if (car.boosting) car.ers = Math.max(0, car.ers - stats.ersDrain * dt);
  else if (thr < 0.3 || brk > 0.05) car.ers = Math.min(1, car.ers + stats.ersRecharge * (1 + brk) * dt);
  // Newtonian cooling: proportional to airflow (speed, reduced in dirty air) and to how hot the engine already is, so
  // heat settles to an equilibrium set by throttle use, boost and the car's cooling stats (no run-away at 1.2).
  const dirty = clamp(draft / 0.18, 0, 1);
  const air = (TUNING.coolFloor + (1 - TUNING.coolFloor) * Math.min(1, Math.max(0, car.u) / TUNING.coolSpeedRef)) * (1 - TUNING.dirtyAirCooling * dirty);
  const cool = stats.coolRate * air * (TUNING.coolBase + (1 - TUNING.coolBase) * car.heat / TUNING.coolRefHeat);
  car.heat = clamp(car.heat + (stats.heatGain * thr + (car.boosting ? TUNING.boostHeat : 0) - cool) * dt, 0, 1.2);
  // 'car:overheat' once per excursion above 1.0: re-armed only when well below and at most every 8 s (no warning spam
  // while the heat hovers around the limit)
  car.overheatT = (car.overheatT || 0) + dt;
  let ev = false;
  if (car.heat >= 1.0 && !car.overheated && car.overheatT > 8) { car.overheated = true; car.overheatT = 0; ev = true; }
  else if (car.heat < 0.7) car.overheated = false;
  return ev;
}
