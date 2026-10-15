import { h, clear, button, chip, fmtLap, fmtDate, fmtInt, attachMenuKeys } from '../dom.js';
import { TRACKS } from '../../data/tracks/index.js';
import { getTeam } from '../../data/teams.js';
import { formatTime } from '../../core/lapMath.js';
import { DIFFICULTY, RACE_MINUTES } from '../dataRefs.js';

const TABS = [['laps', 'BEST LAPS'], ['races', 'BEST RACES'], ['history', 'HISTORY'], ['stats', 'STATS']];

export function createHallOfFameScreen(ctx) {
  const { hof, flow, save } = ctx;
  let tab = 'laps', trackId = TRACKS[0].id, minutes = RACE_MINUTES[0];

  const tabsEl = h('div.tabs');
  const trackEl = h('div.tabs.sub');
  const minEl = h('div.tabs.sub');
  const body = h('div.hof-body');
  const back = button('BACK', () => { if (!flow.back()) flow.transition('title'); }, 'btn-back');

  const el = h('section.screen.screen-hof',
    h('header.screen-head', h('h1', 'HALL OF FAME'), h('p.sub', 'Records are stored on this device')),
    h('div.panel.hof-panel', tabsEl, h('div.row.gap', trackEl, minEl), body),
    h('footer.screen-foot', back));

  function tabBtn(label, active, onclick) {
    return h('button.tab' + (active ? '.active' : ''), { type: 'button', onclick }, label);
  }

  function entryRow(i, e, isRace) {
    const t = getTeam(e.teamId);
    return h('div.row', h('span.rp', i + 1), chip(t?.livery?.primary || '#888'),
      h('span.rname', e.name), h('span.rteam', t?.shortName || ''),
      h('span.r.mono', isRace ? formatTime(e.time) : fmtLap(e.time)),
      h('span.r.muted', `${e.difficulty ?? ''}`), h('span.r.muted', fmtDate(e.date)));
  }
  const headRow = (...cols) => h('div.row.head', ...cols.map((c, i) => h('span' + (i >= 4 ? '.r' : ''), c)));
  const empty = (txt) => h('p.empty', txt);

  function render() {
    clear(tabsEl);
    TABS.forEach(([k, l]) => tabsEl.append(tabBtn(l, tab === k, () => { tab = k; render(); })));
    clear(trackEl); clear(minEl);
    if (tab === 'laps' || tab === 'races') {
      TRACKS.forEach((t) => trackEl.append(tabBtn(t.name, trackId === t.id, () => { trackId = t.id; render(); })));
    }
    if (tab === 'races') {
      RACE_MINUTES.forEach((m) => minEl.append(tabBtn(`${m} min`, minutes === m, () => { minutes = m; render(); })));
    }
    clear(body);
    if (tab === 'laps') {
      const list = hof.getBestLaps(trackId) || [];
      if (!list.length) body.append(empty('No lap times yet. Finish a lap to set the first record!'));
      else {
        body.append(headRow('#', '', 'Driver', 'Team', 'Lap time', 'Difficulty', 'Date'));
        list.forEach((e, i) => body.append(entryRow(i, e, false)));
      }
    } else if (tab === 'races') {
      const list = hof.getBestRaces(trackId, minutes) || [];
      if (!list.length) body.append(empty(`No ${minutes}-minute race finished here yet.`));
      else {
        body.append(headRow('#', '', 'Driver', 'Team', 'Race time', 'Difficulty', 'Date'));
        list.forEach((e, i) => body.append(entryRow(i, e, true)));
      }
    } else if (tab === 'history') {
      const list = hof.getHistory(100) || [];
      if (!list.length) body.append(empty('No races yet. Your race history will appear here.'));
      else {
        body.append(h('div.row.head.hist', h('span', 'DATE'), h('span', 'CIRCUIT'), h('span', 'LEN'), h('span', 'DIFF'), h('span.r', 'POS'), h('span.r', 'GRID'), h('span.r', 'TIME'), h('span.r', 'BEST LAP'), h('span.r', 'CREDITS')));
        for (const r of list) {
          const tr = TRACKS.find((t) => t.id === r.trackId);
          body.append(h('div.row.hist' + (r.position === 1 ? '.win' : ''),
            h('span.muted', fmtDate(r.date)), h('span', tr?.name ?? r.trackId), h('span', `${r.minutes}m`), h('span.muted', r.difficulty),
            h('span.r', r.finished ? `P${r.position}` : `P${r.position} DNF`), h('span.r.muted', `P${r.grid}`),
            h('span.r.mono', r.totalTime != null ? (r.lapsDown > 0 ? `+${r.lapsDown} L` : formatTime(r.totalTime)) : '--'),
            h('span.r.mono', fmtLap(r.bestLap)), h('span.r', '¢' + fmtInt(r.credits || 0))));
        }
      }
    } else {
      const s = hof.getStats() || {};
      const tile = (l, v) => h('div.stat-tile', h('b', v), h('label', l));
      body.append(h('div.stat-tiles',
        tile('RACES', s.races ?? 0), tile('WINS', s.wins ?? 0), tile('PODIUMS', s.podiums ?? 0), tile('FINISHES', s.finishes ?? 0)));
      if (!s.races) body.append(empty('Complete a race to start building your record.'));
    }
  }

  let detach = null;
  return {
    el,
    show() {
      const l = save.get().last;
      if (TRACKS.some((t) => t.id === l.trackId)) trackId = l.trackId;
      if (RACE_MINUTES.includes(l.minutes)) minutes = l.minutes;
      render(); detach = attachMenuKeys(el); },
    hide() { detach?.(); detach = null; },
    setTab(t) { tab = t; render(); },
  };
}
