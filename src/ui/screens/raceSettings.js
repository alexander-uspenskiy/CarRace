import { h, button, fmtClock, attachMenuKeys } from '../dom.js';
import { getTrackDef } from '../../data/tracks/index.js';
import { computeLaps, estimateRaceSeconds } from '../../core/lapMath.js';
import { DIFFICULTY, RACE_MINUTES, LENGTH_CREDIT_MULT } from '../dataRefs.js';

const DIFF_INFO = {
  easy: 'Relaxed AI pace, forgiving tyre wear. Credits ×0.8',
  normal: 'Competitive field with occasional mistakes.',
  hard: 'Full-pace AI on upgraded cars, fewer errors, harsher tyre wear.',
};

export function createRaceSettingsScreen(ctx) {
  const { save, flow } = ctx;
  let minutes = 5, difficulty = 'normal';

  const lenWrap = h('div.opt-row');
  const diffWrap = h('div.opt-row');
  const summary = h('div.summary');
  const lenBtns = RACE_MINUTES.map((m) => {
    const b = h('button.opt', { type: 'button', onclick: () => { minutes = m; render(); } });
    lenWrap.append(b);
    return { m, b };
  });
  const diffBtns = ['easy', 'normal', 'hard'].map((d) => {
    const b = h('button.opt', { type: 'button', onclick: () => { difficulty = d; render(); } },
      h('b', d.toUpperCase()), h('small', `×${(DIFFICULTY[d]?.creditMult ?? 1).toFixed(2)} credits`));
    diffWrap.append(b);
    return { d, b };
  });
  const diffInfo = h('p.muted');

  const back = button('BACK', () => flow.transition('track'), 'btn-back');
  const next = button('NEXT: GARAGE', () => {
    save.setLast({ minutes, difficulty });
    flow.transition('garage');
  }, 'btn-primary');

  const el = h('section.screen.screen-settings',
    h('header.screen-head', h('h1', 'RACE SETTINGS'), h('p.sub', 'Length and AI difficulty')),
    h('div.panel.settings-panel',
      h('h4.sec', 'RACE LENGTH'), lenWrap,
      h('h4.sec', 'AI DIFFICULTY'), diffWrap, diffInfo,
      h('h4.sec', 'SUMMARY'), summary),
    h('footer.screen-foot', back, next));

  function render() {
    const last = save.get().last;
    const def = getTrackDef(last.trackId);
    const ref = def.referenceLapTime;
    lenBtns.forEach(({ m, b }) => {
      const laps = computeLaps(m, ref);
      b.className = 'opt' + (m === minutes ? ' active' : '');
      b.replaceChildren(h('b', `${m} MIN`), h('small', `${laps} laps · ≈ ${fmtClock(estimateRaceSeconds(laps, ref))}`));
    });
    diffBtns.forEach(({ d, b }) => { b.className = 'opt' + (d === difficulty ? ' active' : ''); });
    diffInfo.textContent = DIFF_INFO[difficulty];
    const laps = computeLaps(minutes, ref);
    const mult = (LENGTH_CREDIT_MULT[minutes] ?? 1) * (DIFFICULTY[difficulty]?.creditMult ?? 1);
    summary.replaceChildren(
      h('div', h('label', 'CIRCUIT'), h('b', def.name)),
      h('div', h('label', 'LAPS'), h('b', laps)),
      h('div', h('label', 'EST. DURATION'), h('b', fmtClock(estimateRaceSeconds(laps, ref)))),
      h('div', h('label', 'CREDIT MULTIPLIER'), h('b', `×${mult.toFixed(2)}`)));
  }

  let detach = null;
  return {
    el,
    show() {
      const l = save.get().last;
      minutes = RACE_MINUTES.includes(l.minutes) ? l.minutes : 5;
      difficulty = DIFFICULTY[l.difficulty] ? l.difficulty : 'normal';
      render();
      detach = attachMenuKeys(el);
    },
    hide() { detach?.(); detach = null; },
  };
}
