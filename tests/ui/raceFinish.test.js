import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../src/core/storage.js';
import { createSaveStore } from '../../src/data/saveStore.js';
import { createHallOfFame } from '../../src/data/hallOfFame.js';
import { createRaceConfig } from '../../src/data/raceConfig.js';
import { finalizeRace } from '../../src/game/raceFinish.js';

function fakeResult(position = 3) {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      position: i + 1, carId: i, teamId: i === 0 ? 'mclaren' : 'ferrari', driverCode: 'D' + i, driverName: 'Driver ' + i,
      isPlayer: i + 1 === position, finished: true, lapsCompleted: 5, totalTime: 300 + i, gapToWinner: i, lapsDown: 0,
      bestLap: 60 + i * 0.1, gridPosition: i + 1,
    });
  }
  rows[position - 1].teamId = 'mclaren';
  return {
    trackId: 'monte-veloce', minutes: 5, laps: 5, difficulty: 'normal', seed: 1, date: null,
    playerCarId: position - 1, playerTeamId: 'mclaren', playerName: 'TESTER', playerPosition: position, playerGridPosition: 6,
    playerFinished: true, playerTotalTime: 300 + position - 1, playerBestLap: 60 + (position - 1) * 0.1,
    fastestLap: { carId: 0, time: 60, lap: 2 }, rows,
  };
}

test('finalizeRace credits wallet, updates stats, records HoF and returns flow params', () => {
  const storage = createMemoryStorage();
  const save = createSaveStore(storage);
  const hof = createHallOfFame(storage, () => '2026-10-15T12:00:00.000Z');
  const config = createRaceConfig({ trackId: 'monte-veloce', minutes: 5, difficulty: 'normal', teamId: 'mclaren', driverIndex: 0, playerName: 'TESTER', seed: 1, upgrades: save.getUpgrades('mclaren') });
  const before = save.get().credits;
  const result = fakeResult(3);
  const out = finalizeRace({ result, config, save, hof, now: () => '2026-10-15T12:00:00.000Z' });
  assert.equal(out.result.date, '2026-10-15T12:00:00.000Z');
  assert.ok(out.credits.total > 0);
  assert.equal(save.get().credits, before + out.credits.total);
  assert.equal(save.get().stats.races, 1);
  assert.equal(save.get().stats.creditsEarned, out.credits.total);
  assert.equal(hof.getStats().races, 1);
  assert.equal(hof.getStats().podiums, 1);
  assert.ok(out.entryId);
  assert.ok(Array.isArray(out.newRecords));
  assert.equal(hof.getBestLaps('monte-veloce').length, 1);
});
