import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDelimited, detectDelimiter, rowsToObjects, buildPack, isCemeteryCategory,
  parsePlusJsonIds, filterByUserIds } from '../src/pack.js';
import { readXlsxRows } from '../src/xlsx.js';

const NOW = new Date('2026-10-26');

test('parseDelimited handles quotes, embedded newlines and BOM', () => {
  const rows = parseDelimited('﻿a,b\n"x\ny","he said ""hi"""\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['x\ny', 'he said "hi"']]);
});

test('detectDelimiter', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c\n'), ',');
});

test('cemetery category detection', () => {
  assert.ok(isCemeteryCategory('Fairmont_Cemetery,_Raton,_New_Mexico'));
  assert.ok(isCemeteryCategory('St_Mary_Churchyard,_Kent'));
  assert.ok(!isCemeteryCategory('Cemetery_Records_Project'));
  assert.ok(!isCemeteryCategory('Sample_Family'));
});

test('xlsx reader -> pack: groups, excludes living, keeps categories', async () => {
  const buf = readFileSync(new URL('./fixtures/sample.xlsx', import.meta.url));
  const rows = await readXlsxRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const pack = buildPack(rowsToObjects(rows), { name: 't', now: NOW });
  assert.equal(pack.people.length, 2);
  assert.equal(pack.stats.excludedLiving, 1);
  const cem = pack.places.find((p) => p.kind === 'cemetery');
  assert.equal(cem.name, 'Fairmont Cemetery, Raton, New Mexico');
  assert.deepEqual(cem.personIds, ['Sample-1']);
  const town = pack.places.find((p) => p.kind === 'town');
  assert.equal(town.name, 'Denver, Colorado, United States');
  assert.equal(pack.people[0].userId, '1001');
  assert.equal(pack.schemaVersion, 1);
});

test('csv with no death info and old birth is kept; unknown birth is treated as living', () => {
  const rows = parseDelimited('WikiTree ID,FullName,Birth Date\nA-1,Old One,1800\nA-2,No Date,\n', ',');
  const pack = buildPack(rowsToObjects(rows), { now: NOW });
  assert.deepEqual(pack.people.map((p) => p.id), ['A-1']);
  assert.equal(pack.stats.excludedLiving, 1);
});

test('Plus JSON ids parse and filter', () => {
  const ids = parsePlusJsonIds('{"response":{"profiles":[15040238.0,7]}}');
  assert.deepEqual(ids, ['15040238', '7']);
  assert.equal(filterByUserIds([{ userid: '7' }, { userid: '9' }], ids).length, 1);
});

test('uploadPhotoUrl opens WikiTree\'s upload page for a numeric user id, and nothing for anything else', async () => {
  const { uploadPhotoUrl } = await import('../src/pack.js');
  assert.equal(uploadPhotoUrl('28433171'), 'https://www.wikitree.com/index.php?title=Special:UploadPhoto&person_id=28433171');
  assert.equal(uploadPhotoUrl(''), '');
  assert.equal(uploadPhotoUrl('28433171&x=1'), '');
});
