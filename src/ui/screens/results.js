import { h, clear, button, chip, fmtLap, fmtInt, ordinal, attachMenuKeys } from '../dom.js';
import { getTeam } from '../../data/teams.js';
import { getTrackDef } from '../../data/tracks/index.js';
import { formatTime, formatGapLaps } from '../../core/lapMath.js';
import { createPreviewPadding, debounce } from '../layout.js';

function fmtTotal(row, result) {
  if (!row.finished) return row.lapsDown > 0 ? formatGapLaps(row.lapsDown) : 'DNF';
  if (row.position === 1) return formatTime(row.totalTime);
  if (row.lapsDown > 0) return formatGapLaps(row.lapsDown);
  return row.gapToWinner != null ? '+' + row.gapToWinner.toFixed(3) : '--';
}

export function createResultsScreen(ctx) {
  const { game, save, hof, flow } = ctx;
  let current = null;

  const headline = h('div.res-headline');
  const tableEl = h('div.res-table');
  const creditsEl = h('div.credits-box');
  const creditsTotal = h('span.sum-total');
  const creditsDetails = h('details.credits-details', h('summary', h('span', 'CREDITS'), creditsTotal), creditsEl);
  const recordsEl = h('div.records');
  const nameInput = h('input.name-input', { type: 'text', maxlength: 16, autocomplete: 'off', spellcheck: 'false' });
  const nameMsg = h('span.muted.small');
  const nameRow = h('div.name-row', h('label.field-label', 'NAME FOR HALL OF FAME'), nameInput, button('SAVE', commitName, 'btn-small'), nameMsg);
  nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commitName(); });
  // also persist while typing (debounced), so leaving the screen right away keeps the name
  const saveSoon = debounce(() => commitName(true), 400);
  nameInput.addEventListener('input', saveSoon);

  const again = button('RACE AGAIN', () => flow.transition('settings'), 'btn-primary');
  const hofBtn = button('HALL OF FAME', () => flow.transition('hof'));
  const menu = button('MAIN MENU', () => flow.transition('title'), 'btn-back');

  const podSpace = h('div.res-pod');
  const headPanel = h('div.panel.res-head', headline);
  const standingsPanel = h('div.panel.res-standings', tableEl);
  const namePanel = h('div.panel.res-name', nameRow);
  const recordsPanel = h('div.panel.res-records.records-panel', h('h3.panel-title', 'RECORDS'), recordsEl);
  const creditsPanel = h('div.panel.res-credits', creditsDetails);
  const scroll = h('div.res-scroll', podSpace,
    h('div.res-cols',
      h('div.res-left', headPanel, standingsPanel),
      h('div.res-right', namePanel, recordsPanel, creditsPanel)));

  const el = h('section.screen.screen-results', scroll, h('footer.screen-foot.res-foot', menu, hofBtn, again));

  // keep the 3D podium centred in the free band at the top of the screen
  const padding = createPreviewPadding(game, () => ({ within: podSpace }));
  // breakdown starts expanded only when there is room for it
  const wideMq = () => window.matchMedia('(min-width: 900px) and (min-height: 900px)').matches;
  const onResize = () => { if (wideMq()) creditsDetails.open = true; };

  function commitName(quiet = false) {
    saveSoon.cancel();
    const name = nameInput.value.trim();
    if (!current) return;
    if (!name) { if (quiet !== true) nameMsg.textContent = 'Enter a name.'; return; }
    if (current.entryId) hof.renamePlayer(current.entryId, name);
    save.setPlayerName(name);
    const finalName = save.get().playerName;
    if (quiet !== true) nameInput.value = finalName;
    current.renamedTo = finalName;
    nameMsg.textContent = 'Saved.';
    setTimeout(() => { nameMsg.textContent = ''; }, 1800);
    const nm = tableEl.querySelector('.row.me .rname');
    if (nm) nm.textContent = finalName;
  }

  function render(params) {
    const { result, credits, newRecords = [] } = params;
    current = params;
    const def = getTrackDef(result.trackId);
    const me = result.rows.find((r) => r.isPlayer) || result.rows[result.playerPosition - 1];
    const team = getTeam(result.playerTeamId);
    el.style.setProperty('--team', team?.livery?.primary || '#e10600');

    headline.replaceChildren(
      h('div.res-pos', h('span.big', ordinal(result.playerPosition)), h('span.of', ' / ' + result.rows.length)),
      h('div.res-meta',
        h('b', `${def?.name ?? result.trackId} · ${result.minutes} min · ${result.laps} laps · ${result.difficulty}`),
        h('div.muted', result.playerFinished
          ? `Race time ${formatTime(result.playerTotalTime)}${me && me.lapsDown > 0 ? ' (' + formatGapLaps(me.lapsDown) + ')' : ''} · best lap ${fmtLap(result.playerBestLap)}`
          : `Did not finish · best lap ${fmtLap(result.playerBestLap)}`),
        h('div.muted', `Started P${result.playerGridPosition}` + (result.playerGridPosition !== result.playerPosition
          ? `  (${result.playerGridPosition > result.playerPosition ? '▲' : '▼'}${Math.abs(result.playerGridPosition - result.playerPosition)})` : ''))));

    clear(tableEl);
    tableEl.append(h('div.row.head', h('span', 'POS'), h('span'), h('span', 'DRIVER'), h('span.rteam', 'TEAM'), h('span.r', 'TIME / GAP'), h('span.r.rbest', 'BEST LAP'), h('span', '')));
    for (const r of result.rows) {
      const t = getTeam(r.teamId);
      const fl = result.fastestLap && result.fastestLap.carId === r.carId;
      tableEl.append(h('div.row' + (r.isPlayer ? '.me' : '') + (r.position <= 3 ? '.podium.p' + r.position : ''),
        h('span.rp', r.position),
        chip(t?.livery?.primary || '#888'),
        h('span.rname', r.isPlayer ? (params.renamedTo || r.driverName) : r.driverName, h('small', ' ' + r.driverCode)),
        h('span.rteam', t?.shortName || ''),
        h('span.r', fmtTotal(r, result)),
        h('span.r.rbest' + (fl ? '.purple' : ''), fmtLap(r.bestLap)),
        h('span', fl ? h('b.fl', 'FL') : '')));
    }

    // credits
    clear(creditsEl);
    creditsTotal.textContent = credits ? '¢ ' + fmtInt(credits.total) : '';
    if (credits) {
      for (const l of credits.lines) creditsEl.append(h('div.cl', h('span', l.label), h('b', (l.amount >= 0 ? '+' : '') + fmtInt(l.amount))));
      creditsEl.append(
        h('div.cl.sub', h('span', 'Subtotal'), h('b', fmtInt(credits.subtotal))),
        h('div.cl.sub', h('span', `Length ×${credits.lengthMult} · Difficulty ×${credits.diffMult}`), h('b', '')),
        h('div.cl.total', h('span', 'TOTAL EARNED'), h('b', '¢ ' + fmtInt(credits.total))),
        h('div.cl.sub', h('span', 'Wallet'), h('b', '¢ ' + fmtInt(save.get().credits))));
    }

    // records
    clear(recordsEl);
    if (!newRecords.length) recordsEl.append(h('p.muted', 'No new records this race.'));
    for (const rec of newRecords) {
      const label = rec.kind === 'bestLap' ? 'BEST LAP' : `BEST ${rec.minutes} MIN RACE`;
      recordsEl.append(h('div.record' + (rec.rank === 1 ? '.gold' : ''),
        h('b', rec.rank === 1 ? 'NEW RECORD' : `TOP 10 · #${rec.rank}`),
        h('span', `${label} · ${getTrackDef(rec.trackId)?.name ?? rec.trackId}`),
        h('span.t', rec.kind === 'bestLap' ? fmtLap(rec.time) : formatTime(rec.time)),
        rec.isPersonalBest ? h('em', 'Personal best') : null));
    }
    nameInput.value = params.renamedTo || result.playerName || save.get().playerName;
    nameMsg.textContent = '';
    // a record was set: name entry goes to the top of the (right) column
    namePanel.classList.toggle('record-set', newRecords.length > 0);
    recordsPanel.classList.toggle('empty-rec', newRecords.length === 0);
    creditsDetails.open = wideMq();
    scroll.scrollTop = 0;

    // podium (the preview controller is activated by game.js before show(); size it once the DOM is laid out)
    if (game.preview) {
      try {
        padding.bind();
        game.host?.resize();
        game.preview.showPodium(result.rows.slice(0, 3).map((r) => ({ teamId: r.teamId, position: r.position, name: r.driverName })));
        requestAnimationFrame(() => { try { game.host?.resize(); padding.apply(); } catch { /* ignore */ } });
      } catch (e) { console.error(e); }
    }
  }

  let detach = null;
  return {
    el,
    show(params) {
      const p = params && params.result ? params : (game.lastResults || null);
      if (p) render(p);
      detach = attachMenuKeys(el);
      window.addEventListener('resize', onResize);
    },
    hide() {
      saveSoon.flush();
      detach?.(); detach = null;
      window.removeEventListener('resize', onResize);
      padding.unbind();
    },
  };
}
