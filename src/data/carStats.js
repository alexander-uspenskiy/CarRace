// CarStats: the physics parameter bag. computeCarStats = BASE_CAR x team multipliers x upgrade effects.
import { UPGRADES, UPGRADE_CATEGORIES, MAX_LEVEL, emptyLevels, effectFactor } from './upgrades.js';
import { getTeam } from './teams.js';
import { clamp } from '../core/mathUtil.js';

const RHO_HALF = 0.6; // 0.5 * 1.2

/** Derived figures (A's formulas, spec §2.5). */
export function computeDerived(s) {
  // top speed: root of power = 0.6 cdA u^3 + crr (m g + 0.6 clA u^2) u
  const f = (u) => s.power - (RHO_HALF * s.cdA * u * u * u + s.crr * (s.mass * 9.81 + RHO_HALF * s.clA * u * u) * u);
  let lo = 40;
  let hi = 150;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  const topSpeed = (lo + hi) / 2;

  const maxLatG60 = (s.tyreMu * (9.81 + (RHO_HALF * s.clA * 3600) / s.mass)) / 9.81;

  const L = s.cgToFront + s.cgToRear;
  const target = 100 / 3.6;
  const steps = 2000;
  const du = target / steps;
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) * du;
    const traction = 0.95 * s.tyreMu * ((s.mass * 9.81 * s.cgToFront) / L + RHO_HALF * s.clA * (1 - s.aeroBalanceFront) * u * u);
    const drive = Math.min(s.power / Math.max(u, 4), traction);
    const a = drive / s.mass - (RHO_HALF * s.cdA * u * u) / s.mass;
    t += du / Math.max(a, 0.1);
  }
  return { topSpeed, maxLatG60, accel0to100: t };
}

export const BASE_CAR = {
  mass: 800,
  cgToFront: 1.98,
  cgToRear: 1.62,
  yawInertia: 1100,
  halfWidth: 1.0,
  noseX: 3.3,
  tailX: -2.4,
  power: 400000,
  boostPower: 80000,
  cdA: 0.85,
  clA: 3.0,
  aeroBalanceFront: 0.42,
  crr: 0.015,
  brakeForceMax: 12500,
  tyreMu: 1.55,
  slipStiff: 14,
  steerMax: 0.5,
  tyreWearMult: 1.0,
  heatGain: 0.08,
  coolRate: 0.055,
  heatLimit: 0.8,
  ersDrain: 0.125,
  ersRecharge: 0.05,
  derived: { topSpeed: 89.8, maxLatG60: 2.8, accel0to100: 3.3 },
};
BASE_CAR.derived = computeDerived(BASE_CAR);

/** x=(1-s)/0.35: top team (s=1) -> all 1; last (0.65) -> power 0.97, cl 0.95, cd 1.02, mu 0.99. */
export function teamBaseMultipliers(strength) {
  const x = (1 - strength) / 0.35;
  return { power: 1 - 0.03 * x, cl: 1 - 0.05 * x, cd: 1 + 0.02 * x, mu: 1 - 0.01 * x };
}

/**
 * @param team Team object (or team id)
 * @param levels UpgradeLevels (missing categories = 0)
 * @param extraLevelOffset added to every category level (AI), clamped to 0..MAX_LEVEL
 */
export function computeCarStats(team, levels = emptyLevels(), extraLevelOffset = 0) {
  const t = typeof team === 'string' ? getTeam(team) : team;
  if (!t) throw new Error(`computeCarStats: unknown team ${String(team)}`);
  const m = teamBaseMultipliers(t.strength);
  const s = { ...BASE_CAR, derived: undefined };
  s.power *= m.power;
  s.clA *= m.cl;
  s.cdA *= m.cd;
  s.tyreMu *= m.mu;
  for (const cat of UPGRADE_CATEGORIES) {
    const L = clamp((levels?.[cat] ?? 0) + extraLevelOffset, 0, MAX_LEVEL);
    if (L === 0) continue;
    for (const e of UPGRADES[cat].effects) s[e.stat] *= effectFactor(e, L);
  }
  s.derived = computeDerived(s);
  return s;
}

// ---- UI summary bars -------------------------------------------------------
// Each bar maps a metric linearly: 50 = stock mid-field team (strength 0.78, no upgrades),
// 100 = strength 1.0 with the categories that feed that metric maxed (so engine+aero trade-offs stay visible).
const accelAt = (s, u) => {
  const L = s.cgToFront + s.cgToRear;
  const traction = 0.95 * s.tyreMu * ((s.mass * 9.81 * s.cgToFront) / L + RHO_HALF * s.clA * (1 - s.aeroBalanceFront) * u * u);
  return (Math.min(s.power / Math.max(u, 4), traction) - RHO_HALF * s.cdA * u * u) / s.mass;
};
const METRICS = {
  topSpeed: { fn: (s) => s.derived.topSpeed, max: ['engine'] },
  accel: { fn: (s) => 0.5 * (1 / s.derived.accel0to100 / (1 / 3.3) + accelAt(s, 60) / 6), max: ['engine', 'tyres'] },
  cornering: { fn: (s) => s.derived.maxLatG60, max: ['aero', 'tyres'] },
  braking: { fn: (s) => s.brakeForceMax, max: ['brakes'] },
  tyreLife: { fn: (s) => 1 / s.tyreWearMult, max: ['tyres'] },
  cooling: { fn: (s) => (s.coolRate / s.heatGain) * s.heatLimit, max: ['cooling'] },   // dissipation vs generation, scaled by the derate threshold
};
let refs = null;
function getRefs() {
  if (!refs) {
    const mid = computeCarStats({ strength: 0.78 }, emptyLevels());
    refs = { mid, best: {} };
    for (const [k, m] of Object.entries(METRICS)) {
      const lv = emptyLevels();
      for (const c of m.max) lv[c] = MAX_LEVEL;
      refs.best[k] = computeCarStats({ strength: 1.0 }, lv);
    }
  }
  return refs;
}
export function statSummary(stats) {
  const { mid, best } = getRefs();
  const out = {};
  for (const [k, m] of Object.entries(METRICS)) {
    const lo = m.fn(mid);
    const span = m.fn(best[k]) - lo;
    out[k] = Math.round(clamp(span === 0 ? 50 : 50 + (50 * (m.fn(stats) - lo)) / span, 0, 100));
  }
  return out;
}
