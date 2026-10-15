// Wall and car-car collision response (spec §4.3). Soft; damage is applied by RaceSim from the returned impact / closing speeds.
import { clamp, wrapAngle } from '../core/mathUtil.js';

const WALL_SKIN = 0.02;          // m
const PIN_SPEED = 6;             // m/s: below this a wall contact also swings the body off the wall
const PIN_YAW_RATE = 1.1;        // rad/s
const PIN_NEAR = 1.5;            // m: the swing also acts while a corner is this close to the barrier
const CORNER_X = [1, 1, -1, -1];   // nose, nose, tail, tail
const CORNER_Y = [1, -1, 1, -1];

/**
 * Tests the 4 body corners against |d| > wallOffset using the car's current projection
 * (car.d, car.trackHeading). Pushes the car back, applies restitution/friction.
 * Returns impact speed (m/s, normal component) or 0.
 */
export function resolveWall(car, trackModel, stats, dt = 1 / 120) {
  const wo = trackModel.wallOffset;
  if (Math.abs(car.d) < wo - 4.2) return 0;
  const dpsi = wrapAngle(car.heading - car.trackHeading);
  const sd = Math.sin(dpsi), cd = Math.cos(dpsi);
  let worst = 0, worstSign = 0, worstAll = -1e9;
  for (let i = 0; i < 4; i++) {
    const cx = i < 2 ? stats.noseX : stats.tailX;
    const dc = car.d + cx * sd + CORNER_Y[i] * stats.halfWidth * cd;
    const pen = Math.abs(dc) - wo;
    if (pen > worstAll) worstAll = pen;
    if (pen > worst) { worst = pen; worstSign = dc > 0 ? 1 : -1; }
  }
  // Anti-pin: at crawling speed the dynamics cannot yaw the car (kinematic model), so a car driven nose-first into the
  // barrier would stay wedged. While the driver is on the throttle next to the wall, swing the body about its CG towards
  // the nearest track-parallel direction (forward or backward), which turns it away from whichever corner touches.
  if (worstAll > -PIN_NEAR && Math.abs(car.u) < PIN_SPEED && car.inThrottle > 0.05) {
    const target = Math.abs(dpsi) <= Math.PI / 2 ? 0 : Math.PI;
    const rate = PIN_YAW_RATE * dt;
    car.heading = wrapAngle(car.heading + clamp(wrapAngle(target - dpsi), -rate, rate));
    car.yawRate *= 0.5;
  }
  if (worst <= 0) return 0;
  // track right normal at car's s
  const th = car.trackHeading;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const inX = -worstSign * nx, inY = -worstSign * ny;   // inward (towards track) normal
  const push = worst + WALL_SKIN;                       // push slightly past the wall so the next step starts clear
  car.x += inX * push; car.y += inY * push;
  car.d -= worstSign * push;
  const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
  let vx = car.u * ch - car.v * sh, vy = car.u * sh + car.v * ch;
  const vn = vx * inX + vy * inY;                       // negative = into the wall
  let impact = 0;
  if (vn < 0) {
    impact = -vn;
    const tx = vx - vn * inX, ty = vy - vn * inY;       // tangential part
    const hard = impact > 1.0;
    // scraping along a barrier sheds more speed the harder the hit; the rebound is livelier than before
    const tf = hard ? Math.max(0.72, 0.90 - 0.0065 * impact) : 0.985;
    vx = tx * tf + inX * (-vn) * (0.15 + Math.min(0.2, 0.012 * impact));
    vy = ty * tf + inY * (-vn) * (0.15 + Math.min(0.2, 0.012 * impact));
    car.u = vx * ch + vy * sh;
    car.v = -vx * sh + vy * ch;
    if (hard) {
      // yaw nudge away from the wall: align with track direction
      const nudge = clamp(-dpsi * 1.5, -0.8, 0.8) * Math.min(1, impact / 8);
      // a big hit also kicks the tail round (spin), more so with a glancing angle
      const spin = worstSign * Math.min(1.6, Math.max(0, impact - 6) * 0.07) * (0.5 + Math.min(1, Math.abs(sd) * 3));
      car.yawRate = clamp(car.yawRate * 0.6 + nudge + spin, -3.5, 3.5);
      car.hitSide = worstSign;
    }
  }
  return impact;
}

const FRONT_C = 2.3, REAR_C = -1.5, RADIUS = 1.0;
const CIRCLES = [FRONT_C, REAR_C];

function applyImpulse(car, px, py, jx, jy, mass, inertia) {
  // px,py: contact point relative to CG (world axes). Changes body velocity + yaw.
  const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
  const dvx = jx / mass, dvy = jy / mass;
  car.u += dvx * ch + dvy * sh;
  car.v += -dvx * sh + dvy * ch;
  const torque = px * jy - py * jx;
  car.yawRate = clamp(car.yawRate + clamp(torque / inertia, -1.1, 1.1), -3.5, 3.5);
}

/** Returns the largest closing speed over all circle pairs (0 if no contact). */
export function resolveCarCar(A, B, statsA, statsB) {
  const cA = Math.cos(A.heading), sA = Math.sin(A.heading);
  const cB = Math.cos(B.heading), sB = Math.sin(B.heading);
  const mA = statsA.mass, mB = statsB.mass;
  const iA = 1 / mA, iB = 1 / mB, isum = iA + iB;
  let maxClose = 0;
  for (let ia = 0; ia < 2; ia++) {
    for (let ib = 0; ib < 2; ib++) {
      const rax = CIRCLES[ia] * cA, ray = CIRCLES[ia] * sA;
      const rbx = CIRCLES[ib] * cB, rby = CIRCLES[ib] * sB;
      const dx = (B.x + rbx) - (A.x + rax), dy = (B.y + rby) - (A.y + ray);
      const d2 = dx * dx + dy * dy;
      const rr = 2 * RADIUS;
      if (d2 >= rr * rr) continue;
      let dist = Math.sqrt(d2);
      let nx, ny;
      if (dist < 1e-6) { nx = 1; ny = 0; dist = 0; } else { nx = dx / dist; ny = dy / dist; }
      const pen = rr - dist;
      // positional correction: 60% of penetration, split by inverse mass
      const corr = 0.6 * pen / isum;
      A.x -= nx * corr * iA; A.y -= ny * corr * iA;
      B.x += nx * corr * iB; B.y += ny * corr * iB;
      // velocities at the circle centres
      const vAx = A.u * cA - A.v * sA - A.yawRate * ray, vAy = A.u * sA + A.v * cA + A.yawRate * rax;
      const vBx = B.u * cB - B.v * sB - B.yawRate * rby, vBy = B.u * sB + B.v * cB + B.yawRate * rbx;
      const rvx = vBx - vAx, rvy = vBy - vAy;
      const vn = rvx * nx + rvy * ny;
      if (vn >= 0) continue;
      const close = -vn;
      if (close > maxClose) maxClose = close;
      const jn = -(1 + 0.22) * vn / isum;                    // bouncier than before: a clear shove, not a soft merge
      // tangential friction 2%
      const tx = rvx - vn * nx, ty = rvy - vn * ny;
      const jx = jn * nx + 0.06 * (-tx) / isum * 1, jy = jn * ny + 0.06 * (-ty) / isum * 1;   // 6% scrape friction
      A.hitSide = (rax * ny - ray * nx) > 0 ? -1 : 1; B.hitSide = (rbx * ny - rby * nx) > 0 ? 1 : -1;
      applyImpulse(A, rax, ray, -jx, -jy, mA, statsA.yawInertia);
      applyImpulse(B, rbx, rby, jx, jy, mB, statsB.yawInertia);
    }
  }
  return maxClose;
}
