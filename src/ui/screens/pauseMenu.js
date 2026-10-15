import { h, button } from '../dom.js';
import { createSettingsControls, controlsTable } from '../settingsPanel.js';

export function createPauseMenuScreen(ctx) {
  const { game, save, flow } = ctx;
  const settings = createSettingsControls({ save, game, include: ['volume', 'camera', 'units'] });
  let quitArmed = false, quitTimer = null;

  const resume = button('RESUME', () => game.resume(), 'btn-primary btn-xl');
  const restart = button('RESTART RACE', () => flow.transition('loading', { restart: true }), 'btn-xl');
  const quit = button('QUIT TO MENU', onQuit, 'btn-xl btn-danger');
  function onQuit() {
    if (!quitArmed) {
      quitArmed = true;
      quit.textContent = 'CONFIRM QUIT (NO CREDITS)';
      quitTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    game.quitRace();
  }
  function disarm() { quitArmed = false; clearTimeout(quitTimer); quit.textContent = 'QUIT TO MENU'; }

  const el = h('section.screen.screen-pause',
    h('div.panel.pause-card',
      h('h1', 'PAUSED'),
      h('div.btn-col', resume, restart, quit),
      h('h4.sec', 'SETTINGS'), settings.el,
      h('h4.sec', 'CONTROLS'), controlsTable()));

  return {
    el,
    show() { settings.refresh(); disarm(); },
    hide() { disarm(); },
  };
}
