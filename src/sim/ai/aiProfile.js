// Per-driver, per-race character for an AI car: experience, aggression, form on the day, tyre choice, wet-weather craft.
// Pure and seeded (the caller supplies the rng), so a race with the same seed replays identically.
import { clamp, lerp, TAU } from '../../core/mathUtil.js';
import { DIFFICULTY } from '../../data/economy.js';
import { COMPOUNDS, COMPOUND_IDS, driverTraits } from '../../data/driverTraits.js';
import { getWeather } from '../../data/weather.js';

/**
 * Tyre choice: experienced drivers pick the compound that suits the race (soft is a gamble on a long / hard-wearing race),
 * rookies choose closer to at random. Returns a COMPOUNDS id.
 */
export function pickCompound(rng, { experience, minutes = 5, difficulty = 'normal', weather = 'clear' }) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const w = getWeather(weather);
  // base appetite per compound: shorter race -> softer
  const base = minutes <= 5 ? { soft: 0.4, medium: 0.4, hard: 0.2 } : minutes <= 7 ? { soft: 0.3, medium: 0.45, hard: 0.25 } : { soft: 0.2, medium: 0.45, hard: 0.35 };
  if (w.rain > 0) { base.soft *= 0.4; base.hard *= 1.2; }   // no wet tyres in this game: nobody wants the softest rubber on a damp track
  // wear is paced to end a normal race around 0.55; project the soft tyre's end-of-race wear and let experience avoid the cliff
  const projectedSoft = 0.55 * diff.tyreWearMult * COMPOUNDS.soft.wear;
  if (projectedSoft > 0.72) base.soft *= lerp(1, 0.3, experience);
  const sharp = lerp(0.4, 1.4, experience);                 // rookies: flat odds, veterans: stick to the sensible choice
  const weights = COMPOUND_IDS.map((id) => Math.pow(base[id], sharp));
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < COMPOUND_IDS.length; i++) {
    x -= weights[i];
    if (x < 0) return COMPOUND_IDS[i];
  }
  return 'medium';
}

/**
 * Builds the AI profile. `rng` must be a dedicated seeded stream (not the one the driver itself consumes).
 * Fields:
 *   experience, aggression      traits (0..1)
 *   paceBias                    this race's form on the day, a few tenths of a percent either way
 *   formAmp/formPeriod/formPhase  slow wobble of pace over the race (rookies swing more)
 *   mistakeScale                multiplier on the corner-entry mistake probability (rookies, rain)
 *   wearMgmt                    multiplier on tyre wear (veterans save the tyres)
 *   heatEase, boostHeatMax      engine heat where the driver starts easing off / stops using ERS boost
 *   wetPace                     pace multiplier from wet-weather craft (0 effect in the dry)
 *   launchExtra                 extra reaction time at the start lights (s)
 *   compound                    'soft' | 'medium' | 'hard'
 */
export function buildAiProfile({ driver, rng, config = {} }) {
  const tr = driverTraits(driver && driver.id);
  const exp = tr.experience, agg = tr.aggression;
  const skill = driver && driver.skill != null ? driver.skill : 0.9;
  const skillNorm = clamp((skill - 0.85) / 0.14, 0, 1);
  const w = getWeather(config.weather);
  const form = (rng() + rng() + rng()) / 3 - 0.5;       // roughly bell shaped, -0.5..0.5
  const wetSkill = clamp(0.5 * exp + 0.4 * skillNorm + 0.1 * rng(), 0, 1);
  const compound = pickCompound(rng, { experience: exp, minutes: config.minutes, difficulty: config.difficulty, weather: config.weather });
  return {
    experience: exp,
    aggression: agg,
    paceBias: form * 0.008,
    formAmp: lerp(0.004, 0.0012, exp),
    formPeriod: 70 + rng() * 80,
    formPhase: rng() * TAU,
    mistakeScale: lerp(1.7, 0.55, exp) * (1 + 1.4 * w.rain * (1 - wetSkill)),
    wearMgmt: lerp(1.1, 0.93, exp),
    heatEase: lerp(0.93, 0.8, exp),
    boostHeatMax: lerp(0.97, 0.85, exp),
    wetPace: 1 + (wetSkill - 0.5) * 0.03 * w.rain,
    launchExtra: (1 - exp) * 0.1 + rng() * 0.05,
    compound,
  };
}
