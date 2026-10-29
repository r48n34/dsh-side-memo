// Memo drag-and-drop plumbing: payload shape, DataTransfer helpers and drop planning.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const { MEMO_DRAG_MIME, MEMO_DRAG_VERSION } = hook.constants;
const {
  memoDragText,
  memoDragPayload,
  fillMemoDragData,
  readMemoDragPayload,
  memoDragTypesInclude,
  composerEditorFor,
  planMemoDrop,
  insertMemoIntoComposer
} = hook;

class FakeDataTransfer {
  constructor(types = []) {
    this._data = new Map();
    this.types = types;
    this.effectAllowed = 'none';
  }

  setData(type, value) {
    if (!this.types.includes(type)) this.types.push(type);
    this._data.set(type, value);
  }

  getData(type) {
    return this._data.has(type) ? this._data.get(type) : '';
  }
}

function editableElement({ editable = true, attribute = 'true' } = {}) {
  return {
    isContentEditable: editable,
    getAttribute(name) {
      return name === 'contenteditable' ? attribute : null;
    }
  };
}

function targetWith({ input = null, seat = null } = {}) {
  return {
    closest(selector) {
      if (selector === '[data-composer-input]') return input;
      if (selector === '[data-composer-seat]') return seat;
      return null;
    }
  };
}

test('memoDragText prefers the body and falls back to the title', () => {
  assert.equal(memoDragText(null), '');
  assert.equal(memoDragText(undefined), '');
  assert.equal(memoDragText({}), '');
  assert.equal(memoDragText({ body: 'body text', title: 'title' }), 'body text');
  assert.equal(memoDragText({ body: '   ', title: 'title' }), 'title');
  assert.equal(memoDragText({ body: '', title: ' title ' }), ' title ');
  assert.equal(memoDragText({ body: 42, title: 'title' }), 'title');
  assert.equal(memoDragText({ body: '\r\nline', title: 'title' }), '\r\nline');
  assert.equal(memoDragText({ body: '  ', title: '  ' }), '');
});

test('memoDragPayload returns null for empty notes and the browser payload otherwise', () => {
  assert.equal(memoDragPayload({ body: '', title: '' }), null);
  assert.equal(memoDragPayload(null), null);

  const payload = memoDragPayload({ id: 'note-1', title: 'Title', body: 'Body' });
  assert.equal(payload.mime, MEMO_DRAG_MIME);
  assert.equal(payload.text, 'Body');
  assert.deepEqual(JSON.parse(payload.json), {
    v: MEMO_DRAG_VERSION,
    id: 'note-1',
    title: 'Title',
    text: 'Body'
  });

  const untitled = memoDragPayload({ id: 7, title: 8, body: 'Body' });
  assert.equal(JSON.parse(untitled.json).id, '');
  assert.equal(JSON.parse(untitled.json).title, '');
});

test('fillMemoDragData writes both payload types and the copy effect', () => {
  const dataTransfer = new FakeDataTransfer();
  const payload = fillMemoDragData(dataTransfer, { id: 'n1', title: 'T', body: 'B' });

  assert.equal(payload.text, 'B');
  assert.equal(dataTransfer.getData(MEMO_DRAG_MIME), payload.json);
  assert.equal(dataTransfer.getData('text/plain'), 'B');
  assert.equal(dataTransfer.effectAllowed, 'copy');
  assert.deepEqual(dataTransfer.types, [MEMO_DRAG_MIME, 'text/plain']);
});

test('fillMemoDragData tolerates a missing or restricted DataTransfer', () => {
  const payload = fillMemoDragData(null, { body: 'text' });
  assert.equal(payload.text, 'text');
  assert.equal(fillMemoDragData({}, { body: 'text' }).text, 'text');

  const restricted = {
    setData() {
      throw new Error('restricted');
    }
  };
  assert.equal(fillMemoDragData(restricted, { body: 'text' }).text, 'text');
  assert.equal(fillMemoDragData({}, { body: '' }), null);
});

test('readMemoDragPayload round-trips a filled payload', () => {
  const dataTransfer = new FakeDataTransfer();
  fillMemoDragData(dataTransfer, { id: 'n1', title: 'T', body: 'line 1' });
  assert.deepEqual(readMemoDragPayload(dataTransfer), {
    id: 'n1',
    title: 'T',
    text: 'line 1'
  });
});

test('readMemoDragPayload rejects malformed data without throwing', () => {
  assert.equal(readMemoDragPayload(null), null);
  assert.equal(readMemoDragPayload({}), null);

  const raw = (value) => ({ getData: () => value });
  assert.equal(readMemoDragPayload(raw('')), null);
  assert.equal(readMemoDragPayload(raw(42)), null);
  assert.equal(readMemoDragPayload(raw('not json')), null);
  assert.equal(readMemoDragPayload(raw('null')), null);
  assert.equal(readMemoDragPayload(raw('[]')), null);
  assert.equal(readMemoDragPayload(raw('"text"')), null);
  assert.equal(readMemoDragPayload(raw(JSON.stringify({ v: 999, text: 'x' }))), null);
  assert.equal(readMemoDragPayload(raw(JSON.stringify({ v: MEMO_DRAG_VERSION, text: '' }))), null);
  assert.equal(readMemoDragPayload(raw(JSON.stringify({ v: MEMO_DRAG_VERSION, text: 7 }))), null);

  const throwing = {
    getData() {
      throw new Error('denied');
    }
  };
  assert.equal(readMemoDragPayload(throwing), null);
});

test('readMemoDragPayload normalizes non-string id and title', () => {
  const dataTransfer = new FakeDataTransfer();
  dataTransfer.setData(MEMO_DRAG_MIME, JSON.stringify({ v: MEMO_DRAG_VERSION, id: 1, title: {}, text: 'ok' }));
  assert.deepEqual(readMemoDragPayload(dataTransfer), { id: '', title: '', text: 'ok' });
});

test('memoDragTypesInclude checks includes, indexOf and array-like types', () => {
  assert.equal(memoDragTypesInclude(null), false);
  assert.equal(memoDragTypesInclude({}), false);
  assert.equal(memoDragTypesInclude({ types: null }), false);
  assert.equal(memoDragTypesInclude({ types: [MEMO_DRAG_MIME] }), true);
  assert.equal(memoDragTypesInclude({ types: ['text/plain'] }), false);

  const indexOfOnly = {
    types: {
      indexOf(value) {
        return value === MEMO_DRAG_MIME ? 0 : -1;
      }
    }
  };
  assert.equal(memoDragTypesInclude(indexOfOnly), true);

  assert.equal(memoDragTypesInclude({ types: { 0: 'text/plain', 1: MEMO_DRAG_MIME, length: 2 } }), true);
  assert.equal(memoDragTypesInclude({ types: { 0: 'text/plain', length: 1 } }), false);
});

test('composerEditorFor finds the editable composer root', () => {
  const editable = editableElement();
  assert.equal(composerEditorFor(targetWith({ input: editable })), editable);
  assert.equal(composerEditorFor(null), null);
  assert.equal(composerEditorFor({}), null);
  assert.equal(composerEditorFor(targetWith()), null);
});

test('composerEditorFor skips disabled roots and searches the composer seat', () => {
  const disabled = editableElement({ editable: false, attribute: 'false' });
  assert.equal(composerEditorFor(targetWith({ input: disabled })), null);

  const enabled = editableElement();
  const seat = { querySelectorAll: () => [disabled, enabled] };
  assert.equal(composerEditorFor(targetWith({ seat })), enabled);

  const emptySeat = { querySelectorAll: () => [] };
  assert.equal(composerEditorFor(targetWith({ seat: emptySeat })), null);
  assert.equal(composerEditorFor(targetWith({ seat: {} })), null);
});

test('planMemoDrop ignores events it cannot handle', () => {
  assert.deepEqual(planMemoDrop(null), { kind: 'ignore' });
  assert.deepEqual(planMemoDrop({}), { kind: 'ignore' });

  const dataTransfer = new FakeDataTransfer();
  fillMemoDragData(dataTransfer, { body: 'text' });
  assert.deepEqual(planMemoDrop({ dataTransfer, target: targetWith() }), { kind: 'ignore' });
  assert.deepEqual(planMemoDrop({ dataTransfer: new FakeDataTransfer(), target: targetWith({ input: editableElement() }) }), { kind: 'ignore' });
});

test('planMemoDrop inserts a valid payload into an editable composer', () => {
  const editor = editableElement();
  const dataTransfer = new FakeDataTransfer();
  fillMemoDragData(dataTransfer, { id: 'n1', title: 'T', body: 'Body' });

  const plan = planMemoDrop({ dataTransfer, target: targetWith({ input: editor }) });
  assert.equal(plan.kind, 'insert');
  assert.equal(plan.editor, editor);
  assert.deepEqual(plan.payload, { id: 'n1', title: 'T', text: 'Body' });
});

test('planMemoDrop ignores a MIME match whose payload is corrupt', () => {
  const dataTransfer = new FakeDataTransfer();
  dataTransfer.setData(MEMO_DRAG_MIME, '{not json');
  const plan = planMemoDrop({ dataTransfer, target: targetWith({ input: editableElement() }) });
  assert.deepEqual(plan, { kind: 'ignore' });
});

test('insertMemoIntoComposer forwards text and span to InputActions', () => {
  const calls = [];
  const actions = {
    captureInsertion() {
      calls.push('capture');
      return { from: 1, to: 2 };
    },
    insertText(text, span) {
      calls.push(['insert', text, span]);
      return true;
    }
  };
  assert.equal(insertMemoIntoComposer(actions, 'hello'), true);
  assert.deepEqual(calls, ['capture', ['insert', 'hello', { from: 1, to: 2 }]]);
});

test('insertMemoIntoComposer reports refusals and failures', () => {
  assert.equal(insertMemoIntoComposer(null, 'x'), false);
  assert.equal(insertMemoIntoComposer({}, 'x'), false);
  assert.equal(insertMemoIntoComposer({ insertText() {} }, 'x'), false);
  assert.equal(insertMemoIntoComposer({ captureInsertion() {} }, 'x'), false);

  const returnsFalse = {
    captureInsertion: () => ({}),
    insertText: () => false
  };
  assert.equal(insertMemoIntoComposer(returnsFalse, 'x'), false);

  const returnsUndefined = {
    captureInsertion: () => ({}),
    insertText: () => undefined
  };
  assert.equal(insertMemoIntoComposer(returnsUndefined, 'x'), true);

  const captureThrows = {
    captureInsertion() {
      throw new Error('busy');
    },
    insertText: () => true
  };
  assert.equal(insertMemoIntoComposer(captureThrows, 'x'), false);

  const insertThrows = {
    captureInsertion: () => ({}),
    insertText() {
      throw new Error('stale');
    }
  };
  assert.equal(insertMemoIntoComposer(insertThrows, 'x'), false);

  const noSpan = {
    captureInsertion: () => null,
    insertText: () => true
  };
  assert.equal(insertMemoIntoComposer(noSpan, 'x'), false);
});
