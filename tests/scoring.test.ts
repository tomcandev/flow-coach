import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mark, itemSkills } from '../src/scoring.ts';
import { DICTATION_ITEMS, WRITING_ITEMS } from '../src/content.ts';

test('perfect answer scores full marks', () => {
  const r = mark('The library extends its opening hours.', 'the library extends its opening hours');
  assert.equal(r.score, 6);
  assert.equal(r.total, 6);
});

test('ending, spelling, small and missed words are classified', () => {
  const r = mark(
    'Researchers observed a significant decline in local bird populations.',
    'Researcher observe significent decline local bird populations',
  );
  assert.equal(r.total, 9);
  assert.equal(r.score, 4);
  assert.equal(r.lost.ending, 2); // Researchers, observed
  assert.equal(r.lost.spelling, 1); // significant
  assert.equal(r.lost.small, 2); // a, in
  assert.equal(r.lost.missed, 0);
});

test('extra words cost nothing and British/American spellings both count', () => {
  const r = mark('The professor emphasised the importance.', 'The professor really emphasized the importance');
  assert.equal(r.score, 5);
  assert.ok(r.tokens.some((t) => t.status === 'extra' && t.typed === 'really'));
});

test('missed content word', () => {
  const r = mark('Careful planning prevented the project from going over budget.', 'Careful planning the project from going over budget');
  assert.equal(r.lost.missed, 1);
});

test('content bank is large enough and every item trains something', () => {
  assert.ok(DICTATION_ITEMS.length >= 40);
  assert.ok(WRITING_ITEMS.length >= 10);
  assert.equal(new Set(DICTATION_ITEMS.map((i) => i.text)).size, DICTATION_ITEMS.length);
  for (const i of DICTATION_ITEMS) assert.ok(itemSkills(i.text).length > 0, i.text);
});

test('inflection endings are classified as endings, function words as small words', () => {
  const r = mark(
    'The library extends its opening hours during the final examination period.',
    'The library extend it opening hour during final examnation period',
  );
  assert.equal(r.score, 6);
  assert.equal(r.lost.ending, 2); // extends, hours
  assert.equal(r.lost.small, 2); // its, the
  assert.equal(r.lost.spelling, 1); // examination
});
