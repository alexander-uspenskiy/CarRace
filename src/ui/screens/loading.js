import { h, button } from '../dom.js';
import { getTrackDef } from '../../data/tracks/index.js';
import { getTeam } from '../../data/teams.js';

function nextFrame() {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(fin);
    setTimeout(fin, 120); // rAF can be throttled in background tabs
  });
}

export function createLoadingScreen(ctx) {
  const { game, save, flow } = ctx;
  const trackName = h('h2');
  const sub = h('p.muted');
  const spinner = h('div.spinner');
  const status = h('p.load-status', 'Building circuit…');
  const errBox = h('div.load-error.hidden');
  const backBtn = button('BACK TO MENU', () => flow.force('title'), 'btn-primary');
  const el = h('section.screen.screen-loading',
    h('div.panel.loading-card', h('div.load-label', 'LOADING'), trackName, sub, spinner, status, errBox, h('div.row.center', backBtn)));
  backBtn.parentElement.classList.add('hidden');
  let token = 0;

  async function run(params) {
    const my = ++token;
    await nextFrame();
    await nextFrame();
    if (my !== token || flow.state !== 'loading') return;
    try {
      if (params.restart) game.restartRace();
      else game.startRace({});
      if (my !== token) return;
      if (!flow.transition('race')) flow.force('race');
    } catch (e) {
      console.error('[loading] failed to start race', e);
      game.reportError?.(e);
      spinner.classList.add('hidden');
      status.textContent = '';
      errBox.classList.remove('hidden');
      errBox.textContent = game.webglError
        ? `Could not start the 3D race: ${game.webglError}. Your browser or GPU may not support WebGL.`
        : `Could not start the race: ${e && e.message ? e.message : e}`;
      backBtn.parentElement.classList.remove('hidden');
    }
  }

  return {
    el,
    show(params = {}) {
      const last = save.get().last;
      const def = getTrackDef(last.trackId);
      const team = getTeam(last.teamId);
      trackName.textContent = def?.name || 'Race';
      sub.textContent = team ? `${team.name}` : '';
      el.style.setProperty('--team', team?.livery?.primary || '#e10600');
      spinner.classList.remove('hidden');
      status.textContent = params.restart ? 'Restarting race…' : 'Building circuit…';
      errBox.classList.add('hidden');
      backBtn.parentElement.classList.add('hidden');
      if (params.manual) return; // debug hook drives the race itself
      run(params);
    },
    hide() { token++; },
  };
}
