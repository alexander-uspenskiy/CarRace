import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName, truncateGraphemes, graphemes, coerceNum, MAX_NAME_LENGTH } from '../../src/core/text.js';

test('sanitizeName: trim, strip control chars, fallback', () => {
  assert.equal(sanitizeName('  Alex  '), 'Alex');
  assert.equal(sanitizeName('A\u0000l\u001fe\u007fx'), 'Alex');
  assert.equal(sanitizeName(''), 'PLAYER');
  assert.equal(sanitizeName('   '), 'PLAYER');
  assert.equal(sanitizeName(null), 'PLAYER');
  assert.equal(sanitizeName(42), 'PLAYER');
  assert.equal(sanitizeName('x'.repeat(40)), 'x'.repeat(MAX_NAME_LENGTH));
});

test('sanitizeName: truncation never splits surrogate pairs / emoji sequences', () => {
  const emoji = '\u{1F3CE}️';                        // racing car + variation selector (one grapheme, 3 UTF-16 units)
  const name = 'A'.repeat(15) + '\u{1F600}\u{1F600}\u{1F600}';
  const out = sanitizeName(name);
  assert.equal(Array.from(out).length, 16);
  assert.equal(out, 'A'.repeat(15) + '\u{1F600}');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), 'no lone surrogates');
  assert.equal(sanitizeName('\u{1F600}'.repeat(30)), '\u{1F600}'.repeat(16));
  assert.equal(JSON.parse(JSON.stringify(sanitizeName('\u{1F600}'.repeat(30)))), '\u{1F600}'.repeat(16));   // survives JSON round trip
  // a 16-grapheme name made of multi-unit graphemes is kept whole
  assert.equal(sanitizeName(emoji.repeat(16)), emoji.repeat(16));
  assert.equal(Array.from(sanitizeName(emoji.repeat(20))).length, 32);
  // family emoji (ZWJ sequence) is a single grapheme when Intl.Segmenter exists
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    assert.equal(graphemes(fam).length, 1);
    assert.equal(truncateGraphemes('ab' + fam + 'cd', 3), 'ab' + fam);
  }
});

test('sanitizeName: lone surrogates (from older truncated saves) are dropped', () => {
  assert.equal(sanitizeName('Al\uD83Dex'), 'Alex');
  assert.equal(sanitizeName('\uDE00Zed'), 'Zed');
  assert.equal(sanitizeName('\uD83D'), 'PLAYER');
});

test('coerceNum: numbers and numeric strings only', () => {
  assert.equal(coerceNum(12, 0), 12);
  assert.equal(coerceNum('4321', 0), 4321);
  assert.equal(coerceNum(' 12.5 ', 0), 12.5);
  assert.equal(coerceNum('1e3', 0), 1000);
  assert.equal(coerceNum('', 7), 7);
  assert.equal(coerceNum('  ', 7), 7);
  assert.equal(coerceNum('abc', 7), 7);
  assert.equal(coerceNum('12px', 7), 7);
  assert.equal(coerceNum(NaN, 7), 7);
  assert.equal(coerceNum(Infinity, 7), 7);
  assert.equal(coerceNum('Infinity', 7), 7);
  assert.equal(coerceNum(null, 7), 7);
  assert.equal(coerceNum(true, 7), 7);
  assert.equal(coerceNum([5], 7), 7);
  assert.equal(coerceNum({}, 7), 7);
});
