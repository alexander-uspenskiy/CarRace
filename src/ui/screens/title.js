import { h, button, fmtInt, attachMenuKeys } from '../dom.js';
import { createSettingsModal } from '../settingsPanel.js';
import { getTeam } from '../../data/teams.js';
import { createPreviewPadding, debounce, isStacked } from '../layout.js';

export function createTitleScreen(ctx) {
  const { game, save, flow } = ctx;
  const nameInput = h('input.name-input', { type: 'text', maxlength: 16, placeholder: 'PLAYER', autocomplete: 'off', spellcheck: 'false' });
  // save while typing (debounced) so clicking PLAY immediately never loses the name
  const saveSoon = debounce(() => save.setPlayerName(nameInput.value), 180);
  nameInput.addEventListener('input', saveSoon);
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitName(); nameInput.blur(); } e.stopPropagation(); });
  function commitName() {
    saveSoon.cancel();
    save.setPlayerName(nameInput.value);
    nameInput.value = save.get().playerName;
  }

  const credits = h('div.credits-pill');
  const teamLine = h('div.title-team');
  const notice = h('div.notice');

  const play = button('PLAY', () => { commitName(); flow.transition('team'); }, 'btn-primary btn-xl');
  const garage = button('GARAGE', () => { commitName(); flow.transition('garage'); }, 'btn-xl');
  const hofBtn = button('HALL OF FAME', () => flow.transition('hof'), 'btn-xl');
  const settingsBtn = button('SETTINGS', () => modal.show(), 'btn-ghost');
  const helpBtn = button('CONTROLS', () => game.help?.show(), 'btn-ghost');

  const el = h('section.screen.screen-title',
    h('div.title-wrap',
      h('div.logo', h('div.logo-stripes', h('i'), h('i'), h('i')), h('h1.logo-text', 'CAR', h('span', 'RACE')), h('p.tagline', 'FORMULA SEASON · 10 TEAMS · 3 CIRCUITS')),
      h('div.panel.title-panel',
        h('label.field-label', 'DRIVER NAME'), nameInput,
        h('div.btn-col', play, garage, hofBtn),
        h('div.row.between', credits, teamLine),
        h('div.row.gap', settingsBtn, helpBtn),
        notice)));
  const modal = createSettingsModal(document.getElementById('ui-root') || document.body, ctx);
  let detach = null;
  const padding = createPreviewPadding(game, () => (isStacked() ? {} : { left: el.querySelector('.title-wrap') }));

  function refresh() {
    const s = save.get();
    nameInput.value = s.playerName;
    credits.textContent = '';
    credits.append(h('span.coin', '¢'), ` ${fmtInt(s.credits)} credits`);
    const t = getTeam(s.last.teamId);
    teamLine.textContent = t ? `${t.shortName} · ${t.car}` : '';
    teamLine.style.color = t?.livery?.primary || '';
    const msgs = [];
    if (game.storageUnsaved ?? game.storageIsMemory) msgs.push("Progress won't be saved (browser storage unavailable).");
    if (game.webglError) msgs.push('3D graphics unavailable: ' + game.webglError + ' Menus work, but races need WebGL.');
    notice.textContent = msgs.join(' ');
    notice.style.display = msgs.length ? 'block' : 'none';
  }

  return {
    el,
    show() { refresh(); detach = attachMenuKeys(el); padding.bind(); setTimeout(() => play.focus?.(), 50); },
    hide() { commitName(); detach?.(); detach = null; modal.hide(); padding.unbind(); },
  };
}
