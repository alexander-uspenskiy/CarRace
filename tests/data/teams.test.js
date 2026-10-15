import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS, ALL_DRIVERS, getTeam, getDriver, teamIndex, carIdFor, makeDriverCode } from '../../src/data/teams.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;

test('10 teams, 20 drivers, expected order', () => {
  assert.equal(TEAMS.length, 10);
  assert.equal(ALL_DRIVERS.length, 20);
  assert.deepEqual(TEAMS.map((t) => t.id), ['mclaren', 'ferrari', 'redbull', 'mercedes', 'williams', 'astonmartin', 'racingbulls', 'haas', 'alpine', 'sauber']);
  assert.deepEqual(TEAMS.map((t) => t.car), ['MCL39', 'SF-25', 'RB21', 'W16', 'FW47', 'AMR25', 'VCARB 02', 'VF-25', 'A525', 'C45']);
});

test('unique driver ids / codes / numbers; code == uppercase id; 2 drivers per team', () => {
  assert.equal(new Set(ALL_DRIVERS.map((d) => d.id)).size, 20);
  assert.equal(new Set(ALL_DRIVERS.map((d) => d.code)).size, 20);
  assert.equal(new Set(ALL_DRIVERS.map((d) => d.number)).size, 20);
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, 10);
  for (const t of TEAMS) {
    assert.equal(t.drivers.length, 2);
    for (const d of t.drivers) {
      assert.equal(d.code, d.id.toUpperCase());
      assert.equal(d.code.length, 3);
      assert.ok(d.name.length > 3 && d.nationality.length === 3);
    }
  }
});

test('2025 drivers and numbers', () => {
  const byCode = Object.fromEntries(ALL_DRIVERS.map((d) => [d.code, d.number]));
  assert.deepEqual(byCode, {
    NOR: 4, PIA: 81, LEC: 16, HAM: 44, VER: 1, TSU: 22, RUS: 63, ANT: 12, ALB: 23, SAI: 55,
    ALO: 14, STR: 18, HAD: 6, LAW: 30, OCO: 31, BEA: 87, GAS: 10, COL: 43, HUL: 27, BOR: 5,
  });
});

test('strengths descend and fit 0.65..1.0; skills 0.85..0.99', () => {
  assert.deepEqual(TEAMS.map((t) => t.strength), [1.0, 0.93, 0.92, 0.9, 0.78, 0.74, 0.72, 0.7, 0.66, 0.65]);
  for (const t of TEAMS) assert.ok(t.strength >= 0.65 && t.strength <= 1.0);
  for (const d of ALL_DRIVERS) assert.ok(d.skill >= 0.85 && d.skill <= 0.99);
  assert.equal(getDriver('ver').driver.skill, 0.99);
});

test('liveries: valid hex colours and patterns, spec primaries', () => {
  const prim = ['#FF8000', '#E8002D', '#1E41FF', '#27F4D2', '#1868DB', '#229971', '#6692FF', '#E6E8EA', '#0093CC', '#52E252'];
  TEAMS.forEach((t, i) => {
    assert.equal(t.livery.primary.toUpperCase(), prim[i]);
    for (const k of ['primary', 'secondary', 'accent', 'wing', 'rim']) assert.match(t.livery[k], HEX, `${t.id}.${k}`);
    assert.ok(['solid', 'split', 'stripe', 'chevron'].includes(t.livery.pattern));
    for (const d of t.drivers) {
      assert.match(d.helmet.base, HEX);
      assert.match(d.helmet.accent, HEX);
    }
  });
  assert.equal(getTeam('mclaren').livery.pattern, 'solid');
  assert.equal(getTeam('redbull').livery.pattern, 'split');
  assert.equal(getTeam('sauber').livery.pattern, 'chevron');
});

test('lookups and carId convention', () => {
  assert.equal(getTeam('ferrari').shortName, 'Ferrari');
  assert.equal(getTeam('zzz'), undefined);
  const { driver, team } = getDriver('ham');
  assert.equal(driver.name, 'Lewis Hamilton');
  assert.equal(team.id, 'ferrari');
  assert.equal(getDriver('nobody'), undefined);
  assert.equal(teamIndex('mclaren'), 0);
  assert.equal(teamIndex('sauber'), 9);
  assert.equal(teamIndex('zzz'), -1);
  assert.equal(carIdFor('mclaren', 0), 0);
  assert.equal(carIdFor('ferrari', 1), 3);
  assert.equal(carIdFor('sauber', 1), 19);
  const ids = new Set(TEAMS.flatMap((t) => [0, 1].map((s) => carIdFor(t.id, s))));
  assert.equal(ids.size, 20);
});

test('makeDriverCode', () => {
  assert.equal(makeDriverCode('Max Verstappen'), 'VER');
  assert.equal(makeDriverCode('alex'), 'ALE');
  assert.equal(makeDriverCode('Li'), 'LIX');
  assert.equal(makeDriverCode('X'), 'XXX');
  assert.equal(makeDriverCode('  Anna   Müller  '), 'MUL');
  assert.equal(makeDriverCode("O'Brien"), 'OBR');
  assert.equal(makeDriverCode('Smith-Jones'), 'SMI');
  assert.equal(makeDriverCode(''), 'PLR');
  assert.equal(makeDriverCode('   '), 'PLR');
  assert.equal(makeDriverCode('1234'), 'PLR');
  assert.equal(makeDriverCode(null), 'PLR');
  assert.equal(makeDriverCode('PLAYER'), 'PLA');
});
