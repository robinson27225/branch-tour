import { parseDelimited, detectDelimiter, rowsToObjects, buildPack, parsePlusJsonIds, filterByUserIds, personById, wikiTreeUrl, uploadPhotoUrl } from './src/pack.js';
import { readXlsxRows } from './src/xlsx.js';
import { isReportJson, reportToPack } from './src/report.js';
import { parseConnectionsHtml, addConnections } from './src/connections.js';
import { geocodePack } from './src/geocode.js';
import { nearestPlaces, placesWithin, radiusMeters, defaultUnit, formatDistance, parseCoordinates } from './src/geo.js';
import { limitToNearby } from './src/nearby.js';
import { SORTS, DEFAULT_SORT, sortPeople } from './src/sort.js';
import { offlineReport, mark } from './src/offline.js';
import { exportStories, importStories } from './src/stories.js';
import { geocodeName } from './src/geocode.js';
import { narrate, templateNarration, engineOf, ungroundedWord, DEFAULT_SETTINGS } from './src/narrate.js';
import { BROWSER_MODELS, webGpuAvailable, isDownloaded, loadModel, isLoaded, generatorFor, removeModel, friendlyLoadError } from './src/webllm.js';
import { checkOllama, describeOllama, pullCommand, serveCommand } from './src/ollama.js';
import { buildTourPack, makeApi, parseProfileIds } from './src/builder.js';
import { VERSION, OWNER_ID, HELP_URL } from './src/version.js';
import { MediaStore, getClip, hasClip, storyKey, VOICE_DEFAULTS, VOICE_SUGGESTIONS } from './src/voice.js';
import { savePack, listPacks, deletePack, loadSettings, saveSettings } from './src/store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const media = new MediaStore();
// A WikiTree ID that opens the profile on WikiTree (new tab). Plain text when there is no real ID.
const wtLink = (id) => { const u = wikiTreeUrl(id); return u ? `<a class="wt" href="${esc(u)}" target="_blank" rel="noopener">${esc(id)} ↗</a>` : esc(id); };
const state = { packs: [], packName: null, pos: null, placeKey: null, idFilter: null, settings: { ...DEFAULT_SETTINGS, ...loadSettings() } };
if (state.settings.speak && !state.settings.voice) state.settings.voice = 'browser';
state.settings.engine = engineOf(state.settings);
state.settings.useModel = state.settings.engine !== 'template';
const currentPack = () => state.packs.find((p) => p.name === state.packName) || state.packs[0];

// ---------- views ----------
function show(view) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== view;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.view === view);
  if (view === 'tour') renderTour();
}
document.querySelector('nav').addEventListener('click', (e) => e.target.dataset.view && show(e.target.dataset.view));

// ---------- packs ----------
async function refreshPacks() {
  state.packs = await listPacks();
  $('packList').innerHTML = state.packs.length
    ? state.packs.map((p) => `<li data-pack="${esc(p.name)}"><span>${esc(p.name)}<small>${p.stats.people} people · ${p.places.length} places${p.places.some((x) => x.lat === null) ? ' · some not located' : ''}</small></span><span class="acts"><button class="go" data-start="${esc(p.name)}">Start tour</button><button data-del="${esc(p.name)}">Delete</button></span></li>`).join('')
    : '<li>No packs yet.</li>';
}
$('packList').addEventListener('click', async (e) => {
  if (e.target.dataset.del) {
    if (confirm(`Delete "${e.target.dataset.del}" from this device?`)) { await deletePack(e.target.dataset.del); await refreshPacks(); }
    return;
  }
  const li = e.target.closest('li[data-pack]');
  if (li) { state.packName = li.dataset.pack; state.placeKey = null; show('tour'); }
});

// One place for messages. The banner is pinned to the top of the screen so a long build is never out of sight.
function status(text, { pct = null, done = false, error = false } = {}) {
  $('progress').hidden = false;
  $('progress').classList.toggle('error', error);
  $('statusText').textContent = text;
  $('bar').hidden = pct === null;
  if (pct !== null) $('bar').value = pct;
  $('startTour').hidden = !done;
}
$('startTour').addEventListener('click', () => { state.placeKey = null; show('tour'); });

async function readRows(file) {
  if (/\.xlsx$/i.test(file.name)) return readXlsxRows(await file.arrayBuffer());
  const text = await file.text();
  return parseDelimited(text, detectDelimiter(text));
}

$('file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  try {
    const packName = $('packName').value.trim() || 'Tour pack';
    let pack = null, moreNote = '';
    const isHtml = (f) => /\.html?$/i.test(f.name);
    const file = files.find((f) => !isHtml(f));

    if (file && /\.json$/i.test(file.name)) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (isReportJson(parsed)) pack = reportToPack(parsed, { name: packName });
      else {
        state.idFilter = parsePlusJsonIds(text);
        return status(`Got ${state.idFilter.length} profile IDs. Now drop the matching Excel or CSV file.`);
      }
    } else if (file) {
      status('Reading…');
      let records = rowsToObjects(await readRows(file));
      if (state.idFilter) { records = filterByUserIds(records, state.idFilter); state.idFilter = null; }
      pack = buildPack(records, { name: packName, source: file.name });
    }

    // Saved WikiTree My Connections pages (one per "Next" click) go on top of
    // whatever was just read, or into an existing pack of the same name.
    const htmlFiles = files.filter(isHtml);
    if (htmlFiles.length) {
      if (!pack) pack = state.packs.find((p) => p.name === packName) || null;
      for (const f of htmlFiles) {
        const parsed = parseConnectionsHtml(await f.text());
        pack = addConnections(pack, parsed);
        pack.name = packName;
        if (parsed.next) moreNote = ' WikiTree shows a Next button on that page, so more profiles may be waiting: save the next page too.';
      }
    }
    if (!pack || !pack.people.length) return status('No usable people found. Is the first row a header with "WikiTree ID"?');
    await finish(pack, moreNote);
  } catch (err) { status('Could not read that file: ' + err.message, { error: true }); }
});

// Locate places (if asked), save the pack on this device and report what it holds.
// `near` ({ center, meters, label }) keeps only the people within that distance, which needs the places located.
async function finish(pack, note = '', near = null) {
  if (near) {
    const unit = $('nearUnit').value;
    const info = await limitToNearby(pack, {
      center: near.center, radiusMeters: near.meters,
      onProgress: (u) => u.stage === 'regions'
        ? status(`Checking which regions are in reach: ${u.done} of ${u.total}\n${u.region || ''}`, { pct: Math.round((u.done / u.total) * 100) })
        : status(`Finding places on the map: ${u.done} of ${u.total}\n${u.place}`, { pct: Math.round((u.done / u.total) * 100) }),
    });
    if (!pack.people.length) return status(`Nobody in this pack rests within ${$('nearN').value} ${unit} of ${near.label}, so nothing was saved. Try a larger distance.`, { error: true });
    note += ` Kept ${pack.people.length} of ${info.peopleBefore} people, those within ${$('nearN').value} ${unit} of ${near.label}.`;
  } else if ($('doGeocode').checked) {
    await geocodePack(pack, { onProgress: (d, n, p) => status(`Finding cemeteries on the map: ${d} of ${n}\n${p.name}`, { pct: Math.round((d / n) * 100) }) });
  }
  await savePack(pack);
  await refreshPacks();
  state.packName = pack.name;
  const s = pack.stats;
  const unplaced = pack.places.filter((p) => p.lat === null).length;
  status(`Ready: ${s.people} ${s.people === 1 ? 'person' : 'people'} at ${pack.places.length} ${pack.places.length === 1 ? 'place' : 'places'}${s.withBio !== undefined ? `, ${s.withBio} with biographies` : ''}${unplaced ? ` (${unplaced} not found on the map)` : ''}. Left out ${s.excludedLiving} who may be living${s.hidden ? ` and ${s.hidden} private or hidden profiles` : ''}.${note}`, { done: true });
}

// ---------- build from WikiTree ----------
// Says how far out the build got, and why it stopped if WikiTree's limit did.
// Standing at the stone is the moment to photograph it, so offer WikiTree's own upload page for this profile.
function photoPrompt(person) {
  const u = uploadPhotoUrl(person.userId);
  return u ? `<p class="src photo">Photographed the stone? <a href="${esc(u)}" target="_blank" rel="noopener">Add it to ${esc(person.name)}'s WikiTree profile ↗</a></p>` : '';
}

function reachNote(pack) {
  const c = pack.stats.category;
  if (c) {
    const k = pack.stats.kinship;
    return ` Found ${c.found} profiles in the category${c.used ? `, which WikiTree lists as "${c.used.replace(/_/g, ' ')}"` : ''}.` +
      (k ? ` Named how ${k.related} of ${k.members} are related to you; the rest share no ancestor with you within reach, or are related by marriage.` : '') +
      (c.coordinate ? ' The cemetery\'s position came from its category page.' : '');
  }
  const r = pack.stats.reach;
  if (!r) return '';
  const deg = (n) => `${n} degree${n === 1 ? '' : 's'}`;
  if (r.capped) return ` Went out ${deg(r.degrees)} (${r.profiles.toLocaleString()} relatives): WikiTree would not return the next degree.`;
  if (r.degrees < r.asked) return ` Your family does not reach further than ${deg(r.degrees)}.`;
  return ` Went out ${deg(r.degrees)}.`;
}

const modeOf = () => document.querySelector('input[name=mode]:checked').value;
function syncMode() {
  $('gensRow').hidden = modeOf() !== 'ancestors';
  $('catRow').hidden = modeOf() !== 'category';
  $('extraRow').hidden = modeOf() !== 'category';
  $('degRow').hidden = modeOf() !== 'cc7';
}
$('buildForm').addEventListener('change', syncMode);

// "Only people near a place": the number, the unit and the centre (GPS, or a place name looked up on the map).
$('nearN').value = state.settings.nearN || '25';
$('nearUnit').value = state.settings.radiusUnit || defaultUnit(navigator.language);
function syncNear() {
  $('nearRow').hidden = !$('nearOn').checked;
  $('nearPlace').hidden = $('nearWhere').value !== 'place';
}
$('buildForm').addEventListener('change', (e) => {
  if (e.target.id === 'nearN' || e.target.id === 'nearUnit') {
    if (e.target.id === 'nearN') state.settings.nearN = $('nearN').value; else state.settings.radiusUnit = $('nearUnit').value;
    saveSettings(state.settings);
  }
  syncNear();
});
syncNear();

async function nearTarget() {
  const meters = radiusMeters($('nearN').value, $('nearUnit').value);
  if (!meters) throw new Error('Enter a distance for "Only people near a place", for example 25.');
  if ($('nearWhere').value === 'place') {
    const name = $('nearPlace').value.trim();
    if (!name) throw new Error('Type the place to stay near, for example Molalla, Oregon.');
    status('Finding that place on the map…');
    const hit = await geocodeName(name);
    if (!hit) throw new Error(`Could not find "${name}" on the map. Try adding the state or country.`);
    return { center: hit, meters, label: name };
  }
  if (!navigator.geolocation) throw new Error('This browser has no GPS access. Choose "a place I type" instead.');
  status('Getting your location…');
  const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, (err) => fail(new Error('Could not get your location: ' + err.message + '. Choose "a place I type" instead.')), { timeout: 20000 }));
  return { center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, meters, label: 'your location' };
}
$('startId').value = state.settings.startId || '';

$('buildForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const startId = $('startId').value.trim();
  state.settings.startId = startId;
  saveSettings(state.settings);
  $('buildBtn').disabled = true;
  $('buildBtn').textContent = 'Building…';
  try {
    window.scrollTo({ top: 0 });
    const near = $('nearOn').checked ? await nearTarget() : null;
    status('Contacting WikiTree…', { pct: 0 });
    const pack = await buildTourPack({
      api: makeApi(), startId, mode: modeOf(), generations: Number($('gens').value), maxDegree: Number($('degrees').value),
      category: $('category').value, extraIds: parseProfileIds($('extraIds').value), onProgress: status,
    });
    if (!pack.people.length) return status('WikiTree returned no public, deceased profiles for that choice.', { error: true });
    await finish(pack, reachNote(pack), near);
  } catch (err) { status(err.message, { error: true }); }
  finally { $('buildBtn').disabled = false; $('buildBtn').textContent = 'Build my tour pack'; }
});
syncMode();
window.addEventListener('pageshow', syncMode);
window.addEventListener('load', syncMode);

// ---------- footer ----------
$('ver').textContent = 'v' + VERSION;
$('help').href = HELP_URL;
$('owner').textContent = OWNER_ID;
$('owner').href = 'https://www.wikitree.com/wiki/' + OWNER_ID;

$('demo').addEventListener('click', async () => {
  await savePack(await (await fetch('sample-pack.json')).json());
  await refreshPacks();
  status('Sample pack added.');
});

// ---------- tour ----------
function renderTour() {
  const pack = currentPack();
  const el = $('tour');
  if (!pack) { el.innerHTML = '<p>No tour pack yet. Open <b>Packs</b> to build one.</p>'; return; }
  const place = pack.places.find((p) => p.key === state.placeKey);
  if (place) return renderPlace(pack, place);

  const located = pack.places.filter((p) => p.lat !== null);
  const unit = state.settings.radiusUnit || defaultUnit(navigator.language);
  const limit = radiusMeters(state.settings.radius, unit);
  let rows = pack.places.map((p) => ({ place: p, meters: null })), note = 'Not using GPS yet. Showing all places, largest first.';
  if (state.pos && limit) {
    const w = placesWithin(state.pos, located, limit);
    rows = w.inside;
    const left = w.unlocated ? ` ${w.unlocated} place${w.unlocated === 1 ? ' has' : 's have'} no map position and ${w.unlocated === 1 ? 'is' : 'are'} left out.` : '';
    note = rows.length
      ? `${rows.length} place${rows.length === 1 ? '' : 's'} within ${state.settings.radius} ${unit}, nearest first.${left}`
      : `Nothing within ${state.settings.radius} ${unit}.${w.nearest ? ` The nearest is ${w.nearest.place.name}, ${formatDistance(w.nearest.meters, unit)} away.` : ''}${left}`;
  } else if (state.pos) {
    rows = nearestPlaces(state.pos, located, 8);
    note = 'Nearest first.';
  } else if (limit) note = `Press the button to use GPS, then only places within ${state.settings.radius} ${unit} show.`;
  const radius = `<p class="radius"><label>Only within <input id="radius" type="number" min="1" step="any" inputmode="decimal" placeholder="any distance" value="${esc(state.settings.radius || '')}"></label>
    <select id="radiusUnit" aria-label="Distance unit"><option value="mi"${unit === 'mi' ? ' selected' : ''}>miles</option><option value="km"${unit === 'km' ? ' selected' : ''}>km</option></select> of me</p>`;
  el.innerHTML = `<h2>${esc(pack.name)}</h2>
    <button class="go" id="locate">${state.pos ? 'Update my location' : 'Find cemeteries near me'}</button>${radius}
    <p class="hint">${esc(note)}</p>
    <ul class="list">${rows.map(({ place: p, meters }) => `<li data-place="${esc(p.key)}"><span>${esc(p.name)}<small>${p.personIds.length} people${p.approximate ? ' · approximate spot' : ''}</small></span><small>${meters === null ? '' : formatDistance(meters, unit)}</small></li>`).join('')}</ul>`;
}

function renderPlace(pack, place) {
  const prep = state.settings.voice === 'eleven'
    ? `<button id="prepare" class="go">Prepare this cemetery for offline listening</button><p id="prep" class="hint" role="status"></p>` : '';
  const by = SORTS.some((x) => x.id === state.settings.sort) ? state.settings.sort : DEFAULT_SORT;
  const people = sortPeople(place.personIds.map((id) => personById(pack, id)), by);
  const sorter = `<p class="radius"><label>Sort by <select id="sortBy">${SORTS.map((x) => `<option value="${x.id}"${x.id === by ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label></p>`;
  const where = place.lat === null ? 'not on the map' : place.approximate ? 'approximate' : `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  const position = `<details class="panel"><summary>Where this place is (${esc(where)})</summary>
    <label>Latitude and longitude <input id="posInput" placeholder="45.120541, -122.590745" autocomplete="off"></label>
    <button type="button" id="posSet">Set it</button> <button type="button" id="posGps">Use my location</button>
    <p class="hint" id="posMsg" role="status">Paste the coordinates from a map app or from WikiTree's category page, or stand at the gate and use your location.</p></details>`;
  const offline = `<details class="panel"><summary>Stories for no signal</summary>
    <button type="button" id="writeAll">Write every story now</button>
    <button type="button" id="saveStories">Save stories to a file</button>
    <label>Load stories from a file <input type="file" id="loadStories" accept=".json,application/json"></label>
    <p class="hint" id="storiesMsg" role="status">Write them where Gemma works best (a laptop with Ollama), save the file, and load it on the phone. Each story is checked against the record again before it is used.</p></details>`;
  $('tour').innerHTML = `<button id="back">← All places</button><h2>${esc(place.name)}</h2>${prep}${position}${offline}${sorter}
    <ul class="list">${people.map((p) => `<li data-person="${esc(p.id)}"><span>${esc(p.name)}<small>${esc(p.birth.date)} – ${esc(p.death.date)}${p.relationship ? ' · ' + esc(p.relationship) : p.relation && p.relation.kind === 'untraced' ? ' · relationship not traced' : ''}</small><small class="id">${wtLink(p.id)}</small></span></li>`).join('')}</ul>`;
}

$('tour').addEventListener('click', async (e) => {
  if (e.target.closest('a[href^="http"]')) return; // WikiTree links just open
  const pack = currentPack();
  if (e.target.id === 'locate') return locate();
  if (e.target.id === 'back') { state.placeKey = null; return renderTour(); }
  const pl = e.target.closest('li[data-place]');
  if (pl) { state.placeKey = pl.dataset.place; return renderTour(); }
  const pe = e.target.closest('li[data-person]');
  if (pe) {
    state.personId = pe.dataset.person;
    unlockAudio(); // inside the tap, before anything is awaited
    return tell(pack, false);
  }
  if (e.target.id === 'again') { unlockAudio(); return tell(pack, true); }
  if (e.target.id === 'writeAll') return writeAll(pack, currentPlace(pack));
  if (e.target.id === 'saveStories') return saveStories(pack, currentPlace(pack));
  if (e.target.id === 'posSet') {
    const at = parseCoordinates($('posInput').value);
    if (!at) return ($('posMsg').textContent = 'Could not read that. Type two numbers, for example 45.120541, -122.590745.');
    return setPlacePosition(pack, currentPlace(pack), at);
  }
  if (e.target.id === 'posGps') {
    if (!navigator.geolocation) return ($('posMsg').textContent = 'This browser has no GPS access.');
    $('posMsg').textContent = 'Getting your location…';
    return navigator.geolocation.getCurrentPosition(
      (p) => setPlacePosition(pack, currentPlace(pack), { lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => { $('posMsg').textContent = 'Could not get your location: ' + err.message; },
      { enableHighAccuracy: true, timeout: 20000 });
  }
  if (e.target.id === 'prepare') return prepare(pack);
});

// The distance limit is kept with the other settings. A blank or non-positive number means no limit.
$('tour').addEventListener('change', async (e) => {
  if (e.target.id === 'loadStories') {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const { loaded, skipped } = await importStories(media, currentPack(), JSON.parse(await file.text()));
      $('storiesMsg').textContent = `Loaded ${loaded} stories${skipped ? ` (${skipped} were for people not in this pack)` : ''}. Tap a name to hear one.`;
    } catch (err) { $('storiesMsg').textContent = err.message; }
    return;
  }
  if (e.target.id === 'sortBy') { state.settings.sort = e.target.value; saveSettings(state.settings); return renderTour(); }
  if (e.target.id !== 'radius' && e.target.id !== 'radiusUnit') return;
  if (e.target.id === 'radius') { const n = Number(e.target.value); state.settings.radius = n > 0 ? String(n) : ''; }
  else state.settings.radiusUnit = e.target.value;
  saveSettings(state.settings);
  renderTour();
});

// Writes (or keeps) a story for everyone at this place, one after another, so they are ready with no signal.
async function writeAll(pack, place) {
  if (!place) return;
  const people = place.personIds.map((id) => personById(pack, id));
  $('writeAll').disabled = true;
  const plain = [];
  try {
    for (const [i, p] of people.entries()) {
      $('storiesMsg').textContent = `Writing ${i + 1} of ${people.length}: ${p.name}`;
      const out = await storyFor(pack, place, p);
      if (out.source === 'template' && state.settings.useModel) {
        // The model ran and every try failed the checks (out.attempt): keep the plain story for this person and go on.
        // Otherwise the model could not run at all, and going on would only repeat that, so stop and say why.
        if (!out.attempt) {
          $('storiesMsg').textContent = `Stopped at ${p.name}: the model could not write (${out.reason || 'unknown reason'}). Nothing more was saved. Fix that on the Narrator tab, or choose "Nothing" for plain stories.`;
          return;
        }
        await media.putJson(storyKey(pack.name, p.id), out);
        plain.push(p.name);
      }
    }
    $('storiesMsg').textContent = `Done: ${people.length} stories are saved on this device.` +
      (plain.length ? ` ${plain.length} are the plain version because every try from the model failed the checks against the record: ${plain.join(', ')}. Press "tell it again" on them to try once more.` : '');
  } catch (err) { $('storiesMsg').textContent = err.message; }
  finally { $('writeAll').disabled = false; }
}

async function saveStories(pack, place) {
  const data = await exportStories(media, pack, place.personIds.map((id) => personById(pack, id)));
  const n = Object.keys(data.stories).length;
  if (!n) return ($('storiesMsg').textContent = 'No stories are saved yet. Use "Write every story now" first.');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `stories-${place.name.split(',')[0].replace(/\W+/g, '-')}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $('storiesMsg').textContent = `Saved ${n} stories to a file.`;
}

// A position typed in or taken from the phone replaces the map lookup's guess, and is saved with the pack.
async function setPlacePosition(pack, place, at) {
  if (!place) return;
  place.lat = at.lat; place.lng = at.lng; delete place.approximate;
  await savePack(pack);
  renderTour();
}

const currentPlace = (pack) => pack.places.find((p) => p.key === state.placeKey);

// Loading Gemma, or having it write, takes a lot of memory, and a phone with many tabs open may close the page to make room.
// The page then comes back as if it had been reloaded, with no word about why, and trying again can do the same. So a note
// of the step under way is kept in localStorage; finding one at the next start means that step never finished. Gemma is
// then paused (plain stories, and the voice, carry on) until the member turns it back on under Narrator.
const STEP_KEY = 'branches-gemma-step';
const PAUSED_KEY = 'branches-gemma-paused';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const step = (what) => (what ? store.set(STEP_KEY, what) : store.del(STEP_KEY));
{
  const unfinished = store.get(STEP_KEY);
  if (unfinished) { store.set(PAUSED_KEY, unfinished); store.del(STEP_KEY); }
}
// Closing the page or going to another one on purpose is not a crash.
window.addEventListener('pagehide', () => step(''));
const gemmaPausedAt = () => store.get(PAUSED_KEY);
async function guardedLoad(id, opts) {
  step('loading Gemma onto the graphics chip');
  try { return await loadModel(id, { ...opts, onStep: (what) => step(what) }); } finally { step(''); }
}
function showPaused() {
  const at = gemmaPausedAt();
  $('pausedNote').hidden = $('resumeGemma').hidden = !at;
  if (at) $('pausedNote').textContent = `Gemma is paused: the page closed while it was ${at}. That is usually the phone running out of memory. Stories use the plain version, with the voice, until you turn Gemma back on. Close other tabs and apps first.`;
}
$('resumeGemma').addEventListener('click', () => { store.del(PAUSED_KEY); showPaused(); $('dlMsg').textContent = 'Gemma is back on. Tap a name to try it.'; });

// The in-browser Gemma, loaded from the device if it was downloaded. null for the other engines.
async function browserGenerator() {
  state.browserReason = '';
  if (state.settings.engine !== 'browser') return null;
  if (gemmaPausedAt()) {
    state.browserReason = `Gemma is paused because the page closed while it was ${gemmaPausedAt()}, usually because the phone ran out of memory. Close other tabs and apps, then turn it back on under Narrator`;
    return null;
  }
  if (!webGpuAvailable()) { state.browserReason = 'this browser has no WebGPU, so Gemma cannot run in it'; return null; }
  const id = state.settings.browserModel || BROWSER_MODELS[0].id;
  try {
    if (!isLoaded(id) && !(await isDownloaded(id))) { state.browserReason = 'Gemma is not downloaded on this device (the phone may have cleared it: open Narrator and download it again)'; return null; }
    return generatorFor(await guardedLoad(id));
  } catch (err) { state.browserReason = friendlyLoadError(err); return null; } // say what really went wrong, not just "not downloaded"
}

// A story is made once and kept, so the same words are heard (and the same clip played) every time.
// "Tell it again" makes a new one.
async function storyFor(pack, place, person, fresh = false) {
  const key = storyKey(pack.name, person.id);
  if (!fresh) {
    const kept = await media.getJson(key);
    // A kept model story is checked again, so one written under older rules cannot slip back in.
    if (kept && (kept.source === 'template' || !ungroundedWord(kept.text, person, place))) return kept;
  }
  const gen = await browserGenerator();
  if (gen) step('writing a story');
  let out;
  try {
    out = await narrate(person, place, state.settings, fetch, gen, (n, tries) => {
      step(`writing a story (try ${n})`);
      const box = $('story');
      if (box && state.personId === person.id) box.innerHTML = `<p class="hint">That answer did not pass the checks. Trying again (${n} of ${tries})…</p>`;
    });
  } finally { if (gen) step(''); }
  if (!gen && state.settings.engine === 'browser' && state.browserReason) out.reason = state.browserReason;
  // A template that stands in for an unreachable model is not kept, so the model gets another chance.
  if (out.source !== 'template' || !state.settings.useModel) await media.putJson(key, out);
  return out;
}

// The story opens right under the person tapped, so in a long list it is never out of sight below everyone else.
function placeStory(personId) {
  $('story')?.remove();
  const rows = [...document.querySelectorAll('li[data-person]')];
  const row = rows.find((r) => r.dataset.person === personId);
  if (!row) return;
  for (const r of rows) r.classList.toggle('sel', r === row);
  row.insertAdjacentHTML('afterend', '<li id="story"></li>');
  row.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function tell(pack, fresh) {
  const place = currentPlace(pack);
  const person = personById(pack, state.personId);
  if (!place || !person) return;
  speechSynthesis?.cancel?.();
  player.pause();
  placeStory(person.id);
  $('story').innerHTML = `<p class="hint">${state.settings.engine === 'browser' && !isLoaded(state.settings.browserModel || BROWSER_MODELS[0].id) ? 'Waking Gemma on this device (the first story takes a little longer)…' : 'Listening to the stones…'}</p>`;
  const out = await storyFor(pack, place, person, fresh);
  const src = out.source === 'template'
    ? 'Plain template from the record' + (out.reason && state.settings.useModel ? ` (${esc(out.reason)})` : '')
    : 'Narrated by ' + esc(out.source) + (out.source.includes('Ollama') || out.source.includes('browser') ? ', on your device' : '');
  // When the checks refuse what the model wrote, show it, so the member can see what was caught.
  const refused = out.attempt
    ? `<details class="panel"><summary>What the model wrote, and why it was not used</summary><div class="biotext">${esc(out.attempt)}</div><p class="src">${esc(out.reason)}</p></details>`
    : '';
  const bio = person.bio
    ? `<details class="panel"><summary>Biography from WikiTree</summary><div class="biotext">${esc(person.bio)}</div></details>`
    : '';
  $('story').innerHTML = `<div class="story">${esc(out.text)}</div><p class="src">${src} · <a href="#" id="again">tell it again</a></p><div id="audio"></div>
    <p class="src">${person.relationship ? esc(person.relationship) + ' · ' : ''}WikiTree: ${wtLink(person.id)}</p>${photoPrompt(person)}${refused}${bio}`;
  $('story').querySelector('#again').addEventListener('click', (ev) => ev.preventDefault());
  await speak(out.text);
}

// iPhones only let a page start sound inside a tap. A story takes seconds to write and the voice a few more, so by the
// time the clip is ready the tap is long over and play() is refused. The fix is to use one <audio> element for every
// clip and start it, silently, during the tap itself: after that the browser lets the page change its source and play it.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const player = new Audio();
player.controls = true;
player.id = 'player';
player.setAttribute('playsinline', '');
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    player.src = SILENT_WAV;
    const p = player.play();
    if (p && p.then) p.then(() => { audioUnlocked = true; player.pause(); }).catch(() => { /* not allowed here: the player's own button will do */ });
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  } catch { /* no audio on this device */ }
}

async function speak(text) {
  const mode = state.settings.voice;
  const box = $('audio');
  if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; }
  player.pause();
  const browserVoice = () => { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); };
  if (mode === 'browser') return browserVoice();
  if (mode !== 'eleven') { if (box) box.innerHTML = '<p class="hint">No voice: turn one on under Narrator → Voice.</p>'; return; }
  if (!box) return;
  box.innerHTML = '<p class="hint">Finding the voice…</p>';
  try {
    const { blob, fromCache } = await getClip({ text, settings: state.settings, store: media });
    state.audioUrl = URL.createObjectURL(blob);
    box.innerHTML = `<p class="src" id="voiceNote">${fromCache ? 'Voice saved on this device' : 'Voice made by ElevenLabs and saved on this device'}</p>`;
    player.src = state.audioUrl;
    box.prepend(player);
    player.play().catch(() => { $('voiceNote').textContent += '. Tap play to listen.'; });
  } catch (err) {
    box.innerHTML = `<p class="src">${esc(err.message)}${'speechSynthesis' in window ? ' Using this device\'s voice instead.' : ''}</p>`;
    browserVoice();
  }
}

// Make every story and clip for one cemetery now, while there is signal.
async function prepare(pack) {
  const place = currentPlace(pack);
  if (!place) return;
  if (!state.settings.elevenKey) return ($('prep').textContent = 'Add your ElevenLabs key on the Narrator tab first.');
  const people = place.personIds.map((id) => personById(pack, id));
  const guess = state.settings.useModel ? 650 : null;
  let chars = 0;
  for (const p of people) {
    const kept = await media.getJson(storyKey(pack.name, p.id));
    if (kept && await hasClip(kept.text, state.settings, media)) continue;
    chars += kept ? kept.text.length : (guess ?? templateNarration(p, place).length);
  }
  if (!chars) return ($('prep').textContent = 'Already prepared. Nothing more to make.');
  if (!confirm(`Make voice clips for ${people.length} people at ${place.name}?\nThis uses about ${chars.toLocaleString()} characters of your ElevenLabs credit.`)) return;
  $('prepare').disabled = true;
  try {
    for (const [i, p] of people.entries()) {
      $('prep').textContent = `Preparing ${i + 1} of ${people.length}: ${p.name}`;
      const out = await storyFor(pack, place, p);
      await getClip({ text: out.text, settings: state.settings, store: media });
    }
    $('prep').textContent = `Ready: ${people.length} stories can be heard with no signal.`;
  } catch (err) { $('prep').textContent = err.message; }
  finally { $('prepare').disabled = false; }
}

function locate() {
  if (!navigator.geolocation) return alert('This browser has no GPS access.');
  navigator.geolocation.getCurrentPosition(
    (p) => { state.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; renderTour(); },
    (err) => alert('Could not get your location: ' + err.message),
    { enableHighAccuracy: true, timeout: 15000 });
}

// ---------- settings ----------
function bindSettings() {
  const fields = { engine: 'value', browserModel: 'value', ollamaUrl: 'value', model: 'value', voice: 'value', elevenKey: 'value', voiceId: 'value', voiceModel: 'value' };
  const defaults = { engine: 'template', browserModel: BROWSER_MODELS[0].id, voice: 'off', voiceId: VOICE_DEFAULTS.voiceId, voiceModel: VOICE_DEFAULTS.modelId };
  $('browserModel').innerHTML = BROWSER_MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('voiceList').innerHTML = VOICE_SUGGESTIONS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('');
  $('cmdPull').textContent = pullCommand(state.settings.model || DEFAULT_SETTINGS.model);
  $('cmdServe').textContent = serveCommand(location.origin);
  $('cmdMac').textContent = `launchctl setenv OLLAMA_ORIGINS "${location.origin}"`;

  const showRows = () => {
    $('elevenRow').hidden = $('voice').value !== 'eleven';
    $('browserRow').hidden = $('engine').value !== 'browser';
    $('ollamaRow').hidden = $('engine').value !== 'ollama';
  };
  for (const [id, prop] of Object.entries(fields)) {
    $(id)[prop] = state.settings[id] ?? defaults[id] ?? DEFAULT_SETTINGS[id] ?? '';
    $(id).addEventListener('change', () => {
      state.settings[id] = $(id)[prop].trim?.() ?? $(id)[prop];
      state.settings.useModel = state.settings.engine !== 'template';
      saveSettings(state.settings);
      showRows();
      if (id === 'engine' || id === 'browserModel') refreshBrowserModel();
      if (id === 'model') $('cmdPull').textContent = pullCommand(state.settings.model);
    });
  }
  state.settings.voice = $('voice').value;
  state.settings.engine = $('engine').value;
  showRows();

  // copy buttons
  document.addEventListener('click', async (e) => {
    const id = e.target.dataset && e.target.dataset.copy;
    if (!id) return;
    try { await navigator.clipboard.writeText($(id).textContent); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; }
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
  });

  // ElevenLabs: say one line with the saved key and voice, so the member can hear it before a whole cemetery is made
  $('testVoice').addEventListener('click', async () => {
    const msg = $('voiceMsg');
    msg.textContent = 'Asking ElevenLabs…';
    try {
      const { blob } = await getClip({ text: 'Here lie the people who came before you.', settings: state.settings, store: media });
      msg.innerHTML = `<audio controls autoplay src="${URL.createObjectURL(blob)}"></audio>`;
    } catch (err) { msg.textContent = err.message; }
  });

  // Ollama
  $('checkOllama').addEventListener('click', async () => {
    $('ollamaMsg').textContent = 'Checking…';
    const r = await checkOllama($('ollamaUrl').value, $('model').value);
    $('ollamaMsg').textContent = describeOllama(r, $('model').value, location.origin);
  });

  // Gemma in the browser
  $('dlModel').addEventListener('click', async () => {
    const id = $('browserModel').value;
    $('dlModel').disabled = true; $('dlBar').hidden = false; $('dlBar').value = 0;
    const kept = await (navigator.storage && navigator.storage.persist ? navigator.storage.persist().catch(() => false) : false);
    try {
      const engine = await guardedLoad(id, { onProgress: (p) => { $('dlBar').value = Math.round((p.progress || 0) * 100); $('dlMsg').textContent = p.text || ''; } });
      $('dlMsg').textContent = 'Checking that Gemma answers…';
      const hello = await generatorFor(engine)('In one short sentence, welcome a visitor to a quiet cemetery.');
      $('dlMsg').textContent = `Ready. Gemma says: ${hello.trim()}` + (kept ? '' : '\nYour browser did not promise to keep this download. If the phone runs low on space it may clear it, so check before you leave home.');
    } catch (err) { $('dlMsg').textContent = 'Could not load Gemma: ' + friendlyLoadError(err); }
    finally { $('dlBar').hidden = true; $('dlModel').disabled = false; await refreshBrowserModel(true); }
  });
  $('rmModel').addEventListener('click', async () => {
    if (!confirm('Remove the downloaded Gemma from this device?')) return;
    await removeModel($('browserModel').value);
    $('dlMsg').textContent = 'Removed.';
    await refreshBrowserModel(true);
  });
}

// Shows whether the chosen Gemma is on this device. Only runs when that panel is open: it loads the library.
async function refreshBrowserModel(keepMessage = false) {
  if ($('engine').value !== 'browser') return;
  if (!webGpuAvailable()) {
    $('gpuNote').textContent = 'This browser has no WebGPU, so Gemma cannot run in it. Use recent Chrome or Edge, or choose Ollama.';
    $('dlModel').disabled = true;
    return;
  }
  $('gpuNote').textContent = '';
  const have = await isDownloaded($('browserModel').value).catch(() => false);
  $('dlModel').textContent = have ? 'Load Gemma and test it' : 'Download Gemma to this device';
  $('rmModel').hidden = !have;
  if (!keepMessage) $('dlMsg').textContent = have ? 'Downloaded on this device.' : '';
}

// ---------- offline check ----------
$('offlineCheck').addEventListener('click', async () => {
  const id = state.settings.browserModel || BROWSER_MODELS[0].id;
  let downloaded = false;
  try { downloaded = state.settings.engine === 'browser' && await isDownloaded(id); } catch { downloaded = false; }
  const rows = await offlineReport({
    nav: navigator, cacheStorage: 'caches' in window ? caches : null,
    standalone: !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)),
    packs: state.packs, gemma: { needed: state.settings.engine === 'browser', downloaded }, version: VERSION,
  });
  $('offlineOut').innerHTML = rows.map((r) => `<li class="${r.ok === true ? 'yes' : r.ok === false ? 'no' : ''}"><b>${mark(r.ok)}</b> ${esc(r.text)}</li>`).join('');
});

// ---------- boot ----------
bindSettings();
refreshBrowserModel();
showPaused();
await refreshPacks();
show('tour');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
