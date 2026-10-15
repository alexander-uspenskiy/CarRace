// Driver character (beyond raw `skill` pace) and tyre compounds. Pure data.

/**
 * experience 0..1: seasons of racing craft. High = consistent, kind to tyres and engine, picks sensible strategy,
 * copes with rain. Low (rookies) = more mistakes, harsher on tyres, slower reactions at the start.
 * aggression 0..1: how readily the driver goes for a gap (and how little room they leave when defending).
 */
export const DRIVER_TRAITS = {
  nor: { experience: 0.7, aggression: 0.7 },
  pia: { experience: 0.55, aggression: 0.6 },
  lec: { experience: 0.8, aggression: 0.8 },
  ham: { experience: 1.0, aggression: 0.7 },
  ver: { experience: 0.95, aggression: 0.95 },
  tsu: { experience: 0.6, aggression: 0.85 },
  rus: { experience: 0.75, aggression: 0.65 },
  ant: { experience: 0.1, aggression: 0.6 },
  alb: { experience: 0.7, aggression: 0.55 },
  sai: { experience: 0.85, aggression: 0.6 },
  alo: { experience: 1.0, aggression: 0.8 },
  str: { experience: 0.65, aggression: 0.5 },
  had: { experience: 0.1, aggression: 0.7 },
  law: { experience: 0.3, aggression: 0.75 },
  oco: { experience: 0.8, aggression: 0.85 },
  bea: { experience: 0.2, aggression: 0.7 },
  gas: { experience: 0.75, aggression: 0.7 },
  col: { experience: 0.15, aggression: 0.65 },
  hul: { experience: 0.9, aggression: 0.5 },
  bor: { experience: 0.1, aggression: 0.5 },
};
const DEFAULT_TRAIT = { experience: 0.5, aggression: 0.6 };

export function driverTraits(driverId) {
  return DRIVER_TRAITS[driverId] || DEFAULT_TRAIT;
}

/**
 * Tyre compounds. `mu` scales the car's tyre friction (peak grip), `wear` scales how fast the tyre wears out.
 * Soft: quick but fades (and can fall off the cliff late in a long race); hard: slower but lasts.
 */
export const COMPOUNDS = {
  soft: { id: 'soft', label: 'S', name: 'SOFT', mu: 1.025, wear: 1.25 },
  medium: { id: 'medium', label: 'M', name: 'MEDIUM', mu: 1.0, wear: 1.0 },
  hard: { id: 'hard', label: 'H', name: 'HARD', mu: 0.975, wear: 0.75 },
};
export const COMPOUND_IDS = Object.keys(COMPOUNDS);
