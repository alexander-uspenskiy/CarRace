import { h, clear, button, statBar, fmtInt, attachMenuKeys, swatch } from '../dom.js';
import { TEAMS, getTeam } from '../../data/teams.js';
import { UPGRADE_CATEGORIES, UPGRADES, MAX_LEVEL, UPGRADE_COSTS, getUpgradeCost, describeUpgrade } from '../../data/upgrades.js';
import { computeCarStats, statSummary } from '../../data/carStats.js';
import { createPreviewPadding, isStacked } from '../layout.js';

const STAT_LABELS = [
  ['topSpeed', 'Top speed'], ['accel', 'Acceleration'], ['cornering', 'Cornering'],
  ['braking', 'Braking'], ['tyreLife', 'Tyre life'], ['cooling', 'Cooling'],
];

export function createGarageScreen(ctx) {
  const { game, save, flow, bus } = ctx;
  let selected = 'engine';
  let refundArmed = false, refundTimer = null;
  let enteredFrom = 'title';

  const credits = h('div.credits-pill.big');
  const teamName = h('h2.team-name');
  const teamSub = h('div.team-sub');
  const cardsEl = h('div.upg-cards');
  const bars = STAT_LABELS.map(([k, l]) => ({ k, bar: statBar(l) }));
  const barsEl = h('div.stat-bars', bars.map((b) => b.bar.el));
  const swatchHolder = h('div.swatch-holder');
  const msg = h('div.garage-msg');
  const refundBtn = h('button.btn.btn-secondary.btn-small', { type: 'button', onclick: onRefund, title: 'Sell all upgrades for this team (70% back)' }, 'REFUND ALL');
  const prevTeam = h('button.arrow.arrow-l', { type: 'button', onclick: () => changeTeam(-1), title: 'Previous team' }, '‹');
  const nextTeam = h('button.arrow.arrow-r', { type: 'button', onclick: () => changeTeam(1), title: 'Next team' }, '›');

  const back = button('BACK', () => { if (!flow.back()) flow.transition('title'); }, 'btn-back');
  const start = button('START RACE', () => { flow.transition('loading', {}); }, 'btn-primary');

  const head = h('div.garage-head.panel', h('div', teamName, teamSub), credits);
  const colLeft = h('div.col-left.panel', h('h3.panel-title', 'UPGRADES'), cardsEl, h('div.row.between.refund-row', refundBtn, msg));
  const colRight = h('div.col-right.panel', h('h3.panel-title', 'CAR PERFORMANCE'), barsEl,
    h('p.muted.small', 'Highlighted bars preview the selected upgrade\'s next level.'));
  const garageBody = h('div.garage-body', colLeft, colRight);

  const el = h('section.screen.screen-garage',
    head,
    garageBody,
    h('div.center-pick', prevTeam, nextTeam, swatchHolder),
    h('footer.screen-foot', back, start));

  const teamId = () => save.get().last.teamId;
  const team = () => getTeam(teamId()) || TEAMS[0];

  function changeTeam(dir) {
    const i = TEAMS.findIndex((t) => t.id === teamId());
    const nt = TEAMS[(i + dir + TEAMS.length) % TEAMS.length];
    save.setLast({ teamId: nt.id });
    disarm();
    render();
  }

  function levelsWith(cat, lvl) {
    return { ...save.getUpgrades(teamId()), [cat]: lvl };
  }

  function spentOn(levels) {
    let total = 0;
    for (const c of UPGRADE_CATEGORIES) for (let l = 0; l < (levels[c] || 0); l++) total += UPGRADE_COSTS[l];
    return total;
  }

  function disarm() {
    refundArmed = false;
    clearTimeout(refundTimer);
  }

  function onRefund() {
    const levels = save.getUpgrades(teamId());
    const spent = spentOn(levels);
    if (spent <= 0) { flash('Nothing to refund.'); return; }
    if (!refundArmed) {
      refundArmed = true;
      refundTimer = setTimeout(() => { refundArmed = false; render(); }, 3500);
      render();
      return;
    }
    disarm();
    const r = save.refundUpgrades(teamId());
    if (r?.ok) { game.audio?.playSfx?.('click'); flash(`Refunded ${fmtInt(r.refunded)} credits.`); }
    render();
  }

  let flashT = null;
  function flash(text) {
    msg.textContent = text;
    clearTimeout(flashT);
    flashT = setTimeout(() => { msg.textContent = ''; }, 2500);
  }

  function buy(cat) {
    const r = save.buyUpgrade(teamId(), cat);
    if (r?.ok) {
      game.audio?.playSfx?.('purchase');
      bus.emit('save:purchase', { teamId: teamId(), category: cat, level: r.level, cost: r.cost });
      flash(`${UPGRADES[cat].name} upgraded to level ${r.level}.`);
    } else if (r?.reason === 'funds') flash('Not enough credits.');
    else if (r?.reason === 'maxed') flash('Already at maximum level.');
    selected = cat;
    render();
  }

  function renderBars() {
    const t = team();
    const levels = save.getUpgrades(t.id);
    const cur = statSummary(computeCarStats(t, levels));
    const sel = levels[selected] || 0;
    const nxt = sel < MAX_LEVEL ? statSummary(computeCarStats(t, levelsWith(selected, sel + 1))) : cur;
    bars.forEach((b) => b.bar.set(cur[b.k] ?? 0, nxt[b.k] ?? 0));
  }

  function select(cat) {
    if (selected === cat) return;
    selected = cat;
    for (const c of cardsEl.children) c.classList.toggle('active', c.dataset.cat === cat);
    renderBars();
  }

  function render() {
    const t = team();
    el.style.setProperty('--team', t.livery.primary);
    el.style.setProperty('--team2', t.livery.accent);
    teamName.textContent = t.name;
    teamSub.textContent = `${t.car} · upgrades are saved per team`;
    credits.replaceChildren(h('span.coin', '¢'), ` ${fmtInt(save.get().credits)}`);
    const levels = save.getUpgrades(t.id);
    const wallet = save.get().credits;

    clear(cardsEl);
    for (const cat of UPGRADE_CATEGORIES) {
      const u = UPGRADES[cat];
      const lvl = levels[cat] || 0;
      const maxed = lvl >= MAX_LEVEL;
      const cost = getUpgradeCost(lvl);
      const afford = !maxed && wallet >= cost;
      const pips = h('div.pips', Array.from({ length: MAX_LEVEL }, (_, i) => h('i' + (i < lvl ? '.on' : ''))));
      const nextLines = maxed ? ['Maximum level reached'] : describeUpgrade(cat, lvl + 1);
      const missing = Math.max(0, cost - wallet);
      const buyBtn = h('button.btn.btn-buy' + (afford ? '.btn-primary' : ''), {
        type: 'button', disabled: !afford, title: maxed ? 'Maxed' : afford ? 'Buy upgrade' : `Need ${fmtInt(missing)} more credits`,
        onclick: (e) => { e.stopPropagation(); buy(cat); },
      }, maxed ? 'MAXED' : h('span', 'BUY ', h('b', `¢${fmtInt(cost)}`)));
      const buyCol = h('div.buy-col', buyBtn, !maxed && !afford ? h('div.need', `Need ¢${fmtInt(missing)} more credits`) : null);
      cardsEl.append(h('div.upg-card' + (cat === selected ? '.active' : '') + (maxed ? '.maxed' : ''),
        { role: 'button', tabindex: 0, dataset: { cat }, onclick: () => select(cat), onmouseenter: () => select(cat) },
        h('div.upg-icon', u.icon || '⚙'),
        h('div.upg-body',
          h('div.upg-top', h('b', u.name), h('span.lvl', `LVL ${lvl}/${MAX_LEVEL}`)),
          h('div.muted.small', u.blurb), pips,
          h('ul.upg-lines', nextLines.map((l) => h('li', (maxed ? '' : 'Next: ') + l)))),
        buyCol));
    }

    renderBars();

    const spent = spentOn(levels);
    refundBtn.disabled = spent <= 0;
    refundBtn.textContent = refundArmed ? `CONFIRM REFUND (+${fmtInt(Math.round(spent * 0.7))})` : 'REFUND ALL (70%)';
    refundBtn.classList.toggle('danger', refundArmed);
    refundBtn.classList.toggle('btn-secondary', !refundArmed);

    if (game.preview) {
      try { game.preview.showTeam(t.id, save.get().last.driverIndex === 1 ? 1 : 0); } catch (e) { console.error(e); }
    } else {
      clear(swatchHolder);
      swatchHolder.append(swatch(t));
    }
    back.textContent = enteredFrom === 'settings' ? 'BACK' : 'BACK TO MENU';
  }

  let detach = null;
  const padding = createPreviewPadding(game, () => {
    if (isStacked()) return { top: head, bottom: garageBody, left: prevTeam, right: nextTeam };
    return { left: [colLeft, prevTeam], right: [colRight, nextTeam], top: head };
  });
  return {
    el,
    show() {
      const hist = flow.history;
      enteredFrom = hist.length ? hist[hist.length - 1].state : 'title';
      render();
      padding.bind();
      detach = attachMenuKeys(el);
    },
    hide() { detach?.(); detach = null; disarm(); padding.unbind(); },
    refresh: render,
  };
}
