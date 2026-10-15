# NOTES-A (package A: data + core)

Spec ambiguities and how they were resolved.

- **Track design vs calibration.** Original control points hit the geometry rules (§2.2/§8.1) but my first versions of ridgeback/costa-marina calibrated to 75 s / 93 s with B's physics (tight corners = slow), giving 3 laps at 5 min. Tracks were reopened (bigger radii) and `calibration.js` regenerated with `node tools/calibrate.mjs --write` (66.0 / 66.9 / 71.0 s). **If tracks or physics change, re-run the calibrator.** Raw `referenceLapTime` guesses equal those values (the design-intent 52–64 s is not reachable with the §4 car/AI; tests only require 40–80 s and 4–14 laps).
- Costa-marina "90° street corners" use R≈38 (min centreline radius ~31 m), not R≈14–20, for the same reason.
- `mul` upgrade effects are **linear** (`1 + perLevel*L`, so L2 power = +8%); `tyreWearMult` is `0.92^L` (`mode:'pow'`). `describeUpgrade(cat, level)` describes the *cumulative* effect at that level.
- `extraLevelOffset` is added to every category level and clamped to 0..5; `computeCarStats` accepts a Team object or a team id. `BASE_CAR.derived.accel0to100` computes to 3.36 s (spec "≈3.3").
- `statSummary`: 50 = stock Williams-strength car, 100 = strength-1.0 car with the categories feeding that bar maxed (so engine+aero trade-offs stay visible; a fully upgraded car is not 100 on top speed).
- `computeCredits`: the DNF x0.5 applies to the position payout only (shown as a negative line); bonuses still apply. 'Positions gained' / 'Beat teammate' lines appear only when earned.
- `refundUpgrades` returns `{ok:false, refunded:0}` when nothing was spent. `getUpgrades` returns a copy.
- HoF `isPersonalBest` = no earlier entry on that board by the same (case-insensitive) name is as fast; `newRecords` only lists entries that made the top 10. Entry id == history record id (rename updates all).
- Corrupt JSON in save/HoF -> defaults, original text backed up under `<key>.corrupt`. Unknown/future versions are field-sanitised and rewritten as v1.
- `getTrackDef(unknownId)` throws. `core/text.js` (shared `sanitizeName`) and `tests/data/trackChecks.js` (geometry validators) are extra files.
- Run tests: `node --test "tests/core/**/*.test.js" "tests/data/**/*.test.js"` (the bare-directory form fails on Node >= 21).
