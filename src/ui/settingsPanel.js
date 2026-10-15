// Shared settings controls (title modal + pause menu).
import { h } from './dom.js';

function seg(options, value, onPick) {
  const wrap = h('div.seg');
  const btns = options.map(([val, label]) => {
    const b = h('button.seg-btn', { type: 'button', onclick: () => { set(val); onPick(val); } }, label);
    b.dataset.val = String(val);
    wrap.append(b);
    return b;
  });
  function set(v) { btns.forEach((b) => b.classList.toggle('active', b.dataset.val === String(v))); }
  set(value);
  return { el: wrap, set };
}

function slider(min, max, step, value, onInput, fmt) {
  const out = h('span.slider-val', fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = fmt(v); onInput(v); });
  return { el: h('div.slider', input, out), input, out, set(v) { input.value = v; out.textContent = fmt(v); } };
}

const field = (label, ctl) => h('div.field', h('label', label), ctl);

/** @returns {{el, refresh()}} */
export function createSettingsControls({ save, game, include = ['volume', 'quality', 'units', 'assist', 'camera'] }) {
  const s = () => save.get().settings;
  const root = h('div.settings-controls');
  const ctl = {};
  if (include.includes('volume')) {
    ctl.volume = slider(0, 1, 0.01, s().volume, (v) => { save.setSettings({ volume: v }); game.applySettings(); }, (v) => `${Math.round(v * 100)}%`);
    root.append(field('Volume', ctl.volume.el));
  }
  if (include.includes('camera')) {
    ctl.camera = seg([['chase', 'Chase'], ['cockpit', 'Cockpit']], s().defaultCamera, (v) => {
      save.setSettings({ defaultCamera: v });
      game.setCameraMode?.(v);
    });
    root.append(field('Camera (C)', ctl.camera.el));
  }
  if (include.includes('quality')) {
    ctl.quality = seg([['high', 'High'], ['low', 'Low']], s().quality, (v) => { save.setSettings({ quality: v }); game.applySettings(); });
    root.append(field('Graphics (next race)', ctl.quality.el));
  }
  if (include.includes('units')) {
    ctl.units = seg([['kph', 'km/h'], ['mph', 'mph']], s().units, (v) => { save.setSettings({ units: v }); game.hud?.setUnits?.(v); });
    root.append(field('Speed units', ctl.units.el));
  }
  if (include.includes('assist')) {
    ctl.assist = slider(0, 1, 0.05, s().steerAssist, (v) => save.setSettings({ steerAssist: v }), (v) => (v < 0.05 ? 'Off' : `${Math.round(v * 100)}%`));
    root.append(field('Steering assist (next race)', ctl.assist.el));
  }
  return {
    el: root,
    refresh() {
      const st = s();
      ctl.volume?.set(st.volume);
      ctl.camera?.set(st.defaultCamera);
      ctl.quality?.set(st.quality);
      ctl.units?.set(st.units);
      ctl.assist?.set(st.steerAssist);
    },
  };
}

export const CONTROLS_LIST = [
  ['↑ / W', 'Throttle'],
  ['↓ / S', 'Brake'],
  ['← → / A D', 'Steer'],
  ['Space', 'Handbrake'],
  ['Shift', 'ERS boost'],
  ['R', 'Reset car to track'],
  ['C', 'Change camera'],
  ['Esc / P', 'Pause'],
  ['Enter', 'Skip intro / confirm'],
  ['H', 'Help'],
];

export function controlsTable() {
  return h('div.controls-grid', CONTROLS_LIST.map(([k, d]) => h('div.ctl-row', h('kbd', k), h('span', d))));
}

/** Modal overlay with controls help; toggled by H. */
export function createHelpOverlay(root) {
  const el = h('div.modal.hidden', { onclick: (e) => { if (e.target === el) hide(); } },
    h('div.panel.modal-card',
      h('h2', 'Controls'),
      controlsTable(),
      h('p.muted', 'Tip: keep the throttle smooth in corners. The grass slows you down and barriers hurt. Tyres wear with hard driving, and the ERS boost recharges when you lift or brake.'),
      h('div.row.end', h('button.btn.btn-primary', { type: 'button', onclick: () => hide() }, 'Close'))));
  root.append(el);
  function show() { el.classList.remove('hidden'); }
  function hide() { el.classList.add('hidden'); }
  return { el, show, hide, toggle() { el.classList.contains('hidden') ? show() : hide(); }, get visible() { return !el.classList.contains('hidden'); } };
}

/** Modal for the settings controls on the title screen. */
export function createSettingsModal(root, ctx) {
  const controls = createSettingsControls({ save: ctx.save, game: ctx.game });
  const el = h('div.modal.hidden', { onclick: (e) => { if (e.target === el) hide(); } },
    h('div.panel.modal-card', h('h2', 'Settings'), controls.el,
      h('div.row.end', h('button.btn.btn-primary', { type: 'button', onclick: () => hide() }, 'Done'))));
  root.append(el);
  function show() { controls.refresh(); el.classList.remove('hidden'); }
  function hide() { el.classList.add('hidden'); }
  return { el, show, hide };
}
