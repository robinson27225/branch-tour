import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionOf, distanceToBox, geocodeRegion, limitToNearby } from '../src/nearby.js';
import { buildPack } from '../src/pack.js';

test('regionOf names the state or country a place is in', () => {
  assert.equal(regionOf('Molalla, Clackamas, Oregon, United States'), 'Oregon, United States');
  assert.equal(regionOf('Molalla Memorial Cemetery, Molalla, Oregon'), 'Oregon');
  assert.equal(regionOf('Leeds, Yorkshire, England'), 'England');
  assert.equal(regionOf('Oregon'), 'Oregon');
  assert.equal(regionOf(''), '');
});

test('distanceToBox is zero inside and the distance to the nearest edge outside', () => {
  const box = { s: 42, n: 46, w: -124, e: -117 };
  assert.equal(distanceToBox({ lat: 45, lng: -122 }, box), 0);
  const d = distanceToBox({ lat: 47, lng: -122 }, box);                  // one degree north of the box: about 111 km
  assert.ok(d > 110000 && d < 112000, String(d));
});

// A tiny map: each query is answered from this table, and every request is logged.
const MAP = {
  'Oregon, United States': { boundingbox: ['42', '46.3', '-124.6', '-116.4'], lat: '44', lon: '-120.5' },
  'Texas, United States': { boundingbox: ['25.8', '36.5', '-106.6', '-93.5'], lat: '31', lon: '-100' },
  'Washington, United States': { boundingbox: ['45.5', '49', '-124.8', '-116.9'], lat: '47.4', lon: '-120.7' },
  'Molalla Memorial Cemetery, Molalla, Oregon': { lat: '45.12', lon: '-122.58' },
  'Salem, Marion, Oregon, United States': { lat: '44.94', lon: '-123.03' },
  'Eugene, Lane, Oregon, United States': { lat: '44.05', lon: '-123.09' },
  'Seattle, King, Washington, United States': { lat: '47.6', lon: '-122.3' },
  'Dallas, Dallas, Texas, United States': { lat: '32.8', lon: '-96.8' },
};
const stubMap = (log) => async (url) => {
  const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)[1]); log.push(q);
  const hit = MAP[q];
  return { ok: true, json: async () => (hit ? [hit] : []) };
};
const person = (id, place) => ({ id, name: id, gender: '', birth: { date: '1850', place: '' }, death: { date: '1920', place }, categories: [] });
const packOf = () => buildPack([
  person('A-1', 'Salem, Marion, Oregon, United States'), person('A-2', 'Salem, Marion, Oregon, United States'),
  person('B-1', 'Eugene, Lane, Oregon, United States'),
  person('C-1', 'Seattle, King, Washington, United States'),
  person('D-1', 'Dallas, Dallas, Texas, United States'),
  { ...person('E-1', ''), categories: ['Molalla_Memorial_Cemetery,_Molalla,_Oregon'], cemeteryCategories: ['Molalla_Memorial_Cemetery,_Molalla,_Oregon'] },
], { name: 'T', now: new Date('2026-10-27') });

test('limitToNearby looks up regions first, skips far ones whole, and keeps only people in reach', async () => {
  const log = [];
  const pack = packOf();
  const info = await limitToNearby(pack, { center: { lat: 45.1, lng: -122.6 }, radiusMeters: 90000, fetchFn: stubMap(log), delayMs: 0, sleep: async () => {} });
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['A-1', 'A-2', 'E-1']);          // Salem (about 70 km) and the cemetery; Eugene is about 130 km
  assert.ok(!log.some((q) => /Dallas/.test(q)), 'Texas is out of reach, so Dallas is never looked up');
  assert.ok(log.includes('Texas, United States'));
  assert.equal(info.farRegions, 1);
  assert.equal(pack.stats.people, 3);
  assert.equal(pack.stats.nearby.peopleBefore, 6);
  assert.ok(pack.places.every((pl) => pl.lat !== null));
});

test('a larger distance keeps more, and a place the map cannot find is left out', async () => {
  const log = [];
  const pack = packOf();
  pack.places.push({ key: 'town:nowhere', kind: 'town', name: 'Nowhereville, Oregon, United States', lat: null, lng: null, personIds: ['X-1'] });
  pack.people.push(person('X-1', 'Nowhereville, Oregon, United States'));
  await limitToNearby(pack, { center: { lat: 45.1, lng: -122.6 }, radiusMeters: 300000, fetchFn: stubMap(log), delayMs: 0, sleep: async () => {} });
  assert.deepEqual(pack.people.map((p) => p.id).sort(), ['A-1', 'A-2', 'B-1', 'C-1', 'E-1']);   // Seattle is about 230 km; Texas is not
});

test('when a region cannot be looked up it is kept, not dropped', async () => {
  const pack = packOf();
  const fetchFn = async (url) => { if (/Texas/.test(decodeURIComponent(url))) throw new TypeError('offline'); return stubMap([])(url); };
  await limitToNearby(pack, { center: { lat: 45.1, lng: -122.6 }, radiusMeters: 90000, fetchFn, delayMs: 0, sleep: async () => {} });
  assert.ok(!pack.people.some((p) => p.id === 'D-1'));        // Dallas was looked up (region unknown) and is far
  assert.equal(pack.stats.nearby.farRegions, 0);
});

test('geocodeRegion reads the bounding box', async () => {
  assert.deepEqual(await geocodeRegion('Oregon, United States', stubMap([])), { s: 42, n: 46.3, w: -124.6, e: -116.4 });
  assert.equal(await geocodeRegion('Nowhere', stubMap([])), null);
});
