// Entry point. Only debug.js is imported statically so that a failure in any other module
// (or missing WebGL) shows a friendly message instead of a blank page.
import { createDebug } from './debug.js';

const params = new URLSearchParams(location.search);
const debug = createDebug({ verbose: params.get('debug') === '1' });

function showFatal(title, message) {
  const root = document.getElementById('ui-root') || document.body;
  const box = document.createElement('div');
  box.className = 'fatal panel';
  const h2 = document.createElement('h2'); h2.textContent = title;
  const p = document.createElement('p'); p.textContent = message;
  const hint = document.createElement('p'); hint.className = 'muted';
  hint.textContent = 'CarRace needs a modern desktop browser with WebGL and must be served over http (for example: npm run serve, then open http://localhost:8000).';
  const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'RELOAD';
  btn.onclick = () => location.reload();
  box.append(h2, p, hint, btn);
  root.append(box);
}

try {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  let storage;
  if (params.get('fresh') === '1') {
    const { createMemoryStorage } = await import('./core/storage.js');
    storage = createMemoryStorage();
  }
  const { createGame } = await import('./game/game.js');
  const game = createGame({ canvas, uiRoot, storage, onError: (m) => debug.pushError(m) });
  debug.attach(game);
  window.addEventListener('pagehide', () => { try { game.dispose(); } catch { /* ignore */ } });
} catch (e) {
  console.error(e);
  debug.pushError('boot: ' + ((e && e.stack) || e));
  showFatal('CarRace could not start', (e && e.message) || String(e));
  debug.failed();
}
