import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, isGrounded, buildPrompt, templateNarration } from '../src/narrate.js';
import { nearestPlaces, formatDistance } from '../src/geo.js';
import { geocodePack } from '../src/geocode.js';

const person = { id: 'S-1', name: 'Ada Sample', gender: 'Female',
  birth: { date: '1850-03-02', place: 'Raton, New Mexico' },
  death: { date: '1921-07-09', place: 'Raton, New Mexico' }, categories: [] };
const place = { kind: 'cemetery', name: 'Fairmont Cemetery, Raton, New Mexico' };
const reply = (response, ok = true, status = 200) => async () => ({ ok, status, json: async () => ({ response }) });

test('prompt carries facts and the no-invention rule', () => {
  const p = buildPrompt(person, place);
  assert.match(p, /Ada Sample/);
  assert.match(p, /ONLY the facts/);
});

test('template narration uses only recorded facts', () => {
  const t = templateNarration(person, place);
  assert.match(t, /1850/); assert.match(t, /1921/); assert.match(t, /Fairmont Cemetery/);
});

test('grounding guard rejects invented years', () => {
  assert.ok(isGrounded('She lived from 1850 to 1921.', person, place));
  assert.ok(!isGrounded('She fought in 1861.', person, place));
});

test('narrate: model reply used when grounded', async () => {
  const r = await narrate(person, place, { useModel: true }, reply('Ada Sample rests here in Raton. She was born in 1850 and she lived there until 1921.'));
  assert.equal(r.source, 'gemma3 via Ollama');
});
test('narrate: falls back on invented year, bad status, network error, or model off', async () => {
  assert.equal((await narrate(person, place, { useModel: true }, reply('In 1861 she wept.'))).source, 'template');
  assert.equal((await narrate(person, place, { useModel: true }, reply('', false, 500))).source, 'template');
  assert.equal((await narrate(person, place, { useModel: true }, async () => { throw new Error('x'); })).source, 'template');
  assert.equal((await narrate(person, place, {})).source, 'template');
});

test('nearestPlaces sorts and skips unlocated', () => {
  const near = nearestPlaces({ lat: 36.9, lng: -104.4 }, [
    { name: 'far', lat: 40, lng: -105 }, { name: 'near', lat: 36.91, lng: -104.41 }, { name: 'none', lat: null, lng: null }]);
  assert.deepEqual(near.map((n) => n.place.name), ['near', 'far']);
  assert.match(formatDistance(near[0].meters), /m$|km$/);
});

test('geocodePack falls back to town for a missing cemetery and respects rate limit hook', async () => {
  const pack = { places: [{ kind: 'cemetery', name: 'Nowhere Cemetery, Raton, New Mexico', lat: null, lng: null }] };
  const calls = [];
  const fetchFn = async (url) => { calls.push(url);
    return { ok: true, json: async () => (calls.length === 1 ? [] : [{ lat: '36.9', lon: '-104.4' }]) }; };
  const waits = [];
  const r = await geocodePack(pack, { fetchFn, sleep: async (ms) => waits.push(ms) });
  assert.equal(r.located, 1);
  assert.equal(pack.places[0].approximate, true);
  assert.equal(waits.length, 2);
});

import { bioExcerpt, factsFor } from '../src/narrate.js';
import { wikiTreeUrl } from '../src/pack.js';
import { familyOf } from '../src/builder.js';

test('wikiTreeUrl links real IDs only', () => {
  assert.equal(wikiTreeUrl('Robinson-27225'), 'https://www.wikitree.com/wiki/Robinson-27225');
  assert.match(wikiTreeUrl("D'Allemand-14"), /D'Allemand-14$/);
  assert.equal(wikiTreeUrl('u12345'), '');
  assert.equal(wikiTreeUrl(''), '');
});

test('bioExcerpt keeps whole story sentences, skips birth/death lines and captions', () => {
  const bio = 'Firman Joseph Robinson, son of William, was born on 2 August 1901 in Caledonia, Missouri.\n\nFirman as a baby\n\nHe was the eldest of six sons. On 27 April 1910 the family was living on a rented farm in Belleview Township. He died on 1 October 1991 in Seattle.';
  const t = bioExcerpt(bio);
  assert.match(t, /^He was the eldest of six sons\./);
  assert.match(t, /rented farm/);
  assert.ok(!/was born on/.test(t) && !/baby/.test(t) && !/He died/.test(t));
  assert.ok(t.length <= 380);
  assert.equal(bioExcerpt(''), '');
});

test('template uses parents, marriages and the biography; facts carry them to the model', () => {
  const person = { id: 'S-1', name: 'Ada Sample', gender: 'Female', birth: { date: '1850', place: 'Raton' }, death: { date: '1921', place: 'Raton' },
    family: { parents: ['Walt Sample', 'Edie Sample'], spouses: [{ name: 'Ben Sample', date: '1872-05-01', place: 'Denver, Colorado' }] },
    bio: 'Ada kept bees behind the church and sold honey to the neighbours every summer.' };
  const t = templateNarration(person, { kind: 'cemetery', name: 'Fairmont Cemetery, Raton' });
  assert.match(t, /Daughter of Walt Sample and Edie Sample\./);
  assert.match(t, /Married Ben Sample on 1 May 1872, in Denver, Colorado\./);
  assert.match(t, /Ada kept bees/);
  const f = factsFor(person, null).join('\n');
  assert.match(f, /Parents: Walt Sample and Edie Sample/);
  assert.match(f, /Married: Ben Sample, 1 May 1872, Denver, Colorado/);
});

test('familyOf names public parents and spouse, leaves living ones out but keeps the marriage', () => {
  const people = {
    1: { Id: 1, FirstName: 'Kid', LastNameAtBirth: 'T', Father: 2, Mother: 3, Spouses: { 4: { Id: 4, MarriageDate: '1990-06-00', MarriageLocation: 'Reno' } } },
    2: { Id: 2, FirstName: 'Dad', LastNameAtBirth: 'T', Privacy: 60 },
    3: { Id: 3, FirstName: 'Mom', LastNameAtBirth: 'T', Privacy: 20 },
    4: { Id: 4, FirstName: 'Alive', LastNameAtBirth: 'T', IsLiving: 1, Privacy: 60 },
  };
  const f = familyOf(people[1], people);
  assert.deepEqual(f.parents, ['Dad T']);
  assert.deepEqual(f.spouses, [{ name: '', date: '1990-06', place: 'Reno' }]);
});

import { ungroundedWord, bioForPrompt } from '../src/narrate.js';

const carl = { id: 'R-1', name: 'Carl Robinson', gender: 'Male', birth: { date: '1933-11-13', place: 'Burlington, Iowa' }, death: { date: '2003-04-25', place: 'Longview, Washington' },
  relationship: 'your father', family: { parents: ['Firman Robinson', 'Leona Budd'], spouses: [] },
  bio: 'Carl Robinson was born on 13 November 1933 in Burlington, Iowa.\n\nCarl as a baby\n\nIn 1936 his family moved west to Pacific County with his aunt. He had a sister, Naomi, and a brother, Robert.' };
const cem = { kind: 'cemetery', name: 'Fern Hill Cemetery, Aberdeen, Washington' };

test('guard: the filler Gemma wrote in the field is refused, plain facts pass', () => {
  assert.equal(ungroundedWord("We're here at Fern Hill Cemetery, a peaceful place to reflect. Carl Robinson rests here.", carl, cem), 'peaceful');
  assert.equal(ungroundedWord('He is remembered as a father and part of this community.', carl, cem), 'remembered as');
  assert.equal(ungroundedWord('Carl Robinson rests at Fern Hill Cemetery. He was born in 1933 in Burlington, Iowa, and moved in 1936 with Naomi and Robert.', carl, cem), '');
});

test('guard: invented names and places are refused, sentence starts and possessives are fine', () => {
  assert.equal(ungroundedWord('Carl moved to Boston with his family.', carl, cem), 'Boston');
  assert.equal(ungroundedWord("Carl's sister Naomi was older. Then Robert came along.", carl, cem), '');
  assert.equal(ungroundedWord('Nobody told Carl about Spokane.', carl, cem), 'Spokane');
  assert.equal(ungroundedWord('He sailed in 1999.', carl, cem), '1999');
});

test('prompt: rules, a short biography selection, no raw dump, and the family facts', () => {
  const p = buildPrompt(carl, cem);
  assert.match(p, /Use ONLY the facts below/);
  assert.match(p, /at least two concrete details from "From the biography"/);
  assert.match(p, /Parents: Firman Robinson and Leona Budd/);
  assert.match(p, /From the biography:\nIn 1936 his family moved west/);
  assert.ok(!/Carl as a baby/.test(p) && !/Biography notes/.test(p));
  const noBio = buildPrompt({ ...carl, bio: '' }, cem);
  assert.ok(!/From the biography/.test(noBio) && /born and died/.test(noBio));
  assert.equal(bioForPrompt(''), '');
});

import { humanDate, datePhrase } from '../src/narrate.js';

test('dates read as words, and the month the record implies is allowed', () => {
  assert.equal(humanDate('1933-11-13'), '13 November 1933');
  assert.equal(humanDate('1933-11'), 'November 1933');
  assert.equal(humanDate('1933-00-00'), '1933');
  assert.equal(humanDate('2 August 1901'), '2 August 1901');
  assert.equal(datePhrase('1933-11-13'), ' on 13 November 1933');
  assert.equal(datePhrase('1933'), ' in 1933');
  assert.equal(datePhrase(''), '');
  const full = { ...carl, birth: { date: '1933-11-13', place: 'Burlington, Iowa' } };
  assert.match(factsFor(full, null).join('\n'), /Born: 13 November 1933, in Burlington, Iowa/);
  // Gemma wrote "November" in the field; the record's full date supports it
  assert.equal(ungroundedWord('Carl was born on November 13th in Burlington, Iowa.', full, cem), '');
  // a month the record does not imply is an invention
  assert.equal(ungroundedWord('Carl was born in March in Burlington, Iowa.', full, cem), 'March');
  assert.equal(ungroundedWord('Carl was born in November in Burlington, Iowa.', { ...carl, bio: '', birth: { date: '1933', place: 'Burlington, Iowa' } }, cem), 'November');
});

test('guard: a count of children or siblings must come from the record', () => {
  // from the field: Gemma turned "your father" into a count
  assert.equal(ungroundedWord('Carl Robinson rests here. He was a father to one child.', carl, cem), 'one child');
  assert.equal(ungroundedWord('Carl had two sisters.', carl, cem), 'two sisters');
  const withCount = { ...carl, bio: 'Carl was the second of three children born to Firman and Leona. He farmed.' };
  assert.equal(ungroundedWord('Carl was the second of three children.', withCount, cem), '');
  assert.match(buildPrompt(carl, cem), /Relationship to the visitor: the visitor's father/);
  assert.match(buildPrompt(carl, cem), /how many children, siblings/);
});

test('guard: ordinary capitalised words after a colon, quote, dash or new line are not names (the "Let" false alarm)', () => {
  assert.equal(ungroundedWord("Here's a short story about Carl Robinson:\n\nLet us remember him. Carl was born in Burlington, Iowa.", carl, cem), '');
  assert.equal(ungroundedWord('Carl Robinson rests at Fern Hill Cemetery. "Let it be said that he was born in Burlington, Iowa."', carl, cem), '');
  assert.equal(ungroundedWord('Carl Robinson rests here — Let us stand a moment. He was born in Burlington, Iowa.', carl, cem), '');
  assert.equal(ungroundedWord('* Carl Robinson was born in 1933.\n* Then he moved to Pacific County.', carl, cem), '');
});

test('guard: an invented name or place is still caught mid-sentence, even after a preamble', () => {
  assert.equal(ungroundedWord("Here's his story:\n\nCarl moved to Boston with his family.", carl, cem), 'Boston');
  assert.equal(ungroundedWord('Carl was born in Burlington, Iowa. He later worked for Boeing.', carl, cem), 'Boeing');
});

test('a refused story keeps what the model wrote, for the member to see', async () => {
  const gen = async () => 'Carl Robinson rests here. He was a quiet and peaceful man.';
  const r = await narrate(carl, cem, { engine: 'browser' }, fetch, gen);
  assert.equal(r.source, 'template');
  assert.match(r.reason, /peaceful/);
  assert.equal(r.attempt, 'Carl Robinson rests here. He was a quiet and peaceful man.');
  const ok = await narrate(carl, cem, { engine: 'browser' }, fetch, async () => 'Carl Robinson rests at Fern Hill Cemetery in Aberdeen, Washington, where he was buried after he died in 2003.');
  assert.equal(ok.attempt, undefined);
});

test('a distance limit: miles or km, only places inside it, and the nearest one when nothing is', async () => {
  const { placesWithin, radiusMeters, defaultUnit, formatDistance: fmt } = await import('../src/geo.js');
  const here = { lat: 45.0, lng: -122.0 };
  const places = [
    { key: 'a', name: 'A', lat: 45.0, lng: -122.05 },   // about 4 km
    { key: 'b', name: 'B', lat: 45.3, lng: -122.0 },    // about 33 km
    { key: 'c', name: 'C', lat: null, lng: null },
  ];
  assert.equal(Math.round(radiusMeters('10', 'mi')), 16093);
  assert.equal(radiusMeters('', 'mi'), null); assert.equal(radiusMeters('-5', 'km'), null); assert.equal(radiusMeters('abc', 'km'), null); assert.equal(radiusMeters('5', 'furlongs'), null);
  const w = placesWithin(here, places, radiusMeters(10, 'km'));
  assert.deepEqual(w.inside.map((r) => r.place.key), ['a']);
  assert.equal(w.unlocated, 1);
  const none = placesWithin(here, places, radiusMeters(1, 'km'));
  assert.deepEqual([none.inside.length, none.nearest.place.key], [0, 'a']);
  assert.equal(placesWithin(here, places, radiusMeters(100, 'km')).inside.length, 2);
  assert.equal(fmt(16093, 'mi'), '10 mi'); assert.equal(fmt(2414, 'mi'), '1.5 mi'); assert.equal(fmt(100, 'mi'), '330 ft'); assert.equal(fmt(4000), '4.0 km');
  assert.equal(defaultUnit('en-US'), 'mi'); assert.equal(defaultUnit('en-GB'), 'mi'); assert.equal(defaultUnit('fr-FR'), 'km'); assert.equal(defaultUnit(''), 'km');
});

test('the plain story does not say a marriage twice, but keeps a list of marriages that names someone without a profile', () => {
  const joanna = { id: 'Barstow-803', name: 'Joanna Aileen Barstow', gender: 'Female', birth: { date: '1863-06-25', place: 'Stafford, Oregon' }, death: { date: '1962-01-08', place: 'Molalla, Oregon' },
    family: { parents: [], spouses: [{ name: 'William Milton Bird (1860–1942)', date: '1881', place: 'Oregon, United States' }] },
    bio: 'Joanna was a farm wife who raised six children near Molalla in a house her husband built. She married WIlliam Milton Bird in 1881. She married William Milton Bird in 1881.' };
  const t = templateNarration(joanna, { kind: 'cemetery', name: 'Molalla Memorial Cemetery, Molalla, Oregon' });
  assert.equal((t.match(/married William Milton Bird/gi) || []).length, 1, t);   // the misspelt copy is a different name, so it is the one that is left
  assert.match(t, /farm wife who raised six children/);
  const quinten = { id: 'Wyland-1', name: 'Quinten Wyland', gender: 'Male', birth: { date: '1919' }, death: { date: '2005' },
    family: { parents: [], spouses: [{ name: 'Betty Zane Rider (1922–2011)', date: '1940-08-06', place: 'Clark, Washington' }] },
    bio: 'He married Betty Zane Rider (17 July 1922 - 3 June 2011) 10 August 1940; Betty Lou (3 April 1931 - 15 October 2000).' };
  assert.match(templateNarration(quinten, null), /Betty Lou \(3 April 1931/);
});

test('a count the record states in digits may be written in words, and the other way round; a count it does not state is still refused', () => {
  const margaret = { id: 'Bagby-165', name: 'Margaret Luella Bagby', gender: 'Female', birth: { date: '1855-11-06', place: 'Molalla, Oregon' }, death: { date: '1948-06-28', place: 'Clackamas, Oregon' },
    bio: 'In 1860, 4 year old Margaret was one of 6 children living on the family farm at Molalla with parents William and Harriet.' };
  const cem = { kind: 'cemetery', name: 'Molalla Memorial Cemetery, Molalla, Oregon' };
  assert.equal(ungroundedWord('Margaret Luella Bagby was one of six children on a farm at Molalla.', margaret, cem), '');
  assert.equal(ungroundedWord('Margaret Luella Bagby grew up with 6 children around her at Molalla.', margaret, cem), '');
  assert.match(ungroundedWord('Margaret Luella Bagby was one of seven children on a farm at Molalla.', margaret, cem), /seven children/);
  const wordy = { ...margaret, bio: 'Margaret was one of six children on the farm at Molalla.' };
  assert.equal(ungroundedWord('Margaret Luella Bagby was one of 6 children at Molalla.', wordy, cem), '');
});
