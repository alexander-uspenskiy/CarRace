// Race length / lap-count / time formatting helpers.
//
// Lap formula (balance pass; the old `round((T - 8) / ref)` finished 5-16% short because the winner laps ~3-6% faster
// than the calibration car and rounding to the nearest lap can lose half a lap):
//   winnerLap = referenceLapTime * AI_PACE_FACTOR[difficulty]       (measured: the winner's mean lap / reference lap)
//   total(k)  = k * winnerLap + START_OVERHEAD                      (predicted winner time for k laps)
//   laps      = the k whose total is inside [-2%, +9%] of the nominal length (closest to +3.5% if several; if none fits
//               the k closest to the window), never fewer than 3.
// The inner window leaves ~1% margin to the advertised -3% .. +10%. One lap is ~20% of a 5-minute race, so on a slow track
// 5 minutes can only land at about -5% or +11%.
export const START_OVERHEAD = 4.5;   // s: standing-start loss of the race leader (raceTime starts at lights-out)
export const AI_PACE_FACTOR = { easy: 0.984, normal: 0.975, hard: 0.953 };
export const LENGTH_WINDOW = { lo: -0.02, hi: 0.09, centre: 0.035 };

export function winnerLapEstimate(referenceLapTime, difficulty = 'normal') {
  return referenceLapTime * (AI_PACE_FACTOR[difficulty] ?? AI_PACE_FACTOR.normal);
}
/** Expected winner's total time (s). */
export function estimateRaceSeconds(laps, referenceLapTime, difficulty = 'normal') {
  return laps * winnerLapEstimate(referenceLapTime, difficulty) + START_OVERHEAD;
}
/** Number of laps for a race of `minutes` on a track with the given (calibrated) reference lap, at `difficulty`. */
export function computeLaps(minutes, referenceLapTime, difficulty = 'normal') {
  const T = minutes * 60;
  const lap = winnerLapEstimate(referenceLapTime, difficulty);
  const k0 = Math.floor((T - START_OVERHEAD) / lap);
  const { lo, hi, centre } = LENGTH_WINDOW;
  let best = 3, bestScore = Infinity, bestC = Infinity;
  for (let k = Math.max(3, k0 - 1); k <= Math.max(3, k0 + 2); k++) {
    const dev = (k * lap + START_OVERHEAD) / T - 1;
    const score = Math.max(0, lo - dev, dev - hi);               // distance outside the window (0 = inside)
    const c = Math.abs(dev - centre);
    if (score < bestScore - 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && c < bestC)) { best = k; bestScore = score; bestC = c; }
  }
  return best;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** 'm:ss.mmm' ('--:--.---' for null/NaN). */
export function formatTime(sec) {
  if (!isNum(sec) || sec < 0) return '--:--.---';
  const total = Math.round(sec * 1000);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** '+1.234' under a minute, '+1:02.3' from one minute up. '--.---' for null/NaN. */
export function formatGap(sec) {
  if (!isNum(sec)) return '--.---';
  const sgn = sec < 0 ? '-' : '+';
  const a = Math.abs(sec);
  if (a < 59.9995) return `${sgn}${a.toFixed(3)}`;
  const tenths = Math.round(a * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${sgn}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function formatGapLaps(n) {
  return n === 1 ? '+1 LAP' : `+${n} LAPS`;
}
