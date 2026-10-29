// Labels: canonical text, de-duplication, caps and lookup semantics.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const {
  normalizeLabel,
  normalizeLabels,
  noteLabels,
  noteHasLabel,
  noteImageIds,
  imageCountLabel,
  constants
} = hook;

test('normalizeLabel trims, strips leading # and collapses whitespace', () => {
  assert.equal(normalizeLabel('  hello   world  '), 'hello world');
  assert.equal(normalizeLabel('#Work'), 'Work');
  assert.equal(normalizeLabel('＃全角'), '全角');
  assert.equal(normalizeLabel('\t tabbed \n'), 'tabbed');
});

test('normalizeLabel turns separators and control characters into spaces', () => {
  assert.equal(normalizeLabel('a,b'), 'a b');
  assert.equal(normalizeLabel('a，b；c'), 'a b c');
  assert.equal(normalizeLabel('a\u0000b'), 'a b');
  assert.equal(normalizeLabel(',,,,'), '');
  assert.equal(normalizeLabel('#'), '');
});

test('normalizeLabel caps length at MAX_LABEL_LEN and rejects non-strings', () => {
  assert.equal(normalizeLabel('x'.repeat(40)).length, constants.MAX_LABEL_LEN);
  assert.equal(normalizeLabel('x'.repeat(40)), 'x'.repeat(constants.MAX_LABEL_LEN));
  assert.equal(normalizeLabel(''), '');
  assert.equal(normalizeLabel(null), '');
  assert.equal(normalizeLabel(undefined), '');
  assert.equal(normalizeLabel(42), '');
  assert.equal(normalizeLabel({ label: 'x' }), '');
});

test('normalizeLabels keeps order, drops empties and de-duplicates case-insensitively', () => {
  assert.deepEqual(normalizeLabels(['Work', 'work', '  WORK ', '', 'Home']), ['Work', 'Home']);
  assert.deepEqual(normalizeLabels(['#Work', 'work']), ['Work']);
  assert.deepEqual(normalizeLabels(['a', 5, null, 'b']), ['a', 'b']);
  assert.deepEqual(normalizeLabels(undefined), []);
  assert.deepEqual(normalizeLabels('not-an-array'), []);
});

test('normalizeLabels caps the list at MAX_LABELS', () => {
  const many = Array.from({ length: constants.MAX_LABELS + 8 }, (_, index) => 'tag-' + index);
  const labels = normalizeLabels(many);
  assert.equal(labels.length, constants.MAX_LABELS);
  assert.equal(labels[0], 'tag-0');
  assert.equal(labels[constants.MAX_LABELS - 1], 'tag-' + (constants.MAX_LABELS - 1));
});

test('noteLabels only returns an array for note-shaped objects', () => {
  assert.deepEqual(noteLabels({ labels: ['a'] }), ['a']);
  assert.deepEqual(noteLabels({}), []);
  assert.deepEqual(noteLabels({ labels: 'nope' }), []);
  assert.deepEqual(noteLabels(null), []);
  assert.deepEqual(noteLabels(undefined), []);
});

test('noteHasLabel matches case-insensitively and tolerates missing labels', () => {
  assert.equal(noteHasLabel({ labels: ['Work', 'home'] }, 'work'), true);
  assert.equal(noteHasLabel({ labels: ['Work'] }, 'WORK'), true);
  assert.equal(noteHasLabel({ labels: ['Work'] }, 'home'), false);
  assert.equal(noteHasLabel({}, 'work'), false);
  assert.equal(noteHasLabel(null, 'work'), false);
});

test('noteImageIds keeps only image block ids in order', () => {
  const note = {
    content: [
      { type: 'text', text: 'a' },
      { type: 'image', id: 'i1' },
      { type: 'image', id: 'i2' },
      { type: 'text', text: 'b' }
    ]
  };
  assert.deepEqual(noteImageIds(note), ['i1', 'i2']);
  assert.deepEqual(noteImageIds({ content: [] }), []);
  assert.deepEqual(noteImageIds({ content: 'nope' }), []);
  assert.deepEqual(noteImageIds(null), []);
});

test('imageCountLabel picks singular/plural keys and passes count and max', () => {
  const calls = [];
  const t = (key, params) => {
    calls.push([key, params]);
    return key;
  };
  assert.equal(imageCountLabel(t, 1), 'image.count.one');
  assert.equal(imageCountLabel(t, 2), 'image.count.other');
  assert.deepEqual(calls[0], ['image.count.one', { count: 1, max: constants.MAX_IMAGES }]);
  assert.deepEqual(calls[1], ['image.count.other', { count: 2, max: constants.MAX_IMAGES }]);
});
