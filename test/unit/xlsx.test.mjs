// XLSX export/import: escaping, CRC-32, store-only ZIP writer, sheet parsing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadClient } from '../support/load-client.mjs';

const { hook } = await loadClient();
const {
  encodeText,
  decodeText,
  crc32,
  xmlEscape,
  xmlDecode,
  xlsxCell,
  buildXlsxNotes,
  columnNumber,
  collectTextRuns,
  parseSharedStrings,
  parseSheetRows,
  importTimestamp,
  importFavorite,
  parseLabelCell,
  normalizedHeader,
  stripXmlPrefixes
} = hook;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_HEADER = 0x06054b50;

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === LOCAL_HEADER) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decodeText(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    files.set(name, { method, crc, compressedSize, uncompressedSize, data: data.slice() });
    offset = dataStart + compressedSize;
  }
  return { files, centralOffset: offset };
}

function readEndRecord(bytes, centralOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(centralOffset, true), CENTRAL_HEADER);
  const endOffset = bytes.byteLength - 22;
  assert.equal(view.getUint32(endOffset, true), END_HEADER);
  return {
    entries: view.getUint16(endOffset + 10, true),
    centralSize: view.getUint32(endOffset + 12, true),
    centralOffset: view.getUint32(endOffset + 16, true),
    commentLength: view.getUint16(endOffset + 20, true)
  };
}

test('crc32 matches the published check value', () => {
  assert.equal(crc32(encodeText('123456789')), 0xcbf43926);
  assert.equal(crc32(encodeText('')), 0);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(encodeText('a')), 0xe8b7be43);
  assert.equal(crc32(new Uint8Array([0xff])), 0xff000000);
  assert.ok(crc32(encodeText('123456789')) > 0);
});

test('encodeText/decodeText round-trip UTF-8', () => {
  const encoded = encodeText('héllo 世界');
  assert.ok(encoded instanceof Uint8Array);
  assert.equal(encoded.length, new TextEncoder().encode('héllo 世界').length);
  assert.equal(decodeText(encoded), 'héllo 世界');
  assert.equal(decodeText(encodeText('')), '');
});

test('xmlEscape normalizes newlines, drops control characters and escapes markup', () => {
  assert.equal(xmlEscape(undefined), '');
  assert.equal(xmlEscape(null), '');
  assert.equal(xmlEscape(0), '0');
  assert.equal(xmlEscape(false), 'false');
  assert.equal(xmlEscape('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(xmlEscape('a\tb\nc'), 'a\tb\nc');
  assert.equal(xmlEscape('a\u0000b\u0008c\u000bd\u001fe'), 'abcde');
  assert.equal(xmlEscape('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
});

test('xmlDecode handles named, decimal and hex entities plus invalid code points', () => {
  assert.equal(xmlDecode('&lt;p&gt;&amp;&quot;&apos;'), '<p>&"\'');
  assert.equal(xmlDecode('&#65;&#x4e16;&#x754c;'), 'A世界');
  assert.equal(xmlDecode('&#x110000;'), '');
  assert.equal(xmlDecode('&#1114112;'), '');
  assert.equal(xmlDecode('&nbsp;'), '&nbsp;');
  assert.equal(xmlDecode('&amp;lt;'), '&lt;');
  assert.equal(xmlDecode('plain'), 'plain');
});

test('xmlEscape and xmlDecode round-trip ordinary text', () => {
  for (const value of ['plain', 'a & b < c > d', 'say "hi" and \'bye\'', 'héllo 世界 ♥']) {
    assert.equal(xmlDecode(xmlEscape(value)), value);
  }
  assert.equal(xmlDecode(xmlEscape('a\r\nb')), 'a\nb');
});

test('xlsxCell renders an inline-string cell with escaped text', () => {
  assert.equal(
    xlsxCell('A', 2, 'a&b', 1),
    '<c r="A2" t="inlineStr" s="1"><is><t xml:space="preserve">a&amp;b</t></is></c>'
  );
  const cell = xlsxCell('AA', 10, 'say "hi"', 2);
  assert.ok(cell.startsWith('<c r="AA10" t="inlineStr" s="2">'));
  assert.ok(cell.includes('&quot;hi&quot;'));
});

test('columnNumber maps Excel column letters to 1-based numbers', () => {
  assert.equal(columnNumber('A'), 1);
  assert.equal(columnNumber('B'), 2);
  assert.equal(columnNumber('Z'), 26);
  assert.equal(columnNumber('AA'), 27);
  assert.equal(columnNumber('AB'), 28);
  assert.equal(columnNumber('ZZ'), 702);
  assert.equal(columnNumber('AAA'), 703);
});

test('zipStore writes local headers, a central directory and an end record', () => {
  const files = [
    { name: 'a.txt', data: encodeText('hello') },
    { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3, 4]) }
  ];
  const zip = zipStoreFiles(files);
  assert.ok(zip instanceof Uint8Array);

  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), LOCAL_HEADER);
  assert.equal(view.getUint16(4, true), 20);
  assert.equal(view.getUint16(6, true), 0);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), 0);
  assert.equal(view.getUint16(12, true), 0x21);

  const parsed = readZip(zip);
  assert.deepEqual([...parsed.files.keys()], ['a.txt', 'dir/b.bin']);
  const first = parsed.files.get('a.txt');
  assert.equal(first.method, 0);
  assert.equal(first.uncompressedSize, 5);
  assert.equal(first.compressedSize, 5);
  assert.equal(first.crc, crc32(encodeText('hello')));
  assert.equal(decodeText(first.data), 'hello');
  assert.deepEqual([...parsed.files.get('dir/b.bin').data], [1, 2, 3, 4]);

  const end = readEndRecord(zip, parsed.centralOffset);
  assert.equal(end.entries, 2);
  assert.equal(end.centralOffset, parsed.centralOffset);
  assert.equal(end.centralSize, zip.byteLength - parsed.centralOffset - 22);
  assert.equal(end.commentLength, 0);
  assert.equal(zip.byteLength, end.centralOffset + end.centralSize + 22);
});

function zipStoreFiles(files) {
  return hook.zipStore(files);
}

test('buildXlsxNotes writes the expected OOXML parts', () => {
  const zip = buildXlsxNotes([]);
  const parsed = readZip(zip);
  assert.deepEqual([...parsed.files.keys()], [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml'
  ]);
  const workbook = decodeText(parsed.files.get('xl/workbook.xml').data);
  assert.ok(workbook.includes('name="Notes"'));
  const sheet = decodeText(parsed.files.get('xl/worksheets/sheet1.xml').data);
  const rows = parseSheetRows(sheet, []);
  assert.deepEqual(rows, [['Title', 'Body', 'Favorite', 'Labels', 'Created', 'Updated', 'Images']]);
});

test('buildXlsxNotes output parses back through parseSheetRows', () => {
  const notes = [
    {
      id: '1',
      title: 'A&B <x>',
      body: 'line1\nline2',
      favorite: true,
      labels: ['Work', 'home'],
      createdAt: Date.UTC(2024, 0, 2, 3, 4, 5),
      updatedAt: Date.UTC(2024, 0, 3, 4, 5, 6),
      content: [{ type: 'image', id: 'i1' }, { type: 'text', text: 'line1\nline2' }]
    },
    {
      id: '2',
      title: '',
      body: '',
      favorite: false,
      labels: [],
      createdAt: Date.UTC(2024, 1, 1),
      updatedAt: Date.UTC(2024, 1, 2),
      content: [{ type: 'text', text: '' }]
    }
  ];

  const parsed = readZip(buildXlsxNotes(notes));
  const sheet = decodeText(parsed.files.get('xl/worksheets/sheet1.xml').data);
  const rows = parseSheetRows(sheet, []);

  assert.equal(rows.length, notes.length + 1);
  assert.deepEqual(rows[0], ['Title', 'Body', 'Favorite', 'Labels', 'Created', 'Updated', 'Images']);
  assert.deepEqual(rows[1], [
    'A&B <x>',
    'line1\nline2',
    'TRUE',
    'Work, home',
    new Date(notes[0].createdAt).toISOString(),
    new Date(notes[0].updatedAt).toISOString(),
    '1'
  ]);
  assert.deepEqual(rows[2], [
    '',
    '',
    'FALSE',
    '',
    new Date(notes[1].createdAt).toISOString(),
    new Date(notes[1].updatedAt).toISOString(),
    '0'
  ]);
});

test('parseSheetRows resolves inline strings, shared strings, booleans and numbers', () => {
  const xml = '<worksheet><sheetData>'
    + '<row r="1">'
    + '<c r="A1" t="s"><v>0</v></c>'
    + '<c r="B1" t="s"><v>1</v></c>'
    + '<c r="D1" t="inlineStr"><is><t>inline</t></is></c>'
    + '</row>'
    + '<row r="3">'
    + '<c r="A3" t="b"><v>1</v></c>'
    + '<c r="B3" t="b"><v>0</v></c>'
    + '<c r="C3"><v>42</v></c>'
    + '</row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>second</t></is></c></row>'
    + '</sheetData></worksheet>';

  const rows = parseSheetRows(xml, ['alpha', 'beta']);
  assert.deepEqual(rows[0], ['alpha', 'beta', '', 'inline']);
  assert.deepEqual(rows[1], ['second', '', '', '']);
  assert.deepEqual(rows[2], ['TRUE', 'FALSE', '42', '']);
});

test('parseSheetRows tolerates missing refs, self-closing cells and absent row numbers', () => {
  const xml = '<sheetData>'
    + '<row><c t="inlineStr"><is><t>x</t></is></c></row>'
    + '<row><c r="B2"/></row>'
    + '</sheetData>';
  const rows = parseSheetRows(xml, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], 'x');
  assert.equal(rows[1][1], '');
  assert.deepEqual(parseSheetRows('<worksheet></worksheet>', []), []);
});

test('collectTextRuns concatenates runs and decodes entities', () => {
  assert.equal(collectTextRuns('<t>a</t><t xml:space="preserve">b&amp;c</t>'), 'ab&c');
  assert.equal(collectTextRuns('<t></t>'), '');
  assert.equal(collectTextRuns('<x:t>a</x:t>'), '');
  assert.equal(collectTextRuns('<t>a</t><ignored>b</ignored><t>c</t>'), 'ac');
});

test('parseSharedStrings reads plain and rich-text entries', () => {
  const xml = '<sst><si><t>Hello</t></si>'
    + '<si><r><t xml:space="preserve">a</t></r><r><t>b</t></r></si>'
    + '<si></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['Hello', 'ab', '']);
  assert.deepEqual(parseSharedStrings(''), []);
  assert.deepEqual(parseSharedStrings(undefined), []);
});

test('importTimestamp converts Excel serial dates, epoch values and ISO text', () => {
  const fallback = 1234;
  assert.equal(importTimestamp(undefined, fallback), fallback);
  assert.equal(importTimestamp(null, fallback), fallback);
  assert.equal(importTimestamp('   ', fallback), fallback);
  assert.equal(importTimestamp('not a date', fallback), fallback);

  assert.equal(importTimestamp('45000', fallback), Math.round((45000 - 25569) * 86400000));
  assert.equal(importTimestamp(30000, fallback), Math.round((30000 - 25569) * 86400000));
  assert.equal(importTimestamp('1700000000000', fallback), 1700000000000);
  assert.equal(importTimestamp('1700000000', fallback), 1700000000000);
  assert.equal(
    importTimestamp('2024-01-02T03:04:05.000Z', fallback),
    Date.UTC(2024, 0, 2, 3, 4, 5)
  );
});

test('importFavorite recognizes the documented truthy spellings', () => {
  for (const value of ['TRUE', ' true ', '1', 'yes', 'Y', '是', '★', '星标', '收藏']) {
    assert.equal(importFavorite(value), true, 'expected favorite for ' + JSON.stringify(value));
  }
  for (const value of ['', 'false', '0', 'no', 'truex', null, undefined, false]) {
    assert.equal(importFavorite(value), false, 'expected not favorite for ' + JSON.stringify(value));
  }
});

test('parseLabelCell splits on every supported separator and normalizes labels', () => {
  assert.deepEqual(parseLabelCell('a,b'), ['a', 'b']);
  assert.deepEqual(parseLabelCell(' one ， two ; three、 four；five'), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(parseLabelCell(''), []);
  assert.deepEqual(parseLabelCell(null), []);
  assert.deepEqual(parseLabelCell('#Work, work'), ['Work']);
  assert.equal(parseLabelCell('x'.repeat(40))[0].length, 24);
});

test('normalizedHeader lowercases and strips spaces/underscores', () => {
  assert.equal(normalizedHeader(' Title '), 'title');
  assert.equal(normalizedHeader('CREATED_AT'), 'createdat');
  assert.equal(normalizedHeader('Updated At'), 'updatedat');
  assert.equal(normalizedHeader('Labels'), 'labels');
  assert.equal(normalizedHeader(null), '');
  assert.equal(normalizedHeader('  '), '');
  assert.equal(normalizedHeader(42), '42');
});

test('stripXmlPrefixes removes element prefixes but keeps attributes and text', () => {
  const xml = '<x:worksheet xmlns:x="urn:x"><x:row r="1"><x:c r="A1"/></x:row></x:worksheet>';
  assert.equal(
    stripXmlPrefixes(xml),
    '<worksheet xmlns:x="urn:x"><row r="1"><c r="A1"/></row></worksheet>'
  );
  assert.equal(stripXmlPrefixes('<row/>'), '<row/>');
  assert.equal(stripXmlPrefixes('<a:b>text</a:b>'), '<b>text</b>');
});
