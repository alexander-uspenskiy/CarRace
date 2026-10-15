import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('src never writes HTML strings (names from users/localStorage must go through textContent)', () => {
  for (const f of walk(new URL('../../src', import.meta.url).pathname)) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(t), `${f} uses an HTML sink`);
  }
});
