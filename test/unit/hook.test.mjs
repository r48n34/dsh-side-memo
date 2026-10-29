// The opt-in window.__dsmTest hook: surface, constants and the disabled gate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { clientPath, loadClient } from '../support/load-client.mjs';

const ORIGINAL_KEYS = [
  'buildEditorDom',
  'composerEditorFor',
  'createNotesStore',
  'dict',
  'fillMemoDragData',
  'fitContent',
  'insertImageIntoEditor',
  'insertMemoIntoComposer',
  'memoDragPayload',
  'memoDragText',
  'memoDragTypesInclude',
  'normalizeContent',
  'normalizeNote',
  'noteImageCount',
  'noteSnippetText',
  'noteTitleText',
  'planMemoDrop',
  'prepareImageFile',
  'readEditorContent',
  'readMemoDragPayload'
];

const HELPER_KEYS = [
  'ageLabel',
  'buildXlsxNotes',
  'collectTextRuns',
  'columnNumber',
  'contentText',
  'crc32',
  'decodeText',
  'encodeText',
  'imageCountLabel',
  'importFavorite',
  'importTimestamp',
  'normalizeImageRecord',
  'normalizedHeader',
  'normalizeLabel',
  'normalizeLabels',
  'noteHasLabel',
  'noteImageIds',
  'noteLabels',
  'parseLabelCell',
  'parseSharedStrings',
  'parseSheetRows',
  'sortNotes',
  'stripXmlPrefixes',
  'textBlocksForBody',
  'xlsxCell',
  'xmlDecode',
  'xmlEscape',
  'zipStore'
];

const CONSTANT_VALUES = {
  MAX_NOTES: 300,
  MAX_TITLE: 120,
  MAX_BODY: 8000,
  MAX_LABELS: 12,
  MAX_LABEL_LEN: 24,
  MAX_IMAGES: 20,
  MAX_IMAGE_DIMENSION: 1400,
  MAX_IMAGE_FILE_BYTES: 24 * 1024 * 1024,
  MAX_IMAGE_DATA_BYTES: 1200 * 1024,
  MAX_TOTAL_IMAGE_BYTES: 60 * 1024 * 1024,
  IMAGE_QUALITY: 0.82,
  SAVE_DELAY_MS: 250,
  XLSX_MAX_FILE_BYTES: 8 * 1024 * 1024,
  XLSX_MAX_TOTAL_BYTES: 32 * 1024 * 1024,
  XLSX_MAX_ENTRIES: 64,
  MEMO_DRAG_MIME: 'application/x-dsh-side-memo',
  MEMO_DRAG_VERSION: 1,
  STORAGE_KEY: 'dsh.side-memo.notes.v1',
  KIND: 'side-memo'
};

test('the module still exports the Cordis plugin pieces', async () => {
  const { moduleExports } = await loadClient();
  assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']);
  assert.equal(typeof moduleExports.apply, 'function');
});

test('the hook keeps every pre-existing key', async () => {
  const { hook } = await loadClient();
  for (const key of ORIGINAL_KEYS) {
    assert.ok(Object.hasOwn(hook, key), 'missing original hook key ' + key);
  }
  assert.equal(typeof hook.dict, 'object');
  for (const key of ORIGINAL_KEYS.filter((name) => name !== 'dict')) {
    assert.equal(typeof hook[key], 'function', 'hook.' + key + ' should be a function');
  }
});

test('the hook exposes the documented constants with exact values', async () => {
  const { hook } = await loadClient();
  assert.equal(typeof hook.constants, 'object');
  assert.deepEqual(Object.keys(hook.constants).sort(), Object.keys(CONSTANT_VALUES).sort());
  assert.deepEqual(hook.constants, CONSTANT_VALUES);
});

test('the hook exposes every documented pure helper', async () => {
  const { hook } = await loadClient();
  assert.equal(HELPER_KEYS.length, 28);
  for (const key of HELPER_KEYS) {
    assert.equal(typeof hook[key], 'function', 'hook.' + key + ' should be a function');
  }
});

test('the hook surface is exactly the original keys plus constants and helpers', async () => {
  const { hook } = await loadClient();
  const expected = [...ORIGINAL_KEYS, 'constants', ...HELPER_KEYS].sort();
  assert.deepEqual(Object.keys(hook).sort(), expected);
  assert.equal(Object.keys(hook).length, 49);
});

test('store limits mirror the exposed constants', async () => {
  const { hook } = await loadClient();
  const store = hook.createNotesStore();
  assert.deepEqual(store.limits, {
    maxNotes: 300,
    maxTitle: 120,
    maxBody: 8000,
    maxImages: 20
  });
  store.flush();
});

test('the hook is inert when the opt-in flag is not exactly true', async () => {
  const { hook, moduleExports, window } = await loadClient({ hooks: false });
  assert.equal(hook, undefined);
  assert.equal(window.__dsmTestHooks, false);
  assert.equal(window.__dsmTest, undefined);
  assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']);
  assert.equal(typeof moduleExports.apply, 'function');
});

test('a fresh instance with the gate re-enabled gets its own hook', async () => {
  const first = (await loadClient()).hook;
  const disabled = await loadClient({ hooks: false });
  const second = (await loadClient()).hook;

  assert.equal(disabled.hook, undefined);
  assert.notEqual(first, second);
  assert.equal(typeof second.normalizeLabel, 'function');
  assert.deepEqual(second.constants, CONSTANT_VALUES);
  assert.equal(second.normalizeLabel(' #Work, home '), 'Work home');
});

test('the gate and the assignment live in client.js exactly once', async () => {
  const source = await readFile(clientPath, 'utf8');
  const gate = 'window.__dsmTestHooks === true';
  assert.equal(source.split(gate).length - 1, 1);
  assert.equal(source.split('window.__dsmTest = {').length - 1, 1);
  assert.equal(source.split('window.__dsmTest = ').length - 1, 1);
});
