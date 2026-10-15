// Race HUD: DOM overlay. update(snapshot) each frame; DOM writes only on change.
import { h, clear, setText, setStyle, setClass, kph, mph, fmtClock, fmtLap, fmtGap } from './dom.js';
import { estimateRaceSeconds } from '../core/lapMath.js';
import { Minimap } from '../render/minimap.js';
import { getWeather } from '../data/weather.js';

const TOWER_ROWS = 10;
const COMPACT_ROWS = 5;
const COMPACT_MQ = '(max-width: 700px), (max-height: 500px)';

export function createHud({ root, bus, save, onPause = () => {}, onSkipIntro = () => {} }) {
  // ---------- static structure ----------
  const towerRows = [];
  const tower = h('div.hud-tower');
  for (let i = 0; i <= TOWER_ROWS; i++) {
    const row = {
      el: h('div.t-row'),
      pos: h('span.t-pos'), chip: h('span.t-chip'), codeTxt: h('span'), tyre: h('span.t-tyre'), gap: h('span.t-gap'),
    };
    row.code = h('span.t-code', row.codeTxt, row.tyre);
    row.el.append(row.pos, row.chip, row.code, row.gap);
    if (i === TOWER_ROWS) row.el.classList.add('t-extra');
    tower.append(row.el);
    towerRows.push(row);
  }
  const towerHead = h('div.t-head', h('span', 'P'), h('span', 'DRIVER'), h('span', 'INT'));
  tower.prepend(towerHead);

  const lapVal = h('span.big'), lapTotal = h('span.small');
  const posVal = h('span.big'), posTotal = h('span.small');
  const clockVal = h('div.clock'), clockRem = h('div.clock-rem');
  const curLap = h('span'), lastLap = h('span'), bestLap = h('span');
  const flBadge = h('div.fl-badge', 'FASTEST LAP');
  const flInfo = h('div.fl-info');
  const gapAhead = h('div.gap-row.ahead'), gapBehind = h('div.gap-row.behind');
  const pauseBtn = h('button.hud-pause', { type: 'button', tabindex: -1, title: 'Pause (Esc)', onclick: (e) => { e.currentTarget.blur(); onPause(); } }, h('span.pk', 'II'), h('span.pt', '☰ MENU'));

  const topRight = h('div.hud-topright',
    h('div.lp-row', h('div.lp', h('label', 'LAP'), lapVal, lapTotal), h('div.lp', h('label', 'POS'), posVal, posTotal)),
    h('div.clock-wrap', clockVal, clockRem),
    h('div.laps',
      h('div', h('label', 'CURRENT'), curLap),
      h('div', h('label', 'LAST'), lastLap),
      h('div.best', h('label', 'BEST'), bestLap)),
    flBadge, flInfo, gapAhead, gapBehind);

  const speedVal = h('div.speed-val'), speedUnit = h('div.speed-unit'), gearVal = h('div.gear-val');
  const rpmFill = h('div.rpm-fill');
  const speedo = h('div.hud-speedo',
    h('div.speed-row', h('div.speed-box', speedVal, speedUnit), h('div.gear-box', h('label', 'GEAR'), gearVal)),
    h('div.rpm', rpmFill));

  const tyreFill = h('div.fill'), tyreTxt = h('span.val');
  const ersFill = h('div.fill.ers'), ersTxt = h('span.val');
  const heatFill = h('div.fill.heat'), heatTxt = h('span.val');
  const dmgFill = h('div.fill.dmg'), dmgTxt = h('span.val');
  const dmgRow = h('div.gauge.gauge-dmg', h('label', 'DAMAGE'), h('div.track', dmgFill), dmgTxt);
  const gauges = h('div.hud-gauges',
    h('div.gauge', h('label', 'TYRES'), h('div.track', tyreFill), tyreTxt),
    h('div.gauge', h('label', 'ERS'), h('div.track', ersFill), ersTxt),
    h('div.gauge', h('label', 'ENGINE'), h('div.track', heatFill), heatTxt),
    dmgRow);

  const mapWrap = h('div.hud-minimap');

  const lights = [0, 1, 2, 3, 4].map(() => h('div.light', h('i'), h('i')));
  const goText = h('div.go-text', 'GO');
  const lightsEl = h('div.hud-lights', h('div.light-row', lights), goText);

  const toasts = h('div.hud-toasts');
  const warn = h('div.hud-warn');
  const banner = h('div.hud-banner');
  const introHint = h('div.hud-intro', { onclick: () => onSkipIntro() }, h('span.kb', 'PRESS ENTER'), h('span.tp', 'TAP'), ' TO SKIP INTRO');
  const hint = h('div.hud-hint', 'ESC pause   C camera   R reset   H help');
  const weatherEl = h('div.hud-weather');

  const el = h('div.hud.hidden', tower, topRight, speedo, gauges, mapWrap, lightsEl, toasts, warn, banner, introHint, hint, weatherEl, pauseBtn);
  root.append(el);

  // ---------- state ----------
  // compact layouts (phones) show only ~5 tower rows around the player
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COMPACT_MQ) : null;
  let compact = !!mq?.matches;
  let lastSnap = null;
  const onMq = () => { compact = !!mq.matches; if (info && lastSnap) update(lastSnap); };
  mq?.addEventListener?.('change', onMq);
  let info = null, minimap = null, minimapCanvas = null;
  let units = 'kph', phase = 'intro', lastLapNo = 0, finalShown = false;
  let refLap = 60;
  const timers = new Set();
  const unsubs = [];

  function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  }

  function toast(text, kind = '', ms = 2600) {
    const t = h('div.toast' + (kind ? '.' + kind : ''), text);
    toasts.append(t);
    while (toasts.children.length > 3) toasts.removeChild(toasts.firstChild);
    later(() => t.remove(), ms);
  }
  function showBanner(text, kind = '', ms = 3000) {
    banner.className = 'hud-banner show ' + kind;
    banner.textContent = text;
    later(() => { banner.className = 'hud-banner'; }, ms);
  }

  const codeOf = (id) => info?.carMetas?.[id]?.code ?? '???';

  function on(name, fn) { unsubs.push(bus.on(name, fn)); }
  on('race:fastestLap', (e) => {
    if (!info) return;
    toast(`FASTEST LAP  ${codeOf(e.carId)}  ${fmtLap(e.time)}`, 'purple', 3200);
  });
  on('race:lap', (e) => {
    if (!info || !e.isPlayer) return;
    toast(`LAP ${e.lap}  ${fmtLap(e.lapTime)}${e.isPersonalBest ? '  PB' : ''}`, e.isPersonalBest ? 'green' : '', 2800);
  });
  on('race:position', (e) => {
    if (!info || phase !== 'racing') return;
    const gain = e.to < e.from;
    toast(`P${e.from} → P${e.to}`, gain ? 'green' : 'red', 2000);
  });
  on('race:carFinished', (e) => {
    if (!info || e.carId !== info.playerId) return;
    showBanner(`CHEQUERED FLAG · P${e.position}`, 'flag', 6000);
  });
  on('car:overheat', (e) => {
    if (info && e.carId === info.playerId) toast('ENGINE OVERHEATING', 'red', 2600);
  });
  on('car:issue', (e) => {
    if (!info || e.phase !== 'start' || !lastSnap) return;
    // news only for cars that matter: the front of the field or the player's neighbours
    const c = lastSnap.cars[e.carId], me = lastSnap.cars[info.playerId];
    if (!c || !me || (c.position > 8 && Math.abs(c.position - me.position) > 2)) return;
    toast(`${codeOf(e.carId)}  ${e.label}`, 'amber', 3000);
  });
  on('car:damage', (e) => {
    if (!info || e.carId !== info.playerId) return;
    const before = e.damage - e.added;
    for (const [lvl, msg] of [[0.25, 'DAMAGE 25%'], [0.5, 'HEAVY DAMAGE 50%'], [0.75, 'CAR CRITICAL 75%']]) {
      if (before < lvl && e.damage >= lvl) toast(msg, lvl >= 0.5 ? 'red' : 'amber', 2200);
    }
  });
  on('car:wall', (e) => {
    if (info && e.carId === info.playerId && e.speed > 12) toast('IMPACT', 'red', 1400);
  });

  // ---------- API ----------
  function begin(i) {
    end();
    info = i;
    const def = i.trackDef;
    refLap = def?.referenceLapTime ?? 60;
    phase = 'intro';
    lastLapNo = 0;
    finalShown = false;
    clear(toasts);
    banner.className = 'hud-banner';
    units = save.get().settings.units === 'mph' ? 'mph' : 'kph';
    setText(speedUnit, units.toUpperCase());
    for (const r of towerRows) { r.el._vis = null; }
    minimapCanvas = h('canvas', { width: 200, height: 200 });
    clear(mapWrap);
    mapWrap.append(minimapCanvas);
    try {
      minimap = new Minimap(minimapCanvas, i.trackModel, { size: 200, rotate: false });
    } catch (e) {
      minimap = null;
      console.error('[hud] minimap failed', e);
    }
    const wx = getWeather(i.config.weather);
    setText(weatherEl, wx.grip < 1 ? `${wx.label} · GRIP -${Math.round((1 - wx.grip) * 100)}%` : wx.label);
    el.style.setProperty('--team', i.carMetas?.[i.playerId]?.color || '#e10600');
    setText(lapTotal, `/${i.config.laps}`);
    setText(posTotal, `/${i.carMetas?.length ?? 20}`);
    el.classList.remove('hidden');
  }

  function end() {
    info = null;
    lastSnap = null;
    minimap = null;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clear(toasts);
    banner.className = 'hud-banner';
  }

  function update(snap) {
    if (!info || !snap) return;
    const me = snap.cars[snap.playerId];
    if (!me) return;
    phase = snap.phase;
    const intro = snap.phase === 'intro';
    setClass(el, 'intro', intro);
    setClass(introHint, 'show', intro);

    // lights
    const showLights = snap.phase === 'lights' || (snap.phase === 'racing' && snap.raceTime < 1.2);
    setClass(lightsEl, 'show', showLights);
    const lit = snap.lights?.out ? 0 : (snap.lights?.lit ?? 0);
    lights.forEach((l, i) => setClass(l, 'on', i < lit));
    setClass(goText, 'show', snap.phase === 'racing' && snap.raceTime < 1.2);

    if (intro) return;

    // tower
    lastSnap = snap;
    const order = snap.order;
    const meIdx = order.indexOf(snap.playerId);
    if (compact) {
      const n = Math.min(COMPACT_ROWS, order.length);
      const start = Math.max(0, Math.min(order.length - n, meIdx - 2));
      for (let i = 0; i < TOWER_ROWS; i++) {
        setClass(towerRows[i].el, 'off', i >= n);
        if (i < n) fillRow(towerRows[i], snap, order[start + i], start + i);
      }
      setClass(towerRows[TOWER_ROWS].el, 'show', false);
    } else {
      for (let i = 0; i < TOWER_ROWS; i++) { setClass(towerRows[i].el, 'off', false); fillRow(towerRows[i], snap, order[i], i); }
      const extra = towerRows[TOWER_ROWS];
      if (meIdx >= TOWER_ROWS) { setClass(extra.el, 'show', true); fillRow(extra, snap, snap.playerId, meIdx); }
      else setClass(extra.el, 'show', false);
    }

    // top right
    setText(lapVal, Math.min(me.lap, snap.laps));
    setText(posVal, `P${me.position}`);
    setText(clockVal, fmtClockMs(snap.raceTime));
    const est = estimateRaceSeconds(snap.laps, refLap);
    setText(clockRem, snap.phase === 'finished' || snap.phase === 'finishing' ? 'FINAL LAP COMPLETE' : `≈ ${fmtClock(Math.max(0, est - snap.raceTime))} REMAINING`);
    setText(curLap, me.finished ? fmtLap(me.lastLap) : fmtLap(snap.phase === 'racing' || snap.phase === 'finishing' ? me.lapTime : null));
    setText(lastLap, fmtLap(me.lastLap));
    setText(bestLap, fmtLap(me.bestLap));
    const fl = snap.fastestLap;
    setClass(flBadge, 'show', !!fl && fl.carId === snap.playerId);
    setText(flInfo, fl ? `FASTEST ${codeOf(fl.carId)}  ${fmtLap(fl.time)}` : '');
    const ahead = meIdx > 0 ? snap.cars[order[meIdx - 1]] : null;
    const behind = meIdx >= 0 && meIdx < order.length - 1 ? snap.cars[order[meIdx + 1]] : null;
    setText(gapAhead, ahead ? `${ahead.code}  ${fmtGap(me.gapAhead)}` : 'LEADING');
    setText(gapBehind, behind ? `${behind.code}  -${(behind.gapAhead ?? 0).toFixed(1)}` : '');

    // speedo
    const spd = units === 'mph' ? mph(me.speed) : kph(me.speed);
    setText(speedVal, spd);
    setText(gearVal, me.speed < 0.5 && me.throttle < 0.05 ? 'N' : me.gear);
    setStyle(rpmFill, 'width', `${Math.round(me.rpm * 100)}%`);
    setClass(rpmFill, 'limit', me.rpm > 0.93);

    // gauges
    const life = Math.max(0, 1 - me.tyreWear);
    setStyle(tyreFill, 'width', `${Math.round(life * 100)}%`);
    setStyle(tyreFill, 'background', tyreColor(me.tyreWear));
    setText(tyreTxt, `${Math.round(me.tyreGrip * 100)}% GRIP`);
    setStyle(ersFill, 'width', `${Math.round(me.ers * 100)}%`);
    setClass(ersFill, 'boosting', me.boosting);
    setText(ersTxt, me.boosting ? 'BOOST' : `${Math.round(me.ers * 100)}%`);
    const heat = Math.min(1, me.heat);
    setStyle(heatFill, 'width', `${Math.round(heat * 100)}%`);
    setClass(heatFill, 'hot', me.heat > 0.85);
    setText(heatTxt, me.heat > 1 ? 'OVERHEAT' : `${Math.round(me.heat * 100)}%`);

    // damage (hidden entirely on easy, where the player's car can't be hurt)
    const dmg = me.damage || 0;
    dmgRow.classList.toggle('off', !snap.damageOn);
    setStyle(dmgFill, 'width', `${Math.round(dmg * 100)}%`);
    setClass(dmgFill, 'hot', dmg > 0.5);
    setText(dmgTxt, `${Math.round(dmg * 100)}%`);

    // warnings
    let w = '';
    if (me.wrongWay) w = 'WRONG WAY';
    else if (me.surface === 'grass') w = 'OFF TRACK';
    setText(warn, w);
    setClass(warn, 'show', !!w);
    setClass(warn, 'wrong', me.wrongWay);

    // lap banners
    if (me.lap !== lastLapNo) {
      lastLapNo = me.lap;
      if (snap.phase === 'racing' && me.lap === snap.laps && !finalShown) {
        finalShown = true;
        showBanner('FINAL LAP', 'final', 3000);
      }
    }
    if (snap.phase === 'finishing' && !me.finished && !banner.classList.contains('flag')) {
      showBanner('CHEQUERED FLAG · FINISH YOUR LAP', 'flag', 4000);
    }

    if (minimap) {
      try { minimap.draw(snap); } catch (e) { minimap = null; console.error('[hud] minimap draw', e); }
    }
  }

  function fillRow(row, snap, carId, idx) {
    const c = snap.cars[carId];
    if (!c) return;
    setText(row.pos, idx + 1);
    setStyle(row.chip, 'background', c.color);
    setText(row.codeTxt, c.code);
    setText(row.tyre, c.compound ? c.compound[0].toUpperCase() : '');
    row.tyre.className = 't-tyre' + (c.compound ? ' ' + c.compound : '');
    setClass(row.el, 'issue', !!c.issue);
    let g;
    if (c.finished) g = 'FIN';
    else if (idx === 0) g = 'LEADER';
    else g = fmtGap(c.gapAhead);
    setText(row.gap, g);
    setClass(row.el, 'me', c.isPlayer);
  }

  return {
    el,
    begin, end, update,
    show() { el.classList.remove('hidden'); },
    hide() { el.classList.add('hidden'); },
    toast,
    setUnits(u) { units = u === 'mph' ? 'mph' : 'kph'; setText(speedUnit, units.toUpperCase()); },
    dispose() { end(); mq?.removeEventListener?.('change', onMq); unsubs.forEach((u) => u()); el.remove(); },
  };
}

function fmtClockMs(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function tyreColor(wear) {
  // green -> yellow -> red by wear
  const w = Math.max(0, Math.min(1, wear));
  const hue = Math.round(125 * (1 - Math.min(1, w / 0.9)));
  return `hsl(${hue} 85% 50%)`;
}
