# CarRace marketing screenshots

All files are 3840x2160 PNG (1920x1080 viewport at deviceScaleFactor 2), captured from real headless Chrome with GPU WebGL (Apple Metal/ANGLE), game loaded with `?fresh=1` (clean in-memory save). Player name "ALEX". No source files were modified; the only DOM tweaks while shooting are removing `.storage-notice`/`.notice`, hiding `.hud-hint` and the pause overlay on the paused race frames, and hiding the 3D preview car/ring on the track-select screen.

| File | Shows | Team / track / seed |
|---|---|---|
| 01-title.png | Title screen, Ferrari turntable at front 3/4 angle, name ALEX, 3,150 credits | Ferrari SF-25 |
| 02-team-select.png | Team select, driver + upgraded stat bars | Ferrari, Leclerc |
| 03-track-select.png | Three circuits with best laps filled in (seeded via autopilot races), Costa Marina focused | Ferrari best laps on all 3 tracks |
| 04-garage-upgrades.png | Garage with Engine 3, Aero 2, Brakes 2, Tyres 1, Reliability 1 bought, 3,150 credits | Ferrari |
| 05-race-chase.png | HERO: chase camera, pack through a Costa Marina corner, grandstand and sea, HUD visible | Ferrari, costa-marina, seed 1, race time ~16.3 s, 5 min, normal |
| 06-race-cockpit.png | Cockpit / T-cam (C key), cars ahead in the same corner | same as 05 |
| 07-podium-results.png | Results with 3D podium, ALEX P1 with fastest lap, credits, records | Ferrari (upgraded), monte-veloce, seed 2, easy, 5 min, autopilot |

`_alts/` holds runners-up (other teams/tracks and a cockpit straight shot).

## Regenerate

```
python3 -m http.server 8000        # in the project root, keep running
cd marketing/tools && npm install
node capture.mjs all               # or: menus | race
```
Env overrides: `OUT`, `GAME_URL`, `CHROME`, `DSF` (1 for 1920x1080 output). Race frames are produced deterministically with `__game.startRace({autopilot:true,...})`, `fastForward()` to an exact sim time, then `__game.pause()` so the camera settles on a frozen frame.
