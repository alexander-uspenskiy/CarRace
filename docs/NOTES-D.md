# NOTES-D (UI / flow / main loop)

Interpretation choices where the spec was ambiguous:

- Selections (team, driver, track, length, difficulty) live in `save.last` via `save.setLast`; flow params are not used to carry them.
- `DIFFICULTY`, `RACE_MINUTES`, `LENGTH_CREDIT_MULT`, `computeCredits`, `createRaceConfig` may live in `data/economy.js` or `data/raceConfig.js`: `src/ui/dataRefs.js` resolves them from either (with fallbacks).
- `flow.back()` pops a history stack (cleared on `title`); `transition()` pushes. Garage/HoF "Back" use `back()` (fall back to title).
- Results flow params are `{result, credits, newRecords, entryId}` (`entryId` added so the name field can call `hof.renamePlayer`).
- `loading` screen starts the race itself unless params `{manual:true}` (debug hook) and supports `{restart:true}` (pause -> Restart goes through `loading`). Leaving `race/paused` for any other state disposes the RaceController.
- `main.js` statically imports only `debug.js`; everything else is dynamically imported so a broken module/WebGL failure yields a friendly panel and a live `window.__game.errors`.
- `__game.startRace` always passes `allowNoRender:true` (works headless without WebGL); normal UI flow throws a friendly error instead.
- Extra UI beyond spec: settings modal (title) + settings in pause menu, help overlay (H), gamepad mapping (optional).
- Race-time remaining on the HUD is an estimate: `estimateRaceSeconds(laps, referenceLapTime) - raceTime`.
