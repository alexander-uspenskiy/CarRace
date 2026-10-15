// RaceConfig factory.
import { computeLaps, estimateRaceSeconds } from '../core/lapMath.js';
import { getTrackDef } from './tracks/index.js';
import { DIFFICULTY } from './economy.js';
import { emptyLevels, UPGRADE_CATEGORIES } from './upgrades.js';
import { WEATHER, pickWeather, weatherGrip } from './weather.js';

export { DIFFICULTY, RACE_MINUTES, LENGTH_CREDIT_MULT, STARTING_CREDITS } from './economy.js';

export function createRaceConfig(opts, trackDef = getTrackDef(opts.trackId)) {
  const {
    trackId = trackDef.id,
    minutes = 5,
    difficulty = 'normal',
    teamId = 'mclaren',
    driverIndex = 0,
    playerName = 'PLAYER',
    seed = 12345,
    upgrades,
    steerAssist = 0.5,
    weather,
  } = opts;
  const levels = emptyLevels();
  for (const c of UPGRADE_CATEGORIES) levels[c] = upgrades?.[c] ?? 0;
  const raceSeconds = minutes * 60;
  const wx = WEATHER[weather] ? weather : pickWeather(seed, trackId);
  // a damp track costs a few % of lap time (corner speed ~ sqrt(grip)): size the race for the conditions
  const refLap = trackDef.referenceLapTime / Math.sqrt(weatherGrip(wx));
  const laps = computeLaps(minutes, refLap, difficulty);
  // expected winner time (the whole-lap race is a few % off the nominal length); wear is paced to THIS, not to `raceSeconds`
  const expectedSeconds = estimateRaceSeconds(laps, refLap, difficulty);
  return {
    trackId,
    minutes,
    difficulty,
    teamId,
    driverIndex: driverIndex === 1 ? 1 : 0,
    playerName,
    seed,
    upgrades: levels,
    steerAssist,
    weather: wx,
    laps,
    raceSeconds,
    expectedSeconds,
    tyreWearBase: 0.62 / (0.55 * expectedSeconds),
  };
}

/** All categories set to DIFFICULTY[d].aiUpgradeLevel. */
export function aiLevelsFor(difficulty) {
  const lvl = (DIFFICULTY[difficulty] ?? DIFFICULTY.normal).aiUpgradeLevel;
  const levels = emptyLevels();
  for (const c of UPGRADE_CATEGORIES) levels[c] = lvl;
  return levels;
}
