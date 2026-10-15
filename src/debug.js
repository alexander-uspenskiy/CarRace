// window.__game debug/automation hook (ARCHITECTURE.md §8.2). Installed immediately by main.js,
// even if the game fails to construct; `attach(game)` wires the live objects.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); });
const clone = (o) => (o == null ? o : structuredClone(o));

export function createDebug({ verbose = false } = {}) {
  const errors = [];
  let game = null;
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  const need = () => {
    if (!game) throw new Error('__game: game is not initialised (see __game.errors)');
    return game;
  };
  const pushError = (m) => { if (errors.length < 200) errors.push(String(m)); };

  window.addEventListener('error', (e) => pushError(`${e.message}${e.filename ? ` @ ${e.filename}:${e.lineno}` : ''}`));
  window.addEventListener('unhandledrejection', (e) => pushError('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

  const api = {
    ready,
    errors,
    get state() { return game ? game.flow.state : 'boot'; },
    get save() { return game?.save ?? null; },
    get hof() { return game?.hof ?? null; },
    get bus() { return game?.bus ?? null; },
    get flow() { return game?.flow ?? null; },
    get game() { return game; },

    async startRace(opts = {}) {
      const g = need();
      const o = {
        teamId: 'mclaren', trackId: 'monte-veloce', minutes: 5, difficulty: 'normal',
        driverIndex: 0, seed: 1, autopilot: false, skipIntro: true, ...opts,
      };
      g.flow.force('loading', { manual: true });
      await frame();
      g.startRace({ ...o, allowNoRender: true });
      g.flow.force('race', {});
      const sim = g.sim;
      if (o.skipIntro) {
        let guard = 0;
        while (sim.phase === 'intro' && guard++ < 5) sim.stepFixed(g.input.read());
      } else {
        while (g.sim === sim && sim.phase === 'intro') await sleep(50);
      }
      return clone(sim.getSnapshot());
    },

    fastForward(seconds, { render = false } = {}) {
      const g = need();
      const sim = g.sim;
      if (!sim) throw new Error('__game.fastForward: no race running');
      const n = Math.round(seconds * 120);
      for (let i = 0; i < n; i++) {
        sim.stepFixed(g.input.read());
        if (sim.phase === 'finished') break;
      }
      const snap = sim.getSnapshot();
      if (render && g.host && g.renderer && g.flow.state === 'race') {
        try { g.host.render(0, snap); } catch (e) { pushError(e.message || e); }
      }
      g.hud?.update(snap);
      return clone(snap);
    },

    getSnapshot() { return game ? clone(game.getSnapshot()) : null; },
    getResult() { return game ? clone(game.getResult()) : null; },
    setAutopilot(on) { const g = need(); g.sim?.setPlayerAutopilot(!!on); },
    setInput(partial) { need().input.setOverride(partial); },
    goto(state, params) { need().flow.force(state, params); return true; },
    pause() { return need().pause(); },
    resume() { return need().resume(); },
    stats() { return game ? game.getStats() : { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 }; },
  };

  window.__game = api;

  return {
    api, errors, pushError,
    attach(g) {
      game = g;
      g.firstFrame.then(() => resolveReady(api));
      setTimeout(() => resolveReady(api), 1500); // rAF is throttled in hidden tabs; do not hang automation
      if (verbose) {
        for (const ev of ['flow:state', 'race:created', 'race:phase', 'race:lights', 'race:lap', 'race:fastestLap', 'race:position',
          'race:carFinished', 'race:finished', 'car:wall', 'car:contact', 'car:overheat', 'ui:pause', 'ui:resume', 'ui:restart', 'ui:quit',
          'save:purchase', 'hof:record']) {
          g.bus.on(ev, (p) => console.debug('[bus]', ev, p));
        }
      }
    },
    failed() { resolveReady(api); },
  };
}
