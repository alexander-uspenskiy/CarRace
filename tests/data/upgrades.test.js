import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADE_CATEGORIES, MAX_LEVEL, UPGRADE_COSTS, UPGRADES, getUpgradeCost, emptyLevels, describeUpgrade } from '../../src/data/upgrades.js';

test('categories, max level and escalating costs', () => {
  assert.deepEqual(UPGRADE_CATEGORIES, ['engine', 'aero', 'brakes', 'tyres', 'cooling']);
  assert.equal(MAX_LEVEL, 5);
  assert.deepEqual(UPGRADE_COSTS, [400, 700, 1100, 1700, 2600]);
  assert.equal(UPGRADE_COSTS.reduce((a, b) => a + b, 0), 6500);
  for (let i = 1; i < UPGRADE_COSTS.length; i++) assert.ok(UPGRADE_COSTS[i] > UPGRADE_COSTS[i - 1]);
});

test('getUpgradeCost: per level, null at max / invalid', () => {
  assert.equal(getUpgradeCost(0), 400);
  assert.equal(getUpgradeCost(4), 2600);
  assert.equal(getUpgradeCost(5), null);
  assert.equal(getUpgradeCost(-1), null);
  assert.equal(getUpgradeCost(1.5), null);
});

test('emptyLevels returns a fresh all-zero object', () => {
  const a = emptyLevels();
  assert.deepEqual(a, { engine: 0, aero: 0, brakes: 0, tyres: 0, cooling: 0 });
  a.engine = 3;
  assert.equal(emptyLevels().engine, 0);
});

test('UPGRADES defs follow the spec table', () => {
  for (const id of UPGRADE_CATEGORIES) {
    const u = UPGRADES[id];
    assert.equal(u.id, id);
    assert.ok(u.name && u.icon && u.blurb && u.effects.length >= 1);
  }
  const eff = (id) => Object.fromEntries(UPGRADES[id].effects.map((e) => [e.stat, e.perLevel]));
  assert.deepEqual(eff('engine'), { power: 0.05, boostPower: 0.09 });
  assert.deepEqual(eff('aero'), { clA: 0.038, cdA: 0.012 });
  assert.deepEqual(eff('brakes'), { brakeForceMax: 0.14 });
  assert.deepEqual(eff('tyres'), { tyreMu: 0.007, tyreWearMult: 0.9 });
  assert.deepEqual(eff('cooling'), { heatGain: -0.05, coolRate: 0.12, heatLimit: 0.04 });
});

test('describeUpgrade', () => {
  const e2 = describeUpgrade('engine', 2);
  assert.ok(e2.includes('Power +10%'));
  assert.ok(e2.some((l) => l === 'Top speed ≈ +3.2%'), e2.join('|'));
  assert.ok(describeUpgrade('aero', 5).includes('Downforce +19%'));
  assert.ok(describeUpgrade('aero', 5).includes('Drag +6%'));
  assert.deepEqual(describeUpgrade('brakes', 3), ['Braking force +42%']);
  assert.ok(describeUpgrade('tyres', 2).includes('Tyre wear -19%'));
  assert.ok(describeUpgrade('cooling', 1).includes('Engine heat -5%'));
  assert.ok(describeUpgrade('cooling', 1).includes('Cooling +12%'));
  assert.ok(describeUpgrade('cooling', 5).includes('Overheat threshold +20%'));
  assert.ok(describeUpgrade('engine', 0).includes('Power +0%'));
  assert.deepEqual(describeUpgrade('nope', 1), []);
  assert.equal(describeUpgrade('engine', 99).length, describeUpgrade('engine', 5).length); // clamped
});
