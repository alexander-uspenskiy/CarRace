import { h, clear, button, stars, fmtLap, attachMenuKeys } from '../dom.js';
import { TRACKS, getTrackModel } from '../../data/tracks/index.js';
import { drawTrackMap } from '../../render/minimap.js';
import { getTeam } from '../../data/teams.js';

function difficultyLabel(def) {
  const t = def.rating?.technical ?? 3;
  return ['Easy', 'Easy', 'Medium', 'Hard', 'Expert', 'Expert'][t] || 'Medium';
}

export function createTrackSelectScreen(ctx) {
  const { save, hof, flow } = ctx;
  let idx = 0;
  const cardsEl = h('div.track-cards');
  let cards = [];

  const back = button('BACK', () => flow.transition('team'), 'btn-back');
  const confirm = button('CONFIRM TRACK', () => {
    save.setLast({ trackId: TRACKS[idx].id });
    flow.transition('settings');
  }, 'btn-primary');

  const el = h('section.screen.screen-track',
    h('header.screen-head', h('h1', 'SELECT CIRCUIT'), h('p.sub', 'Choose where to race')),
    cardsEl,
    h('footer.screen-foot', back, confirm));

  function build() {
    clear(cardsEl);
    cards = TRACKS.map((def, i) => {
      const canvas = h('canvas.track-map', { width: 360, height: 240 });
      const model = (() => { try { return getTrackModel(def.id); } catch (e) { console.error(e); return null; } })();
      const best = hof.getBestLaps(def.id)?.[0];
      const bestTeam = best ? getTeam(best.teamId) : null;
      const card = h('button.track-card', { type: 'button', onclick: () => { idx = i; render(); }, ondblclick: () => confirm.click() },
        h('div.map-wrap', canvas),
        h('h3', def.name), h('div.country', def.country),
        h('p.blurb', def.blurb),
        h('div.tstats',
          h('div', h('label', 'LENGTH'), h('b', model ? (model.length / 1000).toFixed(2) + ' km' : '--')),
          h('div', h('label', 'CORNERS'), h('b', model ? model.stats.corners : '--')),
          h('div', h('label', 'LONGEST STRAIGHT'), h('b', model ? Math.round(model.stats.longestStraight) + ' m' : '--'))),
        h('div.ratings',
          h('div', h('label', 'SPEED'), stars(def.rating?.speed ?? 3)),
          h('div', h('label', 'TECHNICAL'), stars(def.rating?.technical ?? 3)),
          h('div', h('label', 'DIFFICULTY'), h('b.diff.d-' + difficultyLabel(def).toLowerCase(), difficultyLabel(def)))),
        h('div.best', h('label', 'BEST LAP'),
          best ? h('b', fmtLap(best.time), h('small', ` ${best.name}${bestTeam ? ' · ' + bestTeam.shortName : ''}`)) : h('b.muted', 'No time set')));
      if (model) {
        try { drawTrackMap(canvas, model, { padding: 20, stroke: '#ffffff', width: 6, showStart: true }); } catch (e) { console.error('[trackSelect] map', e); }
      }
      return card;
    });
    cards.forEach((c) => cardsEl.append(c));
  }

  function render() {
    cards.forEach((c, i) => c.classList.toggle('active', i === idx));
    const def = TRACKS[idx];
    el.style.setProperty('--team', def.theme?.kerbA || '#e10600');
  }

  let detach = null;
  return {
    el,
    show() {
      build();
      const last = save.get().last.trackId;
      idx = Math.max(0, TRACKS.findIndex((t) => t.id === last));
      render();
      detach = attachMenuKeys(el, (e) => {
        if (e.key === 'ArrowLeft') { idx = (idx + TRACKS.length - 1) % TRACKS.length; render(); }
        else if (e.key === 'ArrowRight') { idx = (idx + 1) % TRACKS.length; render(); }
      });
    },
    hide() { detach?.(); detach = null; },
  };
}
