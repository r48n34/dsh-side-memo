// Locale dictionaries: structure, parity between languages and placeholder integrity.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const { zh, en } = hook.dict;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;
const CJK = /[\u3400-\u9fff\u3040-\u30ff]/;

function placeholders(value) {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

test('dict exposes the zh and en locale objects', () => {
  assert.equal(typeof zh, 'object');
  assert.equal(typeof en, 'object');
  assert.ok(zh !== null && en !== null);
  assert.ok(Object.keys(zh).length >= 70, 'expected at least 70 dictionary keys');
});

test('both locales declare exactly the same keys', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys);
  assert.equal(new Set(zhKeys).size, zhKeys.length);
});

test('every locale value is a non-empty string that is not just the key', () => {
  for (const locale of [['zh', zh], ['en', en]]) {
    const [name, dict] = locale;
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', name + '.' + key + ' must be a string');
      assert.ok(value.trim().length > 0, name + '.' + key + ' must not be empty');
      assert.notEqual(value, key, name + '.' + key + ' must be translated text');
    }
  }
});

test('placeholder sets match between zh and en for every key', () => {
  for (const key of Object.keys(zh)) {
    assert.deepEqual(
      placeholders(en[key]),
      placeholders(zh[key]),
      'placeholder mismatch for ' + key
    );
  }
});

test('placeholders are simple identifiers and braces are balanced', () => {
  for (const [key, value] of Object.entries(zh)) {
    for (const placeholder of placeholders(value)) {
      assert.match(placeholder, /^[A-Za-z][A-Za-z0-9_]*$/, 'bad placeholder in ' + key);
    }
    assert.equal((value.match(/\{/g) || []).length, (value.match(/\}/g) || []).length, 'unbalanced braces in ' + key);
    if ((value.match(/\}/g) || []).length > 0) {
      assert.equal(
        (value.match(/\{\w+\}/g) || []).length,
        (value.match(/\}/g) || []).length,
        'unknown brace form in ' + key
      );
    }
  }
});

test('placeholder multiplicity matches for repeated placeholders', () => {
  const byKey = {};
  for (const key of Object.keys(zh)) {
    const list = placeholders(zh[key]);
    if (list.length !== new Set(list).size) byKey[key] = list;
  }
  for (const [key, list] of Object.entries(byKey)) {
    assert.deepEqual(placeholders(en[key]), list);
  }
});

test('known UI keys are present in both locales', () => {
  const expected = [
    'type.label',
    'guide.title',
    'guide.description',
    'toggle.label',
    'toggle.aria',
    'drawer.close',
    'time.now',
    'time.minutes',
    'time.hours',
    'time.days',
    'search.empty',
    'labels.limit',
    'labels.remove',
    'editor.chars',
    'editor.limit',
    'count.other',
    'limit.reached',
    'image.limit',
    'image.tooLarge',
    'xlsx.imported',
    'xlsx.exported'
  ];
  for (const key of expected) {
    assert.ok(Object.hasOwn(zh, key), 'zh missing ' + key);
    assert.ok(Object.hasOwn(en, key), 'en missing ' + key);
  }
});

test('zh values are Chinese text and en values contain no CJK characters', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.match(value, CJK, 'zh.' + key + ' should contain Chinese text');
  }
  for (const [key, value] of Object.entries(en)) {
    assert.doesNotMatch(value, CJK, 'en.' + key + ' should not contain CJK text');
  }
});

test('the two locales are actually translated (no identical values)', () => {
  for (const key of Object.keys(zh)) {
    assert.notEqual(zh[key], en[key], 'zh and en are identical for ' + key);
  }
});

test('dictionary covers the documented namespaces', () => {
  const namespaces = new Set(Object.keys(zh).map((key) => key.split('.')[0]));
  for (const ns of ['time', 'labels', 'image', 'xlsx', 'search', 'editor', 'count', 'limit']) {
    assert.ok(namespaces.has(ns), 'missing namespace ' + ns);
  }
});

test('compact plural strings only use their own placeholder family', () => {
  assert.deepEqual(placeholders(en['time.minutes']), ['count']);
  assert.deepEqual(placeholders(en['time.hours']), ['count']);
  assert.deepEqual(placeholders(en['time.days']), ['count']);
  assert.deepEqual(placeholders(en['count.other']), ['count']);
  assert.deepEqual(placeholders(en['editor.chars']), ['count']);
  assert.deepEqual(placeholders(en['image.count.other']), ['count']);
  assert.deepEqual(placeholders(en['labels.limit']), ['max']);
  assert.deepEqual(placeholders(en['image.limit']), ['max']);
  assert.deepEqual(placeholders(en['search.empty']), ['query']);
  assert.deepEqual(placeholders(en['count.filtered']), ['total', 'visible']);
  assert.deepEqual(placeholders(en['xlsx.importedSkipped']), ['added', 'skipped']);
});
