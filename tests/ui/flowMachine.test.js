import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowMachine, STATES, TRANSITIONS } from '../../src/ui/flowMachine.js';

const LEGAL = [
  ['title', 'team'], ['title', 'garage'], ['title', 'hof'],
  ['team', 'track'], ['team', 'title'],
  ['track', 'settings'], ['track', 'team'],
  ['settings', 'garage'], ['settings', 'track'],
  ['garage', 'loading'], ['garage', 'settings'], ['garage', 'title'],
  ['loading', 'race'],
  ['race', 'paused'], ['race', 'results'],
  ['paused', 'race'], ['paused', 'loading'], ['paused', 'title'],
  ['results', 'hof'], ['results', 'settings'], ['results', 'title'],
  ['hof', 'title'], ['hof', 'results'],
];

test('every state is in the table', () => {
  for (const s of STATES) assert.ok(TRANSITIONS[s], s);
});

test('all legal transitions work, all others are rejected', () => {
  for (const from of STATES) {
    for (const to of STATES) {
      const m = createFlowMachine({ initial: from });
      const legal = LEGAL.some(([a, b]) => a === from && b === to);
      assert.equal(m.canTransition(to), legal, `${from}->${to} canTransition`);
      assert.equal(m.transition(to), legal, `${from}->${to} transition`);
      assert.equal(m.state, legal ? to : from);
    }
  }
});

test('specific illegal ones from spec', () => {
  const t = createFlowMachine({ initial: 'title' });
  assert.equal(t.transition('loading'), false);
  const p = createFlowMachine({ initial: 'paused' });
  assert.equal(p.transition('results'), false);
});

test('force bypasses the table and rejects unknown states', () => {
  const m = createFlowMachine();
  assert.equal(m.force('loading', { a: 1 }), true);
  assert.equal(m.state, 'loading');
  assert.deepEqual(m.params, { a: 1 });
  assert.throws(() => m.force('nope'));
  assert.throws(() => createFlowMachine({ initial: 'nope' }));
});

test('onChange fires with from/to/params and can unsubscribe; listener errors are isolated', () => {
  const m = createFlowMachine();
  const seen = [];
  const un = m.onChange((f, t, p) => seen.push([f, t, p]));
  m.onChange(() => { throw new Error('boom'); });
  const origErr = console.error; console.error = () => {};
  m.transition('team', { x: 1 });
  console.error = origErr;
  assert.deepEqual(seen, [['title', 'team', { x: 1 }]]);
  un();
  m.transition('track');
  assert.equal(seen.length, 1);
});

test('back() restores previous state with previous params (results <-> hof)', () => {
  const m = createFlowMachine({ initial: 'race' });
  m.transition('results', { result: 'R', credits: 5 });
  m.transition('hof', { tab: 'x' });
  assert.equal(m.state, 'hof');
  assert.equal(m.back(), true);
  assert.equal(m.state, 'results');
  assert.deepEqual(m.params, { result: 'R', credits: 5 });
});

test('back() from garage returns to where it was entered', () => {
  const a = createFlowMachine();
  a.transition('garage');
  a.back();
  assert.equal(a.state, 'title');
  const b = createFlowMachine({ initial: 'settings' });
  b.transition('garage');
  b.back();
  assert.equal(b.state, 'settings');
});

test('back() with no history returns false; title clears history', () => {
  const m = createFlowMachine();
  assert.equal(m.back(), false);
  m.transition('team'); m.transition('title');
  assert.equal(m.back(), false);
});

test('onChange fires on back()', () => {
  const m = createFlowMachine();
  m.transition('hof');
  const seen = [];
  m.onChange((f, t) => seen.push([f, t]));
  m.back();
  assert.deepEqual(seen, [['hof', 'title']]);
});

test('history is capped', () => {
  const m = createFlowMachine({ initial: 'race' });
  for (let i = 0; i < 200; i++) { m.transition('paused'); m.transition('race'); }
  assert.ok(m.history.length <= 64);
});
