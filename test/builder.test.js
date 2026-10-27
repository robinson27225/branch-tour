import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCategoryCoordinate, fetchCategoryCoordinate, buildTourPack, fetchAncestorLines, plusUrl, fetchCategoryIds, idsFromPlusHtml, plusProblemMessage, bestCategory, fitDegrees, fetchPeople, relationships, wikiToText, parseCategoryInput, normDate, isTourable, PAGE_SIZE } from '../src/builder.js';

const NOW = new Date('2026-10-27');
const P = (Id, Name, first, o = {}) => ({ Id, Name, FirstName: first, LastNameAtBirth: 'Test', Gender: o.g || '', Father: 0, Mother: 0,
  BirthDate: '1900-00-00', DeathDate: '1970-05-05', BirthLocation: 'Ames, Iowa', DeathLocation: 'Ames, Iowa', Privacy: 60, IsLiving: 0,
  Categories: [], Spouses: {}, ...o });

const family = () => ({
  1: P(1, 'Test-1', 'Sam', { g: 'Female', Father: 2, Mother: 3, Spouses: { 6: { Id: 6 } }, DeathDate: '2001-01-01', Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  2: P(2, 'Test-2', 'Dad', { g: 'Male', Father: 4, Categories: ['Calvary_Cemetery,_Ames,_Iowa'], Bio: "'''Dad''' was born.<ref>cite</ref> He farmed [[Space:Farm|the farm]].\n== Sources ==\n* Source line" }),
  3: P(3, 'Test-3', 'Mom', { g: 'Female', Categories: ['Sample_Family'] }),
  4: P(4, 'Test-4', 'Grandpa', { g: 'Male', Categories: ['Oak_Hill_Cemetery,_Boone,_Iowa'], BirthDate: '1850-00-00' }),
  5: P(5, 'Test-5', 'Bro', { g: 'Male', Father: 2, Mother: 3, Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  6: P(6, 'Test-6', 'Hubby', { g: 'Male', Spouses: { 1: { Id: 1 } }, Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  7: P(7, 'Test-7', 'Kid', { g: 'Female', Father: 1, Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  8: P(8, 'Test-8', 'Cousin', { g: 'Male', Father: 9 }),
  9: P(9, 'Test-9', 'Uncle', { g: 'Male', Father: 4, Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  10: { Id: 10, Name: 'Test-10' },                                   // hidden: no name
  11: P(11, 'Test-11', 'Alive', { IsLiving: 1, DeathDate: '0000-00-00', Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
  12: P(12, 'Test-12', 'Secret', { Privacy: 20, Categories: ['Calvary_Cemetery,_Ames,_Iowa'] }),
});
const stubApi = (people, calls = []) => ({ getPeople: async (keys, fields, params) => { calls.push({ keys, fields, params }); return ['', {}, people]; } });

test('normDate drops unknown parts', () => {
  assert.equal(normDate('1933-00-00'), '1933'); assert.equal(normDate('1933-11-00'), '1933-11');
  assert.equal(normDate('0000-00-00'), ''); assert.equal(normDate(''), '');
});

test('isTourable: public, named, not living', () => {
  assert.ok(isTourable(family()[2]));
  assert.ok(!isTourable(family()[10]) && !isTourable(family()[11]) && !isTourable(family()[12]));
});

test('parseCategoryInput takes names and WikiTree addresses', () => {
  const want = 'Fern_Hill_Cemetery,_Aberdeen,_Washington';
  assert.equal(parseCategoryInput('Fern Hill Cemetery, Aberdeen, Washington'), want);
  assert.equal(parseCategoryInput('https://www.wikitree.com/wiki/Category:Fern_Hill_Cemetery%2C_Aberdeen%2C_Washington'), want);
  assert.equal(parseCategoryInput('Category:' + want), want);
});

test('relationship labels', () => {
  const rel = relationships(family(), 1);
  assert.equal(rel(2, 'Male').label, 'your father');
  assert.equal(rel(3, 'Female').label, 'your mother');
  assert.equal(rel(4, 'Male').label, 'your grandfather');
  assert.equal(rel(5, 'Male').label, 'your brother');
  assert.equal(rel(6, 'Male').label, 'your husband');
  assert.equal(rel(7, 'Female').label, 'your daughter');
  assert.equal(rel(9, 'Male').kind, 'connection');
  const gg = { 1: P(1, 'a', 'A', { Father: 2 }), 2: P(2, 'b', 'B', { Father: 3 }), 3: P(3, 'c', 'C', { Father: 4 }), 4: P(4, 'd', 'D', { Father: 5 }), 5: P(5, 'e', 'E', { Father: 6 }), 6: P(6, 'f', 'F') };
  const r2 = relationships(gg, 1);
  assert.equal(r2(4, 'Male').label, 'your great-grandfather');
  assert.equal(r2(5, 'Male').label, 'your 2nd great-grandfather');
  assert.equal(r2(6, 'Male').label, 'your 3rd great-grandfather');
});

test('wikiToText strips refs, templates, links and stops at Sources', () => {
  const t = wikiToText("== Biography ==\n'''Ann''' was born.<ref>x</ref> {{Born|1900}}She lived in [[Ames, Iowa|Ames]].\n\n== Sources ==\nSee this.");
  assert.equal(t, 'Ann was born. She lived in Ames.');
});

test('fetchPeople follows pages until a short page', async () => {
  const mk = (from, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [from + i, { Id: from + i }]));
  const pages = [mk(100, PAGE_SIZE), mk(5000, 3)];
  const starts = [];
  const api = { getPeople: async (k, f, p) => { starts.push(p.start); return ['', {}, pages.shift()]; } };
  const out = await fetchPeople({ api, keys: ['X-1'], fields: ['Id'], params: { nuclear: 7 } });
  assert.deepEqual(starts, [0, PAGE_SIZE]);
  assert.equal(Object.keys(out).length, PAGE_SIZE + 3);
});

test('fetchPeople retries a failing call, then reports an error status', async () => {
  let n = 0;
  const api = { getPeople: async () => { if (++n < 3) throw new Error('boom'); return ['', {}, { 1: { Id: 1 } }]; } };
  assert.equal(Object.keys(await fetchPeople({ api, keys: ['X'], fields: [], params: {}, wait: async () => {} })).length, 1);
  await assert.rejects(fetchPeople({ api: { getPeople: async () => ['Limit exceeded', {}, {}] }, keys: ['X'], fields: [], params: {} }), /Limit exceeded/);
});

test('ancestors mode: asks for bios and N generations; keeps only public deceased people with labels and clean bios', async () => {
  const calls = [];
  const pack = await buildTourPack({ api: stubApi(family(), calls), startId: 'Test-1', mode: 'ancestors', generations: 4, now: NOW });
  assert.equal(calls[0].params.ancestors, 4);
  assert.ok(calls[0].fields.includes('Bio') && calls[0].fields.includes('Categories'));
  const ids = pack.people.map((p) => p.id);
  assert.ok(!ids.includes('Test-10') && !ids.includes('Test-11') && !ids.includes('Test-12'));
  const dad = pack.people.find((p) => p.id === 'Test-2');
  assert.equal(dad.relationship, 'your father');
  assert.equal(dad.bio, 'Dad was born. He farmed the farm.');
  assert.equal(dad.birth.date, '1900');
  const cem = pack.places.find((p) => p.name === 'Calvary Cemetery, Ames, Iowa');
  assert.ok(cem.personIds.includes('Test-2'));
  assert.equal(pack.name, 'Ancestors of Sam Test');
  assert.equal(pack.viewer, 'Test-1');
});

test('cc7 mode: nuclear=7, no bios requested', async () => {
  const calls = [];
  const pack = await buildTourPack({ api: stubApi(family(), calls), startId: 'Test-1', mode: 'cc7', now: NOW });
  const last = calls[calls.length - 1];
  assert.ok(last.params.nuclear >= 1);
  assert.ok(!last.fields.includes('Bio') && last.fields.includes('Meta'));
  assert.equal(pack.people.find((p) => p.id === 'Test-2').bio, '');
});

test('clear errors: no ID, no category, start profile not returned', async () => {
  await assert.rejects(buildTourPack({ api: stubApi({}), startId: '' }), /Enter your WikiTree ID/);
  await assert.rejects(buildTourPack({ api: stubApi({}), startId: 'X-1', mode: 'category' }), /category/);
  await assert.rejects(buildTourPack({ api: stubApi({ 2: P(2, 'Other-2', 'O') }), startId: 'X-1' }), /logged in/);
});

import { buildTourPack as build2 } from '../src/builder.js';

test('the API sends the biography as lowercase "bio"; categories and images are dropped from it', async () => {
  const raw = '[[Category:Burlington, Iowa]]\n[[Category:Fern Hill Cemetery, Aberdeen, Washington]]\n== Biography ==\n=== Birth ===\n{{Image|file=x.jpg\n|align=r\n|caption=Baby\n}}\n\nCarl, son of [[Robinson-1|Firman]], was born in [[Wikipedia:Burlington, Iowa|Burlington]].<ref name=a>cite</ref>\n\n== Sources ==\n<references />';
  const people = { 1: P(1, 'Test-1', 'Sam', { Father: 0, bio: raw }), 2: P(2, 'Test-2', 'Dad', { Bio: 'Dad farmed.' }) };
  const pack = await build2({ api: stubApi(people), startId: 'Test-1', mode: 'ancestors', now: NOW });
  const sam = pack.people.find((p) => p.id === 'Test-1');
  assert.equal(sam.bio, 'Carl, son of Firman, was born in Burlington.');
  assert.ok(!/Category|Image|Baby|Sources/.test(sam.bio));
  assert.equal(pack.people.find((p) => p.id === 'Test-2').bio, 'Dad farmed.'); // an uppercase key still works
  assert.equal(pack.stats.withBio, 2);
});

test('a long biography is cut at a sentence, not in the middle of one', () => {
  const sentence = 'The family moved west and farmed a quiet piece of land near the river for many years. ';
  const t = wikiToText(sentence.repeat(80));
  assert.ok(t.length <= 4010);
  assert.match(t, /\. …$/);
});

// A stand-in for WikiTree's cap: more than 1,025 profiles is refused, as it was for the real CC7.
const cappedApi = (limitDegree, sizes, calls = []) => ({
  getPeople: async (keys, fields, params) => {
    calls.push({ fields, params });
    const d = params.nuclear;
    if (d > limitDegree) return ['Maximum number of profiles (1025) reached.', {}, {}];
    const people = {};
    for (let i = 1; i <= sizes[d - 1]; i++) people[i] = P(i, i === 1 ? 'Test-1' : 'Test-' + i, i === 1 ? 'Sam' : 'P' + i, i === 1 ? { g: 'Female', DeathDate: '2001-01-01' } : {});
    return ['', {}, people];
  },
});

test('cc7 goes out one degree at a time and stops where WikiTree refuses', async () => {
  const calls = [];
  const pack = await buildTourPack({ api: cappedApi(3, [4, 12, 40], calls), startId: 'Test-1', mode: 'cc7', now: NOW });
  const probes = calls.filter((c) => c.fields.length === 1).map((c) => c.params.nuclear);
  assert.deepEqual(probes, [1, 2, 3, 4]);                     // 4 was refused
  const final = calls[calls.length - 1];
  assert.equal(final.params.nuclear, 3);                        // the full fetch uses the last degree that fit
  assert.ok(final.fields.includes('Meta') && final.fields.includes('Categories'));
  assert.deepEqual(pack.stats.reach, { degrees: 3, asked: 7, capped: true, profiles: 40 });
  assert.equal(pack.people.length, 40);
});

test('cc7: the degree you pick is the farthest it goes, even if more would fit', async () => {
  const calls = [];
  const pack = await buildTourPack({ api: cappedApi(9, [4, 12, 40, 90], calls), startId: 'Test-1', mode: 'cc7', maxDegree: 2, now: NOW });
  assert.deepEqual(calls.filter((c) => c.fields.length === 1).map((c) => c.params.nuclear), [1, 2]);
  assert.equal(calls[calls.length - 1].params.nuclear, 2);
  assert.deepEqual(pack.stats.reach, { degrees: 2, asked: 2, capped: false, profiles: 12 });
});

test('cc7: stops early when a degree adds nobody new', async () => {
  const pack = await buildTourPack({ api: cappedApi(9, [4, 12, 12, 12], []), startId: 'Test-1', mode: 'cc7', now: NOW });
  assert.equal(pack.stats.reach.degrees, 2);
  assert.equal(pack.stats.reach.capped, false);
});

test('fitDegrees: refused even at one degree is a clear error; other API errors pass through', async () => {
  await assert.rejects(fitDegrees({ api: cappedApi(0, []), key: 'X-1' }), /closest relatives/);
  const broken = { getPeople: async () => ['Limit exceeded', {}, {}] };
  await assert.rejects(fitDegrees({ api: broken, key: 'X-1' }), /Limit exceeded/);
});

test("WikiTree's own degree count (Meta) is used for connections", async () => {
  const people = family();
  people[9] = { ...people[9], Meta: { Degrees: 4 } };
  const pack = await buildTourPack({ api: stubApi(people), startId: 'Test-1', mode: 'cc7', now: NOW });
  const uncle = pack.people.find((p) => p.id === 'Test-9');
  assert.match(uncle.relationship, /4 degrees away/);
});

test('plusUrl is the search the "Get profiles" button runs', () => {
  assert.equal(plusUrl('Molalla_Memorial_Cemetery,_Molalla,_Oregon'),
    'https://plus.wikitree.com/function/WTWebProfileSearch/Profiles.json?Query=Molalla+Memorial+Cemetery%2C+Molalla%2C+Oregon&MaxProfiles=1000&Format=JSON');
  assert.equal(plusUrl('X Y', ''), 'https://plus.wikitree.com/function/WTWebProfileSearch/Profiles.htm?Query=X+Y&MaxProfiles=1000');
});

const json = (obj) => async () => ({ ok: true, text: async () => JSON.stringify(obj) });
const page = (html) => async () => ({ ok: true, text: async () => html });

test('fetchCategoryIds: JSON list (ids arrive as 15040238.0), then the results page, with the reason when neither works', async () => {
  assert.deepEqual(await fetchCategoryIds('X', json({ response: { profiles: [15040238.0, 77, 0] } })), { ids: [15040238, 77], via: 'json' });

  // Plus sends the ordinary page when it does not know the format: take the profile links from it
  const html = '<html><a href="https://www.wikitree.com/wiki/Jones-67676">Lucy</a> <a href="/wiki/Help:X">help</a> <a href="https://www.wikitree.com/wiki/Jones-67676">again</a> <a href="https://www.wikitree.com/wiki/D\'Allemand-14">x</a></html>';
  assert.deepEqual(await fetchCategoryIds('X', page(html)), { ids: ['Jones-67676', "D'Allemand-14"], via: 'page' });

  assert.deepEqual(await fetchCategoryIds('X', page('<html>WikiTree+ Home</html>')), { ids: null, problem: 'page-without-profiles' });
  assert.deepEqual(await fetchCategoryIds('X', async () => ({ ok: false, status: 403 })), { ids: null, problem: 'http 403' });
  assert.deepEqual(await fetchCategoryIds('X', async () => { throw new TypeError('blocked'); }), { ids: null, problem: 'network' });
  assert.deepEqual(await fetchCategoryIds('X', json({ response: { profiles: [] } })), { ids: null, problem: 'empty' });
});

test('idsFromPlusHtml ignores help pages, categories and look-alikes', () => {
  assert.deepEqual(idsFromPlusHtml('<a href="https://www.wikitree.com/wiki/Category:Foo-1">c</a><a href="/wiki/Space:Bar-2">s</a><a href="https://www.wikitree.com/wiki/Smith-9">p</a>'), ['Smith-9']);
});

test('plusProblemMessage says what went wrong and offers the saved-page route', () => {
  for (const p of ['network', 'empty', 'page-without-profiles', 'http 500', 'other']) assert.match(plusProblemMessage(p, 'A_B'), /My Connections page/);
  assert.match(plusProblemMessage('network', 'A_B'), /could not reach WikiTree Plus/);
  assert.match(plusProblemMessage('empty', 'Molalla_Memorial'), /"Molalla Memorial"/);
});

// An API that knows everyone, finds a person by user id or WikiTree id, and returns ancestors by following Father and Mother.
const CEM = 'Molalla_Memorial_Cemetery,_Molalla,_Oregon';
const world = () => ({
  1: P(1, 'Test-1', 'Sam', { g: 'Female', Father: 2, DeathDate: '2001-01-01' }),
  2: P(2, 'Test-2', 'Dad', { g: 'Male', Father: 7, Mother: 8, Categories: [CEM] }),            // your father, buried there
  7: P(7, 'Test-7', 'Grandpa', { g: 'Male', BirthDate: '1840-00-00', DeathDate: '1910-00-00' }),
  8: P(8, 'Test-8', 'Grandma', { g: 'Female', BirthDate: '1842-00-00', DeathDate: '1915-00-00' }),
  50: P(50, 'Far-50', 'Faraway', { g: 'Male', Father: 7, Mother: 8, Categories: [CEM], BirthDate: '1880-00-00' }),   // your father's brother
  51: P(51, 'Far-51', 'Distant', { Father: 50, Categories: [CEM, 'Some_Family'], g: 'Female' }),            // his daughter: your first cousin
  52: P(52, 'Far-52', 'Stranger', { Categories: ['Other_Cemetery,_Elsewhere'] }),                          // Plus matched text, wrong category
});
const find = (w, k) => w[k] || Object.values(w).find((q) => q.Name === k);
const ancestorsOf = (w, keys, depth) => {
  const out = {}; let frontier = keys.map((k) => find(w, k)).filter(Boolean);
  for (const p of frontier) out[p.Id] = p;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const p of frontier) for (const par of [p.Father, p.Mother]) if (par && w[par] && !out[par]) { out[par] = w[par]; next.push(w[par]); }
    frontier = next;
  }
  return out;
};
const worldApi = (w, calls = []) => ({
  getPeople: async (keys, fields, params) => {
    calls.push({ keys, fields, params });
    if (params.ancestors) return ['', {}, ancestorsOf(w, keys, params.ancestors)];
    if (params.nuclear) return ['', {}, { 1: w[1], 2: w[2] }];
    const out = {};
    for (const k of keys) { const p = find(w, k); if (p) out[p.Id] = p; }
    return ['', {}, out];
  },
});

test('category mode asks Plus first and never searches the CC: members found anywhere, ancestors labelled', async () => {
  const seen = [], calls = [];
  const fetchFn = async (url) => { seen.push(url); return { ok: true, text: async () => JSON.stringify({ response: { profiles: [2, 50, 51, 52] } }) }; };
  const pack = await buildTourPack({ api: worldApi(world(), calls), startId: 'Test-1', mode: 'category', category: 'Molalla Memorial Cemetery, Molalla, Oregon', now: NOW, fetchFn });
  assert.match(seen[0], /\/function\/WTWebProfileSearch\/Profiles\.json\?Query=Molalla\+Memorial\+Cemetery%2C\+Molalla%2C\+Oregon/);
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['Far-50', 'Far-51', 'Test-2']);          // Far-52 lists another category
  assert.equal(pack.people.find((p) => p.id === 'Test-2').relationship, 'your father');
  assert.equal(pack.people.find((p) => p.id === 'Far-50').relationship, 'your uncle');
  assert.equal(pack.people.find((p) => p.id === 'Far-51').relationship, 'your first cousin');
  assert.match(pack.people.find((p) => p.id === 'Far-51').relation.via, /Grandpa Test \(1840–1910\) and Grandma Test \(1842–1915\)/);
  assert.equal(pack.people.find((p) => p.id === 'Far-51').relation.generations, 4);
  assert.deepEqual(pack.places.map((p) => p.name), ['Molalla Memorial Cemetery, Molalla, Oregon']);
  assert.deepEqual(pack.stats.category, { source: 'json', found: 4, used: '' });
  assert.ok(calls.every((c) => !c.params.nuclear), 'no CC search for a cemetery');
  assert.deepEqual(calls.find((c) => !c.params.ancestors).keys, [2, 50, 51, 52]);
  assert.deepEqual(pack.stats.kinship, { related: 3, members: 3, deep: false });
});

test('category mode reads Plus\'s results page when JSON is not available (WikiTree ids as keys)', async () => {
  const html = '<a href="https://www.wikitree.com/wiki/Test-2">Dad</a><a href="https://www.wikitree.com/wiki/Far-50">F</a>';
  const pack = await buildTourPack({ api: worldApi(world()), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: page(html) });
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['Far-50', 'Test-2']);
  assert.equal(pack.stats.category.source, 'page');
});

test('category mode: when the category is named differently on WikiTree it finds the one the results share', async () => {
  const w = world();
  const REAL = 'Molalla_Memorial_Cemetery,_Clackamas_County,_Oregon';
  for (const id of [2, 50, 51]) w[id] = { ...w[id], Categories: [REAL] };
  const pack = await buildTourPack({ api: worldApi(w), startId: 'Test-1', mode: 'category', category: 'Molalla Memorial Cemetery, Molalla, Oregon', now: NOW, fetchFn: json({ response: { profiles: [2, 50, 51] } }) });
  assert.equal(pack.people.length, 3);
  assert.deepEqual(pack.stats.category, { source: 'json', found: 3, used: REAL });
  assert.equal(pack.name, 'Molalla Memorial Cemetery, Clackamas County, Oregon');
});

test('bestCategory needs two words in common, and only cemetery-like categories count', () => {
  const found = { 1: { Categories: ['Some_Family', 'Molalla_Memorial_Cemetery,_Clackamas_County,_Oregon'] }, 2: { Categories: ['Oak_Hill_Cemetery,_Boone,_Iowa'] } };
  assert.equal(bestCategory(found, 'Molalla Memorial Cemetery, Molalla, Oregon'), 'Molalla_Memorial_Cemetery,_Clackamas_County,_Oregon');
  assert.equal(bestCategory(found, 'Totally Different Place'), '');
  assert.equal(bestCategory({ 1: { Categories: ['Molalla_Family_Tree'] } }, 'Molalla Family Tree'), '');
});

test('category mode: clear errors instead of a silent fallback', async () => {
  const api = worldApi(world());
  await assert.rejects(buildTourPack({ api, startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: page('<html>WikiTree+ Home</html>') }), /no profile links.*My Connections page/);
  await assert.rejects(buildTourPack({ api, startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: async () => { throw new TypeError('x'); } }), /could not reach WikiTree Plus/);
  // Plus lists strangers only
  await assert.rejects(buildTourPack({ api, startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [52] } }) }), /listed 1 profiles.*none of them has that category/);
});

test('a 44-profile cemetery cannot hit the 1,025 limit: only your direct line and the members are fetched', async () => {
  const api = { getPeople: async (keys, fields, params) => (params.nuclear ? ['Maximum number of profiles (1025) reached.', {}, {}] : worldApi(world()).getPeople(keys, fields, params)) };
  const pack = await buildTourPack({ api, startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [2, 50, 51] } }) });
  assert.equal(pack.people.length, 3);
});

test('a cemetery pack carries the members\' biographies; a very large category skips them', async () => {
  const w = world();
  w[50] = { ...w[50], bio: '[[Category:Foo]]\n== Biography ==\nFaraway farmed near the river for forty years and raised six horses on the land.' };
  const calls = [];
  const pack = await buildTourPack({ api: worldApi(w, calls), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [2, 50, 51] } }) });
  assert.match(pack.people.find((p) => p.id === 'Far-50').bio, /^Faraway farmed near the river/);
  assert.ok(!/Category/.test(pack.people.find((p) => p.id === 'Far-50').bio));
  assert.equal(pack.stats.withBio, 1);
  assert.ok(calls.some((c) => c.fields.includes('Bio')));

  // 250 ids: no biographies are asked for
  const many = Array.from({ length: 250 }, (_, i) => 1000 + i);
  const calls2 = [];
  const api = { getPeople: async (keys, fields, params) => { calls2.push({ keys, fields, params });
    return params.ancestors ? ['', {}, { 1: w[1], 2: w[2] }] : ['', {}, Object.fromEntries(keys.filter((k) => k >= 1000).map((k) => [k, P(k, 'M-' + k, 'M' + k, { Categories: [CEM] })])) ]; } };
  const big = await buildTourPack({ api, startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: many } }) });
  assert.equal(big.people.length, 250);
  assert.ok(calls2.filter((c) => !c.params.ancestors).every((c) => !c.fields.includes('Bio')));
});

test('someone who shares no ancestor is marked as not traced, not left blank', async () => {
  const w = world(); w[60] = P(60, 'Far-60', 'Unrelated', { Categories: [CEM] });
  const pack = await buildTourPack({ api: worldApi(w), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [2, 60] } }) });
  const u = pack.people.find((p) => p.id === 'Far-60');
  assert.equal(u.relationship, ''); assert.equal(u.relation.kind, 'untraced');
});

test('fetchAncestorLines halves a batch WikiTree refuses, and skips a person who alone would not fit', async () => {
  const seen = [];
  const api = { getPeople: async (keys, fields, params) => {
    seen.push(keys.length);
    if (keys.length > 2 || keys.includes(99)) return ['Maximum number of profiles (1025) reached.', {}, {}];
    return ['', {}, Object.fromEntries(keys.map((k) => [k, { Id: k, Father: 0, Mother: 0 }]))];
  } };
  const got = await fetchAncestorLines({ api, ids: [1, 2, 3, 4, 5, 6, 7, 99], batch: 8 });
  assert.deepEqual(Object.keys(got).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]); // 99 skipped, nothing else lost
  assert.ok(seen[0] === 8 && seen.includes(1));
  await assert.rejects(fetchAncestorLines({ api: { getPeople: async () => ['Limit exceeded', {}, {}] }, ids: [1] }), /Limit exceeded/);
});

test('a cemetery pack names each person\'s spouse with years; a private or living spouse stays unnamed', async () => {
  const w = world();
  w[70] = P(70, 'Far-70', 'Husband', { g: 'Male', Categories: [CEM], BirthDate: '1919-10-31', DeathDate: '2005-01-04', Spouses: { 71: { Id: 71, MarriageDate: '1940-08-06', MarriageLocation: 'Clark, Washington' } } });
  w[71] = P(71, 'Far-71', 'Wife', { g: 'Female', BirthDate: '1931-00-00', DeathDate: '2000-00-00' });          // not in the cemetery category
  w[72] = P(72, 'Far-72', 'Second', { g: 'Female', Categories: [CEM], Spouses: { 73: { Id: 73, MarriageDate: '1950-01-01' } } });
  w[73] = P(73, 'Far-73', 'Hidden', { g: 'Male', Privacy: 20 });
  const calls = [];
  const pack = await buildTourPack({ api: worldApi(w, calls), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [70, 72] } }) });
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['Far-70', 'Far-72']);            // spouses are looked up but are not tour stops
  assert.equal(pack.people.find((p) => p.id === 'Far-70').lastNameAtBirth, 'Test');
  assert.deepEqual(pack.people.find((p) => p.id === 'Far-70').family.spouses,
    [{ name: 'Wife Test (1931–2000)', date: '1940-08-06', place: 'Clark, Washington' }]);
  assert.deepEqual(pack.people.find((p) => p.id === 'Far-72').family.spouses, [{ name: '', date: '1950-01-01', place: '' }]);
});

test('the cemetery\'s coordinate is read from the category page\'s source, or from its map links', () => {
  assert.deepEqual(parseCategoryCoordinate('{{CategoryInfoBox Cemetery\n|name= Molalla Memorial Cemetery\n|findagraveID= 2193062\n|coordinate= 45.1206017, -122.5896988\n|startdate=\n}}'), { lat: 45.1206017, lng: -122.5896988 });
  assert.deepEqual(parseCategoryCoordinate('<a href="https://www.openstreetmap.org/?mlat=45.1&amp;mlon=-122.5#map=17/45.1206017/-122.5896988">OPS Map</a>'), { lat: 45.1206017, lng: -122.5896988 });
  assert.deepEqual(parseCategoryCoordinate('<a href="https://www.google.com/maps?q=45.1206017,-122.5896988">Google</a>'), { lat: 45.1206017, lng: -122.5896988 });
  assert.equal(parseCategoryCoordinate('|coordinate=\n|startdate='), null);
  assert.equal(parseCategoryCoordinate('|coordinate= 0, 0'), null);
  assert.equal(parseCategoryCoordinate(''), null);
});

test('fetchCategoryCoordinate tries the source, then the page, and gives null when neither says', async () => {
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return url.includes('action=raw') ? { ok: false } : { ok: true, text: async () => '<a href="https://maps.example/?ll=45.12,-122.58">m</a>' }; };
  assert.deepEqual(await fetchCategoryCoordinate('Molalla Memorial Cemetery, Molalla, Oregon', fetchFn), { lat: 45.12, lng: -122.58 });
  assert.match(urls[0], /title=Category:Molalla_Memorial_Cemetery,_Molalla,_Oregon&action=raw/);
  assert.equal(await fetchCategoryCoordinate('X', async () => { throw new TypeError('blocked'); }), null);
});

test('a cemetery pack takes the cemetery\'s position from its category page, so no map search guesses it', async () => {
  const fetchFn = async (url) => url.includes('Profiles.json')
    ? { ok: true, text: async () => JSON.stringify({ response: { profiles: [2, 50] } }) }
    : { ok: true, text: async () => '|coordinate= 45.1206017, -122.5896988' };
  const pack = await buildTourPack({ api: worldApi(world()), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn });
  const cem = pack.places.find((p) => p.kind === 'cemetery');
  assert.deepEqual([cem.lat, cem.lng], [45.1206017, -122.5896988]);
  assert.equal(pack.stats.category.coordinate, true);
  const none = await buildTourPack({ api: worldApi(world()), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [2, 50] } }) });
  assert.equal(none.places.find((p) => p.kind === 'cemetery').lat, null);
});

test('a dated list in a biography ("He married 1. ... 2. ...") is kept as one sentence; undated bullets are still dropped', () => {
  const t = wikiToText("== Biography ==\nQuinten was born in Wilhoit.\n\nHe married\n# [[Rider-3|Betty Zane Rider]] (17 July 1922 - 3 June 2011) 10 August 1940;<ref>m</ref>\n# Betty Lou (3 April 1931 - 15 October 2000).\n\n* See also\n* Family tree\n== Sources ==\n# Birth record 1919");
  assert.equal(t, 'Quinten was born in Wilhoit.\n\nHe married Betty Zane Rider (17 July 1922 - 3 June 2011) 10 August 1940; Betty Lou (3 April 1931 - 15 October 2000).');
});

test('a spouse already in the cemetery category is a stop even when Plus has not listed them yet', async () => {
  const w = world();
  w[80] = P(80, 'Far-80', 'Quinten', { g: 'Male', Categories: [CEM], Spouses: { 81: { Id: 81, MarriageDate: '1958-09-06' } } });
  w[81] = P(81, 'Far-81', 'Betty', { g: 'Female', Categories: [CEM], BirthDate: '1931-04-03', DeathDate: '2000-10-15', Bio: 'Betty was born in Mulino, Clackamas, Oregon, daughter of Robert Orem and Isabell Strean.' });
  const pack = await buildTourPack({ api: worldApi(w), startId: 'Test-1', mode: 'category', category: CEM, now: NOW, fetchFn: json({ response: { profiles: [80] } }) });
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['Far-80', 'Far-81']);
  assert.match(pack.people.find((p) => p.id === 'Far-81').bio, /^Betty was born in Mulino/);
  assert.equal(pack.people.find((p) => p.id === 'Far-80').family.spouses[0].name, 'Betty Test (1931–2000)');
});

test('fetchPeople carries on past WikiTree\'s "Maximum number of profiles" status when profiles came with it', async () => {
  const pages = [
    ['Maximum number of profiles (1025) reached.', {}, { 1: { Id: 1 }, 2: { Id: 2 } }],
    ['Maximum number of profiles (1025) reached.', {}, { 3: { Id: 3 }, 4: { Id: 4 } }],
    ['', {}, { 5: { Id: 5 } }],
  ];
  const starts = [];
  const api = { getPeople: async (k, f, params) => { starts.push(params.start); return pages[starts.length - 1]; } };
  const got = await fetchPeople({ api, keys: ['Test-1'], fields: ['Id'], params: { nuclear: 7 } });
  assert.deepEqual(Object.keys(got), ['1', '2', '3', '4', '5']);
  assert.deepEqual(starts, [0, PAGE_SIZE, 2 * PAGE_SIZE]);
  // a flagged page with nothing in it is still a refusal
  const refusing = { getPeople: async () => ['Maximum number of profiles (1025) reached.', {}, {}] };
  await assert.rejects(fetchPeople({ api: refusing, keys: ['Test-1'], fields: ['Id'], params: {} }), /Maximum number of profiles/);
});
