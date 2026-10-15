import { h, clear, button, chip, statBar, stars, attachMenuKeys, swatch } from '../dom.js';
import { TEAMS, getTeam } from '../../data/teams.js';
import { computeCarStats, statSummary } from '../../data/carStats.js';
import { createPreviewPadding, isStacked } from '../layout.js';

const STAT_LABELS = [
  ['topSpeed', 'Top speed'], ['accel', 'Acceleration'], ['cornering', 'Cornering'],
  ['braking', 'Braking'], ['tyreLife', 'Tyre life'], ['cooling', 'Cooling'],
];

export function createTeamSelectScreen(ctx) {
  const { game, save, flow } = ctx;
  let idx = 0, driver = 0;

  const list = h('div.team-list');
  const cards = TEAMS.map((t, i) => {
    const c = h('button.team-card', { type: 'button', onclick: () => select(i) },
      h('span.team-stripe', { style: { background: t.livery.primary } }),
      h('span.team-info', h('b', t.shortName), h('small', t.car)),
      h('span.team-str', { title: 'Team strength' }, strengthStars(t.strength)));
    list.append(c);
    return c;
  });

  const teamName = h('h2.team-name');
  const teamSub = h('div.team-sub');
  const strengthEl = h('div.team-strength');
  const drvWrap = h('div.driver-pick');
  const bars = STAT_LABELS.map(([k, l]) => ({ k, bar: statBar(l) }));
  const barsEl = h('div.stat-bars', bars.map((b) => b.bar.el));
  const note = h('p.muted.small');
  const swatchHolder = h('div.swatch-holder');

  const prev = h('button.arrow.arrow-l', { type: 'button', title: 'Previous team (←)', onclick: () => select(idx - 1) }, '‹');
  const next = h('button.arrow.arrow-r', { type: 'button', title: 'Next team (→)', onclick: () => select(idx + 1) }, '›');

  const back = button('BACK', () => flow.transition('title'), 'btn-back');
  const confirm = button('CONFIRM TEAM', () => {
    save.setLast({ teamId: TEAMS[idx].id, driverIndex: driver });
    flow.transition('track');
  }, 'btn-primary');

  const colLeft = h('div.col-left.panel', h('h3.panel-title', 'SELECT TEAM'), list);
  const colRight = h('div.col-right.panel', teamName, teamSub, strengthEl,
    h('h4.sec', 'DRIVER'), drvWrap, note,
    h('h4.sec', 'CAR (with your upgrades)'), barsEl);
  const teamBody = h('div.team-body', colLeft, colRight);
  const centerPick = h('div.center-pick', prev, next, swatchHolder);

  const el = h('section.screen.screen-team',
    teamBody,
    centerPick,
    h('footer.screen-foot', back, confirm));

  function strengthStars(s) {
    const n = Math.max(1, Math.min(5, Math.round(((s - 0.6) / 0.4) * 4 + 1)));
    return stars(n);
  }

  function select(i) {
    idx = (i + TEAMS.length) % TEAMS.length;
    render();
  }

  function render() {
    const t = TEAMS[idx];
    el.style.setProperty('--team', t.livery.primary);
    el.style.setProperty('--team2', t.livery.accent);
    cards.forEach((c, i) => c.classList.toggle('active', i === idx));
    cards[idx].scrollIntoView?.({ block: 'nearest' });
    teamName.textContent = t.name;
    teamSub.textContent = `${t.car} · ${t.country}`;
    clear(strengthEl);
    strengthEl.append('Team strength ', strengthStars(t.strength), h('span.muted', `  ${Math.round(t.strength * 100)}`));
    clear(drvWrap);
    t.drivers.forEach((d, di) => {
      drvWrap.append(h('button.driver-card' + (di === driver ? '.active' : ''), { type: 'button', onclick: () => { driver = di; render(); } },
        h('span.num', '#' + d.number), h('span.dn', h('b', d.name), h('small', `${d.code} · ${d.nationality} · skill ${Math.round(d.skill * 100)}`))));
    });
    const other = t.drivers[1 - driver];
    note.textContent = `You take the seat of ${t.drivers[driver].name}. ${other.name} is your AI teammate.`;
    const stats = statSummary(computeCarStats(t, save.getUpgrades(t.id)));
    bars.forEach((b) => b.bar.set(stats[b.k] ?? 0));
    if (game.preview) {
      try { game.preview.showTeam(t.id, driver); } catch (e) { console.error(e); }
    } else {
      clear(swatchHolder);
      swatchHolder.append(swatch(t));
    }
    game.audio?.playSfx?.('click');
  }

  let detach = null;
  // keep the 3D car centred in the area that is not covered by panels / arrows
  const padding = createPreviewPadding(game, () => {
    if (isStacked()) return { bottom: teamBody, left: prev, right: next };
    return { left: [colLeft, prev], right: [colRight, next] };
  });
  return {
    el,
    show() {
      const last = save.get().last;
      idx = Math.max(0, TEAMS.findIndex((t) => t.id === last.teamId));
      driver = last.driverIndex === 1 ? 1 : 0;
      render();
      padding.bind();
      detach = attachMenuKeys(el, (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(idx - 1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(idx + 1); }
        else if (e.key === '1') { driver = 0; render(); }
        else if (e.key === '2') { driver = 1; render(); }
      });
    },
    hide() { detach?.(); detach = null; padding.unbind(); },
  };
}
