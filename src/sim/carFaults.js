// Random car trouble for AI cars: a seeded plan per car (at most one issue per race) and the per-step effect on the car.
// Effects go through car.powerMult / coolMult / wearMult / gripMult (read by carPhysics.js and tyres.js), never stats.
import { clamp } from '../core/mathUtil.js';

export const FAULTS = {
  cooling: { label: 'COOLING TROUBLE' },
  power: { label: 'POWER LOSS' },
  tyre: { label: 'SLOW PUNCTURE' },
  hybrid: { label: 'ERS FAILURE' },
};
const KINDS = ['cooling', 'cooling', 'power', 'tyre', 'hybrid'];   // cooling is the commonest

/** Odds of an issue for a car in one race: stronger (better developed) teams are more reliable. */
export function faultChance(strength) {
  return clamp(0.07 + (1 - (strength == null ? 0.8 : strength)) * 0.45, 0.04, 0.35);
}

/**
 * Plan for one car: null (trouble-free race) or { kind, at, duration, severity } with `at` / `duration` in race seconds
 * (`duration` Infinity = lasts to the flag). `rng` is a dedicated seeded stream.
 */
export function planFault(rng, { strength, expectedSeconds }) {
  if (rng() >= faultChance(strength)) return null;
  const kind = KINDS[Math.floor(rng() * KINDS.length)];
  const at = expectedSeconds * (0.2 + 0.6 * rng());
  const severity = rng();
  let duration = Infinity;
  if (kind === 'cooling') duration = severity < 0.5 ? 45 + 60 * rng() : Infinity;
  else if (kind === 'power') duration = severity < 0.6 ? 25 + 40 * rng() : Infinity;
  else if (kind === 'hybrid') duration = 40 + 60 * rng();
  return { kind, at, duration, severity, started: false, ended: false };
}

export function neutralFaultFx(car) {
  car.powerMult = 1; car.coolMult = 1; car.wearMult = 1; car.gripMult = 1;
}

/**
 * Applies the plan to the car for race time `t`. Returns 'start' / 'end' on the step the issue begins / clears, else null.
 * Safe to call every step with plan === null.
 */
export function stepFault(plan, car, t) {
  if (!plan) return null;
  let ev = null;
  if (!plan.started && t >= plan.at) { plan.started = true; ev = 'start'; }
  const active = plan.started && !plan.ended;
  if (active && t >= plan.at + plan.duration) {
    plan.ended = true; ev = 'end';
    neutralFaultFx(car);
    return ev;
  }
  if (!active) return ev;
  switch (plan.kind) {
    case 'cooling': car.coolMult = 0.62 - 0.17 * plan.severity; break;
    case 'power': car.powerMult = 0.95 - 0.1 * plan.severity; break;
    case 'tyre': car.wearMult = 1.7 + 1.0 * plan.severity; car.gripMult = 0.985; break;
    case 'hybrid': car.ers = 0; break;
    default: break;
  }
  return ev;
}
