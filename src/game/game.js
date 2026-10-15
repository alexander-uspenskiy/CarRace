// Game orchestrator: owns bus, flow, save/hof, render host, audio, sim, HUD and the main loop.
import { createEventBus } from '../core/eventBus.js';
import { getDefaultStorage } from '../core/storage.js';
import { createSaveStore } from '../data/saveStore.js';
import { createHallOfFame } from '../data/hallOfFame.js';
import { getTrackDef, getTrackModel } from '../data/tracks/index.js';
import { RenderHost } from '../render/renderHost.js';
import { CarPreviewController } from '../render/carPreview.js';
import { RaceController } from '../render/raceController.js';
import { AudioEngine } from '../audio/audioEngine.js';
import { RaceSim } from '../sim/raceSim.js';
import { createFlowMachine } from '../ui/flowMachine.js';
import { createInput } from '../ui/input.js';
import { createTouchControls } from '../ui/touchControls.js';
import { createHud } from '../ui/hud.js';
import { createRaceConfig } from '../ui/dataRefs.js';
import { h } from '../ui/dom.js';
import { createHelpOverlay } from '../ui/settingsPanel.js';
import { createTitleScreen } from '../ui/screens/title.js';
import { createTeamSelectScreen } from '../ui/screens/teamSelect.js';
import { createTrackSelectScreen } from '../ui/screens/trackSelect.js';
import { createRaceSettingsScreen } from '../ui/screens/raceSettings.js';
import { createGarageScreen } from '../ui/screens/garage.js';
import { createLoadingScreen } from '../ui/screens/loading.js';
import { createPauseMenuScreen } from '../ui/screens/pauseMenu.js';
import { createResultsScreen } from '../ui/screens/results.js';
import { createHallOfFameScreen } from '../ui/screens/hallOfFame.js';
import { finalizeRace } from './raceFinish.js';

const inRaceState = (s) => s === 'race' || s === 'paused';
const BACKDROP_STATES = new Set(['title', 'track', 'settings', 'hof', 'loading']);

/** Audio wrapper: never lets an audio bug break the game. */
function makeSafeAudio(engine, onError) {
  let fails = 0;
  const guard = (name, fn) => (...args) => {
    if (!engine || fails > 20) return undefined;
    try { return fn(...args); } catch (e) { fails++; if (fails <= 3) onError(e); return undefined; }
  };
  return {
    engine,
    init: guard('init', () => engine.init()),
    setMasterVolume: guard('vol', (v) => engine.setMasterVolume(v)),
    setPaused: guard('paused', (p) => engine.setPaused(p)),
    update: guard('update', (c, dt, s) => engine.update(c, dt, s)),
    playSfx: guard('sfx', (n) => engine.playSfx(n)),
    dispose: guard('dispose', () => engine.dispose()),
  };
}

export function createGame({ canvas, uiRoot, storage, bus, onError = () => {} }) {
  bus = bus || createEventBus();
  storage = storage || getDefaultStorage();
  const save = createSaveStore(storage, bus);
  const hof = createHallOfFame(storage);
  const settings0 = save.get().settings;

  const reportError = (e) => {
    const msg = e && (e.stack || e.message) ? String(e.message || e) : String(e);
    // eslint-disable-next-line no-console
    console.error('[game]', e);
    try { onError(msg); } catch { /* ignore */ }
  };

  // ---------- WebGL (graceful degradation) ----------
  let host = null, preview = null, webglError = null;
  try {
    host = new RenderHost(canvas, { quality: settings0.quality });
    preview = new CarPreviewController({ quality: settings0.quality });
  } catch (e) {
    webglError = (e && e.message) || 'WebGL initialisation failed.';
    host = null; preview = null;
    reportError(e);
  }
  let lastQuality = settings0.quality;

  const audio = makeSafeAudio(new AudioEngine(), reportError);
  audio.setMasterVolume(settings0.volume);

  const flow = createFlowMachine({ initial: 'title' });

  // ---------- state ----------
  let sim = null, renderer = null, lastOpts = null, lastResults = null;
  let finalizedSim = null;
  let activeController = null, backdropKey = null;
  let dragDelta = 0;
  let rafId = 0, lastT = 0, disposed = false;
  let firstFrameResolve; const firstFrame = new Promise((r) => { firstFrameResolve = r; });
  const perf = { fps: 60, frameMs: 16 };

  const game = {
    bus, flow, save, hof, audio, host, preview, webglError,
    storageIsMemory: storage.isMemory === true,
    get storageUnsaved() { return storage.isMemory === true || storage.writeFailed === true; },
    get sim() { return sim; },
    get renderer() { return renderer; },
    get lastOpts() { return lastOpts; },
    get lastResults() { return lastResults; },
    firstFrame, reportError, perf,
  };

  // ---------- HUD, help, input ----------
  const hud = createHud({ root: uiRoot, bus, save, onPause: () => game.pause(), onSkipIntro: () => handleAction('enter') });
  game.hud = hud;
  const help = createHelpOverlay(uiRoot);
  game.help = help;
  const input = createInput({
    isRaceActive: () => flow.state === 'race',
    onAction: (a) => handleAction(a),
  });
  game.input = input;
  // on-screen controls (shown only while racing; CSS keeps them hidden unless <html> has the `touch` class)
  const touch = createTouchControls({
    root: uiRoot,
    onAction: (a) => handleAction(a),
    onReset: () => input.pulseReset(),
  });
  input.setTouchSource(touch.read);
  game.touch = touch;

  function handleAction(a) {
    const st = flow.state;
    if (a === 'pause') {
      if (help.visible) { help.hide(); return; }
      if (st === 'race') game.pause(); else if (st === 'paused') game.resume();
    } else if (a === 'camera') {
      if (st === 'race' && renderer) {
        renderer.cycleCamera();
        try { save.setSettings({ defaultCamera: renderer.getCameraMode() }); } catch { /* ignore */ }
        hud.toast(`CAMERA: ${String(renderer.getCameraMode()).toUpperCase()}`, '', 1200);
      }
    } else if (a === 'enter') {
      if (st === 'race' && sim && sim.phase === 'intro') sim.skipIntro();
    } else if (a === 'help') {
      if (st === 'race') game.pause();
      help.toggle();
    }
  }

  // non-blocking notice when progress cannot be persisted (private mode, quota, disabled storage)
  const storageNotice = h('div.storage-notice.hidden', { role: 'status' }, "Progress isn't being saved (browser storage unavailable).");
  uiRoot.append(storageNotice);
  const refreshStorageNotice = () => storageNotice.classList.toggle('hidden', !game.storageUnsaved || inRaceState(flow.state));
  refreshStorageNotice();
  bus.on('save:changed', refreshStorageNotice);
  bus.on('hof:record', refreshStorageNotice);
  flow.onChange(refreshStorageNotice);

  // ---------- screens ----------
  const ctx = { game, bus, save, hof, flow, audio };
  const screens = {
    title: createTitleScreen(ctx),
    team: createTeamSelectScreen(ctx),
    track: createTrackSelectScreen(ctx),
    settings: createRaceSettingsScreen(ctx),
    garage: createGarageScreen(ctx),
    loading: createLoadingScreen(ctx),
    paused: createPauseMenuScreen(ctx),
    results: createResultsScreen(ctx),
    hof: createHallOfFameScreen(ctx),
  };
  for (const s of Object.values(screens)) { s.el.classList.add('hidden'); uiRoot.append(s.el); }
  let shownScreen = null;
  function showScreen(state, params) {
    if (shownScreen) {
      try { shownScreen.hide?.(); } catch (e) { reportError(e); }
      shownScreen.el.classList.add('hidden');
      shownScreen = null;
    }
    const s = screens[state];
    if (!s) return;
    shownScreen = s;
    s.el.classList.remove('hidden');
    try { s.show(params); } catch (e) { reportError(e); }
  }

  // ---------- controllers / backdrop ----------
  function setController(c) {
    if (!host) return;
    if (activeController === c) return;
    activeController = c;
    try { host.setController(c); } catch (e) { reportError(e); }
  }
  function ensureBackdrop(state) {
    if (!host || !preview) return;
    setController(preview);
    if (state === 'results') { backdropKey = null; return; }
    if (BACKDROP_STATES.has(state)) {
      const l = save.get().last;
      const key = `${l.teamId}:${l.driverIndex}`;
      if (key !== backdropKey) {
        backdropKey = key;
        try { preview.showTeam(l.teamId, l.driverIndex === 1 ? 1 : 0); } catch (e) { reportError(e); }
      }
    } else {
      backdropKey = null; // team/garage screens drive the preview themselves
    }
  }

  function disposeRenderer() {
    if (renderer) {
      const r = renderer;
      renderer = null;
      if (activeController === r) activeController = null;
      try { r.dispose(); } catch (e) { reportError(e); }
    }
  }

  function leaveRace() {
    disposeRenderer();
    hud.end();
    hud.hide();
    audio.setPaused(true);
    if (finalizedSim !== sim) sim = null; // unfinished race: drop sim; finished sim stays for getResult()
  }

  // ---------- flow wiring (registered first so screens see consistent state) ----------
  flow.onChange((from, to, params) => {
    try {
      bus.emit('flow:state', { from, to, params });
      if (to === 'paused') audio.setPaused(true);
      touch.setVisible(to === 'race');
      if (to === 'race') { audio.setPaused(false); input.clear(); hud.show(); try { document.activeElement?.blur?.(); } catch { /* ignore */ } }
      if (inRaceState(from) && !inRaceState(to)) leaveRace();
      // the HUD must never stay on screen outside race/paused (e.g. __game.goto('title') mid-race)
      if (!inRaceState(to)) { if (hud.el && !hud.el.classList.contains('hidden')) { hud.end(); hud.hide(); } }
      if (!inRaceState(to)) ensureBackdrop(to);
      showScreen(to, params);
    } catch (e) { reportError(e); }
  });
  showScreen('title', {});
  ensureBackdrop('title');

  // ---------- race lifecycle ----------
  function startRace(opts = {}) {
    const last = save.get().last;
    const o = {
      teamId: opts.teamId ?? last.teamId,
      trackId: opts.trackId ?? last.trackId,
      minutes: opts.minutes ?? last.minutes,
      difficulty: opts.difficulty ?? last.difficulty,
      driverIndex: opts.driverIndex ?? last.driverIndex ?? 0,
      seed: opts.seed ?? (Date.now() % 2147483647),
      weather: opts.weather,
      autopilot: !!opts.autopilot,
      skipIntro: !!opts.skipIntro,
      allowNoRender: !!opts.allowNoRender,
    };
    if (!host && !o.allowNoRender) throw new Error(webglError || 'WebGL is not available.');
    disposeRenderer();
    hud.end();
    sim = null;
    lastOpts = { ...o };

    const trackDef = getTrackDef(o.trackId);
    const trackModel = getTrackModel(o.trackId);
    const sv = save.get();
    const config = createRaceConfig({
      trackId: o.trackId, minutes: o.minutes, difficulty: o.difficulty, teamId: o.teamId,
      driverIndex: o.driverIndex === 1 ? 1 : 0, playerName: sv.playerName, seed: o.seed, weather: o.weather,
      upgrades: save.getUpgrades(o.teamId), steerAssist: sv.settings.steerAssist,
    }, trackDef);

    lastOpts.weather = config.weather;      // a restart keeps the conditions (only the seed re-rolls)
    const newSim = new RaceSim({ config, trackModel, emit: (n, p) => bus.emit(n, p) });
    sim = newSim;
    lastResults = null;
    bus.emit('race:created', { config, metas: newSim.carMetas });

    if (host) {
      renderer = new RaceController({
        trackDef, trackModel, carMetas: newSim.carMetas, playerId: newSim.playerId, quality: sv.settings.quality, weather: config.weather,
      });
      activeController = null;
      setController(renderer);
      try { renderer.setCameraMode(sv.settings.defaultCamera || 'chase'); } catch (e) { reportError(e); }
    }
    hud.begin({ config, trackDef, trackModel, carMetas: newSim.carMetas, playerId: newSim.playerId });
    if (o.autopilot) newSim.setPlayerAutopilot(true);
    if (o.skipIntro) newSim.skipIntro();
    audio.setPaused(false);
    return newSim;
  }

  function restartRace() {
    if (!lastOpts) throw new Error('No race to restart');
    bus.emit('ui:restart', {});
    const s = startRace({ ...lastOpts, seed: (Date.now() ^ (lastOpts.seed * 7919)) % 2147483647 });
    if (flow.state === 'paused') flow.transition('race');
    return s;
  }

  function quitRace() {
    bus.emit('ui:quit', {});
    if (flow.state === 'paused') flow.transition('title');
    else if (flow.state === 'race') flow.force('title');
    else if (flow.state !== 'title') flow.force('title');
  }

  function pause() {
    if (flow.state !== 'race') return false;
    if (!flow.transition('paused')) return false;
    bus.emit('ui:pause', {});
    return true;
  }
  function resume() {
    if (flow.state !== 'paused') return false;
    if (!flow.transition('race')) return false;
    bus.emit('ui:resume', {});
    return true;
  }

  // race finished (can fire synchronously inside sim.stepFixed)
  bus.on('race:finished', ({ result }) => {
    if (!sim || finalizedSim === sim) return;
    finalizedSim = sim;
    try {
      const out = finalizeRace({ result, config: sim.config, save, hof });
      lastResults = out;
      bus.emit('hof:record', { records: out.newRecords });
      if (!flow.transition('results', out)) flow.force('results', out);
    } catch (e) { reportError(e); }
  });

  // SFX mapping
  bus.on('race:lights', ({ lit }) => audio.playSfx(lit > 0 ? 'lightBeep' : 'go'));
  bus.on('race:lap', (e) => { if (e.isPlayer) audio.playSfx('lapBeep'); });
  bus.on('race:fastestLap', () => audio.playSfx('fastestLap'));
  bus.on('car:wall', (e) => { if (sim && e.carId === sim.playerId) audio.playSfx('wall'); });
  bus.on('car:contact', (e) => { if (sim && e.carId === sim.playerId) audio.playSfx('contact'); });

  // ---------- settings ----------
  game.applySettings = () => {
    const s = save.get().settings;
    audio.setMasterVolume(s.volume);
    if (host && s.quality !== lastQuality) {
      lastQuality = s.quality;
      try { host.setQuality(s.quality); } catch (e) { reportError(e); }
    }
  };
  game.setCameraMode = (m) => { try { renderer?.setCameraMode(m); } catch (e) { reportError(e); } };

  // ---------- main loop ----------
  function tick(t) {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60;
    if (lastT) {
      const ms = t - lastT;
      perf.frameMs += (ms - perf.frameMs) * 0.1;
      perf.fps = 1000 / Math.max(perf.frameMs, 0.1);
    }
    lastT = t;
    const st = flow.state;
    if (st === 'race' && sim) {
      sim.update(dt, input.read());
      if (flow.state === 'race' && sim) {
        const snap = sim.getSnapshot();
        if (host && renderer) host.render(dt, snap);
        hud.update(snap);
        audio.update(snap.cars[snap.playerId], dt, snap);
      } else if (host) {
        host.render(dt, { pointerDragDelta: 0 });
      }
    } else if (st === 'paused' && sim) {
      if (host && renderer) host.render(dt, sim.getSnapshot());
    } else if (host) {
      host.render(dt, { pointerDragDelta: dragDelta });
    }
    dragDelta = 0;
    if (firstFrameResolve) { firstFrameResolve(); firstFrameResolve = null; }
  }
  // A throwing frame never kills the loop: it is logged (-> __game.errors) and the next frame is already scheduled.
  // After repeated consecutive failures the race is abandoned and a friendly message is shown (once).
  let errCount = 0, errStreak = 0, gaveUp = false;
  function frame(t) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    try {
      tick(t);
      errStreak = 0;
    } catch (e) {
      errCount++;
      errStreak++;
      if (errCount <= 20) reportError(e);
      if (errStreak >= 5 && !gaveUp) {
        gaveUp = true;
        try { if (inRaceState(flow.state)) flow.force('title'); } catch (e2) { reportError(e2); }
        game.fatal('The game hit repeated errors and had to stop the current race. You can reload the page to start fresh.');
      }
    }
  }
  rafId = requestAnimationFrame(frame);

  // ---------- DOM listeners ----------
  const cleanups = [];
  const listen = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); };

  listen(window, 'resize', () => { try { host?.resize(); } catch (e) { reportError(e); } });
  listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });

  // audio unlock on first gesture
  const unlock = () => { audio.init(); };
  listen(window, 'pointerdown', unlock, { once: true });
  listen(window, 'keydown', unlock, { once: true });
  // UI click sound
  listen(uiRoot, 'pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled) { audio.init(); audio.playSfx('click'); }
  });
  // 3D preview drag
  let dragging = false, lastX = 0;
  listen(canvas, 'pointerdown', (e) => { dragging = true; lastX = e.clientX; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  listen(canvas, 'pointermove', (e) => { if (dragging) { dragDelta += e.clientX - lastX; lastX = e.clientX; } });
  const endDrag = () => { dragging = false; };
  listen(canvas, 'pointerup', endDrag);
  listen(canvas, 'pointercancel', endDrag);
  listen(canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    reportError(new Error('WebGL context lost'));
    game.fatal('The graphics context was lost (the GPU reset or ran out of memory). Please reload the page to continue.');
  });

  let fatalCard = null;
  game.fatal = (message) => {
    fatalCard?.remove();
    fatalCard = h('div.fatal.panel', h('h2', 'Something went wrong'), h('p', message),
      h('div.row.center', h('button.btn.btn-primary', { type: 'button', onclick: () => location.reload() }, 'RELOAD')));
    uiRoot.append(fatalCard);
  };

  // ---------- public API ----------
  Object.assign(game, {
    startRace, restartRace, quitRace, pause, resume,
    getSnapshot: () => (sim ? sim.getSnapshot() : null),
    getResult: () => (lastResults?.result ?? (sim ? sim.getResult() : null)),
    getStats() {
      const info = host?.renderer?.info;
      return {
        fps: Math.round(perf.fps * 10) / 10,
        frameMs: Math.round(perf.frameMs * 100) / 100,
        drawCalls: info ? info.render.calls : 0,
        triangles: info ? info.render.triangles : 0,
        geometries: info ? info.memory.geometries : 0,
        textures: info ? info.memory.textures : 0,
        programs: info && info.programs ? info.programs.length : 0,
        heapMB: (typeof performance !== 'undefined' && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined,
      };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      cleanups.forEach((c) => c());
      input.dispose();
      touch.dispose();
      disposeRenderer();
      hud.dispose();
      audio.dispose();
      try { host?.dispose(); } catch { /* ignore */ }
    },
  });
  return game;
}
