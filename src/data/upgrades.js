// Upgrade definitions and cost table. Effects are LINEAR in level: factor = 1 + perLevel*L ('mul'),
// except mode 'pow': factor = perLevel ** L (e.g. wear x0.9 per level).
// Balance pass: level-5 solo best-lap gains vs stock are engine ~1.8%, aero ~2%, brakes ~0.8%, tyres ~2.2% (+ wear x0.59),
// cooling ~0.5% (up to 8% torque derate when the engine is hot); all five ~8% (see docs/NOTES-B.md).
export const UPGRADE_CATEGORIES = ['engine', 'aero', 'brakes', 'tyres', 'cooling'];
export const MAX_LEVEL = 5;
export const UPGRADE_COSTS = [400, 700, 1100, 1700, 2600]; // cost to go level i -> i+1

export const UPGRADES = {
  engine: {
    id: 'engine', name: 'Engine', icon: '⚙', blurb: 'More power and top speed',
    effects: [
      { stat: 'power', perLevel: 0.05, mode: 'mul' },
      { stat: 'boostPower', perLevel: 0.09, mode: 'mul' },
    ],
  },
  aero: {
    id: 'aero', name: 'Aerodynamics', icon: '✈', blurb: 'More downforce for corners, a little more drag',
    effects: [
      { stat: 'clA', perLevel: 0.038, mode: 'mul' },
      { stat: 'cdA', perLevel: 0.012, mode: 'mul' },
    ],
  },
  brakes: {
    id: 'brakes', name: 'Brakes', icon: '◉', blurb: 'Stop later and harder',
    effects: [{ stat: 'brakeForceMax', perLevel: 0.14, mode: 'mul' }],
  },
  tyres: {
    id: 'tyres', name: 'Tyres', icon: '◎', blurb: 'More grip and slower wear',
    effects: [
      { stat: 'tyreMu', perLevel: 0.007, mode: 'mul' },
      { stat: 'tyreWearMult', perLevel: 0.9, mode: 'pow' },
    ],
  },
  cooling: {
    id: 'cooling', name: 'Reliability', icon: '❄', blurb: 'Runs cooler: no power derate when boosting or following in dirty air',
    effects: [
      { stat: 'heatGain', perLevel: -0.05, mode: 'mul' },
      { stat: 'coolRate', perLevel: 0.12, mode: 'mul' },
      { stat: 'heatLimit', perLevel: 0.04, mode: 'mul' },
    ],
  },
};

/** Cost to go from `level` to level+1; null at max (or invalid). */
export function getUpgradeCost(level) {
  if (!Number.isInteger(level) || level < 0 || level >= MAX_LEVEL) return null;
  return UPGRADE_COSTS[level];
}

export function emptyLevels() {
  return { engine: 0, aero: 0, brakes: 0, tyres: 0, cooling: 0 };
}

/** Multiplicative factor of one effect at (possibly fractional) level L. */
export function effectFactor(effect, level) {
  return effect.mode === 'pow' ? Math.pow(effect.perLevel, level) : 1 + effect.perLevel * level;
}

const pct = (f) => {
  const v = Math.round((f - 1) * 1000) / 10;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v)}%`;
};

/** UI lines describing the CUMULATIVE effect of a category at `level`. */
export function describeUpgrade(catId, level) {
  const def = UPGRADES[catId];
  if (!def) return [];
  const L = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  const f = (stat) => {
    const e = def.effects.find((x) => x.stat === stat);
    return effectFactor(e, L);
  };
  switch (catId) {
    case 'engine':
      return [`Power ${pct(f('power'))}`, `ERS boost ${pct(f('boostPower'))}`, `Top speed ≈ ${pct(Math.cbrt(f('power')))}`];
    case 'aero':
      return [`Downforce ${pct(f('clA'))}`, `Drag ${pct(f('cdA'))}`];
    case 'brakes':
      return [`Braking force ${pct(f('brakeForceMax'))}`];
    case 'tyres':
      return [`Grip ${pct(f('tyreMu'))}`, `Tyre wear ${pct(f('tyreWearMult'))}`];
    case 'cooling':
      return [`Engine heat ${pct(f('heatGain'))}`, `Cooling ${pct(f('coolRate'))}`, `Overheat threshold ${pct(f('heatLimit'))}`];
    default:
      return [];
  }
}
