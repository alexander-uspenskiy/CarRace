# NOTES-C (rendering + audio)

Interpretations / deviations (all APIs of spec section 6 are implemented as written; extras are additive):

- `userData.wheels.{fl,fr,rl,rr}` are the **spinning wheel meshes** themselves (spin = their `rotation.z`); the front ones are children of `userData.steerPivots.{fl,fr}` (rotation.y = -steerAngle). Rear wheels are direct children of the car group.
- Car meshes: 9 per car (body, dark parts, helmet, rear light, 4 wheels, blob shadow). Nose tip is x=3.0 (front-wing leading edge reaches x=3.3 = spec nose extent); rear wing trailing edge x=-2.35. Blob quad is 5.5 x 2.04 so the group bbox stays 5.65 x 2.04.
- `RaceController.update` treats a repeated `snapshot.time` as "paused": wheels/smoke do not advance, camera smoothing still runs.
- Camera modes are only `'chase' | 'cockpit'` (intro crane and finish orbit are automatic by `snapshot.phase`). Cockpit hides the player's helmet.
- Shadow map only for the player car on quality `'high'` (sun frustum 28 m around the player); otherwise blob shadow. `RenderHost.setQuality` forwards to `controller.setQuality(q)`; MSAA cannot change after context creation.
- Water theme = `theme.water === true`, `'water'` in `theme.scenery`, or id `costa-marina`: inside of the lap is land (polygon fill), outside has a wobbling shoreline + beach + sea plane. Distant hills ring on all tracks (taller on `ridgeback`).
- Ad boards are part of the barrier mesh (trackMesh), not scenery, so scenery keeps its "no instance within wallOffset+6" guarantee.
- `drawTrackMap(canvas, model, { padding, stroke, width, showStart, highlight })`: canvas size is taken from `canvas.width/height` (set it before calling); `highlight` is `{s0, s1, color}` in metres. `Minimap` sets canvas pixel size to `size*dpr` and CSS size only if unset.
- `AudioEngine`: a 450 ms watchdog silences engine/ambient buses if `update()` stops being called (menus); SFX bus is independent so UI clicks work while paused. Nearby-AI voices (optional) are not implemented.
- `render/` imports only `three`, own files and `data/teams.js` (for `getTeam`); small math helpers live in `geomUtil.js` (no dependency on `core/`).
- Extra files: `render/particles.js` (tyre smoke / grass dust, 1 draw call), `tests/render/_util.js`.

## UI integration (CarPreviewController) — READ THIS if you work on src/ui or src/game

The preview shares the single full-window canvas (RenderHost). Existing calls `game.preview.showTeam(teamId, driverIdx)` and
`game.preview.showPodium(entries)` are unchanged and valid. `entries` = `[{ teamId, position /*1..3*/, name }]` (what `results.js`
already passes: `result.rows.slice(0,3).map(r => ({teamId: r.teamId, position: r.position, name: r.driverName}))`); order does not
matter, missing positions fall back to array index + 1, unknown teamIds fall back to the first team. Podium layout: steps P2 | P1 | P3, cars in team liveries.

New (additive) API — the 3D view is always **auto-fitted** (whole car / whole podium incl. wings at any turntable angle, aspect 0.5–2, 80 % margin):
- `preview.setPadding({ left, right, top, bottom })` — CSS pixels measured from the edges of the **canvas**. The scene is fitted and centred inside
  the free rectangle `[left, W-right] x [top, H-bottom]`. Missing keys = 0. `setPadding(null)` or `setPadding()` resets. Padding persists across
  `showTeam`/`showPodium` calls (reset it when you leave a screen that set it) and is re-applied on canvas resize. Cheap: can be called every frame / on resize.
- `preview.getPadding()` returns the current `{left,right,top,bottom}`.
- `preview.setViewport(w, h)` (alias of `resize(w, h)`) — normally NOT needed: `RenderHost.resize()` forwards the canvas `clientWidth/Height`
  automatically. Only call it if the canvas size changed and `host.resize()` is not run on that path.

Recommended call sequences:
1. **Results screen** (in `results.js` `render()`, after the DOM is laid out — e.g. inside `requestAnimationFrame`, and again on `window` resize):
   ```js
   const cv = game.host.canvas.getBoundingClientRect();
   const p = podiumPanelEl.getBoundingClientRect();     // the panel(s) that overlap the canvas
   // free area = the part of the canvas NOT covered by the results table / records panels
   game.preview.setPadding({ left: Math.max(0, p.right - cv.left), right: 0, top: 0, bottom: 0 }); // adapt to your layout
   game.preview.showPodium(entries);
   ```
   (Leave the podium visible: the results root must not paint an opaque full-screen background over the canvas, otherwise only the HTML rows are seen.)
   On `hide()`: `game.preview.setPadding(null)`.
2. **Team select**: nothing required (auto-fit leaves a margin around wings). If the nav arrows/side panels overlap the canvas, call
   `setPadding({left: arrowW + 16, right: arrowW + 16})` once, `setPadding(null)` on hide.
3. **Garage**: `setPadding({ left: leftPanel.getBoundingClientRect().right, right: window.innerWidth - rightPanel.getBoundingClientRect().left })`
   (+ top/bottom for header bars) then `showTeam(...)`; reset with `setPadding(null)` in `hide()`. Recompute on window resize.

## Camera snap (QA bug: grass-only view after `fastForward`)
Root cause: the chase pose is built from a *smoothed heading* (`CameraRig.hs`, rate 6/s). After a discontinuity (fastForward, restart, teleport, throttled tab with huge dt) the camera was placed behind the car along the stale heading, so it could look away from track and car until the smoothing converged (and never converged if few frames rendered). Fix: `CameraRig.update(dt, car, phase, introT, time)` now detects discontinuities (`isDiscontinuity`: sim time jump > 0.75 s or backwards, wall dt > 0.5 s, car moved more than physically possible, first frame) and calls `snap()` (no smoothing/blend, exact pose on that frame); non-finite car/dt input is ignored. `RaceController.snapCamera()` exposes it manually (e.g. call after custom teleports).
Also: `carPreview` zoom/centring is solved by `render/framing.js` (pure, tested in `tests/render/framing.test.js`).
