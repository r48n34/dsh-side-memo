// Notes: normalizeNote field handling and createNotesStore persistence/limits.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFakeIndexedDB, loadClient, memoryLocalStorage } from '../support/load-client.mjs';

const { hook } = await loadClient();
const { normalizeNote, createNotesStore, noteImageIds, constants } = hook;
const STORAGE_KEY = constants.STORAGE_KEY;

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a predicate so async IndexedDB stubs cannot make the suite timing-flaky. */
async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('timed out after ' + timeoutMs + 'ms waiting for condition');
}

function useStorage(seed) {
  const storage = memoryLocalStorage(seed);
  globalThis.localStorage = storage;
  return storage;
}

function readPersisted(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function withoutLocalStorage() {
  const saved = globalThis.localStorage;
  delete globalThis.localStorage;
  return () => {
    globalThis.localStorage = saved;
  };
}

// ---------------------------------------------------------------------------
// normalizeNote
// ---------------------------------------------------------------------------

test('normalizeNote rejects values without a usable id', () => {
  assert.equal(normalizeNote(undefined), undefined);
  assert.equal(normalizeNote(null), undefined);
  assert.equal(normalizeNote('note'), undefined);
  assert.equal(normalizeNote(7), undefined);
  assert.equal(normalizeNote({}), undefined);
  assert.equal(normalizeNote({ title: 'no id' }), undefined);
  assert.equal(normalizeNote({ id: '' }), undefined);
  assert.equal(normalizeNote([]), undefined);
  assert.equal(normalizeNote({ id: 42 }), undefined);
  assert.equal(normalizeNote({ id: null }), undefined);
});

test('normalizeNote clips id and title to the documented caps', () => {
  const note = normalizeNote({ id: 'i'.repeat(120), title: 't'.repeat(200) });
  assert.equal(note.id.length, 80);
  assert.equal(note.title.length, constants.MAX_TITLE);
  assert.equal(normalizeNote({ id: 'n', title: 42 }).title, '');
  assert.equal(normalizeNote({ id: 'n', title: null }).title, '');
  assert.deepEqual(Object.keys(note).sort(), [
    'body',
    'content',
    'createdAt',
    'favorite',
    'id',
    'labels',
    'title',
    'updatedAt'
  ]);
});

test('normalizeNote normalizes body/content, favorite and labels', () => {
  const textOnly = normalizeNote({ id: 'a', body: 'x\r\ny' });
  assert.equal(textOnly.body, 'x\ny');
  assert.deepEqual(textOnly.content, [
    { type: 'text', text: 'x' },
    { type: 'text', text: 'y' }
  ]);

  const contentWins = normalizeNote({ id: 'b', body: 'ignored', content: [{ type: 'text', text: 'content' }] });
  assert.equal(contentWins.body, 'content');

  const fallback = normalizeNote({ id: 'c', body: 'fallback', content: [] });
  assert.equal(fallback.body, 'fallback');

  assert.equal(normalizeNote({ id: 'd', favorite: true }).favorite, true);
  assert.equal(normalizeNote({ id: 'd', favorite: 'true' }).favorite, false);
  assert.equal(normalizeNote({ id: 'd', favorite: 1 }).favorite, false);

  assert.deepEqual(normalizeNote({ id: 'e', labels: ['#Work', 'work', ' Home '] }).labels, ['Work', 'Home']);
  assert.deepEqual(normalizeNote({ id: 'e' }).labels, []);

  const longBody = normalizeNote({ id: 'f', body: 'x'.repeat(constants.MAX_BODY + 100) });
  assert.equal(longBody.body.length, constants.MAX_BODY);
});

test('normalizeNote defaults and preserves timestamps', () => {
  const before = Date.now();
  const defaults = normalizeNote({ id: 't1' });
  const after = Date.now();
  assert.ok(defaults.createdAt >= before && defaults.createdAt <= after);
  assert.equal(defaults.updatedAt, defaults.createdAt);
  assert.equal(defaults.title, '');
  assert.equal(defaults.body, '');
  assert.deepEqual(defaults.content, [{ type: 'text', text: '' }]);

  const explicit = normalizeNote({ id: 't2', createdAt: 111, updatedAt: 222 });
  assert.equal(explicit.createdAt, 111);
  assert.equal(explicit.updatedAt, 222);

  const onlyCreated = normalizeNote({ id: 't3', createdAt: 500 });
  assert.equal(onlyCreated.createdAt, 500);
  assert.equal(onlyCreated.updatedAt, 500);

  const zero = normalizeNote({ id: 't4', createdAt: 0 });
  assert.equal(zero.createdAt, 0);

  const invalid = normalizeNote({ id: 't5', createdAt: NaN, updatedAt: Infinity });
  assert.ok(Number.isFinite(invalid.createdAt));
  assert.ok(Number.isFinite(invalid.updatedAt));
  assert.equal(invalid.updatedAt, invalid.createdAt);
});

// ---------------------------------------------------------------------------
// createNotesStore: persistence
// ---------------------------------------------------------------------------

test('a fresh store starts empty, then reports imagesReady', async () => {
  useStorage();
  globalThis.indexedDB = createFakeIndexedDB();
  const store = createNotesStore();
  const initial = store.getSnapshot();
  assert.deepEqual(initial.notes, []);
  assert.deepEqual(initial.images, {});
  assert.equal(initial.imagesReady, false);
  assert.equal(initial.saveFailed, false);

  await waitFor(() => store.getSnapshot().imagesReady);
  const ready = store.getSnapshot();
  assert.equal(ready.imagesReady, true);
  assert.equal(ready.imagesAvailable, true);
  assert.equal(ready.saveFailed, false);
});

test('create() makes a blank note, prepends it, and persists after flush', () => {
  const storage = useStorage();
  const store = createNotesStore();
  const first = store.create();
  const second = store.create();

  assert.equal(typeof first.id, 'string');
  assert.ok(first.id.length > 0);
  assert.equal(first.title, '');
  assert.equal(first.body, '');
  assert.deepEqual(first.content, [{ type: 'text', text: '' }]);
  assert.equal(first.favorite, false);
  assert.deepEqual(first.labels, []);
  assert.equal(first.createdAt, first.updatedAt);
  assert.equal(store.getSnapshot().notes.length, 2);
  assert.equal(store.getSnapshot().notes[0].id, second.id);

  assert.equal(storage.getItem(STORAGE_KEY), null);
  store.flush();
  const persisted = readPersisted(storage);
  assert.equal(persisted.version, 3);
  assert.equal(persisted.notes.length, 2);
  assert.equal(persisted.notes[0].id, second.id);
});

test('persisted notes survive a store round-trip', () => {
  const storage = useStorage();
  const store = createNotesStore();
  const note = store.create();
  store.update(note.id, {
    title: 'Plan',
    body: 'one\r\ntwo',
    labels: ['#Work', 'work', ' Home '],
    favorite: true
  });
  store.flush();

  const persisted = readPersisted(storage);
  assert.equal(persisted.notes[0].title, 'Plan');
  assert.equal(persisted.notes[0].body, 'one\ntwo');
  assert.deepEqual(persisted.notes[0].labels, ['Work', 'Home']);
  assert.equal(persisted.notes[0].favorite, true);

  const reloaded = createNotesStore();
  const notes = reloaded.getSnapshot().notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'Plan');
  assert.equal(notes[0].body, 'one\ntwo');
  assert.deepEqual(notes[0].labels, ['Work', 'Home']);
  assert.equal(notes[0].favorite, true);
  reloaded.flush();
});

test('loading storage skips malformed entries and caps at MAX_NOTES', () => {
  const seeded = [];
  for (let index = 0; index < constants.MAX_NOTES + 5; index += 1) {
    seeded.push({ id: 'seed-' + index, title: 't' + index, body: 'b' + index });
  }
  seeded.push(null, { title: 'missing id' }, { id: '' });
  useStorage({ [STORAGE_KEY]: JSON.stringify({ version: 3, notes: seeded }) });

  const store = createNotesStore();
  const notes = store.getSnapshot().notes;
  assert.equal(notes.length, constants.MAX_NOTES);
  assert.equal(notes[0].id, 'seed-0');
  assert.ok(notes.every((note) => note.id.startsWith('seed-')));
  assert.equal(store.getSnapshot().saveFailed, false);
  store.flush();
});

test('corrupt storage starts empty, marks saveFailed, and recovers on write', () => {
  useStorage({ [STORAGE_KEY]: '{not json' });
  const store = createNotesStore();
  assert.deepEqual(store.getSnapshot().notes, []);
  assert.equal(store.getSnapshot().saveFailed, true);
  assert.ok(store.create());
  store.flush();
  assert.equal(store.getSnapshot().saveFailed, false);
});

test('a missing localStorage is tolerated', () => {
  const restore = withoutLocalStorage();
  try {
    const store = createNotesStore();
    assert.deepEqual(store.getSnapshot().notes, []);
    assert.equal(store.getSnapshot().saveFailed, true);
    assert.ok(store.create());
    store.flush();
    assert.equal(store.getSnapshot().saveFailed, true);
  } finally {
    restore();
  }
});

test('write failures set saveFailed and a later write clears it', () => {
  const storage = useStorage();
  const realSetItem = storage.setItem;
  storage.setItem = () => {
    throw new Error('quota exceeded');
  };
  const store = createNotesStore();
  const note = store.create();
  store.flush();
  assert.equal(store.getSnapshot().saveFailed, true);

  storage.setItem = realSetItem;
  store.update(note.id, { title: 'ok' });
  store.flush();
  assert.equal(store.getSnapshot().saveFailed, false);
  assert.equal(readPersisted(storage).notes[0].title, 'ok');
});

// ---------------------------------------------------------------------------
// createNotesStore: mutations
// ---------------------------------------------------------------------------

test('update() edits fields in place and keeps createdAt', () => {
  const storage = useStorage();
  const store = createNotesStore();
  const note = store.create();
  const created = note.createdAt;

  assert.equal(store.update('missing', { title: 'x' }), undefined);
  const titled = store.update(note.id, { title: 'T' });
  assert.equal(titled.title, 'T');
  assert.equal(titled.createdAt, created);
  assert.ok(titled.updatedAt >= created);
  assert.equal(store.getSnapshot().notes[0].title, 'T');
  assert.equal(store.update(note.id, { title: 'x'.repeat(200) }).title.length, constants.MAX_TITLE);

  assert.equal(store.update(note.id, { body: 'a\r\nb' }).body, 'a\nb');
  assert.equal(store.update(note.id, {
    content: [
      { type: 'text', text: 'c' },
      { type: 'text', text: 'd' }
    ]
  }).body, 'c\nd');

  assert.equal(store.update(note.id, { favorite: 'yes' }).favorite, false);
  assert.equal(store.update(note.id, { favorite: true }).favorite, true);
  assert.deepEqual(store.update(note.id, { labels: ['x', 'y'] }).labels, ['x', 'y']);
  store.flush();
});

test('setFavorite() flips the flag and remove() deletes the note', () => {
  useStorage();
  const store = createNotesStore();
  const first = store.create();
  const second = store.create();

  assert.equal(store.setFavorite(first.id, true).favorite, true);
  assert.equal(store.getSnapshot().notes.find((note) => note.id === first.id).favorite, true);
  assert.equal(store.setFavorite(first.id, false).favorite, false);
  assert.equal(store.setFavorite('missing', true), undefined);

  assert.equal(store.remove(first.id), true);
  assert.equal(store.remove(first.id), false);
  assert.equal(store.getSnapshot().notes.length, 1);
  assert.equal(store.getSnapshot().notes[0].id, second.id);
  store.flush();
});

test('importMany() normalizes entries, skips blanks and reports counts', () => {
  useStorage();
  const store = createNotesStore();
  const result = store.importMany([
    {
      title: 'First',
      body: 'one\r\ntwo',
      labels: ['#A', 'a'],
      favorite: true,
      createdAt: 1000,
      updatedAt: 2000
    },
    { title: '', body: '   ' },
    null,
    { title: 'Second' },
    { title: 't'.repeat(200), body: 'x' }
  ]);

  assert.deepEqual(result, { added: 3, skipped: 2, limit: 0 });
  const notes = store.getSnapshot().notes;
  assert.equal(notes.length, 3);
  assert.equal(notes[0].title, 'First');
  assert.equal(notes[0].body, 'one\ntwo');
  assert.deepEqual(notes[0].labels, ['A']);
  assert.equal(notes[0].favorite, true);
  assert.equal(notes[0].createdAt, 1000);
  assert.equal(notes[0].updatedAt, 2000);
  assert.equal(notes[1].title, 'Second');
  assert.equal(notes[1].body, '');
  assert.ok(Number.isFinite(notes[1].createdAt));
  assert.equal(notes[2].title.length, constants.MAX_TITLE);
  store.flush();
});

test('a store at capacity refuses create() and reports the import limit', () => {
  const seeded = [];
  for (let index = 0; index < constants.MAX_NOTES; index += 1) {
    seeded.push({ id: 'full-' + index, title: 't' + index, body: 'b' + index });
  }
  useStorage({ [STORAGE_KEY]: JSON.stringify({ version: 3, notes: seeded }) });
  const store = createNotesStore();
  assert.equal(store.getSnapshot().notes.length, constants.MAX_NOTES);
  assert.equal(store.create(), undefined);
  assert.deepEqual(store.importMany([{ title: 'x', body: 'y' }]), { added: 0, skipped: 0, limit: 1 });
  store.flush();
});

// ---------------------------------------------------------------------------
// createNotesStore: subscriptions and introspection
// ---------------------------------------------------------------------------

test('subscribers fire on mutations and stop after unsubscribe', () => {
  useStorage();
  const store = createNotesStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  const note = store.create();
  assert.equal(calls, 1);
  store.update(note.id, { title: 'x' });
  assert.equal(calls, 2);
  store.setFavorite(note.id, true);
  assert.equal(calls, 3);
  store.remove(note.id);
  assert.equal(calls, 4);

  unsubscribe();
  store.create();
  assert.equal(calls, 4);
  store.flush();
});

test('limits mirror the module constants', () => {
  useStorage();
  const store = createNotesStore();
  assert.deepEqual(store.limits, {
    maxNotes: constants.MAX_NOTES,
    maxTitle: constants.MAX_TITLE,
    maxBody: constants.MAX_BODY,
    maxImages: constants.MAX_IMAGES
  });
  store.flush();
});

// ---------------------------------------------------------------------------
// createNotesStore: images (fake IndexedDB only; canvas/FileReader untested)
// ---------------------------------------------------------------------------

test('image records load from IndexedDB, filter missing references and drop orphans', async () => {
  const fakeIndexedDb = createFakeIndexedDB();
  globalThis.indexedDB = fakeIndexedDb;
  fakeIndexedDb._records.set('kept', {
    id: 'kept',
    src: 'data:image/png;base64,AAAA',
    width: 2,
    height: 3,
    size: 28,
    createdAt: 1000
  });
  fakeIndexedDb._records.set('orphan', {
    id: 'orphan',
    src: 'data:image/png;base64,BBBB',
    width: 1,
    height: 1,
    size: 28,
    createdAt: 1000
  });
  useStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 3,
      notes: [{ id: 'n1', content: [{ type: 'image', id: 'kept' }, { type: 'text', text: 'x' }] }]
    })
  });

  const store = createNotesStore();
  await waitFor(() => store.getSnapshot().imagesReady);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.imagesAvailable, true);
  assert.ok(snapshot.images.kept);
  assert.equal(snapshot.images.orphan, undefined);
  assert.deepEqual(noteImageIds(snapshot.notes[0]), ['kept']);
  store.flush();
});

test('addImage() stores a record, update() keeps it, remove() collects the orphan', async () => {
  const fakeIndexedDb = createFakeIndexedDB();
  globalThis.indexedDB = fakeIndexedDb;
  useStorage();
  const store = createNotesStore();
  await waitFor(() => store.getSnapshot().imagesReady);
  assert.equal(store.getSnapshot().imagesReady, true);

  const added = await store.addImage({
    id: 'img-1',
    src: 'data:image/png;base64,AAAA',
    width: 4,
    height: 6
  });
  assert.equal(added.ok, true);
  assert.equal(added.record.id, 'img-1');
  assert.equal(store.getSnapshot().images['img-1'].width, 4);
  assert.equal(store.getSnapshot().images['img-1'].size, 'data:image/png;base64,AAAA'.length);

  const note = store.create();
  const updated = store.update(note.id, {
    content: [{ type: 'image', id: 'img-1' }, { type: 'text', text: 'caption' }]
  });
  assert.deepEqual(updated.content[0], { type: 'image', id: 'img-1' });
  assert.equal(updated.body, 'caption');

  assert.equal(store.remove(note.id), true);
  await waitFor(() => Object.keys(store.getSnapshot().images).length === 0);
  assert.deepEqual(store.getSnapshot().images, {});
  assert.equal(fakeIndexedDb._records.has('img-1'), false);
  store.flush();
});

test('update() drops dangling image references once the image cache is ready', async () => {
  globalThis.indexedDB = createFakeIndexedDB();
  useStorage();
  const store = createNotesStore();
  await waitFor(() => store.getSnapshot().imagesReady);
  const note = store.create();
  const updated = store.update(note.id, { content: [{ type: 'image', id: 'missing' }] });
  assert.deepEqual(updated.content, [{ type: 'text', text: '' }]);
  assert.equal(updated.body, '');
  store.flush();
});

test('image records stay referenced when the image store is unavailable', async () => {
  useStorage();
  const savedIndexedDb = globalThis.indexedDB;
  delete globalThis.indexedDB;
  const originalError = console.error;
  console.error = () => {};
  try {
    const store = createNotesStore();
    await waitFor(() => store.getSnapshot().imagesReady);
    assert.equal(store.getSnapshot().imagesReady, true);
    assert.equal(store.getSnapshot().imagesAvailable, false);

    const note = store.create();
    const updated = store.update(note.id, {
      content: [{ type: 'image', id: 'kept' }, { type: 'text', text: 'x' }]
    });
    assert.deepEqual(updated.content[0], { type: 'image', id: 'kept' });
    assert.equal(updated.body, 'x');

    assert.deepEqual(await store.addImage({ id: 'a' }), { ok: false, reason: 'unavailable' });
    store.flush();
  } finally {
    console.error = originalError;
    globalThis.indexedDB = savedIndexedDb;
  }
});

test('addImage() rejects malformed records', async () => {
  globalThis.indexedDB = createFakeIndexedDB();
  useStorage();
  const store = createNotesStore();
  await waitFor(() => store.getSnapshot().imagesReady);
  assert.deepEqual(await store.addImage(null), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await store.addImage({ id: 'no-src' }), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await store.addImage({ id: 'bad', src: 'https://example.com/x.png' }), {
    ok: false,
    reason: 'unsupported'
  });
  store.flush();
});
