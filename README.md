# CarRace

A browser-based, arcade-sim Formula-style racing game built with Three.js and vanilla ES modules (no build step). Pick a 2025-season team and driver, choose a circuit and race length, upgrade your car in the garage, and race a 20-car grid with AI opponents. Everything (3D models, textures, sound) is generated in code.

> Unofficial fan project. Team, car and driver names are used descriptively only. This game has no affiliation with, or endorsement by, Formula 1, the FIA or any team.

## Run

```
npm install      # only needed for the unit tests (Three.js is vendored in ./vendor)
npm run serve    # then open http://localhost:8000
```

Requires a modern desktop browser with WebGL. The game must be served over http (opening `index.html` from disk will not work). Add `?debug=1` for verbose bus logging; `window.__game` exposes a debug/automation hook.

## Controls

| Key | Action |
| --- | --- |
| Up / W | Throttle |
| Down / S | Brake |
| Left, Right / A, D | Steer |
| Space | Handbrake |
| Shift | ERS boost |
| R | Reset car to the track |
| C | Change camera (chase / cockpit) |
| Esc / P | Pause |
| Enter | Skip intro / confirm |
| H | Help overlay |

A standard-mapping gamepad also works (left stick steer, RT throttle, LT brake, A boost, X handbrake).

## Features

- 3 circuits: Monte Veloce GP, Ridgeback Raceway, Costa Marina Street Circuit
- 2025 grid: 10 teams, 20 drivers, each with its own car stats and livery
- Race lengths of 5, 7 or 10 minutes; Easy / Normal / Hard difficulty
- Garage upgrades per team, paid with credits earned from racing (refundable at 70%)
- Hall of Fame: per-track best laps and best races, stats and history (saved locally)
- Tyre wear, engine heat, ERS boost, start lights, race rules, results with podium
- Progress is stored in `localStorage`; if storage is unavailable the game still runs and shows a notice

## Tests

```
npm test         # node --test, ~330 tests, no browser needed
```

## Project structure

```
index.html, styles.css   page shell and styles
src/main.js              entry point (boot, fatal-error screen)
src/debug.js             window.__game hook and error log
src/game/                game orchestrator (main loop, flow wiring), race finalisation
src/sim/                 deterministic fixed-step simulation: physics, AI, rules (no DOM)
src/render/              Three.js: RenderHost, race scene, car models, track, cameras, minimap
src/audio/               WebAudio synthesis
src/ui/                  HUD, screens, input, state machine
src/data/                teams, tracks, upgrades, economy, save store, Hall of Fame
src/core/                math, track model, storage, event bus
tests/                   node unit tests
docs/                    architecture and notes
vendor/                  vendored three.module.js
```
