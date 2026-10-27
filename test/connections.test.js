import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionsHtml, splitNameYears, addConnections, relationLabel, isConnectionsHtml } from '../src/connections.js';
import { reportToPack } from '../src/report.js';

// Row markup copied from a real page; names and IDs are made up.
const row = (id, dist, unit, name, mark = '', kind = 'relationship', page = 'Relationship') => `
<div class="row">
<div class="col-auto text-lg-end text-center">
<a href="/index.php?title=Special:${page}&action=calculate&person1Name=Viewer-1&person2Name=${id}" target="_blank" title="x"><b>${dist}</b> ${unit}</a>
</div>
<div class="col-auto text-md-start text-center">
<a href="/wiki/${id}" target="_blank" title="Click here to open this profile in a new window">${name}</a>
${mark}
</div>
</div>`;
const page = `<script>var wgCanonicalSpecialPageName="MyConnections";</script>
<input type="hidden" name="c" value="Calvary_Cemetery,_Ames,_Iowa" checked>
<a href="/index.php?title=Special:MyConnections&u=1&c=Calvary_Cemetery,_Ames,_Iowa&amp;from=EATON|Heppie"><button class="btn btn-secondary btn-sm">Next</button></a>
<section id="Ancestors" class="tab-content">
${row('Sample-2', 2, 'generations', 'Ada (Sample) Placeholder (1850-1921)', '<mark>ancestor <span></span></mark>')}
${row('Sample-3', 17, 'generations', 'Bo Example (abt.1873-1954)')}
${row('Sample-9', 18, 'generations', 'No Dates')}
</section>
<section id="Connections" class="tab-content">
${row('Sample-4', 5, 'degrees', "Cy D'Example Sr (-1919)", '', 'c', 'Connection')}
${row('Sample-5', 1, 'degrees', 'Di Young (1949-1995)', '', 'c', 'Connection')}
</section>`;

test('detects the page and rejects other HTML', () => {
  assert.ok(isConnectionsHtml(page));
  assert.throws(() => parseConnectionsHtml('<html>nope</html>'));
});

test('splitNameYears keeps maiden names, handles abt., open-ended and missing years', () => {
  assert.deepEqual(splitNameYears('Leona (Budd) Robinson (1904-1966)'), { name: 'Leona (Budd) Robinson', birth: '1904', death: '1966' });
  assert.deepEqual(splitNameYears('Susan (abt.1873-1954)'), { name: 'Susan', birth: '1873', death: '1954' });
  assert.deepEqual(splitNameYears('Alice (Brown) Boling (-1919)'), { name: 'Alice (Brown) Boling', birth: '', death: '1919' });
  assert.deepEqual(splitNameYears('Derek Douglass'), { name: 'Derek Douglass', birth: '', death: '' });
  assert.deepEqual(splitNameYears('Mary (Carl) Hulet'), { name: 'Mary (Carl) Hulet', birth: '', death: '' });
});

test('parse: viewer, category, next page, kinds and distances', () => {
  const p = parseConnectionsHtml(page);
  assert.equal(p.viewer, 'Viewer-1');
  assert.equal(p.category, 'Calvary_Cemetery,_Ames,_Iowa');
  assert.match(p.next, /from=EATON\|Heppie/);
  assert.deepEqual(p.entries.map((e) => [e.wikiTreeId, e.kind, e.distance]),
    [['Sample-2', 'ancestor', 2], ['Sample-3', 'cousin', 17], ['Sample-9', 'cousin', 18], ['Sample-4', 'connection', 5], ['Sample-5', 'connection', 1]]);
  assert.equal(p.entries[3].name, "Cy D'Example Sr");
});

test('labels use WikiTree wording and singular/plural', () => {
  assert.equal(relationLabel({ kind: 'ancestor', distance: 1 }), 'your ancestor, 1 generation back');
  assert.match(relationLabel({ kind: 'connection', distance: 5 }), /through marriage, 5 degrees away/);
});

test('addConnections makes a cemetery pack; undated people are left out', () => {
  const pack = addConnections(null, parseConnectionsHtml(page), { now: new Date('2026-10-27') });
  assert.equal(pack.viewer, 'Viewer-1');
  assert.equal(pack.places.length, 1);
  assert.equal(pack.places[0].name, 'Calvary Cemetery, Ames, Iowa');
  assert.equal(pack.people.length, 4);
  assert.ok(!pack.people.some((p) => p.id === 'Sample-9'));
  assert.equal(pack.stats.excludedLiving, 1);
  assert.equal(pack.people.find((p) => p.id === 'Sample-2').relationship, 'your ancestor, 2 generations back');
});

test('addConnections into a report pack keeps bios and coordinates and overrides the label', () => {
  const report = { schemaVersion: 1, generator: { name: 'g' }, root: { wikiTreeId: 'Root-1' }, people: [
    { ahnentafel: 1, relationship: 'self', id: 1, wikiTreeId: 'Root-1', name: 'Rae Root', birth: { date: '1900', place: '' }, death: { date: '1970', place: '' }, categories: [], cemeteries: [] },
    { ahnentafel: 2, relationship: 'mother', id: 2, wikiTreeId: 'Sample-2', name: 'Ada Placeholder', birth: { date: '1850', place: '' }, death: { date: '1921', place: '' },
      categories: [], cemeteries: [{ category: 'Calvary_Cemetery,_Ames,_Iowa', name: 'Calvary Cemetery', place: 'Ames, Iowa' }], biography: 'Ada kept bees.' }] };
  const base = reportToPack(report, { now: new Date('2026-10-27') });
  base.places.find((p) => p.kind === 'cemetery').lat = 42.0;
  const merged = addConnections(base, parseConnectionsHtml(page), { now: new Date('2026-10-27') });
  const ada = merged.people.find((p) => p.id === 'Sample-2');
  assert.equal(ada.bio, 'Ada kept bees.');
  assert.equal(ada.relationship, 'your ancestor, 2 generations back');
  assert.equal(merged.places.find((p) => p.kind === 'cemetery').lat, 42.0);
  assert.equal(merged.root.name, 'Rae Root');
  assert.equal(merged.people.length, 1 + 1 + 3); // Rae, Ada, plus Sample-3/4/5
});

test('a computed cousin relationship is kept; an untraced person gets the page\'s count', () => {
  const base = { schemaVersion: 1, name: 'p', source: 's', builtAt: 'x', stats: {}, places: [],
    people: [
      { id: 'Sample-2', userId: '', name: 'Ada', gender: '', birth: { date: '1850', place: '' }, death: { date: '1921', place: '' }, categories: [],
        relationship: 'your half fourth cousin four times removed', relation: { kind: 'cousin', via: 'Johann Elrod' } },
      { id: 'Sample-3', userId: '', name: 'Bo', gender: '', birth: { date: '1873', place: '' }, death: { date: '1954', place: '' }, categories: [],
        relationship: '', relation: { kind: 'untraced' } }] };
  const merged = addConnections(base, parseConnectionsHtml(page), { now: new Date('2026-10-27') });
  assert.equal(merged.people.find((p) => p.id === 'Sample-2').relationship, 'your half fourth cousin four times removed');
  assert.match(merged.people.find((p) => p.id === 'Sample-3').relationship, /17 generations apart/);
});
