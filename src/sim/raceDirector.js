// Race director: grid, phases, start lights, lap counting, positions/gaps, finish, classification (spec §4.6, §4.7).
import { gaussian } from '../core/mathUtil.js';

export const INTRO_SECONDS = 4.0;
export const CUTOFF_SECONDS = 90;           // minimum cut-off after the flag
export const CUTOFF_REF_LAPS = 1.6;         // cut-off = max(CUTOFF_SECONDS, CUTOFF_REF_LAPS * referenceLapTime)
export const PLAYER_FINISH_GRACE = 3;       // (legacy export, no longer ends the race early)

export function cutoffSeconds(referenceLapTime) {
  return Math.max(CUTOFF_SECONDS, CUTOFF_REF_LAPS * (referenceLapTime || 60));
}

/** s = wrapS(-(10 + 8*slot)); d = slot%2===0 ? -2.5 : +2.5. slot 0 = pole (left). */
export function gridPose(trackModel, slot) {
  const s = trackModel.wrapS(-(10 + 8 * slot));
  const d = slot % 2 === 0 ? -2.5 : 2.5;
  const p = trackModel.sampleAt(s);
  return { x: p.x + d * p.nx, y: p.y + d * p.ny, heading: p.heading, s, d };
}

/**
 * buildGrid(config, teams, rng[, trackModel]) -> GridSlot[20] {carId, teamId, driverId, slot, s, d, isPlayer}
 * `s` is the wrapped arc length when a trackModel is given, otherwise the signed distance behind the line (negative).
 */
export function buildGrid(config, teams, rng, trackModel = null) {
  const entries = [];
  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    for (let di = 0; di < team.drivers.length; di++) {
      const drv = team.drivers[di];
      const carId = ti * 2 + di;
      const score = team.strength + 0.30 * (drv.skill - 0.9) + 0.08 * gaussian(rng);
      entries.push({
        carId, teamId: team.id, driverId: drv.id, score,
        isPlayer: team.id === config.teamId && di === config.driverIndex,
      });
    }
  }
  entries.sort((a, b) => b.score - a.score || a.carId - b.carId);
  return entries.map((e, slot) => {
    const sRel = -(10 + 8 * slot);
    return {
      carId: e.carId, teamId: e.teamId, driverId: e.driverId, slot,
      s: trackModel ? trackModel.wrapS(sRel) : sRel,
      d: slot % 2 === 0 ? -2.5 : 2.5, isPlayer: e.isPlayer,
    };
  });
}

/**
 * Director: owns phase machine, lap/finish logic, standings. RaceSim feeds it per-car progress.
 * ctx = { config, trackModel, cars, metas, emit, rng, onCarFinished(car) }
 */
export function createDirector(ctx) {
  const { config, trackModel, cars, metas, emit } = ctx;
  const L = trackModel.length;
  const laps = config.laps;
  const n = cars.length;
  const cutoff = cutoffSeconds(ctx.referenceLapTime);

  const D = {
    phase: 'intro', phaseT: 0, raceTime: 0, lit: 0, out: false, holdDur: 0,
    flagT: null, playerFinishT: null, finishedCount: 0,
    fastestLap: null, order: new Array(n), result: null, ended: false,
    introT: 0, firstEmitted: false,
  };
  for (let i = 0; i < n; i++) D.order[i] = i;

  function setPhase(p) {
    if (D.phase === p) return;
    D.phase = p; D.phaseT = 0;
    emit('race:phase', { phase: p });
  }

  D.locked = () => D.phase === 'intro' || D.phase === 'lights';

  D.skipIntro = () => {
    if (D.phase === 'intro') { setPhase('lights'); D.holdDur = 0.6 + 1.4 * ctx.rng(); D.introT = 1; }
  };

  /** Phase logic at the start of a fixed step. */
  D.step = (dt) => {
    if (!D.firstEmitted) { D.firstEmitted = true; emit('race:phase', { phase: D.phase }); }
    D.phaseT += dt;
    if (D.phase === 'intro') {
      D.introT = Math.min(1, D.phaseT / INTRO_SECONDS);
      if (D.phaseT >= INTRO_SECONDS) { setPhase('lights'); D.holdDur = 0.6 + 1.4 * ctx.rng(); D.introT = 1; }
    } else if (D.phase === 'lights') {
      const t = D.phaseT;
      const lit = Math.min(5, Math.floor(t + 1e-9));
      if (lit > D.lit) { D.lit = lit; emit('race:lights', { lit }); }
      if (t >= 5 + D.holdDur) {
        D.lit = 0; D.out = true; D.raceTime = 0;
        emit('race:lights', { lit: 0 });
        setPhase('racing');
      }
    } else {
      D.raceTime += dt;
    }
  };

  D.lapNumber = (car) => Math.min(laps, Math.floor(Math.max(car.progress, 0) / L) + 1);

  /** Called after a car's progress changed; handles lap crossings. */
  D.onProgress = (car, prevProgress, dt) => {
    if (D.phase !== 'racing' && D.phase !== 'finishing' && D.phase !== 'finished') return;
    if (car.finished) return;
    while (car.progress >= (car.lapsDone + 1) * L) {
      const lapNo = car.lapsDone + 1;
      const target = lapNo * L;
      const span = car.progress - prevProgress;
      const frac = span > 1e-9 ? Math.min(1, Math.max(0, (target - prevProgress) / span)) : 1;
      const tc = (D.raceTime - dt) + dt * frac;
      car.lapsDone = lapNo;
      const lapTime = tc - car.lapStartT;
      car.lapStartT = tc;
      car.lastLap = lapTime;
      let isPB = false;
      if (car.bestLap == null || lapTime < car.bestLap) { car.bestLap = lapTime; isPB = true; }
      let isFastest = false;
      if (!D.fastestLap || lapTime < D.fastestLap.time) {
        D.fastestLap = { carId: car.id, time: lapTime, lap: lapNo };
        isFastest = true;
      }
      emit('race:lap', { carId: car.id, lap: lapNo, lapTime, isPlayer: metas[car.id].isPlayer, isPersonalBest: isPB, isFastest });
      if (isFastest) emit('race:fastestLap', { carId: car.id, time: lapTime, lap: lapNo });
      car.lap = D.lapNumber(car);
      // finishing
      const flagged = D.flagT != null;
      if (lapNo >= laps || (flagged && tc >= D.flagT - 1e-9)) {
        if (!flagged) {
          D.flagT = tc; // raceTime of the flag (interpolated)
          setPhase('finishing');
        }
        car.finished = true;
        car.lapsCompleted = Math.min(lapNo, laps);
        car.finishTime = tc;
        D.finishedCount++;
        if (metas[car.id].isPlayer) D.playerFinishT = D.raceTime;
        emit('race:carFinished', { carId: car.id, position: D.finishedCount, time: tc });
        if (ctx.onCarFinished) ctx.onCarFinished(car);
        break;
      }
    }
    if (!car.finished) car.lap = D.lapNumber(car);
  };

  function lapsKey(c) {
    return c.finished ? c.lapsCompleted : Math.min(laps, Math.floor(Math.max(c.progress, 0) / L) + 1) - 0.5;
  }
  function cmp(a, b) {
    const ka = lapsKey(a), kb = lapsKey(b);
    if (ka !== kb) return kb - ka;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    return b.progress - a.progress;
  }

  const sorted = cars.slice();
  D.updateStandings = (playerId) => {
    for (let i = 0; i < n; i++) sorted[i] = cars[i];
    sorted.sort(cmp);
    const prevPlayerPos = cars[playerId] ? cars[playerId].position : 0;
    const leader = sorted[0];
    for (let i = 0; i < n; i++) {
      const c = sorted[i];
      c.position = i + 1;
      D.order[i] = c.id;
      if (i === 0) { c.gapAhead = 0; c.gapLeader = 0; continue; }
      const ahead = sorted[i - 1];
      if (c.finished && ahead.finished && ahead.lapsCompleted === c.lapsCompleted) {
        c.gapAhead = c.finishTime - ahead.finishTime;
      } else {
        c.gapAhead = Math.max(0, ahead.progress - c.progress) / Math.max(ahead.u, 25);
      }
      if (c.finished && leader.finished && leader.lapsCompleted === c.lapsCompleted) {
        c.gapLeader = c.finishTime - leader.finishTime;
      } else {
        c.gapLeader = Math.max(0, leader.progress - c.progress) / Math.max(leader.u, 25);
      }
    }
    const pc = cars[playerId];
    if (pc && prevPlayerPos && prevPlayerPos !== pc.position &&
        (D.phase === 'racing' || D.phase === 'finishing')) {
      emit('race:position', { carId: playerId, from: prevPlayerPos, to: pc.position });
    }
  };

  /** Should the race end now? (call after standings update) */
  D.shouldEnd = () => {
    if (D.ended || D.flagT == null) return false;
    // Only when every car has crossed the line, or the cut-off after the flag passes (a finished player does NOT
    // end the race early: the rest of the field must be allowed to complete their lap and get a time).
    if (D.finishedCount >= n) return true;
    if (D.raceTime - D.flagT >= cutoff) return true;
    return false;
  };

  D.buildResult = (playerId) => {
    const rows = [];
    const ord = cars.slice().sort(cmp);
    const winner = ord[0];
    const pc = cars[playerId];
    for (let i = 0; i < n; i++) {
      const c = ord[i];
      const m = metas[c.id];
      const lapsCompleted = c.finished ? c.lapsCompleted : Math.min(laps, Math.max(0, Math.floor(c.progress / L)));
      const lapsDown = laps - lapsCompleted;
      rows.push({
        position: i + 1, carId: c.id, teamId: m.teamId, driverCode: m.code, driverName: m.driverName,
        isPlayer: m.isPlayer, finished: c.finished, lapsCompleted,
        totalTime: c.finished ? c.finishTime : null,
        gapToWinner: c.finished && lapsDown === 0 && winner.finished ? c.finishTime - winner.finishTime : null,
        lapsDown, bestLap: c.bestLap, gridPosition: c.grid,
      });
    }
    const prow = rows.find((r) => r.carId === playerId);
    return {
      trackId: config.trackId, minutes: config.minutes, laps, difficulty: config.difficulty, seed: config.seed, date: null,
      playerCarId: playerId, playerTeamId: metas[playerId].teamId, playerName: metas[playerId].driverName,
      playerPosition: prow.position, playerGridPosition: pc.grid,
      playerFinished: pc.finished, playerTotalTime: pc.finished ? pc.finishTime : null, playerBestLap: pc.bestLap,
      playerLapsDown: prow.lapsDown,
      fastestLap: D.fastestLap ? { ...D.fastestLap } : null,
      rows,
    };
  };

  D.finish = (playerId) => {
    if (D.ended) return;
    D.ended = true;
    D.result = D.buildResult(playerId);
    setPhase('finished');
    emit('race:finished', { result: D.result });
  };

  return D;
}
