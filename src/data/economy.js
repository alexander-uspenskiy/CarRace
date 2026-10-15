// Difficulty, race-length multipliers, credit payouts.
export const DIFFICULTY = {
  // playerDamage: share of crash damage the player's car takes (easy: none). steerAssistMin / steerEase: friendlier steering
  // (floor for the Settings assist slider; less steering lock at speed).
  easy: { paceScale: 0.935, aiUpgradeLevel: 0, creditMult: 0.8, mistakeRate: 0.1, rubber: 0.03, tyreWearMult: 0.8, playerDamage: 0, steerAssistMin: 0.85, steerEase: 1 },
  normal: { paceScale: 0.97, aiUpgradeLevel: 0, creditMult: 1.0, mistakeRate: 0.05, rubber: 0.02, tyreWearMult: 1.0, playerDamage: 0.5, steerAssistMin: 0.65, steerEase: 0.6 },
  hard: { paceScale: 1.0, aiUpgradeLevel: 1, creditMult: 1.25, mistakeRate: 0.02, rubber: 0.01, tyreWearMult: 1.2, playerDamage: 1, steerAssistMin: 0, steerEase: 0 },
};
export const RACE_MINUTES = [5, 7, 10];
// Payout grows with race length as minutes^1.1, so a longer race pays at least as much per real minute as a 5-minute one
// (10 min: x2.14 for 2x the time). Rounded to 2 decimals because the UI shows the multiplier.
export const LENGTH_EXPONENT = 1.1;
export const lengthCreditMult = (minutes) => Math.round(Math.pow(minutes / 5, LENGTH_EXPONENT) * 100) / 100;
export const LENGTH_CREDIT_MULT = Object.fromEntries(RACE_MINUTES.map((m) => [m, lengthCreditMult(m)]));
export const STARTING_CREDITS = 1000;

// All payouts were scaled x1.8 (balance pass): a mid-table (P5) 5-minute race now pays ~1500, so one team with every
// category at level 5 (32 500 credits) takes ~21 races instead of ~39.
export const CREDIT_SCALE = 1.8;
export const PAYOUT_P1 = 2160;                       // 1200 * 1.8
export const PAYOUT_FLOOR = 90;                      // 50 * 1.8
export const FASTEST_LAP_BONUS = 270;                // 150 * 1.8
export const POSITION_GAINED_BONUS = 72;             // 40 * 1.8
export const POSITION_GAINED_CAP = 576;              // 320 * 1.8
export const BEAT_TEAMMATE_BONUS = 180;              // 100 * 1.8

export function payoutForPosition(pos) {
  return Math.max(PAYOUT_FLOOR, Math.round(PAYOUT_P1 * 0.82 ** (pos - 1)));
}

const round10 = (x) => Math.round(x / 10) * 10;

/**
 * CreditBreakdown = { lines:[{label,amount}], subtotal, lengthMult, diffMult, total }
 * An unfinished player (playerFinished === false) is paid half of the position payout (shown as a negative line).
 */
export function computeCredits(result, config) {
  const lines = [];
  const pos = result.playerPosition;
  const payout = payoutForPosition(pos);
  lines.push({ label: `Finish P${pos}`, amount: payout });
  if (result.playerFinished === false) {
    lines.push({ label: 'Did not finish (x0.5)', amount: Math.round(payout * 0.5) - payout });
  }
  if (result.fastestLap && result.fastestLap.carId === result.playerCarId) {
    lines.push({ label: 'Fastest lap', amount: FASTEST_LAP_BONUS });
  }
  const gained = Math.max(0, (result.playerGridPosition ?? pos) - pos);
  if (gained > 0) {
    lines.push({ label: `Positions gained (+${gained})`, amount: Math.min(POSITION_GAINED_CAP, gained * POSITION_GAINED_BONUS) });
  }
  const mate = (result.rows || []).find((r) => r.teamId === result.playerTeamId && !r.isPlayer);
  if (mate && pos < mate.position) {
    lines.push({ label: 'Beat teammate', amount: BEAT_TEAMMATE_BONUS });
  }
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const lengthMult = LENGTH_CREDIT_MULT[config.minutes] ?? 1;
  const diffMult = DIFFICULTY[config.difficulty]?.creditMult ?? 1;
  const total = Math.max(0, round10(subtotal * lengthMult * diffMult));
  return { lines, subtotal, lengthMult, diffMult, total };
}
