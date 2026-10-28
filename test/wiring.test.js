import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const app = read('app.js');
const html = read('index.html');

test('every element app.js looks up by id exists in the page (or is made by app.js)', () => {
  const used = [...new Set([...app.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) => !html.includes(`id="${id}"`) && !app.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('the build form and its mode switching are wired up', () => {
  assert.match(app, /\$\('buildForm'\)\.addEventListener\('submit'/);
  assert.match(app, /function syncMode\(\)/);
  assert.match(app, /\$\('buildForm'\)\.addEventListener\('change', syncMode\)/);
  assert.match(app, /^syncMode\(\);$/m);
  assert.match(app, /function reachNote\(/);
});

test('the other tabs are wired up too', () => {
  for (const needle of ["$('file').addEventListener('change'", "$('startTour').addEventListener('click'", "$('demo').addEventListener('click'",
    "$('checkOllama').addEventListener('click'", "$('dlModel').addEventListener('click'", "$('testVoice').addEventListener('click'"]) {
    assert.ok(app.includes(needle), needle);
  }
});

test('the hidden attribute really hides, even on elements our CSS gives a display', () => {
  assert.match(read('styles.css'), /\[hidden\]\{display:none\s*!important\}/);
  assert.match(app, /window\.addEventListener\('pageshow', syncMode\)/);
});

test('every source file is in the offline cache list, so the app opens with no signal', () => {
  const sw = read('sw.js');
  const files = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const missing = files.filter((f) => !sw.includes(`'src/${f}'`));
  assert.deepEqual(missing, []);
});

test('a story offers the photo upload for the profile', () => {
  assert.match(app, /function photoPrompt\(/);
  assert.match(app, /\$\{photoPrompt\(person\)\}/);
});

test('the distance limit on the tour list is wired up', () => {
  assert.match(app, /\$\('tour'\)\.addEventListener\('change'/);
  assert.match(app, /placesWithin\(/);
  assert.match(app, /id="radius"/);
});

test('"only people near a place" is on the build form and applied when the pack is built', () => {
  for (const id of ['nearOn', 'nearN', 'nearUnit', 'nearWhere', 'nearPlace']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(app, /await nearTarget\(\)/);
  assert.match(app, /await finish\(pack, reachNote\(pack\), near\)/);
  assert.match(app, /limitToNearby\(/);
  assert.match(read('sw.js'), /src\/nearby\.js/);
});

test('a place lists its people in the chosen order, with a selector', () => {
  assert.match(app, /sortPeople\(/);
  assert.match(app, /id="sortBy"/);
  assert.match(app, /e\.target\.id === 'sortBy'/);
  assert.match(read('sw.js'), /src\/sort\.js/);
});

test('sound is unlocked inside the tap, and every clip plays through the one unlocked player', () => {
  assert.match(app, /const player = new Audio\(\)/);
  assert.match(app, /unlockAudio\(\); \/\/ inside the tap, before anything is awaited/);
  assert.match(app, /player\.src = state\.audioUrl/);
  assert.ok(!/<audio id="player"/.test(app), 'a fresh <audio> element per story is never unlocked on an iPhone');
});

test('the offline check and the Gemma crash note are wired up', () => {
  assert.match(app, /\$\('offlineCheck'\)\.addEventListener\('click'/);
  assert.ok(html.includes('id="offlineOut"'));
  assert.match(app, /offlineReport\(/);
  assert.match(app, /guardedLoad\(/);
  assert.ok(!/await loadModel\(/.test(app.replace(/async function guardedLoad[\s\S]*?\n}\n/, '')), 'every Gemma load goes through the crash note');
  assert.match(read('sw.js'), /src\/offline\.js/);
});

test('a place can be positioned by hand, and extra profiles can be named on the build form', () => {
  assert.ok(html.includes('id="extraIds"'));
  assert.match(app, /extraIds: parseProfileIds\(/);
  assert.match(app, /e\.target\.id === 'posSet'/);
  assert.match(app, /e\.target\.id === 'posGps'/);
  assert.match(app, /setPlacePosition\(/);
});

test('Gemma pauses itself after the page closes on it, and stories can be written, saved and loaded', () => {
  assert.match(app, /const PAUSED_KEY = /);
  assert.match(app, /\$\('resumeGemma'\)\.addEventListener\('click'/);
  assert.ok(html.includes('id="pausedNote"') && html.includes('id="resumeGemma"'));
  assert.match(app, /^showPaused\(\);$/m);
  assert.match(app, /e\.target\.id === 'writeAll'/);
  assert.match(app, /e\.target\.id === 'saveStories'/);
  assert.match(app, /e\.target\.id === 'loadStories'/);
  assert.match(read('sw.js'), /src\/stories\.js/);
});
