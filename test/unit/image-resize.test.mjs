// Image sizing: normalize/parse/format helpers and the resize arithmetic
// behind the editor's eight drag handles.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const {
  normalizeImageSize,
  normalizeImageBlockSize,
  imageBlockSize,
  formatImageSize,
  parseImageSize,
  resizeImageBox,
  constants
} = hook;

const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

test('image size constants are exposed with exact values', () => {
  assert.equal(constants.MIN_IMAGE_SIZE, 24);
  assert.equal(constants.MAX_IMAGE_SIZE, 1400);
  assert.equal(constants.IMAGE_RESIZE_STEP, 8);
});

test('normalizeImageSize rounds and clamps numbers into 24..1400', () => {
  assert.equal(normalizeImageSize(24), 24);
  assert.equal(normalizeImageSize(300), 300);
  assert.equal(normalizeImageSize(1400), 1400);
  assert.equal(normalizeImageSize(23), 24);
  assert.equal(normalizeImageSize(1), 24);
  assert.equal(normalizeImageSize(0.6), 24);
  assert.equal(normalizeImageSize(1401), 1400);
  assert.equal(normalizeImageSize(5000), 1400);
  assert.equal(normalizeImageSize(300.4), 300);
  assert.equal(normalizeImageSize(300.6), 301);
  assert.equal(normalizeImageSize(1399.6), 1400);
});

test('normalizeImageSize returns the 0 sentinel for unusable values', () => {
  for (const value of [0, 0.4, -5, -1400, NaN, Infinity, -Infinity, '300', '', 'abc', null, undefined, {}, [], true]) {
    assert.equal(normalizeImageSize(value), 0, 'expected 0 for ' + String(value));
  }
});

test('normalizeImageBlockSize normalizes width/height pairs', () => {
  assert.deepEqual(normalizeImageBlockSize({ width: 300, height: 200 }), { width: 300, height: 200 });
  assert.deepEqual(normalizeImageBlockSize({ width: 300.6, height: 200.4 }), { width: 301, height: 200 });
  assert.deepEqual(normalizeImageBlockSize({ width: 10, height: 5000 }), { width: 24, height: 1400 });
  assert.deepEqual(
    normalizeImageBlockSize({ type: 'image', id: 'i1', width: 300, height: 200 }),
    { width: 300, height: 200 }
  );
});

test('normalizeImageBlockSize returns null when either side is missing or invalid', () => {
  const raws = [
    null,
    undefined,
    {},
    [],
    { width: 300 },
    { height: 200 },
    { width: 0, height: 200 },
    { width: 300, height: 0 },
    { width: -5, height: 200 },
    { width: NaN, height: 200 },
    { width: '300', height: 200 },
    { width: 300, height: '200' }
  ];
  for (const raw of raws) {
    assert.equal(normalizeImageBlockSize(raw), null, 'expected null for ' + JSON.stringify(raw));
  }
});

test('imageBlockSize normalizes image content blocks', () => {
  assert.deepEqual(imageBlockSize({ type: 'image', id: 'i1', width: 300, height: 200 }), {
    width: 300,
    height: 200
  });
  assert.deepEqual(imageBlockSize({ type: 'image', id: 'i1', width: 5000, height: 10 }), {
    width: 1400,
    height: 24
  });
  assert.deepEqual(imageBlockSize({ type: 'image', id: 'i1', width: 300.6, height: 199.4 }), {
    width: 301,
    height: 199
  });
  assert.equal(imageBlockSize({ type: 'image', id: 'i1' }), null);
  assert.equal(imageBlockSize({ type: 'image', id: 'i1', width: 300 }), null);
  assert.equal(imageBlockSize({ type: 'image', id: 'i1', width: 300, height: -1 }), null);
  assert.equal(imageBlockSize({ type: 'text', text: 'hi' }), null);
  assert.equal(imageBlockSize(null), null);
  assert.equal(imageBlockSize(undefined), null);
});

test('formatImageSize renders the width x height pair', () => {
  assert.equal(formatImageSize({ width: 300, height: 200 }), '300x200');
  assert.equal(formatImageSize({ width: 24, height: 1400 }), '24x1400');
  assert.equal(formatImageSize({ width: 1, height: 2 }), '1x2');
});

test('parseImageSize parses and normalizes size text', () => {
  assert.deepEqual(parseImageSize('300x200'), { width: 300, height: 200 });
  assert.deepEqual(parseImageSize('24x1400'), { width: 24, height: 1400 });
  assert.deepEqual(parseImageSize('0010x0020'), { width: 24, height: 24 });
  assert.deepEqual(parseImageSize('1x1'), { width: 24, height: 24 });
  assert.deepEqual(parseImageSize('9999x9999'), { width: 1400, height: 1400 });
});

test('parseImageSize rejects malformed text and zero sides', () => {
  const texts = [
    '',
    '   ',
    '300X200',
    '300 x 200',
    ' 300x200',
    '300x200 ',
    '0x100',
    '0x0',
    '0x200',
    '300x0',
    '300x200x1',
    'x200',
    '300x',
    '300.5x200',
    '-300x200',
    '10000x100',
    '300x10000',
    null,
    undefined,
    300,
    {}
  ];
  for (const text of texts) {
    assert.equal(parseImageSize(text), null, 'expected null for ' + JSON.stringify(text));
  }
});

test('formatImageSize and parseImageSize round-trip', () => {
  for (const size of [
    { width: 300, height: 200 },
    { width: 24, height: 1400 },
    { width: 1000, height: 999 },
    { width: 25, height: 26 }
  ]) {
    assert.deepEqual(parseImageSize(formatImageSize(size)), size);
  }
});

test("resizeImageBox with 'e' and 'w' scales the x axis and both dimensions", () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 60, dy: 0 }), {
    width: 360,
    height: 240
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'w', dx: 60, dy: 0 }), {
    width: 240,
    height: 160
  });
});

test("resizeImageBox with 'n' and 's' scales the y axis and both dimensions", () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'n', dx: 0, dy: 40 }), {
    width: 240,
    height: 160
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 's', dx: 0, dy: 40 }), {
    width: 360,
    height: 240
  });
});

test('resizeImageBox edges ignore the perpendicular delta', () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 60, dy: 999 }), {
    width: 360,
    height: 240
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 's', dx: 999, dy: 40 }), {
    width: 360,
    height: 240
  });
});

test('resizeImageBox corners scale both axes', () => {
  // Each case drags one axis much further than the other, so the expected
  // factor is unambiguous: the corner still scales width and height together.
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'nw', dx: 10, dy: 100 }), {
    width: 150,
    height: 100
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'ne', dx: 60, dy: 0 }), {
    width: 360,
    height: 240
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'sw', dx: 0, dy: 60 }), {
    width: 390,
    height: 260
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 30, dy: 40 }), {
    width: 360,
    height: 240
  });
});

test('resizeImageBox locked corners take the dominant axis factor', () => {
  // dy dominates: factorY = 1.5 wins over factorX = 1.2.
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 60, dy: 100 }), {
    width: 450,
    height: 300
  });
  // dx dominates: factorX = 1.3 wins over factorY = 1.05.
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 90, dy: 10 }), {
    width: 390,
    height: 260
  });
});

test('resizeImageBox corners prefer the x factor when both factors are equally far from 1', () => {
  // Dragging the north-east corner by (+30, -20) gives factorX = 1.1 and
  // factorY = 0.9, whose distances from 1 match. The x factor wins, so the
  // box grows (330x220) rather than shrinking (270x180).
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'ne', dx: 30, dy: 20 }), {
    width: 330,
    height: 220
  });
});

test('resizeImageBox fromCenter doubles the delta on affected axes', () => {
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 30, fromCenter: true }),
    { width: 360, height: 240 }
  );
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 's', dy: 30, fromCenter: true }),
    { width: 390, height: 260 }
  );
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 30, dy: 20, fromCenter: true }),
    { width: 360, height: 240 }
  );
});

test('resizeImageBox free mode changes the affected axis only', () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 60, free: true }), {
    width: 360,
    height: 200
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 's', dy: 40, free: true }), {
    width: 300,
    height: 240
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 60, dy: 40, free: true }), {
    width: 360,
    height: 240
  });
});

test('resizeImageBox free mode honours fromCenter', () => {
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 30, fromCenter: true, free: true }),
    { width: 360, height: 200 }
  );
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 's', dy: 20, fromCenter: true, free: true }),
    { width: 300, height: 240 }
  );
});

test('resizeImageBox locked mode clamps to maxWidth and maxHeight', () => {
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 300, maxWidth: 400 }),
    { width: 400, height: 267 }
  );
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 's', dy: 200, maxHeight: 300 }),
    { width: 450, height: 300 }
  );
  assert.deepEqual(
    resizeImageBox({
      width: 300,
      height: 200,
      handle: 'se',
      dx: 300,
      dy: 300,
      maxWidth: 400,
      maxHeight: 250
    }),
    { width: 375, height: 250 }
  );
});

test('resizeImageBox free mode clamps to maxWidth and maxHeight', () => {
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 300, free: true, maxWidth: 400 }),
    { width: 400, height: 200 }
  );
  assert.deepEqual(
    resizeImageBox({ width: 300, height: 200, handle: 's', dy: 300, free: true, maxHeight: 250 }),
    { width: 300, height: 250 }
  );
});

test('resizeImageBox clamps shrinking to the minimum size', () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: -1000 }), {
    width: 36,
    height: 24
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: -1000, free: true }), {
    width: 24,
    height: 200
  });
});

test('resizeImageBox never grows past MAX_IMAGE_SIZE', () => {
  assert.deepEqual(resizeImageBox({ width: 1400, height: 1400, handle: 'e', dx: 100000 }), {
    width: 1400,
    height: 1400
  });
  assert.deepEqual(resizeImageBox({ width: 1400, height: 1400, handle: 's', dy: 100000, free: true }), {
    width: 1400,
    height: 1400
  });
});

test('resizeImageBox keeps a zero delta unchanged', () => {
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'e', dx: 0 }), {
    width: 300,
    height: 200
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 's', dy: 0, free: true }), {
    width: 300,
    height: 200
  });
  assert.deepEqual(resizeImageBox({ width: 300, height: 200, handle: 'nw', dx: 0, dy: 0 }), {
    width: 300,
    height: 200
  });
});

test('resizeImageBox rounds the resulting dimensions', () => {
  // factorX = 111/101, so the untouched axis rounds from 109.9 to 110.
  assert.deepEqual(resizeImageBox({ width: 101, height: 100, handle: 'e', dx: 10 }), {
    width: 111,
    height: 110
  });
  assert.ok(Number.isInteger(resizeImageBox({ width: 300, height: 200, handle: 'se', dx: 7, dy: 3 }).height));
});

test('resizeImageBox always returns integers inside the allowed range', () => {
  const boxes = [
    { width: 300, height: 200 },
    { width: 1400, height: 24 },
    { width: 24, height: 1400 },
    { width: 37, height: 53 }
  ];
  const deltas = [-5000, -300, -1, 0, 1, 7, 300, 5000];
  for (const box of boxes) {
    for (const handle of ALL_HANDLES) {
      for (const delta of deltas) {
        for (const free of [false, true]) {
          const result = resizeImageBox({
            width: box.width,
            height: box.height,
            handle,
            dx: delta,
            dy: delta,
            free
          });
          const label = JSON.stringify({ box, handle, delta, free });
          assert.ok(Number.isInteger(result.width), 'width must be an integer for ' + label);
          assert.ok(Number.isInteger(result.height), 'height must be an integer for ' + label);
          assert.ok(result.width >= constants.MIN_IMAGE_SIZE, 'width below min for ' + label);
          assert.ok(result.height >= constants.MIN_IMAGE_SIZE, 'height below min for ' + label);
          assert.ok(result.width <= constants.MAX_IMAGE_SIZE, 'width above max for ' + label);
          assert.ok(result.height <= constants.MAX_IMAGE_SIZE, 'height above max for ' + label);
        }
      }
    }
  }
});
