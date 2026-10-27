import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offlineReport, mark } from '../src/offline.js';

const caches = (keys, hasIndex = true) => ({ keys: async () => keys, match: async () => (hasIndex ? {} : undefined) });
const nav = (o = {}) => ({ serviceWorker: { controller: {} }, storage: { persisted: async () => false }, ...o });
const READY = { nav: nav(), cacheStorage: caches(['branches-1.2.3']), standalone: true, packs: [{ name: 'Molalla', people: [1, 2, 3] }], gemma: { needed: true, downloaded: true }, version: '1.2.3' };

test('everything in place: the app, a pack and Gemma are ready', async () => {
  const rows = await offlineReport({ ...READY, nav: nav({ storage: { persisted: async () => true } }) });
  assert.deepEqual(rows.map((r) => r.ok), [true, true, true, true, true]);
  assert.match(rows[3].text, /Molalla.*3 people/);
});

test('a browser with no service worker cannot keep the app, and the advice says what to do on an iPhone', async () => {
  const rows = await offlineReport({ ...READY, nav: { storage: {} } });
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].text, /Safari.*Add to Home Screen/);
});

test('the app is only counted as saved when this version is cached and the page is under its control', async () => {
  assert.equal((await offlineReport({ ...READY, cacheStorage: caches(['branches-0.0.1']) }))[0].ok, false);
  assert.equal((await offlineReport({ ...READY, cacheStorage: caches(['branches-1.2.3'], false) }))[0].ok, false);
  const uncontrolled = await offlineReport({ ...READY, nav: nav({ serviceWorker: { controller: null } }) });
  assert.equal(uncontrolled[0].ok, false);
  assert.match(uncontrolled[0].text, /Reload once/);
});

test('no pack, or Gemma not downloaded, fail the check; an unpromised storage or a browser tab only warn', async () => {
  const rows = await offlineReport({ ...READY, standalone: false, packs: [], gemma: { needed: true, downloaded: false } });
  assert.deepEqual(rows.map((r) => r.ok), [true, null, null, false, false]);
  const plain = await offlineReport({ ...READY, gemma: { needed: false, downloaded: false } });
  assert.equal(plain[4].ok, null);
});

test('marks', () => assert.deepEqual([true, false, null].map(mark), ['✓', '✗', '•']));

test('the service worker gives up on a slow network after a few seconds and uses its saved copy', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /NETWORK_WAIT_MS = \d+/);
  assert.match(sw, /Promise\.race\(\[net,/);
});
