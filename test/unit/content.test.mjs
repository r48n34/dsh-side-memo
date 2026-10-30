// Content blocks: text<->body conversion, truncation to MAX_BODY, image blocks.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const { textBlocksForBody, contentText, fitContent, normalizeContent, normalizeNote, constants } = hook;

test('textBlocksForBody splits on newlines and normalizes CRLF/CR', () => {
  assert.deepEqual(textBlocksForBody('a\nb\nc'), [
    { type: 'text', text: 'a' },
    { type: 'text', text: 'b' },
    { type: 'text', text: 'c' }
  ]);
  assert.deepEqual(textBlocksForBody('a\r\nb\rc'), [
    { type: 'text', text: 'a' },
    { type: 'text', text: 'b' },
    { type: 'text', text: 'c' }
  ]);
  assert.deepEqual(textBlocksForBody(''), [{ type: 'text', text: '' }]);
  assert.deepEqual(textBlocksForBody(undefined), [{ type: 'text', text: '' }]);
});

test('contentText joins text blocks with newlines and ignores images', () => {
  assert.equal(contentText([
    { type: 'text', text: 'a' },
    { type: 'image', id: 'i1' },
    { type: 'text', text: 'b' }
  ]), 'a\nb');
  assert.equal(contentText([{ type: 'image', id: 'i1' }]), '');
  assert.equal(contentText([]), '');
});

test('fitContent returns a single empty text block for empty content', () => {
  assert.deepEqual(fitContent([], 10), { content: [{ type: 'text', text: '' }], body: '' });
});

test('fitContent truncates plain text at the limit', () => {
  const shaped = fitContent([{ type: 'text', text: 'abcde' }, { type: 'text', text: 'f' }], 4);
  assert.deepEqual(shaped.content, [{ type: 'text', text: 'abcd' }]);
  assert.equal(shaped.body, 'abcd');
});

test('fitContent keeps exact-limit text and the newline separator between blocks', () => {
  const shaped = fitContent([{ type: 'text', text: 'abc' }, { type: 'text', text: 'def' }], 7);
  assert.deepEqual(shaped.content, [
    { type: 'text', text: 'abc' },
    { type: 'text', text: 'def' }
  ]);
  assert.equal(shaped.body, 'abc\ndef');
});

test('fitContent never leaves a dangling image past the limit', () => {
  const shaped = fitContent([
    { type: 'text', text: 'abcde' },
    { type: 'image', id: 'i1' }
  ], 5);
  assert.deepEqual(shaped.content, [{ type: 'text', text: 'abcde' }]);
  assert.equal(shaped.body, 'abcde');
});

test('fitContent keeps leading images when there is room', () => {
  const shaped = fitContent([
    { type: 'image', id: 'i1' },
    { type: 'text', text: 'hi' }
  ], 10);
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'i1' },
    { type: 'text', text: 'hi' }
  ]);
  assert.equal(shaped.body, 'hi');
});

test('normalizeContent rebuilds blocks from body when content is unusable', () => {
  const shaped = normalizeContent(null, 'x\r\ny');
  assert.deepEqual(shaped.content, [
    { type: 'text', text: 'x' },
    { type: 'text', text: 'y' }
  ]);
  assert.equal(shaped.body, 'x\ny');
});

test('normalizeContent filters malformed blocks and normalizes text', () => {
  const shaped = normalizeContent([
    null,
    'nope',
    { type: 'text', text: 5 },
    { type: 'text', text: 'a\r\nb' },
    { type: 'image', id: '' },
    { type: 'image', id: 'i'.repeat(120) },
    { type: 'unknown' }
  ], '');
  assert.deepEqual(shaped.content, [
    { type: 'text', text: 'a\nb' },
    { type: 'image', id: 'i'.repeat(80) }
  ]);
  assert.equal(shaped.body, 'a\nb');
});

test('normalizeContent caps serialized bodies at MAX_BODY', () => {
  const long = 'x'.repeat(constants.MAX_BODY + 500);
  const shaped = normalizeContent(undefined, long);
  assert.equal(shaped.body.length, constants.MAX_BODY);
  assert.equal(shaped.content[0].text.length, constants.MAX_BODY);
});

test('normalizeContent keeps a body exactly at MAX_BODY intact', () => {
  const exact = 'y'.repeat(constants.MAX_BODY);
  const shaped = normalizeContent(undefined, exact);
  assert.equal(shaped.body.length, constants.MAX_BODY);
  assert.equal(shaped.body, exact);
});

test('normalizeNote derives body from content and keeps image ids out of body', () => {
  const note = normalizeNote({
    id: 'n1',
    content: [
      { type: 'text', text: 'hello\r\nworld' },
      { type: 'image', id: 'img-1' },
      { type: 'text', text: 'bye' }
    ]
  });
  assert.equal(note.body, 'hello\nworld\nbye');
  assert.deepEqual(note.content, [
    { type: 'text', text: 'hello\nworld' },
    { type: 'image', id: 'img-1' },
    { type: 'text', text: 'bye' }
  ]);
});

test('normalizeNote falls back to body text blocks when content is absent', () => {
  const note = normalizeNote({ id: 'n2', body: 'line1\r\nline2' });
  assert.equal(note.body, 'line1\nline2');
  assert.deepEqual(note.content, [
    { type: 'text', text: 'line1' },
    { type: 'text', text: 'line2' }
  ]);
});

test('normalizeContent keeps a complete image size pair', () => {
  const shaped = normalizeContent([
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'hi' }
  ], '');
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'hi' }
  ]);
  assert.equal(shaped.body, 'hi');
});

test('normalizeContent normalizes and rounds kept image sizes', () => {
  const shaped = normalizeContent([
    { type: 'image', id: 'i1', width: 5000, height: 10 },
    { type: 'image', id: 'i2', width: 300.6, height: 200.4 }
  ], '');
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'i1', width: 1400, height: 24 },
    { type: 'image', id: 'i2', width: 301, height: 200 }
  ]);
  assert.equal(shaped.body, '');
});

test('normalizeContent drops partial and invalid image sizes', () => {
  const shaped = normalizeContent([
    { type: 'image', id: 'a', width: 300 },
    { type: 'image', id: 'b', height: 200 },
    { type: 'image', id: 'c', width: 0, height: 200 },
    { type: 'image', id: 'd', width: 300, height: 0 },
    { type: 'image', id: 'e', width: -5, height: 200 },
    { type: 'image', id: 'f', width: '300', height: 200 },
    { type: 'image', id: 'g', width: NaN, height: 200 }
  ], '');
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'a' },
    { type: 'image', id: 'b' },
    { type: 'image', id: 'c' },
    { type: 'image', id: 'd' },
    { type: 'image', id: 'e' },
    { type: 'image', id: 'f' },
    { type: 'image', id: 'g' }
  ]);
});

test('normalizeContent keeps only the id and size on image blocks', () => {
  const shaped = normalizeContent([
    { type: 'image', id: 'i'.repeat(120), width: 300, height: 200, src: 'blob:x', alt: 'a' }
  ], '');
  assert.deepEqual(shaped.content, [{ type: 'image', id: 'i'.repeat(80), width: 300, height: 200 }]);
});

test('fitContent preserves image sizes on kept image blocks', () => {
  const shaped = fitContent([
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'hi' }
  ], 10);
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'hi' }
  ]);
  assert.equal(shaped.body, 'hi');
});

test('fitContent keeps image sizes when it truncates the following text', () => {
  const shaped = fitContent([
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'abcdef' }
  ], 2);
  assert.deepEqual(shaped.content, [
    { type: 'image', id: 'i1', width: 300, height: 200 },
    { type: 'text', text: 'ab' }
  ]);
  assert.equal(shaped.body, 'ab');
});

test('normalizeNote keeps image sizes through content normalization', () => {
  const note = normalizeNote({
    id: 'n3',
    content: [
      { type: 'image', id: 'img-1', width: 640, height: 480 },
      { type: 'text', text: 'caption' }
    ]
  });
  assert.deepEqual(note.content, [
    { type: 'image', id: 'img-1', width: 640, height: 480 },
    { type: 'text', text: 'caption' }
  ]);
  assert.equal(note.body, 'caption');
});
