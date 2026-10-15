// CarRace marketing screenshot capture. Usage: node capture.mjs [menus|race|all]
// Requires: npm i puppeteer-core ; game served at http://localhost:8000/ (python3 -m http.server 8000 in project root)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.OUT || path.resolve(HERE, '../screenshots');
const URL = process.env.GAME_URL || 'http://localhost:8000/?fresh=1';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DSF = +(process.env.DSF || 2);

async function open(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: DSF });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => window.__game.ready);
  await sleep(1500);
  return page;
}

async function shot(page, name, dir = OUT) {
  await page.evaluate(() => {
    document.querySelectorAll('.storage-notice,.notice').forEach((e) => e.remove());
    document.activeElement?.blur?.();
  });
  await page.mouse.move(1919, 1079);
  await page.screenshot({ path: `${dir}/${name}`, type: 'png' });
  const errors = await page.evaluate(() => __game.errors);
  console.log('saved', name, errors.length ? 'ERRORS ' + JSON.stringify(errors) : 'ok');
}

// ---- menus + results (Ferrari, seeded save: name ALEX, 5 upgrades bought, 3 HoF races) ----
async function menus(browser) {
  const page = await open(browser);
  // leave the title screen first: its hide() would otherwise write the input's stale 'PLAYER' back over our name
  await page.evaluate(() => __game.goto('hof'));
  await sleep(300);
  await page.evaluate(async () => {
    const g = __game, s = g.save;
    s.setPlayerName('ALEX');
    s.update((d) => { d.credits = 9000; });
    for (const [c, n] of [['engine', 3], ['aero', 2], ['brakes', 2], ['tyres', 1], ['cooling', 1]]) for (let i = 0; i < n; i++) s.buyUpgrade('ferrari', c);
    // Hall of Fame / best-lap data on all 3 circuits
    for (const [trackId, seed] of [['ridgeback', 1], ['costa-marina', 1], ['monte-veloce', 1]]) {
      await g.startRace({ autopilot: true, teamId: 'ferrari', trackId, minutes: 5, difficulty: 'easy', seed });
      g.fastForward(420);
    }
    s.update((d) => { d.credits = 3150; });
    s.setLast({ teamId: 'ferrari', driverIndex: 0, trackId: 'costa-marina', minutes: 7, difficulty: 'normal' });
    g.game.preview.setSpin(false);
  });
  const rot = (a) => page.evaluate((a) => { __game.game.preview.turntable.rotation.y = a; }, a);
  const go = async (st, a) => { await page.evaluate((s) => __game.goto(s), st); await sleep(700); if (a != null) await rot(a); await sleep(900); };

  await go('hof'); await go('title', -0.5); await shot(page, '01-title.png');
  await go('team', -0.5); await shot(page, '02-team-select.png');
  await go('track');
  await page.evaluate(() => { const p = __game.game.preview; p.turntable.visible = false; p.ring.visible = false; });
  await sleep(500); await shot(page, '03-track-select.png');
  await page.evaluate(() => { const p = __game.game.preview; p.ring.visible = true; });
  await go('garage', -0.5); await shot(page, '04-garage-upgrades.png');

  // win celebration: Ferrari (upgraded), easy, autopilot, Monte Veloce seed 2 -> P1
  await page.evaluate(async () => {
    const g = __game;
    await g.startRace({ autopilot: true, teamId: 'ferrari', trackId: 'monte-veloce', minutes: 5, difficulty: 'easy', seed: 2 });
    g.fastForward(420);
  });
  const res = await page.evaluate(() => ({ state: __game.state, pos: __game.getResult().playerPosition }));
  console.log('podium race', res);
  await sleep(4500);
  await shot(page, '07-podium-results.png');
  await page.close();
}

// ---- race shots: paused on an exact sim frame so the camera settles and the pack is where we want ----
async function race(browser, { track, team, seed, t, cam = 'chase', out, dir = OUT }) {
  const page = await open(browser);
  await page.evaluate(() => __game.save.setPlayerName('ALEX'));
  await page.evaluate(async (track, team, seed) => { await __game.startRace({ autopilot: true, teamId: team, trackId: track, minutes: 5, seed }); }, track, team, seed);
  await page.evaluate((t) => { let s; do { s = __game.fastForward(0.25); } while (s.phase !== 'racing' || s.raceTime < t); }, t);
  if (cam === 'cockpit') await page.keyboard.press('KeyC');
  await page.evaluate(() => { __game.fastForward(0.0083); __game.pause(); });
  await page.addStyleTag({ content: '.screen-pause{display:none !important} .hud-hint{display:none !important}' });
  await sleep(2200);
  await shot(page, out, dir);
  await page.close();
}

const which = process.argv[2] || 'all';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--window-size=1920,1080',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
try {
  if (which === 'all' || which === 'menus') await menus(browser);
  if (which === 'all' || which === 'race') {
    await race(browser, { track: 'costa-marina', team: 'ferrari', seed: 1, t: 16.07, out: '05-race-chase.png' });
    await race(browser, { track: 'costa-marina', team: 'ferrari', seed: 1, t: 16.07, cam: 'cockpit', out: '06-race-cockpit.png' });
  }
} finally { await browser.close(); }
