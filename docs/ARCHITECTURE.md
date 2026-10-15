# CarRace — Architecture & Module Contract (v1)

Browser F1 racing game, Three.js r170, vanilla ES modules, no bundler. This file is the **single source of truth**. Four coder agents implement packages A–D in parallel and never talk: if something is not in this spec, make the smallest local choice that does not affect any exported API. **Do not rename or reshape anything exported here.** You may add extra exports.

## 0. Global conventions

- **Units**: metres, seconds, radians, kg, N, W. Speeds in m/s (UI converts: kph = m/s*3.6). Angles radians.
- **World axes (Three.js)**: x east, y up, z south. Sim is 2D `(x, y)`; **sim y == world z**. Mapping: sim `(x, y)` -> world `(x, 0, y)`.
- **Heading** `θ`: forward vector = `(cos θ, sin θ)` in sim coords (θ=0 faces +x/east, θ=π/2 faces +y = south). So θ increases **clockwise seen from above** (north up). Normalise with `wrapAngle` to (-π, π].
- **Right normal** of heading: `(-sin θ, cos θ)`. **Lateral offset `d`**: positive = **right** of travel direction, negative = left. **Steer input**: -1 left … +1 right; positive steer/yaw-rate increases θ. Body velocity `u` forward, `v` right-positive.
- **Mesh orientation**: car model local **+X is forward**, +Y up, **+Z is driver's right**. Mesh placement: `mesh.position.set(x, 0, y); mesh.rotation.y = -heading;`. Car model origin = sim reference point = **centre of gravity at ground level**.
- **Modules**: ES modules, **explicit `.js` extensions in every relative import**, no bare imports except `'three'` (render/ and audio/ only). Pure modules (`core/`, `data/`, `sim/`) never import `three`, never touch `window/document/localStorage/AudioContext`, never at import time. `Math.random` is **forbidden** in `sim/` and `data/` logic (use seeded `mulberry32`); `Date.now` only inside persistence modules via an injectable `now()`.
- **three**: `vendor/three.module.js` r170 is self-contained (no `three.core.js` needed). **No `three/addons/*`** are vendored: do not import OrbitControls/BufferGeometryUtils; write your own helpers. importmap maps only `"three"`. In Node tests `import 'three'` resolves to `node_modules/three@0.170` (same version) — render builders must therefore not touch `document`/WebGL at import or in pure geometry builders (textures via guarded helper, see C).
- **package.json**: **already pre-seeded by the critic** with `"type":"module"`, `"test": "node --test \"tests/**/*.test.js\""` (glob form is REQUIRED: `node --test tests/` fails on Node >= 21) and `"serve": "python3 -m http.server 8000"`. Node >= 22. D may only add to it; nobody may flip `type` back. Test files must be named `*.test.js` under `tests/<pkg>/`.
- **Serving**: ES modules + importmap do NOT work from `file://` (CORS). The game must be served over http (`npm run serve`, then http://localhost:8000). `index.html` rules (D): `<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>` placed BEFORE `<script type="module" src="./src/main.js">`; add `<link rel="icon" href="data:,">` (avoids a favicon 404 that would fail smoke step 1); all asset/module URLs relative (`./…`), never root-absolute.
- **Colour space**: THREE r170 colour-manages hex strings (`new Color('#ff8000')` -> linear). When writing vertex colours into BufferAttributes always use `color.toArray()` / `setRGB` from a `THREE.Color`, never raw sRGB floats. Textures that hold colour: `texture.colorSpace = THREE.SRGBColorSpace`.
- **Dependency DAG** (no cycles): `core/` <- `data/` <- `sim/`; `render/`, `audio/` depend only on `core/`, `data/`, `three`; `ui/`, `game/`, `main.js` may depend on everything. `sim/` must not import `render/`; `render/` must not import `sim/` (they share only the snapshot shape in §5).
- Sim stepping: fixed **120 Hz**, `SIM_DT = 1/120`, accumulator clamp 0.25 s. Rendering via rAF, interpolated with `alpha`.
- **Indexing conventions**: `carId` 0..19 = `teamIndex*2 + driverSlot` (TEAMS order, driver order in team) — independent of grid order; the player's carId = `teamIndex*2 + config.driverIndex`. `position`, `grid`/`gridPosition`, `lap` are **1-based**; `GridSlot.slot` and array indices are 0-based. Track sample index `i` <-> `s = i*ds`.
- **Dates**: `Date`/`performance` are never used in `sim/`. `RaceResult.date` is `null` when produced by the sim; `game.js` sets it (`new Date().toISOString()`) before passing the result to economy/HoF.

## 1. Work packages & file ownership (disjoint)

```
CarRace/
  index.html, styles.css, package.json                       D
  vendor/three.module.js                                     (given)
  docs/ARCHITECTURE.md                                       (architect)
  src/
    main.js                                                  D
    debug.js                                                 D   (window.__game)
    core/                                                    A
      mathUtil.js  vec2.js  eventBus.js  storage.js  trackModel.js  lapMath.js
    data/                                                    A
      teams.js  upgrades.js  carStats.js  economy.js  raceConfig.js
      saveStore.js  hallOfFame.js
      tracks/index.js  tracks/monteVeloce.js  tracks/ridgeback.js  tracks/costaMarina.js
      tracks/calibration.js   (A creates stub `export const CALIBRATION = {}`; B's tools/calibrate.mjs is the ONLY other writer, §9)
  tools/plotTracks.mjs                                       A   (optional: dumps SVG/ASCII of the 3 tracks so A can eyeball control points)
    sim/                                                     B
      carPhysics.js  tyres.js  collisions.js  raceSim.js  raceDirector.js
      ai/racingLine.js  ai/aiDriver.js
    render/                                                  C
      renderHost.js  trackMesh.js  carModel.js  carPreview.js  raceController.js
      cameras.js  scenery.js  sky.js  minimap.js  geomUtil.js  textures.js
    audio/audioEngine.js                                     C
    game/game.js                                             D   (orchestrator / game loop)
    ui/                                                      D
      flowMachine.js (pure)  inputMap.js (pure)  input.js  dom.js  hud.js
      screens/title.js teamSelect.js trackSelect.js raceSettings.js garage.js
              loading.js pauseMenu.js results.js hallOfFame.js
  tests/
    core/*.test.js data/*.test.js     A
    sim/*.test.js                     B
    render/*.test.js                  C
    ui/*.test.js                      D
  tools/calibrate.mjs                 B
```

- **A — Data + core logic**: all of `core/`, `data/`, `tests/core`, `tests/data`.
- **B — Physics + AI + race director**: `sim/`, `tests/sim`, `tools/calibrate.mjs`.
- **C — Rendering + audio**: `render/`, `audio/`, `tests/render`.
- **D — UI/flow/HUD/main/index/styles/package.json/debug/game loop**: everything else.
- Integration order recommendation: A is small — land first; B/C/D code against this spec using the documented imports and run tests once A lands.

## 2. Data schemas & static data (owner A: `src/data/`, `src/core/`)

### 2.1 Team / Driver (`data/teams.js`)
```js
// exports: TEAMS (Team[10], this order), getTeam(id), getDriver(driverId) -> {driver, team}, ALL_DRIVERS (20),
//          teamIndex(id)->0..9, carIdFor(teamId, driverSlot)->teamIndex*2+driverSlot, makeDriverCode(name)
Team = {
  id: 'mclaren', name: 'McLaren Formula 1 Team', shortName: 'McLaren', car: 'MCL39', country: 'GBR',
  strength: 1.0,                    // 0.65..1.0, drives AI car stats + grid order
  livery: { primary:'#FF8000', secondary:'#0B0B0F', accent:'#47C7FC', wing:'#FF8000',
            rim:'#1a1a1a', pattern:'solid' },   // pattern: 'solid'|'split'|'stripe'|'chevron'
  drivers: [ Driver, Driver ]
}
Driver = { id:'nor', name:'Lando Norris', code:'NOR', number:4, nationality:'GBR', skill:0.96,
           helmet:{ base:'#FF8000', accent:'#0B0B0F' } }   // skill 0.85..0.99 (AI pace/mistakes)
```
| id | name / car | strength | primary / secondary / accent | pattern | drivers (code #num skill) |
|---|---|---|---|---|---|
| mclaren | McLaren / MCL39 | 1.00 | #FF8000 / #0B0B0F / #47C7FC | solid | NOR 4 .96, PIA 81 .95 |
| ferrari | Ferrari / SF-25 | 0.93 | #E8002D / #FFEB00 / #FFFFFF | stripe | LEC 16 .96, HAM 44 .95 |
| redbull | Red Bull Racing / RB21 | 0.92 | #1E41FF / #121F45 / #FFD800 | split | VER 1 .99, TSU 22 .90 |
| mercedes | Mercedes-AMG Petronas / W16 | 0.90 | #27F4D2 / #0B0B0F / #C0C0C0 | stripe | RUS 63 .95, ANT 12 .88 |
| williams | Williams / FW47 | 0.78 | #1868DB / #FFFFFF / #00A0DE | chevron | ALB 23 .90, SAI 55 .92 |
| astonmartin | Aston Martin / AMR25 | 0.74 | #229971 / #0B0B0F / #CEDC00 | solid | ALO 14 .94, STR 18 .86 |
| racingbulls | Racing Bulls / VCARB 02 | 0.72 | #6692FF / #FFFFFF / #1B2A5C | split | HAD 6 .87, LAW 30 .88 |
| haas | Haas / VF-25 | 0.70 | #E6E8EA / #E6002B / #0B0B0F | stripe | OCO 31 .89, BEA 87 .88 |
| alpine | Alpine / A525 | 0.66 | #0093CC / #FF87BC / #FFFFFF | split | GAS 10 .91, COL 43 .87 |
| sauber | Kick Sauber / C45 | 0.65 | #52E252 / #0B0B0F / #FFFFFF | chevron | HUL 27 .90, BOR 5 .85 |

Helmet colours: coder's choice (base = team primary or driver-typical). `makeDriverCode(name)` -> last whitespace-separated word of the name, letters only, first 3 uppercased, padded with 'X' (fallback 'PLR') — for the player's custom name.
**Player seat**: the player *replaces* one driver of the chosen team (`driverIndex`). The sim keeps that seat's `driverId` in `CarMeta.driverId` (so helmet/skill come from the displaced driver), but `driverName = config.playerName`, `code = makeDriverCode(playerName)`, `isPlayer = true`. The other 19 cars are AI; the teammate is the team's other driver.

### 2.2 TrackDef (`data/tracks/*.js`, `tracks/index.js`)
```js
// tracks/index.js exports: TRACKS (TrackDef[3]), getTrackDef(id), getTrackModel(id)  // memoised buildTrackModel(def)
TrackDef = {
  id: 'monte-veloce',           // 'monte-veloce' | 'ridgeback' | 'costa-marina'
  name: 'Monte Veloce GP', country: 'Italy', blurb: 'Flat-out flowing speed temple…',
  rating: { speed:5, technical:2 },          // 1..5 stars for UI
  controlPoints: [[x,y], …],                 // metres, CLOSED loop, in travel direction, centred near (0,0)
  width: 15,                                 // full asphalt width (m); halfWidth = width/2
  runoff: 10,                                // metres from asphalt edge to barrier => wallOffset = halfWidth + runoff (monte-veloce 12, ridgeback 9, costa-marina 5)
  kerbWidth: 1.4,
  lengthHint: 3850,                          // metres, approx, within ±3% of built model.length
  referenceLapTime: 60.0,                    // seconds, solo flying lap of the calibration car (§9); used by lap formula. A's value is an INITIAL GUESS;
                                             // effective value = CALIBRATION[id] ?? this (tracks/index.js applies tracks/calibration.js overrides)
  theme: { sky:['#5aa7ff','#cfe8ff'], fog:'#cfe3f5', grass:'#3f7d2e', asphalt:'#3a3b3f',
           kerbA:'#e10600', kerbB:'#ffffff', sunDir:[-0.4,0.8,0.3], scenery:['trees','grandstands'], treeDensity:0.5 },
  seed: 1337                                 // scenery RNG seed
}
```
Circuits (A authors control points; must satisfy tests in §8):
1. **monte-veloce** — fast & flowing, ~3.6–4.1 km, bbox ≲ 1600×1000 m, 1 km+ main straight, 2 chicanes, 2 long sweepers, 1 long final-style right-hander; `referenceLapTime ≈ 58–64`, width 15.
2. **ridgeback** — tight technical, ~2.2–2.6 km, bbox ≲ 900×800 m, 12–15 corners incl. one hairpin (centreline radius ≥ 22 m), esses, `referenceLapTime ≈ 52–58`, width 13.
3. **costa-marina** — coastal/street mix, ~2.9–3.4 km, bbox ≲ 1300×900 m, long seafront straight, 90° street corners, a flowing sea-side section; flat; `referenceLapTime ≈ 56–62`, width 13.5, scenery `['palms','buildings','grandstands']`.
All flat (y=0). **Geometry constraints (tested, §8.1)**: (a) minimum centreline radius ≥ `max(1.15*halfWidth, 1.05*wallOffset)` everywhere (ribbon AND both barrier rings must not fold; so ridgeback hairpin R ≥ 22 with wallOffset 15.5 is OK, costa-marina 90° corners R ≥ 14); (b) **start/finish straight**: |κ| < 1/600 for all `s ∈ [-185, +25]` m around the line (20 grid slots span 10…162 m behind the line, `gridPose` §4.2) on ALL three tracks, including the 2.4 km ridgeback; (c) non-adjacent sections (|Δs| > 150 m along the lap) keep centreline separation ≥ `2*wallOffset + 6` so barriers/scenery/`project()` never confuse two sections; (d) the model is flat and has no self-crossing. Calibration of `referenceLapTime`: initial guess = `length / avgSpeed` with avgSpeed ≈ 62 / 42 / 52 m/s; B's `tools/calibrate.mjs` measures the truth and rewrites `tracks/calibration.js` (§9). A's tests accept any `referenceLapTime` in 40–80 s (the 52–64 ranges above are only the design intent), and computed laps for 5/7/10 min must be in 4–14.

### 2.3 TrackModel (`core/trackModel.js`) — built from TrackDef, shared by sim/render/UI
```js
buildTrackModel(def, opts = { spacing: 2.0 }) -> TrackModel
// Method: centripetal Catmull-Rom (alpha 0.5) through controlPoints as closed loop, dense-sample (≥32/seg), resample uniformly by arc length into N = round(length/spacing) samples.
TrackModel = {
  id, length, N, ds,                 // ds = length/N ≈ spacing
  halfWidth, runoff, kerbWidth, wallOffset,   // wallOffset = halfWidth + runoff
  x:Float64Array(N), y:Float64Array(N),       // centreline; sample i is at s = i*ds; sample 0 = start/finish line
  tx, ty,                            // unit tangent (travel dir); heading = atan2(ty,tx)
  nx, ny,                            // unit RIGHT normal = (-ty, tx)
  heading:Float64Array(N), curvature:Float64Array(N),   // signed 1/m, + = turning right (clockwise); 3-sample smoothed
  bbox:{minX,maxX,minY,maxY},
  stats:{ length, corners:int, longestStraight:m, avgCurvature },   // corners = contiguous runs |κ|>1/150 for ≥15 m
  wrapS(s) -> s in [0,length),
  sampleAt(s) -> {x,y,tx,ty,nx,ny,heading,curvature,index,s},       // linear interp, s wrapped
  offsetPoint(s,d) -> {x,y},                                        // centre + d*right normal
  project(x,y,hintIndex?) -> {s, d, index, heading, dist},           // hint => search window ±60 samples, falls back to global if |d|>wallOffset*2; d signed (+ right)
                                                                     // s refined by projecting onto the segment (not just nearest sample); dist = |d|; index = floor(s/ds) % N
  surfaceAt(d) -> 'asphalt'|'kerb'|'grass'|'wall'     // |d|<=halfWidth asphalt; <=halfWidth+kerbWidth kerb; <wallOffset grass; else wall
}
getReferenceSpeed(model, def) = model.length / def.referenceLapTime
```

### 2.4 Helpers (`core/`)
```js
// vec2.js — plain objects {x,y}, non-mutating
v2(x,y) add sub scale dot cross(a,b)=a.x*b.y-a.y*b.x len len2 norm dist dist2 rotate(v,a) lerpV(a,b,t) perp(v)=(-y,x)
// mathUtil.js
clamp(x,lo,hi) lerp(a,b,t) invLerp(a,b,x) smoothstep(a,b,x) wrap(x,lo,hi) wrapAngle(a) angleDiff(a,b)=wrapAngle(a-b)
mulberry32(seed)->()=>[0,1)   gaussian(rng)->N(0,1)   sign(x)
// eventBus.js
createEventBus() -> { on(name,fn)->unsubscribe, off(name,fn), once(name,fn), emit(name,payload), clear() }   // synchronous, listener errors caught+console.error
// storage.js
StorageAdapter = { getItem(key)->string|null, setItem(key,str), removeItem(key) }
createMemoryStorage() -> StorageAdapter(isMemory:true)   getDefaultStorage() -> localStorage adapter (isMemory:false) if usable else memory adapter (try/catch everything)
// lapMath.js
START_OVERHEAD = 8       // s: standing-start loss + lap-1 grid distance (raceTime starts at lights-out, the ~6 s of lights are NOT counted).
                         // Maths check (60 s reference lap): 5/7/10 min -> 5/7/10 laps = 308/428/608 s; rounding error <= 0.5 lap (<=30 s)
computeLaps(minutes, referenceLapTime) = Math.max(3, Math.round((minutes*60 - START_OVERHEAD) / referenceLapTime))
estimateRaceSeconds(laps, referenceLapTime) = laps*referenceLapTime + START_OVERHEAD
formatTime(sec)   // 'm:ss.mmm' ('--:--.---' for null/NaN)
formatGap(sec)    // '+1.234' / '+1:02.3' ; formatGapLaps(n) -> '+1 LAP'/'+2 LAPS'
```

### 2.5 Upgrades, car stats (`data/upgrades.js`, `data/carStats.js`)
```js
UPGRADE_CATEGORIES = ['engine','aero','brakes','tyres','cooling']
MAX_LEVEL = 5;  UPGRADE_COSTS = [400, 700, 1100, 1700, 2600]   // cost to go level i -> i+1; total 6500/category
UpgradeDef = { id:'engine', name:'Engine', icon:'⚙', blurb:'More power and top speed',
               effects:[{stat:'power', perLevel:+0.04, mode:'mul'}] }   // see table below
UPGRADES: Record<id,UpgradeDef>;  getUpgradeCost(level)->number|null (null at max)
emptyLevels() -> {engine:0,aero:0,brakes:0,tyres:0,cooling:0}
describeUpgrade(catId, level) -> string[]   // UI lines e.g. ['Power +8%','Top speed ≈ +2.6%']
// carStats.js
BASE_CAR (below)  teamBaseMultipliers(strength) -> {power,cl,cd,mu}
computeCarStats(team, levels /*UpgradeLevels*/, extraLevelOffset=0 /*AI*/) -> CarStats
statSummary(stats) -> {topSpeed,accel,cornering,braking,tyreLife,cooling}  // each 0..100 for UI bars (50 ≈ stock mid-field, 100 ≈ max-upgraded top team)
```
**Upgrade effects** (level L = 0..5; applied multiplicatively on team-adjusted base):

| category | effect per level | physics fields |
|---|---|---|
| engine | power +4%, boostPower +6% | `power`, `boostPower` |
| aero | clA +6%, cdA +2% (downforce trade-off) | `clA`, `cdA` |
| brakes | brake force +5% | `brakeForceMax` |
| tyres | grip +2%, wear rate ×0.92^L | `tyreMu`, `tyreWearMult` |
| cooling (Reliability) | heat gain −5%, cooling +12% | `heatGain`, `coolRate` |

`teamBaseMultipliers(s)`: `x=(1-s)/0.35` -> `power=1-0.03x, cl=1-0.05x, cd=1+0.02x, mu=1-0.01x` (top team vs last ≈ 2–2.5% lap time; fully upgraded ≈ −6% lap time).

**CarStats** (the physics parameter bag; B consumes, A produces; all fields required):
```js
BASE_CAR = CarStats = {
  mass: 800,                 // kg
  cgToFront: 1.98, cgToRear: 1.62,   // wheelbase 3.60; front weight fraction 0.45
  yawInertia: 1100,          // kg m²
  halfWidth: 1.0, noseX: 3.3, tailX: -2.4,    // body extents from CG (collision)
  power: 400000,             // W at wheels (before boost, derate). (Critic: was 480 kW; with rear-axle traction limit ~8.5 m/s² that made power irrelevant below 70 m/s,
                             //  so the Engine upgrade would do nothing on tight tracks. 400 kW is power-limited above ~45 m/s.)
  boostPower: 80000,         // W extra while ERS boost active
  cdA: 0.85, clA: 3.0,       // drag/downforce areas; F = 0.5*1.2*cdA*u², 0.5*1.2*clA*u² (rho 1.2)
  aeroBalanceFront: 0.42,    // fraction of downforce on front axle
  crr: 0.015,                // rolling resistance coeff
  brakeForceMax: 21000,      // N total, ABS-style split (§4.3). Grip-limited below ~53 m/s, brake-limited above => Brakes upgrade matters on fast entries
  tyreMu: 1.55,              // peak friction coeff, fresh tyre, asphalt
  slipStiff: 14,             // lateral force = -mu*Fz*tanh(slipStiff*alpha)
  steerMax: 0.50,            // rad front wheel at standstill; speed-scaled by physics
  tyreWearMult: 1.0,
  heatGain: 0.040, coolRate: 0.030,           // engine heat model, §4.4
  ersDrain: 0.125, ersRecharge: 0.05,         // charge/s (full 8 s boost; 20 s recharge)
  derived: { topSpeed: 89.8, maxLatG60: 2.8, accel0to100: 3.3 }   // for BASE_CAR values; computed by A (formulas below) for every stats object; used by UI bars AND by B's AI speed cap
}
```
`computeCarStats` returns a **fresh object** (never mutates BASE_CAR). `derived` formulas (A implements exactly; B reads `stats.derived.topSpeed`):
- `topSpeed` = root `u` of `power = 0.6·cdA·u³ + crr·(m·9.81 + 0.6·clA·u²)·u` (bisection on [40,150], 40 iterations). Ignoring rolling resistance (old formula `(P/(0.6 cdA))^(1/3)`) overestimates by ~2%. BASE_CAR -> 89.8 m/s.
- `maxLatG60` = `tyreMu·(9.81 + 0.6·clA·60²/m)/9.81` (BASE_CAR -> 2.83 g; ≈3.8 g at 80 m/s — the old value 3.4 was unreachable at 60 m/s).
- `accel0to100` = numeric integral to 27.78 m/s of `a = min(power/max(u,4), 0.95·tyreMu·(m·9.81·cgToFront/L + 0.6·clA·(1-aeroBalanceFront)·u²))/m − drag/m` (BASE_CAR ≈ 3.3 s; traction-limited all the way).

### 2.6 Economy & difficulty (`data/economy.js`, `data/raceConfig.js`)
```js
DIFFICULTY = {
  easy:   { paceScale:0.935, aiUpgradeLevel:0, creditMult:0.8,  mistakeRate:0.10, rubber:0.03, tyreWearMult:0.8 },
  normal: { paceScale:0.970, aiUpgradeLevel:0, creditMult:1.0,  mistakeRate:0.05, rubber:0.02, tyreWearMult:1.0 },
  hard:   { paceScale:1.000, aiUpgradeLevel:1, creditMult:1.25, mistakeRate:0.02, rubber:0.01, tyreWearMult:1.2 } }
RACE_MINUTES = [5,7,10];  LENGTH_CREDIT_MULT = {5:1.0, 7:1.3, 10:1.7}
// economy.js
payoutForPosition(pos) = Math.max(50, Math.round(1200 * 0.82 ** (pos-1)))     // P1 1200, P2 984, P3 807, P5 543, P10 201
computeCredits(result /*RaceResult*/, config /*RaceConfig*/) -> CreditBreakdown
CreditBreakdown = { lines:[{label,amount}], subtotal, lengthMult, diffMult, total }
//  lines: 'Finish P{n}' payoutForPosition; unfinished(`playerFinished===false`, i.e. not across the line before the cut-off) -> ×0.5 (lapped-but-flagged cars count as finished); 'Fastest lap' +150 (`result.fastestLap.carId === result.playerCarId`);
//  'Positions gained' +40 per place gained (`playerGridPosition − playerPosition`, cap +320, ≥0); 'Beat teammate' +100 (teammate = the row with same teamId and !isPlayer, player's position better). total = round10(subtotal*lengthMult*diffMult), diffMult = DIFFICULTY[config.difficulty].creditMult, lengthMult = LENGTH_CREDIT_MULT[config.minutes].
//  Quitting mid-race -> no result, 0 credits.
STARTING_CREDITS = 1000

// raceConfig.js
createRaceConfig({trackId, minutes, difficulty, teamId, driverIndex, playerName, seed, upgrades, steerAssist=0.5}, trackDef = getTrackDef(trackId)) -> RaceConfig
//   (D passes steerAssist from save.settings; seed from Date.now() in D; upgrades = save.getUpgrades(teamId). Only the PLAYER car uses `upgrades`; all 19 AI cars (incl. teammate) use aiLevelsFor(difficulty).)
RaceConfig = {
  trackId:'monte-veloce', minutes:5, difficulty:'normal', teamId:'mclaren', driverIndex:0 /*0|1: which seat the player takes*/,
  playerName:'PLAYER', seed:12345, upgrades:{engine:0,aero:0,brakes:0,tyres:0,cooling:0}, steerAssist:0.5,
  // derived by createRaceConfig:
  laps: computeLaps(minutes, trackDef.referenceLapTime), raceSeconds: minutes*60,
  tyreWearBase: 0.62/(0.55*raceSeconds)      // 1/s; so a flat-out stint ends ≈0.62 wear for ANY race length (§4.4)
}
aiLevelsFor(difficulty) -> UpgradeLevels (all categories = DIFFICULTY[d].aiUpgradeLevel)   // B calls computeCarStats(team, aiLevelsFor(d)) with extraLevelOffset omitted (0)
```

### 2.7 Save, Hall of Fame (`data/saveStore.js`, `data/hallOfFame.js`)
Upgrade decision: **levels are stored per team** (`upgrades[teamId]`), credits are one global wallet. Keys: `'carrace.save.v1'`, `'carrace.hof.v1'`. Corrupt/missing JSON -> defaults (never throw).
```js
SaveData = {
  version:1, playerName:'PLAYER', credits:1000,
  upgrades: { mclaren:{engine:0,aero:0,brakes:0,tyres:0,cooling:0}, … lazily created per team },
  last: { teamId:'mclaren', driverIndex:0, trackId:'monte-veloce', minutes:5, difficulty:'normal' },
  settings: { volume:0.7, quality:'high', units:'kph', steerAssist:0.5, defaultCamera:'chase' },
  stats: { races:0, creditsEarned:0 }
}
createSaveStore(storage = getDefaultStorage(), bus?) -> {
  get() -> SaveData (live object, treat read-only), update(fn(save)) -> persists + emits 'save:changed',
  getUpgrades(teamId) -> UpgradeLevels, canAfford(teamId,cat)->bool,
  buyUpgrade(teamId,cat) -> {ok, reason?:'maxed'|'funds'|'unknown', level?, cost?, credits?},
  refundUpgrades(teamId) -> {ok, refunded}   // 70% of spent, levels reset to 0
  addCredits(n), setPlayerName(name) (trim, max 16 chars, fallback 'PLAYER'), setLast(partial), setSettings(partial), reset() }

HallOfFameData = {
  version:1,
  bestLaps:  { [trackId]: HofEntry[] },                       // top 10 asc by time
  bestRaces: { [trackId]: { [minutes]: HofEntry[] } },        // top 10 asc by time, only finished races
  stats: { races:0, wins:0, podiums:0, finishes:0 },
  history: HallOfFameRecord[]                                 // newest first, max 100
}
HofEntry = { id, name:'PLAYER', teamId, trackId, minutes, difficulty, time:61.234, date:'2026-10-15T12:00:00Z' }
HallOfFameRecord = { id, date, name, teamId, trackId, minutes, difficulty, laps, position, grid, totalTime:null|number,
                     bestLap:null|number, credits, finished:boolean, lapsDown:number }
createHallOfFame(storage = getDefaultStorage(), now = ()=>Date.now()) -> {
  recordRace(result /*RaceResult*/, meta:{playerName, creditsEarned, difficulty}) ->
      { entryId, newRecords:[{kind:'bestLap'|'bestRace', trackId, minutes, time, rank:1..10, isPersonalBest:bool}] },
  renamePlayer(entryId, name), getBestLaps(trackId)->HofEntry[], getBestRaces(trackId, minutes)->HofEntry[],
  getStats(), getHistory(limit?), getData(), clear() }
```
Only races that produce a `RaceResult` are recorded (quitting records nothing). Rules in `recordRace`: `bestLaps` gets `result.playerBestLap` whenever non-null; `bestRaces` only when the player row has `finished && lapsDown === 0` (a lapped time is not comparable); history/stats always; `stats.finishes` counts `finished`. `HofEntry.date`/record `date` come from the injected `now()` (ISO string), not from `result.date`. Win = position 1, podium = ≤3.

## 3. Event bus event names (payload shapes)

Bus created once in `game.js` (`createEventBus()`), passed to screens/audio hooks. The **sim does not know the bus**: it takes an `emit(name,payload)` callback; `game.js` forwards sim events 1:1 to the bus.

| event | payload | emitter |
|---|---|---|
| `flow:state` | `{from, to, params}` | D |
| `race:created` | `{config, metas: CarMeta[]}` | D |
| `race:phase` | `{phase:'intro'\|'lights'\|'racing'\|'finishing'\|'finished'}` | sim |
| `race:lights` | `{lit:0..5}` (one per second; `lit:0` = lights out = GO) | sim |
| `race:lap` | `{carId, lap /*completed lap no.*/, lapTime, isPlayer, isPersonalBest, isFastest}` | sim |
| `race:fastestLap` | `{carId, time, lap}` | sim |
| `race:position` | `{carId /*player only*/, from, to}` | sim |
| `race:carFinished` | `{carId, position, time}` | sim |
| `race:finished` | `{result: RaceResult}` (once) | sim |
| `car:wall` | `{carId, speed /*impact m/s*/, x, y}` | sim |
| `car:contact` | `{carId, otherId, speed}` | sim |
| `car:surface` | `{carId, surface}` (on change, player only) | sim |
| `car:overheat` | `{carId}` | sim |
| `ui:pause` `ui:resume` `ui:restart` `ui:quit` | `{}` | D |
| `save:changed` | `{save}` | A's saveStore (when a bus is passed to `createSaveStore`) |
| `save:purchase` | `{teamId,category,level,cost}` | D (garage screen, after a successful `buyUpgrade`) |
| `hof:record` | `{records}` (= `newRecords`) | D (game.js, after `hof.recordRace`) |

There is **no `race:go` event**: GO is `race:lights` with `lit:0`. Event -> SFX mapping (D, in game.js): `race:lights lit 1..5 -> 'lightBeep'`, `lit 0 -> 'go'`; `race:lap` with `isPlayer -> 'lapBeep'`; `race:fastestLap -> 'fastestLap'`; `car:wall` / `car:contact` only when `carId === playerId` -> `'wall'` / `'contact'`. The sim only emits `car:surface`, `race:position` for the player but emits `race:lap`, `race:carFinished`, `car:wall`, `car:contact` for all cars. `race:created` is emitted by `game.startRace` AFTER the sim exists and BEFORE its first update.

## 4. Simulation (owner B: `src/sim/`)

### 4.1 Types
```js
InputState = { steer:-1..1, throttle:0..1, brake:0..1, handbrake:false, boost:false, reset:false /*edge-trigger*/ }
CarMeta = { id:0..19 /*== index everywhere*/, teamId, driverId, driverName, code, number,
            isPlayer, color:'#hex' /*team primary*/, stats: CarStats /*for audio pitch etc. optional*/ }
CarState = {                       // internal to sim; fields B may extend
  id, x, y, heading, prevX, prevY, prevHeading,
  u, v, yawRate, steerAngle, ax /*= body-frame longitudinal accel, + = speeding up*/, ay /*= body-frame lateral accel (v̇+uω), + = to the RIGHT; both m/s², smoothed ~0.05 s*/,
  inThrottle, inBrake, inSteer /*filtered*/,
  tyreWear:0..1, tyreGrip /*mult from wear*/, heat:0..1.2, ers:0..1, boosting,
  s, d, index /*track projection*/, surface, progress /*unwrapped metres from start line; negative on grid*/,
  lap /*1-based current lap*/, lapStartT, lastLap:null, bestLap:null, wrongWayT,
  position, grid, finished, finishTime, ai /*controller state*/, stats
}
```

### 4.2 Public API
```js
// sim/raceSim.js
export const SIM_HZ = 120, SIM_DT = 1/120;
export class RaceSim {
  constructor({ config /*RaceConfig*/, trackModel, emit /*(name,payload)=>void, default noop*/ })   // imports TEAMS from data/ itself; builds carMetas (index == carId, §0) and the grid
  readonly config, trackModel, carMetas: CarMeta[], playerId, phase, time /*s since sim start*/, raceTime /*s since lights out*/
  update(frameDt, playerInput) -> stepsRun        // accumulate (clamp 0.25), run stepFixed; stores alpha. `playerInput.reset` is LATCHED: if true on any call it is held until consumed by the next step (a frame may run 0 steps)
  stepFixed(playerInput)                          // exactly one SIM_DT step (headless/tests/fastForward)
  getSnapshot(alpha = this.alpha) -> RaceSnapshot // pose interpolated prev->curr by alpha
  skipIntro()                                     // intro -> lights immediately
  setPlayerAutopilot(on)                          // player car driven by AI controller (headless tests, __game)
  resetCarToTrack(carId)                          // last on-track pose, speed 0 (also triggered by input.reset for player; 3 s cooldown)
  getResult() -> RaceResult|null                  // non-null after 'finished'
}
// sim/raceDirector.js (used by RaceSim; also exported for tests)
buildGrid(config, teams, rng) -> GridSlot[]       // {carId, teamId, driverId, slot, s, d, isPlayer}; 20 slots
gridScore: strength + 0.30*(skill-0.9) + 0.08*gaussian(rng)  // sorted desc. Player seat uses its driver's skill; player gets no pole bonus.
gridPose(trackModel, slot) -> {x,y,heading}       // s = wrapS(-(10 + 8*slot)); d = slot%2===0 ? -2.5 : +2.5; slot 0 = pole (left)
createDirector(...)                               // phases/laps/positions/classification, internal
// buildGrid output `slot` is 0-based; CarState.grid / CarSnapshot.grid / row.gridPosition = slot+1.
// sim/carPhysics.js
createCarState(pose:{x,y,heading,speed=0}, stats) -> CarState
stepCarDynamics(car, stats, input /*DriveInput = InputState sans reset, already filtered*/, env, dt)
   // env = { gripFront:0..1, gripRear:0..1 /*surface mult*/, rollExtra:/*added crr*/, draft:0..0.2 /*drag reduction*/, locked:bool /*grid hold*/ }
   // Stability: explicit-Euler rates reach ~2/dt below 3 m/s, so stepCarDynamics internally sub-steps x2 when u < 10 m/s and blends to the kinematic model between 3 and 6 m/s.
filterInput(car, raw, dt) -> DriveInput           // keyboard smoothing, speed-sensitive steering, assist (§4.3)
gearAndRpm(speed) -> {gear:1..8, rpm:0..1}
// sim/tyres.js
tyreGripFromWear(w) -> mult;  stepTyreWear(car, stats, config, dt);  stepThermal(car, stats, dt) // heat & ERS
// sim/collisions.js
resolveWall(car, trackModel, stats) -> impactSpeed|0;  resolveCarCar(carA, carB, statsA, statsB) -> contactSpeed|0
// sim/ai/racingLine.js
buildRacingLine(trackModel, stats, opts={}) -> { offset:Float32Array(N) /*lateral d per sample*/, x, y, curvature, speed:Float32Array(N) /*m/s limit profile*/ }
// sim/ai/aiDriver.js
createAiDriver({trackModel, stats, driver /*{skill:0.85..1}*/, difficulty /*'easy'|'normal'|'hard'*/, rng, racingLine?, paceOverride?:number, noMistakes?:boolean})
      -> { drive(car, world /*{cars: CarState[], playerId, …}*/, dt) -> InputState (steer/throttle/brake/boost; reset:false) }
// Player autopilot = createAiDriver({driver:{skill:1}, paceOverride:0.96, noMistakes:true, difficulty:'normal'}); cool-down after finishing = same driver with pace ×0.55 (also used for the PLAYER car after it crosses the line).
```
`RaceSim.update` per fixed step: (1) director phase logic; (2) for each car: build `InputState` (player input or `ai.drive`), `filterInput`, project to track with hint, wheel surfaces, `stepCarDynamics`, `resolveWall`, thermal/tyres, progress/lap logic; (3) car-car collisions among all pairs within 8 m; (4) positions/gaps/events. Target: **20 cars at 120 Hz ≤ 0.3 ms per step** on a laptop (5-min race = 36 000 steps headless in ≤ 12 s).

### 4.3 Physics model (arcade-sim, 2-axle "bicycle" with friction circle)
Body frame: `u` forward, `v` right, `ω` yaw rate (cw +). Per step (dt=1/120, semi-implicit Euler):
- **Loads**: `W=m·9.81`; `DF = 0.5·1.2·clA·u²`; `Fz_f = W·(cgToRear/L) + DF·aeroBalanceFront`; `Fz_r = W·(cgToFront/L) + DF·(1-aeroBalanceFront)` (L = wheelbase 3.6). Per-axle friction `μ_axle = tyreMu · tyreGrip · surfaceGrip(axle) · (handbrake? 0.45 on rear)`.
- **Slip angles**: `αf = atan2(v + a·ω, max(|u|,1)) − δ`, `αr = atan2(v − b·ω, max(|u|,1))` (a=cgToFront, b=cgToRear).
- **Lateral**: `Fy = −μ·Fz·tanh(slipStiff·α)`, then friction circle: `|Fy| ≤ sqrt((μFz)² − Fx_axle²)`.
- **Longitudinal**: drive `Fx_drive = min(P_eff / max(u,4), 0.95·μ_r·Fz_r)` (rear driven) with `P_eff = (power + (boost? boostPower:0)) · throttle · heatDerate`; brake `F_brk = brakeForceMax · brake` with **ABS-style split**: `front = min(0.6·F_brk, μ_f·Fz_f)`, `rear = min(F_brk − front, μ_r·Fz_r)` (a fixed 0.6/0.4 split would be front-locked at every speed, capping braking at ~16 kN and making the Brakes upgrade useless); drag `0.5·1.2·cdA·u²·(1−draft)`; rolling `(crr+rollExtra)·(W+DF)`. Reverse not supported: below 0.5 m/s with brake held -> stay stopped.
- **Dynamics**: `m(u̇ − vω) = Fx − Fyf·sinδ − drag…`, `m(v̇ + uω) = Fyf·cosδ + Fyr`, `Iz·ω̇ = a·Fyf·cosδ − b·Fyr`. Below 3 m/s blend to kinematic bicycle (`ω = u·tanδ/L`) to avoid singularity. Clamp |ω| ≤ 3.5.
- **World update**: `heading += ω dt`; world vel = `u·(cosθ, sinθ) + v·(−sinθ, cosθ)`; `x,y += vel·dt`. Store `ax, ay` (body, smoothed) for audio/render roll.
- **Steering**: `δ = steerFiltered · steerMax(u)`, `steerMax(u) = stats.steerMax · (0.12 + 0.88/(1+(u/28)²))`. Input filter: steer rises at 5.5/s toward target, returns to 0 at 8/s (keyboard); throttle/brake ramp 5/s up, 10/s down. **Steer assist** (`settings.steerAssist` 0..1 → config field `steerAssist`, default 0.5): adds counter-steer `−assist·0.35·(v_front_slide)` and yaw-rate damping so keyboard feels stable; AI uses assist 0.
- **Surfaces** (computed per axle from the two wheels; wheel lateral offset ±0.85 m, `d_wheel ≈ d + off·cos(Δψ) ± x_axle·sin(Δψ)`, Δψ = heading − trackHeading): asphalt grip 1.00; kerb 0.95; **grass grip 0.55 + `rollExtra`=0.25** (≈ extra 2.5 m/s² decel; top speed 90 -> ~68 m/s, i.e. −25%; 0.12 gave only −14%); beyond `wallOffset` = barrier.
- **Walls**: 4 body corners (±halfWidth, noseX/tailX) tested against `|d| > wallOffset`; push back inside along normal, remove the normal velocity component with restitution 0.15, tangential speed ×0.90 per hit, yaw nudge ≤ 0.8 rad/s away from wall; returns impact speed (emit `car:wall` if > 3 m/s, 0.4 s debounce per car).
- **Car–car** (soft): each car = 2 circles r=1.0 at x=+2.3 and x=−1.5 from CG. Overlap -> positional correction 60% of penetration split by mass equally; normal impulse restitution 0.05; tangential friction 2%; yaw impulse clamp 0.6 rad/s; no damage. Emit `car:contact` if closing speed > 2 m/s.
- **Slipstream**: if another car is within 6–28 m ahead and lateral gap < 2.2 m -> `draft = 0.18·(1−dist/28)` (drag reduction).
- **Resulting benchmarks (BASE_CAR with McLaren multipliers, tested; hand-checked by critic)**: top speed 88–96 m/s (analytic 89.8 + team 1.0); 0–100 kph 2.8–3.6 s (≈3.3); 100→0 kph ≤ 30 m and ≥ 15 m (≈21 m, grip-limited ≈1.9 g); steady-state lateral accel at 60 m/s **2.5–3.0 g** (μ(g+DF/m)=2.83 g; at 80 m/s 3.5–4.0 g — an earlier "3–3.8 g at 60 m/s" was physically unreachable); full-throttle top speed on grass ≥ 20% lower than on asphalt; 20 m/s braking distance on grass ≥ 1.3× asphalt (μ 0.85 g + 0.25 g roll vs 1.55 g).
- **Axis/sign cheat-sheet (all of B, C must agree)**: `ay>0` when turning right (centripetal to the right); `ax>0` accelerating. A car leaning/pitching visually: see §6.2 `updateCarModel` (roll top-of-car outward = `rotation.x = -k·ay`, nose-dive under braking = `rotation.z = +k·ax`).

### 4.4 Tyres, heat, ERS
- **Wear** `w ∈ [0,1]` (0 new): `dw/dt = tyreWearBase · tyreWearMult(stats) · diff.tyreWearMult · (0.25 + 0.75·load²)`, `load = clamp(hypot(ax,ay)/(μ·g·1.6), 0, 1.5)`; ×0.5 on grass. No pit stops (single stint, deliberate).
- **Grip**: `tyreGripFromWear(w) = 1 − 0.12·w − 0.25·clamp((w−0.75)/0.25,0,1)²` (1.0 → 0.88 @ w=.75 → 0.63 @ w=1; a "cliff" after 75%). `tyreWearBase` makes a typical stint end ≈ 0.55–0.65 wear regardless of race length.
- **Engine heat** `h`: `dh/dt = heatGain·throttle + (boosting ? 0.06 : 0) − coolRate·(0.4 + 0.6·min(1,u/50))`, clamp [0,1.2]; `heatDerate = h>0.85 ? 1 − 0.5·min(1,(h−0.85)/0.15) : 1`; emit `car:overheat` once on crossing 1.0 (re-arm below 0.8).
- **ERS boost** (Shift): charge `e∈[0,1]`; while boost && e>0: drain `ersDrain`/s, adds `boostPower`; recharge `ersRecharge·(1 + 1·brake)`/s when throttle < 0.3 or braking. Boost auto-cuts at e=0.

### 4.5 AI driver model
- **Racing line** `buildRacingLine(model, stats)`: start offset 0. Relaxation operates on **positions**, not on `d` (averaging an all-zero `d` array stays zero): repeat **600** iterations (SOR ω=1.5) of `p_i = c_i + d_i·n_i; target_i = (p_{i−1}+p_{i+1})/2; d_i ← clamp(d_i + ω·(dot(target_i − c_i, n_i) − d_i), ±(halfWidth − 1.8))` (cyclic indices). 80 iterations with 2 m spacing only smooths ~18 m scales, far below corner size. Then compute line curvature κ_line (finite difference of line heading, 5-sample smoothed). Tests: line length < centreline length, max |κ_line| ≤ max |κ_centre|, |offset| ≤ halfWidth−1.8, offset continuous (≤ 0.15 m per sample). **Speed profile**: corner limit `v_c = sqrt(μ·g / max(|κ_line| − μ·k_df/m, 1e-4))` (derivation: `v²κ = μ(mg + k_df v²)/m`; corners with centreline R > ~296 m are aero-unlimited and fall to the top-speed cap) with `k_df = 0.5·1.2·clA`, **`μ = tyreMu·0.92`** (was 0.97: that left no margin for tyre wear (grip −7% by end of a race), the ×1.06 mistake factor and pure-pursuit error — hard-difficulty cars would have spun), capped to `0.99·stats.derived.topSpeed`; then forward pass (accel limit `min(power/u, 0.95·μ_full·(m·g·cgToFront/L + k_df·(1−aeroBalanceFront)·u²))/m − drag/m` — rear-axle traction, NOT `μg` which overestimates launch accel by 1.7×) and backward pass (decel limit `(min(brakeForceMax, μ_full(mg+k_df v²))·0.9 + drag)/m`), run **2 laps cyclically** to close the loop. Reference values (BASE_CAR, μ=1.43): R=25 m -> 19.5 m/s, R=50 -> 29 m/s, R=100 -> 45 m/s, R=150 -> 64 m/s, R=200 -> 88 m/s (cap 89 m/s); `μ_full` above = `stats.tyreMu` (no safety factor). Required resulting max lateral usage by the AI at pace 1.0, no mistakes, fresh tyres ≤ 0.92 of available. Pure & deterministic -> unit-testable; cached per (track, stats-key).
- **Control**: look-ahead `Ld = 8 + 0.35·u` m; pure pursuit steer `δ = atan2(2·L·sin η, Ld)` -> steer input `= δ / steerMax(u)`, clamped, smoothed. Target speed `v_t = profile[i + ceil(0.15·u/ds)] · pace`, and where the profile is corner-limited (`profile < 0.9·topSpeed`) additionally `× sqrt(car.tyreGrip)` (the cached profile assumes fresh tyres; at wear 0.62 grip is 0.93); throttle `= clamp((v_t−u)/3, 0, 1)`; brake `= clamp((u−1.03·v_t)/4, 0, 1)`; traction cut if rear slip high. Uses boost on low-curvature stretches when `ers > 0.3` (not when heat > 0.8).
- **Pace**: `pace = lerp(0.955, 1.0, skill_norm) · DIFFICULTY.paceScale · rubber` (critic: was 0.90..1.0 — a 10% pace spread between VER and BOR, plus the team spread, would put backmarkers ~1 lap down in a 10-lap race; 4.5% driver spread + ≈2% car spread ≈ real-F1-like), `skill_norm = (skill−0.85)/0.14`; `rubber = 1 ± diff.rubber` scaled by player gap (+ if player > 6 s ahead of this AI, − if > 6 s behind; linear to ±rubber at 12 s). Per-car stats: `computeCarStats(team, aiLevelsFor(difficulty))`.
- **Overtaking**: if a car ahead is < 30 m, same lane (|Δd| < 2.2 m), and closing: choose side with more room, target lateral offset `±(2.2+0.6)` m blended at 1.5 m/s; don't start passes where |κ_line| > 1/60; return to the racing line once alongside-clear by 8 m. Brake to keep ≥ 8 m if blocked. No defending.
- **Mistakes**: at each corner entry (|κ|>1/120 start) with prob `mistakeRate·(1−skill_norm·0.5)` the target speed ×1.04 for that corner (understeer/wide moment; ×1.04² on lateral load × μ-margin 0.92 = 0.995 < 1, so a mistake is a wide moment, not a guaranteed spin).
- **Launch**: reaction delay `0.18 + 0.25·(1−skill_norm) + 0.15·rng()` s after lights out. Seeded `rng` from `config.seed + carId`.
- **Race end**: finished cars drive on AI at 55% pace ("cool-down"). Player autopilot = same controller with skill 1.0, pace 0.96, no mistakes.

### 4.6 Race rules (`raceDirector.js`)
- **Phases**: `intro` (4.0 s, cars static; `skipIntro()` ends it) -> `lights` -> `racing` -> `finishing` (first car completed `laps`) -> `finished` (emit `race:finished` once).
- **Start lights**: `race:lights lit=1..5` at t = 1,2,3,4,5 s after phase start; hold random `0.6 + 1.4·rng()` s after 5 lit; then `lit:0` + phase `racing`, `raceTime = 0`. During `lights` all cars are held (`locked`, brake on). No jump-start penalty.
- **Progress & laps**: `progress` = unwrapped arc length (cumulative `Δs` with wrap handling; can decrease). Grid cars start with `progress = s_slot − length` (negative). Lap `n` completes when `progress ≥ n·length`; crossing time interpolated within the step (`t_cross = t_prev + dt·frac`). `lap = floor(max(progress,0)/length)+1` (capped at `laps`). Lap time = `t_cross(n) − t_cross(n−1)` (lap 1 measured from lights out `raceTime=0`, so includes standing start). The first car with `progress ≥ laps·length` takes the flag (`phase='finishing'`, `lapsCompleted = laps`). **Every other car finishes at its NEXT start/finish crossing after the flag** (standard F1 rule; otherwise a lapped player — likely for a keyboard driver — would never "finish", get half credits and no Hall-of-Fame race time), with `lapsCompleted` = laps it had completed at that crossing and `lapsDown = laps − lapsCompleted`. Record `finishTime = raceTime at crossing`. Finished cars (incl. the player's) switch to AI cool-down (§4.5).
- **Positions**: finished cars first by `lapsCompleted` desc then `finishTime` asc; unfinished by `progress` desc (always behind finished cars with ≥ their laps). **Gaps** (s): `gapAhead = max(0,(progress_ahead − progress)) / max(speed_ahead, 25)`; `gapLeader` similar vs P1 (finished cars freeze their gap = `finishTime − leader.finishTime`).
- **End**: sim emits `race:finished` when the player has finished + 3 s, or **90 s** after the first finisher (45 s was shorter than one lap, so a lapped player could be cut off before crossing the line). Cars still running are classified by `progress` (`finished:false`, `lapsCompleted = floor(progress/length)`, `lapsDown = laps − lapsCompleted`, `totalTime:null`). `getResult()` builds `RaceResult` (`date:null`, §0).
- **Wrong way**: `wrongWay = true` when `cos(heading − trackHeading) < −0.3` for > 1.5 s at speed > 3.
- **Fastest lap**: min over all completed laps of all cars; emits `race:fastestLap` on improvement.

### 4.7 RaceResult
```js
RaceResult = {
  trackId, minutes, laps, difficulty, seed, date /*ISO*/,
  playerCarId, playerTeamId, playerName, playerPosition, playerGridPosition,
  playerFinished:boolean, playerTotalTime:612.345|null, playerBestLap:59.1|null,   // `date` is null from the sim (D fills it); `playerLapsDown` is also exposed: rows[player].lapsDown
  fastestLap:{ carId, time, lap }|null,
  rows:[ { position, carId, teamId, driverCode:'NOR', driverName, isPlayer, finished, lapsCompleted,
           totalTime:null|number, gapToWinner:null|number /*null if lapsDown>0 or unfinished; UI then shows formatGapLaps(lapsDown)*/, lapsDown:0, bestLap:null|number, gridPosition /*1-based*/ } ] // 20 rows sorted by position
}
```

## 5. Per-frame snapshot (sim -> renderer/HUD/audio)

`sim.getSnapshot(alpha)` returns a **plain, freshly populated (or reused) object**; consumers must treat it read-only and must not retain `cars[]` between frames.
```js
RaceSnapshot = {
  phase:'intro'|'lights'|'racing'|'finishing'|'finished',
  time, raceTime, introT /*0..1 during intro*/,
  lights:{ lit:0..5, out:boolean },          // out=true once GO
  laps, minutes, playerId, leaderId,
  order:[carId,…],                           // P1..P20
  fastestLap:{carId,time,lap}|null,
  cars:[ CarSnapshot × 20 ]                  // index == carId
}
CarSnapshot = {
  id, isPlayer, teamId, code, number, color,
  x, y, heading,                             // interpolated; world = (x,0,y), rotY = -heading
  speed /*m/s, >=0*/, u, v, yawRate, steerAngle /*front wheel rad, + right*/,
  ax, ay /*body accel, ay + = to the right*/, throttle, brake, gear:1..8, rpm:0..1,
  slip:0..1 /*tyre sliding for smoke/squeal*/, surface:'asphalt'|'kerb'|'grass',
  s, d, progress, lap, position /*1-based*/, grid,
  lapTime /*current lap running*/, lastLap, bestLap /*null if none*/, gapAhead, gapLeader,
  tyreWear:0..1, tyreGrip:0..1, heat:0..1.2, ers:0..1, boosting, wrongWay,
  finished, finishTime, contact:0..1 /*decaying flash after a hit*/
}
```
**Interpolation**: position lerps `prev->curr` by alpha; heading interpolates along the shortest arc (`prev + angleDiff(curr, prev)·alpha`); after `resetCarToTrack` / grid placement the sim sets `prev = curr` (no smear). `CarSnapshot.grid` is 1-based. `snapshot.order[k]` is the carId in position k+1. `lapTime` of a finished car = its last lap time.
**Debug copies**: `__game.getSnapshot()` returns a `structuredClone` (safe to keep); `game.getSnapshot()` returns the live reused object.
**Input flow**: D's `input.js` produces `InputState` each frame from keyboard (`inputMap.js` pure) and passes it to `sim.update(frameDt, input)`. `input.reset` is edge-triggered by D (true for one `read()` only); the sim latches it (§4.2).

## 6. Rendering & audio (owner C)

### 6.1 Single GL context: RenderHost + SceneControllers
```js
// render/renderHost.js
export class RenderHost {
  constructor(canvas, { quality:'high'|'low' })       // WebGLRenderer antialias, pixelRatio min(dpr,2) ('low': 1, no antialias-dependent features), sRGB output, ACES tone mapping. D calls host.resize() on window 'resize'.
                                                      // Draw-call budget: renderer.info.render.calls (incl. shadow pass) < 400 with 20 cars — see §6.2 budget
  readonly renderer
  setController(ctrl|null)      // calls prev.onDeactivate?.(), ctrl.onActivate?.(), resize
  render(dt, data)              // ctrl.update(dt,data); renderer.render(ctrl.scene, ctrl.camera)
  resize()                      // reads canvas.clientWidth/Height -> ctrl.resize(w,h)
  setQuality(q)  dispose()
}
SceneController = { scene, camera, update(dt, data), resize(w,h), dispose(), onActivate?(), onDeactivate?() }

// render/carPreview.js — team select, garage, results podium
export class CarPreviewController /*SceneController*/ {
  constructor({ quality })
  showTeam(teamId, driverIdx = 0)          // turntable car on studio floor, rotates 0.35 rad/s; data = {pointerDragDelta?}
  showPodium([{teamId, position:1|2|3, name}])   // three cars on podium steps, slow camera orbit
  setSpin(on)
}   // update data: { pointerDragDelta?: number /*px dragged horizontally since last frame, D accumulates from canvas pointer events*/ }
// render/raceController.js
export class RaceController /*SceneController*/ {
  constructor({ trackDef, trackModel, carMetas, playerId, quality })   // builds track mesh, scenery, sky, 20 car models SYNCHRONOUSLY (~100–400 ms). D awaits two rAFs before constructing so the loading screen paints. Resolves Team via getTeam(meta.teamId) and driverIdx = team.drivers.findIndex(d => d.id === meta.driverId).
  update(dt, snapshot /*RaceSnapshot*/)   // poses cars, wheels, camera, sky follow, shadows; may be called repeatedly with the same snapshot while paused (camera smoothing keeps running)
  dispose()                               // must free geometries/materials/textures (restart creates a new controller)
  setCameraMode('chase'|'cockpit'), getCameraMode(), cycleCamera()
}
```
### 6.2 Builders
```js
// render/carModel.js
buildCarModel(team, { driverIdx=0, helmet=true, quality } = {}) -> THREE.Group
//  car-local: +X forward, +Z right, origin = CG on ground. Axles: front x=+1.98, rear x=-1.62; track (wheel centre) z=±0.85 front/±0.82 rear;
//  wheel radius 0.33 (front)/0.35 (rear), widths 0.30/0.40; nose tip x=+3.3, rear-wing trailing edge x=-2.35; overall width 2.0, height ≈0.95 (halo top 1.05).
//  Parts (procedural, no textures required): monocoque, nose cone, front wing (main plane+flaps+endplates), rear wing (+DRS flap, endplates, beam wing), sidepods, floor,
//  engine cover + shark fin, airbox, halo, driver helmet (team driver colours), 4 wheels (tyre + rim + sidewall stripe), suspension arms, rear light.
//  Livery: team.livery colours + `pattern` realised as thin geometry decals (stripes/split/chevron).
//  **Draw-call budget (hard)**: ≤ 14 THREE.Mesh per car. Build the parts above as small geometries, then merge them with `geomUtil.mergeGeometries` into: 1 body mesh (livery
//  colours as VERTEX COLOURS, one shared MeshStandardMaterial{vertexColors:true}), 1 carbon/dark-parts mesh, 1 helmet mesh, 1 rear-light mesh, 4 wheel meshes (tyre+rim merged, vertex colours),
//  1 blob-shadow quad. (30 meshes × 20 cars = 600 draw calls, plus the shadow pass, would blow the < 400 budget of smoke step 14.) Only the PLAYER car (and only on quality 'high') casts
//  into the sun shadow map; AI cars get the blob quad. Total budget: cars ≤ 260 + track/scenery/sky ≤ 40 calls.
group.userData = { wheels:{fl,fr,rl,rr}   /* Object3D pivots: wheel spin = child.rotation.z (axle=Z) */, steerPivots:{fl,fr} /* rotation.y */,
                   body:Group /* gets roll/pitch */, rearLight:Mesh, helmet:Mesh|null, dims:{length,width,height,wheelbase} }
updateCarModel(group, carSnap, dt)   // position.set(x,0,y); rotation.y = -heading; steer pivots rotation.y = -steerAngle;
                                     // wheel spin: `wheelChild.rotation.z -= speed/R·dt` (MINUS: rolling forward along +X is a negative rotation about +Z; `+=` makes wheels spin backwards);
                                     // body roll: `body.rotation.x = -clamp(ay·0.002, ±0.06)` (turning right => ay>0 => top of car leans LEFT = outward; +rotation.x would lean it right);
                                     // body pitch: `body.rotation.z = clamp(ax·0.0015, ±0.06)` (braking ax<0 => nose DOWN; positive rotation.z lifts +X nose). The spec's earlier -ax and 0.004/0.003 were wrong-signed/too large (ay≈28 m/s² => 6.4°).
                                     // rear light on when brake>0.1. Heading wrap: rotation.y = -heading is fine (Euler y wraps).
disposeCarModel(group)
// render/trackMesh.js
buildTrackMesh(trackModel, trackDef, { textures, quality } = {}) -> THREE.Group
//  children: asphalt ribbon (+ edge lines, racing-line darkening optional), kerbs (red/white alternating at corners |κ|>0.004 ±15 m, both sides),
//  grass ground (large plane at y=-0.02 + runoff strip), barriers (continuous wall at wallOffset, height 1.1, two-tone), start/finish line (checker) + gantry,
//  grid boxes at the 20 grid poses (from sim's formula §4.2 `gridPose`; duplicate the 3-line formula locally, do NOT import sim/).
//  Each part ONE merged BufferGeometry. group.userData.dispose().
//  Ribbon winding (world x east, z south, y up): for sample pair i,i+1 with L=centre−hw·right, R=centre+hw·right (world (x,0,y)), triangles (L_i,R_i,L_{i+1}) and (R_i,R_{i+1},L_{i+1}) give +Y normals (CCW seen from above). Hand-check once; wrong winding = invisible track with default FrontSide.
//  Wall: normal faces the track (inside); barrier on both sides at ±wallOffset.
//  Grid boxes must lie inside the straight guaranteed by §2.2(b).
// render/scenery.js: buildScenery(trackModel, trackDef, { quality }) -> Group   // InstancedMesh trees/palms/buildings/grandstands, seeded by trackDef.seed,
//     placed ≥ wallOffset+6 m from EVERY centreline sample (use a spatial hash); quality 'low' = 40% count.
// render/sky.js: buildSky(theme) -> {mesh /*gradient dome following camera*/, lights:[Hemisphere, Directional(sun, shadow follows target)], fog}
// render/textures.js: createAsphaltTexture() etc. -> THREE.CanvasTexture | null  (returns null when `typeof document === 'undefined'`, so Node tests work)
// render/geomUtil.js: mergeGeometries(list), ribbonGeometry(...) — own implementation (no addons)
```
### 6.3 Cameras (`render/cameras.js`, `CameraRig`)
- **chase**: 7.5 m behind (along smoothed heading, lag 6/s; smooth the heading as an angle via `angleDiff`, never lerp raw radians across ±π), 2.7 m up, looks at point 6 m ahead of car, FOV `60 + 0.14·speed` (cap 80), small shake on kerb/grass.
- **cockpit** (T-cam): at helmet height (0, 0.95, 0.0) car-local, slightly behind helmet, FOV 75, hides own helmet mesh; steering-lean 0.05 rad.
- **intro** (phase `intro`, `snapshot.introT`): crane sweep over the grid ending behind the player car, then blends to selected mode. `lights`/`racing` use selected mode. On `finished` orbit the player car.
### 6.4 Minimap & track map (`render/minimap.js`)
```js
export class Minimap { constructor(canvas2d, trackModel, {size=200, rotate=false}); draw(snapshot) }   // car dots in team colour, player ringed white, start line tick
export function drawTrackMap(canvas2d, trackModel, { padding=16, stroke='#fff', width=6, showStart=true, highlight? })  // static preview for track select
```
Pre-render the centreline path to an offscreen canvas once; per frame only blit + dots. Map is north-up, sim (x,y) -> canvas (x,y) with uniform scale/centering.
### 6.5 Audio (`audio/audioEngine.js`, WebAudio synthesis only)
```js
export class AudioEngine {
  constructor()                    // no AudioContext until init()
  init()                           // call from a user gesture; creates ctx + master chain; idempotent; resume()
  setMasterVolume(v01)  setPaused(bool)  dispose()
  update(playerCar /*CarSnapshot*/, dt, snapshot?)   // engine: 2 detuned saw + sub through lowpass; f0 = 55 + 260·rpm Hz (+ small gear-shift dip), gain by throttle;
                                                      // tyre squeal: bandpass noise by `slip`; wind noise by speed; grass rumble when surface!=='asphalt'
  playSfx(name)                    // 'lightBeep' | 'go' | 'lapBeep' | 'fastestLap' | 'wall' | 'contact' | 'click' | 'purchase'
}
```
`update` must be no-op if not initialised. Nearby AI cars audio is optional (≤ 3 extra voices, nice-to-have).

## 7. UI, flow, game loop (owner D)

### 7.1 State machine (`ui/flowMachine.js`, pure)
States: `title`, `team`, `track`, `settings`, `garage`, `loading`, `race`, `paused`, `results`, `hof`.
```
title    -> team (Play) | garage (Garage; uses save.last.teamId) | hof (Hall of Fame)
team     -> track (Confirm) | title (Back)
track    -> settings (Confirm) | team (Back)
settings -> garage (Next) | track (Back)
garage   -> loading (Start Race) | settings (Back) | title (Back, when entered from title)   // buy/refund upgrades here; shows stat bars + credits
loading  -> race (sim+renderer ready)
race     -> paused (Esc/P/visibilitychange hidden) | results (race:finished)
paused   -> race (Resume) | loading (Restart: same config, new seed) | title (Quit; no result/credits)
results  -> hof (Hall of Fame) | settings (Race again) | title (Menu)
hof      -> title | results(if came from results) (Back)
```
```js
createFlowMachine({ initial:'title' }) -> { get state, get params, transition(to, params)->bool /*false if illegal*/, canTransition(to), force(to, params) /*bypasses the table: used ONLY by __game.startRace/goto*/,
                                            onChange(fn(from,to,params)), back() /*returns to the previous state WITH its previous params; results<->hof needs this*/ }
// race -> results is legal; `paused -> results` is NOT (quit goes to title). title -> loading is illegal (debug uses force).
```
### 7.2 Game orchestrator (`game/game.js`)
```js
createGame({ canvas, uiRoot, storage?, bus? }) -> Game
Game = { bus, flow, save /*SaveStore*/, hof /*HallOfFame*/, host /*RenderHost*/, audio /*AudioEngine*/,
         sim /*RaceSim|null*/, renderer /*RaceController|null*/, preview /*CarPreviewController*/,
         startRace(opts:{teamId,trackId,minutes,difficulty,driverIndex,seed,autopilot,skipIntro}) -> RaceSim,
         restartRace(), quitRace(), pause(), resume(), getSnapshot(), getResult(), dispose() }
```
Loop: `requestAnimationFrame` -> `frameDt = min(dt, 0.1)`. While `race` state: `sim.update(frameDt, input.read())`, `snap = sim.getSnapshot()`, `host.render(frameDt, snap)`, `hud.update(snap)`, `audio.update(snap.cars[playerId], frameDt, snap)`. While paused: no sim update (render last snapshot, audio paused). In menu states render preview controller. On `race:finished` -> `result.date = new Date().toISOString()`, `computeCredits(result, config)`, `save.addCredits(total)`, `save.update(s => {s.stats.races++; s.stats.creditsEarned += total})`, `hof.recordRace(result, {playerName, creditsEarned:total, difficulty})`, emit `hof:record`, flow -> `results` with `{result, credits /*CreditBreakdown*/, newRecords}`. This handler must work when invoked synchronously from inside `sim.stepFixed` (i.e. during `__game.fastForward`), and exactly once (guard flag). Game wires sim `emit` -> `bus.emit`, and bus events -> `audio.playSfx` per the mapping under §3. `audio.init()` on first `pointerdown` OR `keydown` (autoplay policy). `visibilitychange` hidden -> pause. While in `race` state `preventDefault()` on Arrow keys/Space/Tab so the page does not scroll. `Enter` during `intro` calls `sim.skipIntro()`. `startRace` order: build RaceConfig -> `new RaceSim` -> `emit race:created` -> `new RaceController` -> `host.setController` -> apply `save.settings.defaultCamera`. `restartRace`: dispose old RaceController, new seed, same config. The `quality` setting maps to `RenderHost.setQuality`.

### 7.3 Input (`ui/inputMap.js` pure, `ui/input.js` DOM)
`keysToInput(pressedSet /*Set<KeyboardEvent.code>*/) -> InputState`: steer = (Right|KeyD) − (Left|KeyA); throttle = ArrowUp|KeyW; brake = ArrowDown|KeyS; handbrake = Space; boost = ShiftLeft|ShiftRight; (reset via KeyR edge, camera KeyC, pause Escape|KeyP are UI actions, not in InputState except `reset`). Left+Right cancel. `blur` clears all keys. Optional Gamepad API (axes[0], RT/LT, A=boost) nice-to-have. `input.read() -> InputState` (edge-triggered `reset`: true for exactly one read after KeyR keydown); `input.setOverride(partial|null)` for `__game`. `input.js` must ignore key events whose target is an `<input>`/`<textarea>` (player name entry, rename) so typing a name with W/A/S/D/R does not drive/reset.

### 7.4 HUD (`ui/hud.js`, DOM over canvas; `hud.update(snapshot)` each frame, DOM writes only when value changed)
Top-left: standings tower (top 10, plus player row if lower; team colour chip, code, interval/gap-to-leader). Top-right: `LAP n/N`, `P3/20`, current/last/best lap, fastest-lap badge. Bottom-centre: speed (kph/mph per settings), gear, rpm bar. Bottom-left: tyre wear bar (green→yellow→red, grip %), ERS bar, engine-heat bar. Bottom-right: minimap `<canvas>` (C's `Minimap`). Centre: 5 start lights overlay (driven by `snapshot.lights` / `race:lights`), toasts ('FASTEST LAP', 'P3 → P2', 'OFF TRACK', 'WRONG WAY', 'LAP 2'), final-lap banner. Pause button/hint, camera hint.

### 7.5 Screens (each: `createXScreen(ctx) -> { el, show(params), hide(), update?(dt) }`, ctx = `{ game, bus, save, hof, flow, audio }`)
- **title**: logo, Play / Garage / Hall of Fame, **player name input** (persisted via `save.setPlayerName`).
- **teamSelect**: 10 team cards (colour chip, car name, strength), prev/next arrows (←/→ keys), driver toggle (0/1), 3D turntable via `game.preview.showTeam`, stat bars (`statSummary(computeCarStats(team, save upgrades))`).
- **trackSelect**: 3 cards, static map via `drawTrackMap(canvas, getTrackModel(id))`, stats (length km, corners, longest straight, ratings, best lap from HoF).
- **raceSettings**: length 5/7/10 min (shows computed laps and estimated time via `computeLaps`/`estimateRaceSeconds`), difficulty easy/normal/hard (shows credit multiplier).
- **garage**: credits, 5 upgrade cards (level pips, next cost, `describeUpgrade`), Buy/Refund, before/after stat bars, Start Race. Purchase -> `save.buyUpgrade` + `audio.playSfx('purchase')`.
- **loading**: build track mesh/scenery (yield a frame via `await`), then `game.startRace`.
- **pauseMenu**: Resume, Restart, volume slider, camera toggle, Quit.
- **results**: classification table (pos, team chip, code, time/gap, best lap, FL badge), 3D podium (`preview.showPodium`), credits breakdown (`CreditBreakdown.lines`), new-records callouts, editable name -> `hof.renamePlayer`, buttons.
- **hallOfFame**: tabs (Best Laps / Best Races / History / Stats), track + length filters, tables from `hof.getBestLaps/getBestRaces/getHistory/getStats`, empty states.
Styling: dark glass panels, team-colour accents, system font stack only; responsive ≥ 1024×640.

## 8. Test plan

### 8.1 Node unit tests (`node --test tests/`), no DOM, no WebGL
**A**: `core/mathUtil`, `vec2`; `core/trackModel` (closed loop: first/last sample gap ≈ ds; uniform spacing ±1%; unit tangents & normals; curvature sign for known circle; `project(offsetPoint(s,d))` round trip within 0.05 m; `length` within ±3% of `lengthHint`; ribbon edges at ±halfWidth do not self-intersect or fold (min radius ≥ halfWidth·1.15); wall rings non-self-intersecting (min radius ≥ max(1.15·hw, 1.05·wallOffset)); start straight |κ|<1/600 on s∈[−185,+25]; non-adjacent separation ≥ 2·wallOffset+6; all 3 tracks bbox/length ranges of §2.2; `tracks/calibration.js` override applied by `getTrackDef`); `data/teams` (10 teams, 20 unique driver ids/codes, unique numbers, hex colours valid, strengths in range); `data/upgrades` (costs escalate, maxed at 5, `buyUpgrade` funds/maxed paths, refund 70%); `data/carStats` (monotonic improvement per category, no mutation of BASE_CAR, derived topSpeed ≈ analytic); `data/economy` (payout table, bonuses, multipliers, unfinished half-pay); `core/lapMath` (`computeLaps` × 3 tracks × {5,7,10}: `estimateRaceSeconds` within ±0.5·referenceLapTime of target; laps ≥ 3; laps(5)<laps(7)<laps(10) for every track; plus fixed vectors, e.g. ref 60 -> 5/7/10 laps); `data/saveStore` & `data/hallOfFame` (memory storage; corrupt JSON recovery; top-10 sorting/trim; record flags; rename; history cap 100; version defaults); `core/eventBus`.
**B**: (tests may import `data/` and `core/`; `tests/sim` may rely on A having landed — until then B stubs with a local fake TrackModel built from a circle/oval and `computeCarStats`-like literal BASE_CAR copy) `carPhysics` (benchmarks of §4.3; determinism — same inputs twice = identical state; straight-line stability; grass slower; handbrake rotates rear); `tyres` (grip curve monotone, wear rises with load, `tyreWearBase` end-of-race ≈ 0.55–0.65 for AI driving a full race on each track); `racingLine` (profile ≤ top speed, continuous, braking feasible: decel between samples ≤ limit, offset within track); `aiDriver` (alone on each track for 2 laps: stays within wallOffset, no wall hits at normal, lap time (laps 2–3, flying) within ±12% of the effective `referenceLapTime` (calibration car, §9) — **warning-level threshold ±12%, hard-fail ±25%; B must run `tools/calibrate.mjs` before finishing so the hard-fail cannot trip on A's guess**); `collisions` (wall push-back, car-car separation, no tunnelling at 90 m/s); `raceDirector` (grid sorted by score, 20 slots on distinct poses, lights timing 1..5 s then random hold in [0.6,2.0], lap counting incl. interpolated times, positions ordering, classification of unfinished cars); `integration` (full 5-min race, headless `stepFixed` with player autopilot: ends with `race:finished`, 20 rows, positions 1..20 unique, winner `raceTime` within ±15% of 300 s (rounding alone is up to ±0.5 lap ≈ ±10%), perf ≤ 12 s wall-clock; **default `npm test` runs monte-veloce only; the other two tracks run when `process.env.FULL === '1'`** so the default suite stays < 60 s); a lapped-player case (autopilot `paceOverride` 0.6) must still yield `playerFinished:true, lapsDown ≥ 1`; a stationary player (no input, no autopilot) must still end the race via the 90 s cut-off with `playerFinished:false`.
**C** (Node + `three`, no renderer): `carModel` (10 teams build; mesh count ≤ 14 (§6.2 budget); bbox length ≈ 5.7 ±0.4, width ≈ 2.0 ±0.15; `userData` contract), `trackMesh` (3 tracks build, vertex counts sane, ribbon vertices at ±halfWidth, ribbon triangle normals all +Y), `scenery` (no instance within wallOffset+6 of centreline), `cameras` (pure follow maths), `minimap` (path transform maths if separable).
**D**: `flowMachine` (all legal/illegal transitions, back()), `inputMap` (key combos, cancel, blur), result->credits wiring helper if separable.

### 8.2 Debug hook `window.__game` (D, `src/debug.js`; always installed; verbose with `?debug=1`)
```js
window.__game = {
  ready: Promise,                          // resolves after first frame
  get state(),                             // flow state name
  startRace({ teamId='mclaren', trackId='monte-veloce', minutes=5, difficulty='normal', driverIndex=0,
              seed=1, autopilot=false, skipIntro=true }) -> Promise<RaceSnapshot>   // bypasses menus (flow.force('loading') -> game.startRace -> flow.force('race')), resolves (structuredClone) when phase==='lights' (immediately after construction when skipIntro; otherwise after the rAF loop has run the 4 s intro)
                                                                                    // uses save.getUpgrades(teamId) and save.settings.steerAssist; page loaded with `?fresh=1` uses an in-memory store (clean save/HoF) — recommended for automated runs
  fastForward(seconds, { render=false }) -> RaceSnapshot   // synchronously runs `round(seconds*120)` × sim.stepFixed(input) with current input/autopilot (stops early after phase 'finished'); fires events (incl. the results flow transition)
  getSnapshot() -> RaceSnapshot|null /*structuredClone*/,  getResult() -> RaceResult|null,
  setAutopilot(bool),  setInput(partial|null),     // override InputState
  goto(stateName, params) -> true /*uses flow.force*/,  pause(), resume(),
  save, hof, bus, flow,                    // live objects
  stats(): { fps, frameMs, drawCalls, triangles, heapMB? },
  errors: string[]                         // collected window.onerror / unhandledrejection messages
}
```
### 8.3 Browser smoke-test checklist (served at http://localhost:8000, Chrome; no console errors at each step)
1. Page loads, title screen visible, `__game.errors.length === 0`, no network 404s (check Network).
2. Name entry persists after reload (`__game.save.get().playerName`).
3. Team select: all 10 teams selectable, 3D car visible & rotating, livery colours differ; stat bars update.
4. Track select: 3 tracks, each map preview draws a closed loop; laps shown for 5/7/10 min within sane range (4–14), strictly increasing.
5. Race settings -> garage: buying an upgrade deducts credits, level pips update, stat bars change; maxed state disables Buy; persistence after reload.
6. `__game.startRace({autopilot:true, trackId:T})` for each of 3 tracks: 5 start lights light then GO; 20 cars on grid in 2 columns; HUD shows P/lap/timers/minimap.
7. `fastForward(60)`: player progress > 0, order has 20 unique ids, speeds > 0, no NaN in snapshot (`JSON.stringify(snap)` has no `null` for numeric fields).
8. Manual keys: ↑ accelerates, ← → steer, ↓ brakes, Space handbrake, Shift boost drains ERS, C toggles chase/cockpit, R resets to track, Esc pauses (sim time frozen, `__game.getSnapshot().time` unchanged) and resumes.
9. Driving onto grass slows the car and shows OFF TRACK; hitting a barrier plays impact and loses speed, car stays within walls.
10. Tyre wear rises; end-of-race wear ≈ 0.5–0.7 with autopilot at normal.
11. `startRace({minutes:5, autopilot:true})` then `fastForward(360)` (blocking: ~43 000 steps ≈ 13 s at the 0.3 ms budget; acceptable for a smoke test) -> state becomes `results` (lights ≈ 6.3 s + winner ≈ 290–320 s + 3 s); results show 20-row classification, podium 3D, credits added (`save.get().credits` increased), Hall of Fame entry created.
12. Hall of Fame screen: best lap/best race tables show the new entries per track and length; History lists the race; rename updates entry; reload persists; empty-state displays after `__game.hof.clear()`.
13. Pause -> Restart restarts same config; Quit returns to title with no credits/HoF change.
14. Perf: `__game.stats().fps ≥ 50` on mid laptop in race with 20 cars (quality 'high'), drawCalls < 400; `quality:'low'` ≥ 60.
15. Audio: after first click AudioContext running, engine pitch rises with speed, volume slider works, mute on pause.
16. Resize window / mobile-narrow width: canvas resizes, no layout overflow ≥ 800 px wide.

## 9. Risks & resolved decisions

- **Calibration of `referenceLapTime`** (A authors a guess; B's physics determines truth): **calibration car** = Racing Bulls / LAW (strength 0.72, skill 0.88), `normal` difficulty, no upgrades, solo on track, flying start (lap 0 discarded), reference = **mean of laps 2–4**, rounded to 0.1 s. `tools/calibrate.mjs` (B, Node, run via `node tools/calibrate.mjs [--write]`) prints the measured value per track and, with `--write`, regenerates `src/data/tracks/calibration.js` (`export const CALIBRATION = { 'monte-veloce': 61.3, … }`); `tracks/index.js` (A) must apply `CALIBRATION[id] ?? def.referenceLapTime` inside `getTrackDef`/`TRACKS`. This is the single sanctioned cross-package write. B runs it as its last step and commits the file; the integrator re-runs it after merge. Rationale for the stats: the field's mid-pack AI pace = lerp(0.955,1,0.21)·0.97 ≈ 0.94 of the profile speed; leaders are ~3–4% faster, so a 5-min race with a McLaren leader ends ≈ 4–6% earlier than the formula (documented, acceptable: the formula targets 5/7/10 min for the typical field, ±½ lap).
- **Upgrades per team, credits global** (decided §2.7). Level 5 costs 6500/category; typical race at normal ≈ 500–1000 credits -> shop lasts ~40–60 races.
- **No pit stops, flat tracks, no DRS**: single ERS boost only. **No damage model.**
- **Player seat**: player replaces one driver of chosen team; teammate AI drives the other; player code via `makeDriverCode`.
- **Scoreboard keying**: records separated by track (+ length for race times); difficulty stored as a column, not a key.
- **Three r170 without addons**: all geometry merging is C's `geomUtil.js`; cannot use `three/addons/*`. `import 'three'` must stay the only bare specifier.
- **Determinism**: all sim randomness from `mulberry32(config.seed …)`; renderer/UI may use `Math.random`. Identical `RaceConfig` + identical inputs -> identical results (tested).
- **Background tab**: hidden tab auto-pauses; accumulator clamp prevents spiral of death.
- **Memory/GC**: snapshot object reused/pooled by sim (`getSnapshot` may return same object each call; consumers read-only); per-car typed arrays for racing lines cached by (trackId, statsKey).
- **Track validity risk**: A's hand-authored control points can fold; guarded by the ribbon/radius tests (§8.1). If a test fails A fixes the points, not the test.
- **localStorage unavailable** (private mode): falls back to in-memory store silently; D shows a small "progress won't be saved" notice if `getDefaultStorage().isMemory === true` (A sets that flag on the adapter).
- **AudioContext autoplay policy**: init only on user gesture.
- **WebGL unavailable / context lost**: `main.js` wraps `createGame` in try/catch and shows a plain-HTML error panel (and still installs `window.__game` with `errors`); the menu flow does not require WebGL except the 3D previews, so previews degrade to a static colour swatch if `RenderHost` construction throws.
- **AI tracking error**: pure pursuit alone under-steers at high lateral g (front slip angle ≈ 0.1 rad). B may add a small lateral-error/heading PD term to the steer command; acceptance is the test thresholds (no wall hits at normal, lap within ±12%), not the formula.
- **Integration order / stubs**: A must land `core/mathUtil`, `core/trackModel`, `data/carStats`, `data/teams` first (B/C/D depend on them); until then B/C/D use local stubs inside their own `tests/` only, never in `src/`. `package.json` is pre-seeded (§0).
- **Open for integrator**: global tuning knobs belong in `BASE_CAR` (A) and a single `sim/tuning.js`-style const block at top of `carPhysics.js` (B); change numbers, not APIs.

## Critic changelog

Maths used: μ=1.55, m=800, ρ=1.2. Lateral limit at speed u = μ·(g + 0.6·clA·u²/m): 2.83 g @60 m/s, 3.8 g @80. Corner speed `v=√(μg/(κ−μ·0.6·clA/m))`. Rear-axle traction limit ≈ 0.95·μ·Fz_r ≈ 8.5 m/s² ⇒ power-limited only above P/F_tr. Lap formula checked for ref 60/55/59 s × 5/7/10 min: 5/7/10, 5/7/11, 5/7/10 laps (≈ 283–613 s, error ≤ ½ lap).

1. `package.json` was `"type":"commonjs"` with a dummy test script, owned by D → A/B/C tests (ESM) would all fail until D landed. Resolved: pre-seeded with `"type":"module"`, real test + serve scripts; D may only add.
2. `node --test tests/` fails on Node ≥ 21 (verified on Node 23). Resolved: glob form `node --test "tests/**/*.test.js"`; Node ≥ 22.
3. ES modules/importmap cannot run from `file://`. Resolved: serve over http, `npm run serve`, importmap-before-module rule, relative URLs, favicon data URI (avoids 404 failing smoke step 1).
4. Vertex-colour/colour-space pitfall in r170 (hex strings are colour-managed). Resolved: use `THREE.Color.toArray()`, `colorSpace` on textures.
5. `carId` assignment unspecified (B vs D vs C could disagree). Resolved: `teamIndex*2+driverSlot`, helpers `teamIndex`/`carIdFor`.
6. `RaceResult.date` ISO vs "no Date in sim". Resolved: sim emits `date:null`, `game.js` fills it; HoF uses injected `now()`.
7. `referenceLapTime` guess vs physics truth had no mechanism and a wrong cross-ref (§6.4). Resolved: calibration car definition, `tracks/calibration.js` override written only by B's `calibrate.mjs`, A's tests accept 40–80 s.
8. `makeDriverCode` not in teams.js exports, algorithm vague; player-seat meta (driverId/helmet) undefined. Resolved.
9. Barrier rings fold if radius < wallOffset; costa-marina street corners (~R14) impossible with runoff 10. Resolved: per-track runoff (12/9/5), radius ≥ max(1.15hw, 1.05·wallOffset).
10. Grid spans 162 m behind the line; a tight track could have a corner there. Resolved: start-straight constraint on all tracks + test.
11. Track sections passing close to each other break `project()` hints/barriers/scenery. Resolved: separation ≥ 2·wallOffset+6 test.
12. `derived.topSpeed` (92) ignored rolling resistance and BASE_CAR changed; `maxLatG60` 3.4 g unreachable (2.83 g); `accel0to100` 2.9 s unreachable (3.3 s). Resolved with explicit formulas and values.
13. 480 kW was traction-limited below ~70 m/s → Engine upgrade nearly useless on tight tracks. Resolved: power 400 kW, boost 80 kW, cdA 0.85 (top speed 89.8 m/s, power-limited above ~45 m/s).
14. Fixed 0.6/0.4 brake split front-locks at 16 kN → Brakes upgrade had zero effect. Resolved: ABS-style split, brakeForceMax 21 kN (matters above ~53 m/s).
15. Benchmarks: grass −20% unreachable (−14% with rollExtra 0.12), lateral 3–3.8 g @60 m/s unreachable, 100→0 distance range too loose. Resolved: rollExtra 0.25, 2.5–3.0 g @60, ≤30 m.
16. AI profile used μ·0.97: no margin for tyre wear (−7% grip), ×1.06 mistakes (+12% lateral) or pure-pursuit error → spins on hard. Resolved: μ·0.92, ×1.04 mistakes, `×√tyreGrip` in corner-limited zones.
17. AI forward pass used `μg` (14.7 m/s²) vs real rear-axle limit (~8.5). Resolved: rear-axle traction + aero.
18. Racing-line relaxation "toward neighbours' average" on an all-zero `d` array is a no-op, and 80 iterations only smooth ~18 m. Resolved: relax positions, 600 iterations SOR, tests.
19. Driver pace spread 0.90–1.0 (10%) put backmarkers ~1 lap down in a 10-lap race. Resolved: 0.955–1.0.
20. Cars only "finished" at `laps·length` → a lapped player never finishes (half credits, no HoF), and 45 s cut-off < one lap. Resolved: F1 rule (finish at next line crossing after flag), cut-off 90 s, classification order, player cool-down AI.
21. HoF best-race times for lapped finishes are not comparable. Resolved: `bestRaces` only when `lapsDown===0`; `finished:boolean`, `lapsDown` in records.
22. ≤30 meshes/car × 20 cars (+shadow pass) = >600 draw calls vs smoke budget <400. Resolved: ≤14 meshes via merged vertex-coloured geometry, blob shadows, player-only shadow map, budget split.
23. Wheel spin sign (`+=`) makes wheels roll backwards; roll/pitch signs and magnitudes wrong (nose-up under braking, 6° roll). Resolved with exact signs/clamps; `ax`/`ay` sign definitions added.
24. `race:go` event used in game.js but not defined; SFX mapping, per-car vs player-only emission, and emitters of `save:purchase`/`hof:record` unclear. Resolved.
25. `steerAssist` consumed by sim but absent from `createRaceConfig`; `trackDef?` default undefined. Resolved.
26. Flow: garage opened from title had no Back target; debug `startRace`/`goto` needs illegal transitions; `back()` params. Resolved: `garage→title`, `force()`, `back()` semantics.
27. `input.reset` edge lost when a frame runs 0 sim steps. Resolved: sim latches it.
28. Smoke step 11 `fastForward(330)` too tight (lights 6.3 s + winner ≤ 320 s + 3 s); lap sanity 4–12 too tight for calibrated refs. Resolved: 360 s, 4–14.
29. `createAiDriver` param `driver /*skill*/` ambiguous, no way to express autopilot pace/no-mistakes. Resolved: explicit signature + overrides.
30. Explicit-Euler yaw dynamics ≈ 1.8/dt near the 3 m/s blend → marginal stability. Resolved: sub-step ×2 below 10 m/s, blend 3–6 m/s.
31. Heading interpolation across ±π and teleports (reset) would smear; snapshot is a reused object but `__game` needs safe copies. Resolved.
32. Default test suite would run three 12 s races in parallel. Resolved: monte-veloce default, `FULL=1` for all; lapped/stationary-player cases added.
33. `input.js` would react to W/A/S/D/R typed in name fields and scroll the page with arrows/Space. Resolved.
34. `RaceController` build cost/disposal/loading paint, preview drag data, resize wiring unspecified. Resolved.
35. No WebGL fallback; no stub/landing order for A's core pieces. Resolved in §9.
36. 1-based vs 0-based `grid`/`position`/`slot` unspecified. Resolved (§0, §4.2).
37. Ribbon triangle winding unspecified (classic invisible-track bug). Resolved with verified winding; test added.
38. Camera heading smoothing across ±π; `Enter` to skip intro; tools/plotTracks for A to eyeball tracks. Resolved/added.
