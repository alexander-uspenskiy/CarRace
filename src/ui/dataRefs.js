// Resolve shared constants whose home module is ambiguous in the spec (economy.js vs raceConfig.js),
// with local fallbacks so the UI never breaks on a missing export.
import * as economy from '../data/economy.js';
import * as raceConfig from '../data/raceConfig.js';

const pick = (name, fallback) => economy[name] ?? raceConfig[name] ?? fallback;

export const DIFFICULTY = pick('DIFFICULTY', {
  easy: { creditMult: 0.8 }, normal: { creditMult: 1.0 }, hard: { creditMult: 1.25 },
});
export const RACE_MINUTES = pick('RACE_MINUTES', [5, 7, 10]);
export const LENGTH_CREDIT_MULT = pick('LENGTH_CREDIT_MULT', { 5: 1.0, 7: 1.3, 10: 1.7 });
export const STARTING_CREDITS = pick('STARTING_CREDITS', 1000);
export const computeCredits = economy.computeCredits ?? raceConfig.computeCredits;
export const createRaceConfig = raceConfig.createRaceConfig ?? economy.createRaceConfig;
