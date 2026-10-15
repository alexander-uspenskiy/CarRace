// Pure-ish wiring: RaceResult -> credits, save stats, Hall of Fame. No DOM; unit-testable with in-memory stores.
import { computeCredits } from '../ui/dataRefs.js';

export function finalizeRace({ result, config, save, hof, now = () => new Date().toISOString() }) {
  result.date = now();
  const credits = computeCredits(result, config);
  save.addCredits(credits.total);
  save.update((s) => {
    s.stats.races = (s.stats.races || 0) + 1;
    s.stats.creditsEarned = (s.stats.creditsEarned || 0) + credits.total;
  });
  const rec = hof.recordRace(result, {
    playerName: result.playerName ?? config.playerName,
    creditsEarned: credits.total,
    difficulty: config.difficulty,
  });
  return { result, credits, newRecords: rec.newRecords || [], entryId: rec.entryId };
}
