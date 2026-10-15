// Pure fixed-timestep accumulator. The accumulator is kept in units of *steps* (not seconds) so that
// 1/144 s frames at 120 Hz do not lose a step to floating-point rounding (e.g. 0.99999999999 steps).
export const MAX_STEPS_PER_FRAME = 30; // 0.25 s at 120 Hz
const EPS = 1e-9;

/**
 * advanceAccumulator(acc, frameDt, hz, maxSteps) -> { steps, acc }
 * `acc` is the carried remainder in steps ([0, 1)). Frame time is clamped to >= 0; at most `maxSteps` steps run per
 * frame and any excess time is dropped (spiral-of-death guard) while the sub-step remainder is preserved.
 */
export function advanceAccumulator(acc, frameDt, hz, maxSteps = MAX_STEPS_PER_FRAME) {
  const dt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0;
  let a = (Number.isFinite(acc) && acc > 0 ? acc : 0) + dt * hz;
  let steps = Math.floor(a + EPS);
  a -= steps;
  if (a < 0) a = 0; // only when snapped up by EPS
  if (steps > maxSteps) steps = maxSteps;
  return { steps, acc: a };
}
