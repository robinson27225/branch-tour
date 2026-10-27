import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReportJson, reportToPack, cleanBio } from '../src/report.js';

const person = (over) => ({ ahnentafel: 1, relationship: 'self', id: 1, wikiTreeId: 'Root-1', name: 'Rae Root', gender: 'Female',
  birth: { date: '1900-01-01', place: 'Ames, Iowa' }, death: { date: '1970-05-05', place: 'Ames, Iowa' },
  categories: ['Some_Family'], cemeteries: [], biography: '', ...over });
const report = (people) => ({ schemaVersion: 1, generator: { name: 'Genealogy Report', version: 'x' },
  root: { id: 1, wikiTreeId: 'Root-1' }, people });

test('detects the report format and rejects Plus JSON', () => {
  assert.ok(isReportJson(report([])));
  assert.ok(!isReportJson({ response: { profiles: [1] } }));
  assert.throws(() => reportToPack({ response: {} }));
});

test('cleanBio drops DNA and source sections, which name living people', () => {
  const bio = 'Born in 1900.\n\nShe farmed.\n\nDNA Statements\n\nMatch with Living Person.';
  assert.equal(cleanBio(bio), 'Born in 1900.\n\nShe farmed.');
  assert.equal(cleanBio('No sections here.'), 'No sections here.');
});

test('report -> pack: cemeteries authoritative, bio kept, relationship phrased, root recorded', () => {
  const pack = reportToPack(report([
    person({}),
    person({ ahnentafel: 2, relationship: 'father', id: 2, wikiTreeId: 'Root-2', name: 'Sam Root',
      cemeteries: [{ category: 'Calvary,_Ames,_Iowa', name: 'Calvary', place: 'Ames, Iowa' }],
      biography: 'Sam was a smith.\n\nDNA Statements\n\nMatch: Living Person' }),
  ]), { now: new Date('2026-10-27') });
  assert.equal(pack.people.length, 2);
  const sam = pack.people.find((p) => p.id === 'Root-2');
  assert.equal(sam.relationship, 'the father of Rae Root');
  assert.equal(sam.bio, 'Sam was a smith.');
  const cem = pack.places.find((p) => p.kind === 'cemetery');
  assert.equal(cem.name, 'Calvary, Ames, Iowa');
  assert.deepEqual(cem.personIds, ['Root-2']);
  assert.equal(pack.root.name, 'Rae Root');
  assert.equal(pack.people.find((p) => p.id === 'Root-1').relationship, '');
});

test('report people without a death record are still excluded', () => {
  const pack = reportToPack(report([person({ death: { date: '', place: '' }, birth: { date: '2001-01-01', place: '' } })]),
    { now: new Date('2026-10-27') });
  assert.equal(pack.people.length, 0);
});
