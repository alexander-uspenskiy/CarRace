// RaceSim: fixed 120 Hz simulation of 20 cars (spec §4.2).
import { clamp, mulberry32, angleDiff } from '../core/mathUtil.js';
import { TEAMS, makeDriverCode } from '../data/teams.js';
import { computeCarStats } from '../data/carStats.js';
import { aiLevelsFor } from '../data/raceConfig.js';
import { getTrackDef } from '../data/tracks/index.js';
import { advanceAccumulator } from './fixedStep.js';
import { createCarState, SIM_HZ, SIM_DT, gearAndRpm, crashDamage, MAX_DAMAGE } from './carPhysics.js';
import { DIFFICULTY } from '../data/economy.js';
import { stepCar } from './carStep.js';
import { resolveCarCar } from './collisions.js';
import { buildGrid, gridPose, createDirector } from './raceDirector.js';
import { buildRacingLine } from './ai/racingLine.js';
import { createAiDriver } from './ai/aiDriver.js';
import { buildAiProfile } from './ai/aiProfile.js';
import { planFault, stepFault, FAULTS } from './carFaults.js';
import { COMPOUNDS } from '../data/driverTraits.js';
import { getWeather } from '../data/weather.js';

export { SIM_HZ, SIM_DT };

const NOOP = () => {};
const RESET_COOLDOWN = 3.0;
// Auto-recovery (all cars, incl. the player): put a car back on the track centre when it is stuck or far off track.
export const RECOVERY = {
  startGrace: 4,        // s of racing before stuck detection begins
  stuckSpeed: 2,        // m/s
  stuckPlayerSeconds: 5,
  stuckAiSeconds: 4,
  offTrackSeconds: 8,   // continuously beyond the kerb (grass)
  offTrackMargin: 2.5,  // m beyond the kerb edge that counts as "far off track" (runoff is only 5..12 m wide)
  wrongWaySeconds: 6,
  wrongWayPlayerSeconds: 8,
  cooldown: 1.0,        // s before another reset (auto or manual R) is accepted; short so a human can still press R
  ghostSeconds: 2.5,    // no car-car contact for this long after a reset
};
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false };

export class RaceSim {
  constructor({ config, trackModel, emit = NOOP }) {
    this.config = config;
    this.trackModel = trackModel;
    this.emit = emit || NOOP;
    this.time = 0;
    this.alpha = 0;
    this.accumulator = 0;
    this.autopilot = false;
    this.resetLatched = false;
    this.stepCount = 0;
    this.metas = null;

    const teams = TEAMS;
    const playerTeamIdx = teams.findIndex((t) => t.id === config.teamId);
    this.playerId = (playerTeamIdx < 0 ? 0 : playerTeamIdx) * 2 + (config.driverIndex || 0);

    // metas + stats
    const aiLevels = aiLevelsFor(config.difficulty);
    const metas = [];
    const statsList = [];
    this.profiles = new Array(20).fill(null);
    this.faultPlans = new Array(20).fill(null);
    for (let ti = 0; ti < teams.length; ti++) {
      const team = teams[ti];
      for (let di = 0; di < 2; di++) {
        const drv = team.drivers[di];
        const id = ti * 2 + di;
        const isPlayer = id === this.playerId;
        let stats = computeCarStats(team, isPlayer ? config.upgrades : aiLevels);
        let compound = null;
        if (!isPlayer) {
          // each AI car gets its own character, tyre compound and (maybe) a mechanical problem, all from the race seed
          const profile = buildAiProfile({ driver: drv, config, rng: mulberry32((config.seed + id * 104729 + 0xa11) >>> 0) });
          const cmp = COMPOUNDS[profile.compound];
          stats = { ...stats, tyreMu: stats.tyreMu * cmp.mu, tyreWearMult: stats.tyreWearMult * cmp.wear * profile.wearMgmt };
          compound = profile.compound;
          this.profiles[id] = profile;
          this.faultPlans[id] = planFault(mulberry32((config.seed * 31 + id * 7907 + 0xfa17) >>> 0), {
            strength: team.strength, expectedSeconds: config.expectedSeconds || config.raceSeconds,
          });
        }
        statsList[id] = stats;
        metas[id] = {
          id, teamId: team.id, driverId: drv.id,
          driverName: isPlayer ? config.playerName : drv.name,
          code: isPlayer ? makeDriverCode(config.playerName) : drv.code,
          number: drv.number, isPlayer, color: team.livery.primary, stats, compound,
        };
      }
    }
    this.carMetas = metas;
    this.metas = metas;
    this.stats = statsList;

    // grid
    const dirRng = mulberry32((config.seed ^ 0x5bd1e995) >>> 0);
    const grid = buildGrid(config, teams, dirRng, trackModel);
    this.grid = grid;

    // cars + AI
    this.cars = new Array(20);
    this.drivers = new Array(20);
    this.coolDownDrivers = new Array(20);
    const model = trackModel;
    for (const g of grid) {
      const pose = gridPose(model, g.slot);
      const stats = statsList[g.carId];
      const car = createCarState({ x: pose.x, y: pose.y, heading: pose.heading, speed: 0 }, stats);
      car.id = g.carId; car.grid = g.slot + 1; car.position = g.slot + 1;
      car.tyreGrip = getWeather(config.weather).grip;     // damp track from the first metre
      car.mode = metas[g.carId].isPlayer ? 'player' : 'ai';
      const dcfg = DIFFICULTY[config.difficulty] ?? DIFFICULTY.normal;
      car.assist = metas[g.carId].isPlayer ? Math.max(config.steerAssist ?? 0.5, dcfg.steerAssistMin ?? 0) : 0;
      car.steerEase = metas[g.carId].isPlayer ? (dcfg.steerEase ?? 0) : 0;
      car.laneAssist = metas[g.carId].isPlayer ? (dcfg.laneAssist ?? 0) : 0;
      car.trackHalf = model.halfWidth;
      car.progress = pose.s - model.length;
      car.gapAhead = 0; car.gapLeader = 0; car.lapsCompleted = 0;
      const p = model.project(car.x, car.y, 0);
      car.s = p.s; car.d = p.d; car.index = p.index; car.trackHeading = p.heading; car.prevS = p.s;
      car.lastGood = { x: car.x, y: car.y, s: car.s, d: car.d };
      this.cars[g.carId] = car;
      const driver = teams[Math.floor(g.carId / 2)].drivers[g.carId % 2];
      const line = buildRacingLine(model, stats);
      const aiOpts = {
        trackModel: model, stats, driver, difficulty: config.difficulty,
        rng: mulberry32((config.seed + g.carId * 7919) >>> 0), racingLine: line,
      };
      if (!metas[g.carId].isPlayer) aiOpts.profile = this.profiles[g.carId];
      if (!metas[g.carId].isPlayer) {
        this.drivers[g.carId] = createAiDriver(aiOpts);
        car.ai = this.drivers[g.carId].state;
      } else {
        this.drivers[g.carId] = null;
        this.autopilotDriver = createAiDriver({
          ...aiOpts, profile: null, driver: { skill: 1 }, paceOverride: config.autopilotPace ?? 0.96, noMistakes: true, difficulty: 'normal',
          rng: mulberry32((config.seed + 12345) >>> 0),
        });
        this.coolDownDrivers[g.carId] = createAiDriver({
          ...aiOpts, driver: { skill: 1 }, paceOverride: 0.55, noMistakes: true, difficulty: 'normal',
          rng: mulberry32((config.seed + 54321) >>> 0),
        });
      }
    }

    this.world = { cars: this.cars, playerId: this.playerId, raceTime: 0, phase: 'intro', length: model.length };
    this.director = createDirector({
      config, trackModel, cars: this.cars, metas, emit: (n, p) => this.emit(n, p),
      rng: dirRng, referenceLapTime: getTrackDef(config.trackId)?.referenceLapTime,
      onCarFinished: (car) => this._onCarFinished(car),
    });
    this.director.updateStandings(this.playerId);
    this._buildSnapshot();
    this._lastContact = new Array(20).fill(-1);
  }

  get phase() { return this.director.phase; }
  get raceTime() { return this.director.raceTime; }

  skipIntro() { this.director.skipIntro(); }
  /** Drive the player's car with the AI controller (headless tests, __game). opts.pace overrides the 0.96 default. */
  setPlayerAutopilot(on, opts = null) {
    this.autopilot = !!on;
    if (opts && opts.pace != null) {
      const id = this.playerId;
      const p0 = this.autopilotDriver;
      this.autopilotDriver = createAiDriver({
        trackModel: this.trackModel, stats: this.stats[id], driver: { skill: 1 }, difficulty: 'normal',
        rng: mulberry32((this.config.seed + 12345) >>> 0), racingLine: p0.line, paceOverride: opts.pace, noMistakes: true,
      });
    }
  }
  getResult() { return this.director.result; }

  update(frameDt, playerInput) {
    if (playerInput && playerInput.reset) this.resetLatched = true;
    const r = advanceAccumulator(this.accumulator, frameDt, SIM_HZ);
    this.accumulator = r.acc; // in steps, [0,1)
    const steps = r.steps;
    for (let i = 0; i < steps; i++) this.stepFixed(playerInput);
    this.alpha = this.accumulator;
    return steps;
  }

  resetCarToTrack(carId) {
    const car = this.cars[carId];
    const model = this.trackModel;
    const lg = car.lastGood || { s: car.s };
    const s = lg.s;
    const p = model.sampleAt(s);
    const d = clamp(lg.d || 0, -model.halfWidth * 0.6, model.halfWidth * 0.6);
    car.x = p.x + d * p.nx; car.y = p.y + d * p.ny; car.heading = p.heading;
    car.prevX = car.x; car.prevY = car.y; car.prevHeading = car.heading;
    car.u = 0; car.v = 0; car.yawRate = 0; car.steerAngle = 0; car.ax = 0; car.ay = 0;
    car.inSteer = 0; car.inThrottle = 0; car.inBrake = 0; car.stuckT = 0; car.wrongWayT = 0;
    const pr = model.project(car.x, car.y, p.index);
    // keep progress continuous: pick the lap offset nearest the current progress
    const L = model.length;
    const k = Math.round((car.progress - pr.s) / L);
    car.progress = k * L + pr.s;
    car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading; car.prevS = pr.s;
    car.resetCooldown = RESET_COOLDOWN;
    car.lastGoodT = 0;
    car.offTrackT = 0; car.revT = 0; car.ghost = RECOVERY.ghostSeconds;
    const ai = this.drivers[carId];
    if (ai) { ai.state.init = false; ai.state.passSide = 0; }
    this.emit('car:reset', { carId, reason: 'manual', auto: false, x: car.x, y: car.y });
  }

  /**
   * Auto-recovery: teleport to the track centre at the nearest point (car.s), facing forward, speed 0,
   * with a short ghost period (no car-car contact). reason: 'stuck' | 'offtrack' | 'wrongway'.
   */
  recoverCar(carId, reason) {
    const car = this.cars[carId];
    const model = this.trackModel;
    const p = model.sampleAt(car.s);
    car.x = p.x; car.y = p.y; car.heading = p.heading;
    car.prevX = car.x; car.prevY = car.y; car.prevHeading = car.heading;
    car.u = 0; car.v = 0; car.yawRate = 0; car.steerAngle = 0; car.ax = 0; car.ay = 0;
    car.inSteer = 0; car.inThrottle = 0; car.inBrake = 0; car.stuckT = 0; car.wrongWayT = 0; car.wrongWay = false;
    car.offTrackT = 0; car.revT = 0;
    const pr = model.project(car.x, car.y, p.index);
    const L = model.length;
    const k = Math.round((car.progress - pr.s) / L);
    car.progress = k * L + pr.s;
    car.s = pr.s; car.d = pr.d; car.index = pr.index; car.trackHeading = pr.heading; car.prevS = pr.s;
    car.surface = 'asphalt'; car.wheelsGrass = 0; car.wheelsKerb = 0;
    car.lastGood = { x: car.x, y: car.y, s: car.s, d: car.d };
    car.lastGoodT = 0;
    car.resetCooldown = RECOVERY.cooldown;
    car.ghost = RECOVERY.ghostSeconds;
    const ai = this.drivers[carId];
    if (ai) { ai.state.init = false; ai.state.passSide = 0; }
    this.emit('car:reset', { carId, reason, auto: true, x: car.x, y: car.y });
  }

  _onCarFinished(car) {
    const id = car.id;
    if (this.metas[id].isPlayer) {
      // cool-down autopilot takes over the player's car
      car.mode = 'ai';
    } else {
      this.drivers[id].setPaceMult(0.55);
    }
  }

  stepFixed(playerInput) {
    const dt = SIM_DT;
    const dir = this.director;
    const cars = this.cars, model = this.trackModel, world = this.world;
    const pin = playerInput || NEUTRAL;
    this.time += dt;
    dir.step(dt);
    world.raceTime = dir.raceTime;
    world.phase = dir.phase;
    const locked = dir.locked();
    const racing = !locked;
    const emit = this.emit;
    const L = model.length;

    // latched reset (player)
    if (pin.reset) this.resetLatched = true;
    if (this.resetLatched) {
      const pc = cars[this.playerId];
      if (pc.resetCooldown <= 0 && !pc.finished && !locked) {
        this.resetCarToTrack(this.playerId);
      }
      this.resetLatched = false;
    }

    // --- per-car physics ---
    for (let i = 0; i < 20; i++) {
      const car = cars[i];
      const stats = this.stats[i];
      car.prevX = car.x; car.prevY = car.y; car.prevHeading = car.heading;
      if (car.resetCooldown > 0) car.resetCooldown -= dt;
      if (car.ghost > 0) car.ghost -= dt;
      const isPlayer = i === this.playerId;
      let raw;
      if (locked) raw = NEUTRAL;
      else if (isPlayer && !car.finished && !this.autopilot) raw = pin;
      else if (isPlayer) raw = (car.finished ? this.coolDownDrivers[i] : this.autopilotDriver).drive(car, world, dt);
      else raw = this.drivers[i].drive(car, world, dt);
      if (isPlayer) car.mode = (car.finished || this.autopilot) ? 'ai' : 'player';

      const plan = this.faultPlans[i];
      if (plan && racing) {
        const fev = stepFault(plan, car, dir.raceTime);
        if (fev) emit('car:issue', { carId: i, kind: plan.kind, label: FAULTS[plan.kind].label, phase: fev });
      }

      // slipstream
      let draft = 0;
      if (racing) {
        for (let k = 0; k < 20; k++) {
          if (k === i) continue;
          const o = cars[k];
          let ds = o.s - car.s;
          if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
          if (ds > 6 && ds < 28 && Math.abs(o.d - car.d) < 2.2) {
            const dr = 0.18 * (1 - ds / 28);
            if (dr > draft) draft = dr;
          }
        }
      }
      const prevSurface = car.surface;
      stepCar(car, stats, raw, { trackModel: model, config: this.config, locked, draft }, dt);
      if (car.overheatEvent) emit('car:overheat', { carId: i });
      if (car.wallImpact > 3 && car.wallCooldown <= 0) {
        car.wallCooldown = 0.4; car.contact = 1;
        this._damage(i, crashDamage(car.wallImpact, this._damageScale(i)));
        if (car.hitSide) car.pull = car.hitSide;
        emit('car:wall', { carId: i, speed: car.wallImpact, x: car.x, y: car.y });
      }
      if (car.wallCooldown > 0) car.wallCooldown -= dt;
      if (isPlayer && car.surface !== prevSurface) emit('car:surface', { carId: i, surface: car.surface });
      if (car.contact > 0) car.contact = Math.max(0, car.contact - dt / 0.5);

      // progress
      let ds = car.s - car.prevS;
      if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      const prevProg = car.progress;
      car.progress += ds;
      dir.onProgress(car, prevProg, dt);

      // wrong way
      const cosA = Math.cos(car.heading - car.trackHeading);
      if (cosA < -0.3 && car.u > 3) car.wrongWayT += dt; else car.wrongWayT = 0;
      car.wrongWay = car.wrongWayT > 1.5;

      // last good pose
      if (car.surface !== 'grass' && Math.abs(car.d) < model.halfWidth + model.kerbWidth && cosA > 0.5) {
        car.lastGoodT += dt;
        if (car.lastGoodT >= 0.25) { car.lastGoodT = 0; car.lastGood.x = car.x; car.lastGood.y = car.y; car.lastGood.s = car.s; car.lastGood.d = car.d; }
      }

      // Auto-recovery (every car, incl. a human player): stuck / far off track / wrong way -> back to the track centre
      if (racing && dir.raceTime > RECOVERY.startGrace && car.resetCooldown <= 0 && dir.phase !== 'finished') {
        const human = isPlayer && !car.finished && !this.autopilot;
        const slow = Math.hypot(car.u, car.v) < RECOVERY.stuckSpeed;
        if (slow) car.stuckT += dt; else car.stuckT = 0;
        const edge = model.halfWidth + model.kerbWidth + RECOVERY.offTrackMargin;
        if (Math.abs(car.d) > edge) car.offTrackT += dt; else car.offTrackT = 0;
        let reason = null;
        if (car.stuckT > (human ? RECOVERY.stuckPlayerSeconds : RECOVERY.stuckAiSeconds)) reason = 'stuck';
        else if (car.offTrackT > RECOVERY.offTrackSeconds) reason = 'offtrack';
        else if (car.wrongWayT > (human ? RECOVERY.wrongWayPlayerSeconds : RECOVERY.wrongWaySeconds)) reason = 'wrongway';
        if (reason) this.recoverCar(i, reason);
      }
    }

    // --- car-car collisions ---
    for (let i = 0; i < 20; i++) {
      const a = cars[i];
      for (let j = i + 1; j < 20; j++) {
        const b = cars[j];
        if (a.ghost > 0 || b.ghost > 0) continue;
        const dx = b.x - a.x;
        if (dx > 8 || dx < -8) continue;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > 64) continue;
        const sp = resolveCarCar(a, b, this.stats[i], this.stats[j]);
        if (sp > 0) {
          a.contact = Math.max(a.contact, Math.min(1, sp / 6));
          b.contact = Math.max(b.contact, Math.min(1, sp / 6));
          if (sp > 2) {
            this._damage(i, crashDamage(sp, this._damageScale(i), true));
            this._damage(j, crashDamage(sp, this._damageScale(j), true));
            if (a.hitSide) a.pull = a.hitSide; if (b.hitSide) b.pull = b.hitSide;
            if (this.time - (this._lastContact[i]) > 0.4 || this._lastContact[i] < 0) { this._lastContact[i] = this.time; emit('car:contact', { carId: i, otherId: j, speed: sp, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
            if (this.time - (this._lastContact[j]) > 0.4 || this._lastContact[j] < 0) { this._lastContact[j] = this.time; emit('car:contact', { carId: j, otherId: i, speed: sp, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
          }
        }
      }
    }

    // --- standings, end ---
    dir.updateStandings(this.playerId);
    if (dir.phase !== 'finished' && dir.shouldEnd()) dir.finish(this.playerId);
    this.stepCount++;
  }

  // ---------------- damage ----------------
  _damageScale(i) {
    if (!this.metas[i].isPlayer) return 0.6;      // AI cars take (a bit less) damage too, so a pile-up slows the field down
    return (DIFFICULTY[this.config.difficulty] ?? DIFFICULTY.normal).playerDamage ?? 1;
  }

  _damage(i, amount) {
    if (!(amount > 0)) return;
    const car = this.cars[i];
    const before = car.damage;
    car.damage = Math.min(MAX_DAMAGE, before + amount);
    if (car.damage > before) this.emit('car:damage', { carId: i, damage: car.damage, added: car.damage - before });
  }

  // ---------------- snapshot ----------------
  _buildSnapshot() {
    const cars = [];
    for (let i = 0; i < 20; i++) cars.push({});
    this._snap = {
      phase: 'intro', time: 0, raceTime: 0, introT: 0, lights: { lit: 0, out: false },
      laps: this.config.laps, minutes: this.config.minutes, playerId: this.playerId, leaderId: 0,
      order: new Array(20).fill(0), fastestLap: null, cars,
      damageOn: (DIFFICULTY[this.config.difficulty] ?? DIFFICULTY.normal).playerDamage > 0,
    };
    this._fillSnapshot(0);
  }

  _fillSnapshot(alpha) {
    const S = this._snap, dir = this.director;
    S.phase = dir.phase; S.time = this.time; S.raceTime = dir.raceTime; S.introT = dir.introT;
    S.lights.lit = dir.out ? 0 : dir.lit; S.lights.out = dir.out;
    S.leaderId = dir.order[0];
    for (let i = 0; i < 20; i++) S.order[i] = dir.order[i];
    S.fastestLap = dir.fastestLap;
    const racingT = dir.phase === 'racing' || dir.phase === 'finishing' || dir.phase === 'finished';
    for (let i = 0; i < 20; i++) {
      const c = this.cars[i], m = this.metas[i], o = S.cars[i];
      o.id = i; o.isPlayer = m.isPlayer; o.teamId = m.teamId; o.code = m.code; o.number = m.number; o.color = m.color;
      o.x = c.prevX + (c.x - c.prevX) * alpha;
      o.y = c.prevY + (c.y - c.prevY) * alpha;
      o.heading = c.prevHeading + angleDiff(c.heading, c.prevHeading) * alpha;
      const speed = Math.hypot(c.u, c.v);
      o.speed = speed; o.u = c.u; o.v = c.v; o.yawRate = c.yawRate; o.steerAngle = c.steerAngle;
      o.ax = c.ax; o.ay = c.ay; o.throttle = c.inThrottle; o.brake = c.inBrake;
      const gr = gearAndRpm(c.u);
      o.gear = gr.gear; o.rpm = gr.rpm;
      o.slip = c.slip; o.surface = c.surface;
      o.s = c.s; o.d = c.d; o.progress = c.progress; o.lap = c.finished ? this.config.laps : this.director.lapNumber(c);
      o.position = c.position; o.grid = c.grid;
      o.lapTime = c.finished ? (c.lastLap ?? 0) : (racingT ? Math.max(0, dir.raceTime - c.lapStartT) : 0);
      o.lastLap = c.lastLap; o.bestLap = c.bestLap;
      o.gapAhead = c.gapAhead || 0; o.gapLeader = c.gapLeader || 0;
      o.compound = m.compound; o.issue = this.faultPlans[i] && this.faultPlans[i].started && !this.faultPlans[i].ended ? this.faultPlans[i].kind : null;
      o.damage = c.damage; o.tyreWear = c.tyreWear; o.tyreGrip = c.tyreGrip; o.heat = c.heat; o.ers = c.ers; o.boosting = c.boosting;
      o.wrongWay = c.wrongWay; o.ghost = c.ghost > 0 ? Math.min(1, c.ghost / RECOVERY.ghostSeconds) : 0; o.finished = c.finished; o.finishTime = c.finishTime; o.contact = c.contact;
    }
  }

  getSnapshot(alpha = this.alpha) {
    this._fillSnapshot(alpha);
    return this._snap;
  }
}
