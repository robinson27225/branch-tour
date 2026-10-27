// Builds a tour pack straight from the WikiTree API, for the logged-in member.
// No report or Plus file needed. Runs on apps.wikitree.com, where the member's
// login cookie accompanies the request (the same way WikiTree tree apps work).
//
// Modes
//   ancestors  getPeople ancestors=N, with biographies
//   cc7        getPeople nuclear=N, one degree at a time up to 7, stopping where WikiTree's 1,025-profile limit starts
//   category   the members of one category (a cemetery) from WikiTree Plus, read through the API;
//              only your direct line is fetched, to say which members are your ancestors. No CC search.
//
// `api` is { getPeople(keys, fields, params) -> [status, resultByKey, people] },
// so tests can stand in for the network. See makeApi() for the real one.

import { buildPack, isCemeteryCategory } from './pack.js';
import { parentGraph, ancestorGenerations, kinOf, describeKin } from './kinship.js';

export const APP_ID = 'TA-TourOfTheBranches';
export const PAGE_SIZE = 1000;
const MAX_PAGES = 30;
const RETRIES = 3;
export const MIN_PRIVACY = 50; // public profiles only, matching what WikiTree Plus lists
const BIO_CHARS = 4000;

export const FIELDS = [
  'Id', 'Name', 'Prefix', 'FirstName', 'MiddleName', 'RealName', 'LastNameAtBirth', 'LastNameCurrent', 'Suffix',
  'Gender', 'BirthDate', 'DeathDate', 'BirthLocation', 'DeathLocation', 'Father', 'Mother',
  'Privacy', 'IsLiving', 'Spouses', 'Categories',
];

export function makeApi({ fetchFn = fetch, url = 'https://api.wikitree.com/api.php' } = {}) {
  return {
    async getPeople(keys, fields, params = {}) {
      const body = new URLSearchParams({
        appId: APP_ID, action: 'getPeople', keys: keys.join(','), fields: fields.join(','),
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      });
      const res = await fetchFn(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      if (!res.ok) throw new Error(`WikiTree API HTTP ${res.status}`);
      const json = await res.json();
      return [json[0].status, json[0].resultByKey, json[0].people];
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(call, wait) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try { return await call(); } catch (e) { last = e; await wait(500 * 2 ** i); }
  }
  throw new Error(`The WikiTree API could not be reached (${last && last.message}).`);
}

// WikiTree answers a request that would return more than 1,025 related profiles with this error.
export class TooManyProfiles extends Error {}
const isTooMany = (status) => /maximum number of profiles/i.test(String(status || ''));

// One getPeople request followed through its pages. WikiTree marks a page that stopped at its cap of 1,025
// profiles with the "Maximum number of profiles" status but still returns what it found, and the next page
// carries on (checked live: a seven-degree circle came back as five pages, over 4,000 profiles). So that status
// means "more follows" when profiles came with it, and only an empty flagged page is a real refusal.
// The last page has no status and fewer than PAGE_SIZE related profiles.
export async function fetchPeople({ api, keys, fields, params, onProgress = () => {}, wait = sleep }) {
  const people = {};
  const keySet = new Set(keys.map(String));
  for (let page = 0; page < MAX_PAGES; page++) {
    onProgress(`Fetching profiles… ${Object.keys(people).length} so far`);
    const [status, , got] = await withRetry(
      () => api.getPeople(keys, fields, { ...params, limit: PAGE_SIZE, start: page * PAGE_SIZE }), wait);
    const count = Object.keys(got || {}).length;
    const capped = isTooMany(status);
    if (capped && !count) throw new TooManyProfiles(String(status));
    if (status && !capped) throw new Error(`The WikiTree API returned an error: ${status}`);
    const before = Object.keys(people).length;
    Object.assign(people, got || {});
    const related = Object.keys(got || {}).filter((id) => !keySet.has(id)).length;
    if (!capped && related < PAGE_SIZE) break;
    if (Object.keys(people).length === before) break; // a page that adds nobody is the end
  }
  return people;
}

// How far out WikiTree will let us go. One request for the whole CC7 is refused (more than 1,025 profiles),
// so ask for the IDs only, one degree further each time, and stop when the next degree is too big or adds nobody.
export async function fitDegrees({ api, key, maxDegree = 7, onProgress = () => {}, wait = sleep }) {
  let best = 0, count = 0, capped = false;
  for (let d = 1; d <= maxDegree; d++) {
    try {
      const ids = await fetchPeople({ api, keys: [key], fields: ['Id'], params: { nuclear: d }, wait });
      const n = Object.keys(ids).length;
      onProgress(`${n.toLocaleString()} profiles within ${d} degree${d === 1 ? '' : 's'}…`);
      if (d > 1 && n === count) break; // nobody new: the family does not reach further
      best = d; count = n;
    } catch (e) {
      if (!(e instanceof TooManyProfiles)) throw e;
      capped = true;
      break;
    }
  }
  if (!best) throw new Error('WikiTree would not return even your closest relatives in one request. Try again later.');
  return { degrees: best, count, capped, asked: maxDegree };
}

// ---------- a category's members, from WikiTree Plus ----------
// The WikiTree API cannot list a category's members, but WikiTree Plus can, and it allows pages on
// apps.wikitree.com to read its answers. Plus takes the category name as plain text.

// The search the "Get profiles" button runs: Plus's own page only fills the form in, and a script
// then calls this endpoint (.json for JSON, .htm for the ordinary results table).
const PLUS_SEARCH = 'https://plus.wikitree.com/function/WTWebProfileSearch/Profiles.';
export function plusUrl(category, format = 'JSON') {
  const q = encodeURIComponent(String(category).replace(/_/g, ' ')).replace(/%20/g, '+');
  return format === 'JSON'
    ? `${PLUS_SEARCH}json?Query=${q}&MaxProfiles=1000&Format=JSON`
    : `${PLUS_SEARCH}htm?Query=${q}&MaxProfiles=1000`;
}

// WikiTree ids (Surname-123) linked from a Plus results page.
export function idsFromPlusHtml(html) {
  const ids = new Set();
  for (const m of String(html).matchAll(/wikitree\.com\/wiki\/([^"\s<>#?&\/:]+-\d+)(?=["'\s<>#?&\/]|$)/g)) {
    try { ids.add(decodeURIComponent(m[1])); } catch { ids.add(m[1]); }
  }
  return [...ids];
}

// The cemetery's own position, from the category page's {{CategoryInfoBox Cemetery ... |coordinate=45.12, -122.58}}.
// The page's source (action=raw) has it as text; the ordinary page only links it into map URLs, so those are read as a second try.
const inRange = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
export function parseCategoryCoordinate(text) {
  const t = String(text || '');
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`\\|\\s*coordinate\\s*=\\s*${num}\\s*[,;\\s]\\s*${num}`, 'i'),
    new RegExp(`[?&]lat=${num}&(?:amp;)?(?:lon|lng)=${num}`, 'i'),
    new RegExp(`#map=\\d+/${num}/${num}`),
    new RegExp(`[?&](?:ll|q|query|center)=${num}(?:,|%2C)\\s*${num}`, 'i'),
    new RegExp(`@${num},${num}`),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && inRange(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

export async function fetchCategoryCoordinate(category, fetchFn = fetch) {
  const title = encodeURIComponent('Category:' + String(category).replace(/ /g, '_')).replace(/%2C/g, ',').replace(/%3A/g, ':');
  for (const url of [`https://www.wikitree.com/index.php?title=${title}&action=raw`, `https://www.wikitree.com/wiki/${title}`]) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) continue;
      const hit = parseCategoryCoordinate(await res.text());
      if (hit) return hit;
    } catch { /* try the next */ }
  }
  return null;
}

// Who Plus lists for a category name. Tries its JSON list (numeric user ids), then the ordinary results
// page, whose profile links give WikiTree ids. Returns { ids } or { ids: null, problem } saying why not.
export async function fetchCategoryIds(category, fetchFn = fetch) {
  let problem = 'empty';
  for (const format of ['JSON', '']) {
    let text;
    try {
      const res = await fetchFn(plusUrl(category, format));
      if (!res.ok) { problem = `http ${res.status}`; continue; }
      text = await res.text();
    } catch { problem = 'network'; continue; }
    try {
      const json = JSON.parse(text);
      const list = (json.response && json.response.profiles) || json.profiles || [];
      const ids = list.map((v) => Math.trunc(Number(v))).filter((n) => n > 0);
      if (ids.length) return { ids, via: 'json' };
      problem = 'empty';
    } catch {
      const ids = idsFromPlusHtml(text);
      if (ids.length) return { ids, via: 'page' };
      problem = /<html/i.test(text) ? 'page-without-profiles' : 'empty';
    }
  }
  return { ids: null, problem };
}

export function plusProblemMessage(problem, category) {
  const name = String(category).replace(/_/g, ' ');
  const why = {
    network: 'The browser could not reach WikiTree Plus from this page.',
    empty: `WikiTree Plus lists no profiles for "${name}".`,
    'page-without-profiles': 'WikiTree Plus answered with a page that has no profile links in it.',
  }[problem] || (String(problem).startsWith('http') ? `WikiTree Plus answered with an error${problem.replace('http', '').trim() && problem.replace('http', '').trim() !== 'undefined' ? ' (' + problem.replace('http', '').trim() + ')' : ''}.` : 'WikiTree Plus did not give a list the app can read.');
  return `${why} To use this cemetery anyway, save its My Connections page on WikiTree and drop it under Import.`;
}

// Plus matches words, so the name typed may differ from the category the profiles really list
// ("Clackamas County" for "Molalla"). Pick the cemetery-like category the results share most with the name.
export function bestCategory(found, text) {
  const words = String(text).toLowerCase().match(/[a-z\u00e0-\u024f]{3,}/g) || [];
  const tally = new Map();
  for (const p of Object.values(found)) for (const c of categoriesOf(p)) if (isCemeteryCategory(c)) tally.set(c, (tally.get(c) || 0) + 1);
  let best = '', bestScore = 0, bestCount = 0;
  for (const [c, n] of tally) {
    const lower = c.toLowerCase();
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > bestScore || (score === bestScore && n > bestCount)) { best = c; bestScore = score; bestCount = n; }
  }
  return bestScore >= 2 ? best : '';
}

// Profiles by id, a few hundred per request (a plain lookup may take up to 1000 keys).
export async function fetchByIds({ api, ids, fields, onProgress = () => {}, wait = sleep, chunkSize = 200 }) {
  const people = {};
  for (let i = 0; i < ids.length; i += chunkSize) {
    onProgress(`Reading ${Math.min(i + chunkSize, ids.length)} of ${ids.length} profiles…`);
    const [status, , got] = await withRetry(() => api.getPeople(ids.slice(i, i + chunkSize), fields, {}), wait);
    if (status) throw new Error(`The WikiTree API returned an error: ${status}`);
    Object.assign(people, got || {});
  }
  return people;
}

// ---------- ancestor lines of many people, for naming how they are related ----------
const LINE_FIELDS = ['Id', 'Name', 'FirstName', 'LastNameAtBirth', 'Gender', 'Father', 'Mother', 'BirthDate', 'DeathDate', 'IsLiving', 'Privacy'];

// Ten generations of ancestors for each id. A request for several people is refused when their combined
// ancestors pass WikiTree's 1,025-profile limit, so a refused batch is halved and tried again. A single
// person's ten generations always fit; anyone who somehow does not is skipped.
export async function fetchAncestorLines({ api, ids, depth = 10, batch = 20, onProgress = () => {}, wait = sleep }) {
  const people = {};
  const queue = [];
  for (let i = 0; i < ids.length; i += batch) queue.push(ids.slice(i, i + batch));
  let done = 0;
  while (queue.length) {
    const keys = queue.shift();
    try {
      Object.assign(people, await fetchPeople({ api, keys, fields: LINE_FIELDS, params: { ancestors: depth }, wait }));
      done += keys.length;
      onProgress(`Tracing family lines: ${done} of ${ids.length}…`);
    } catch (e) {
      if (!(e instanceof TooManyProfiles)) throw e;
      if (keys.length === 1) { done += 1; continue; }
      const mid = Math.ceil(keys.length / 2);
      queue.unshift(keys.slice(0, mid), keys.slice(mid));
    }
  }
  return people;
}

// ---------- reading API people ----------

const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// WikiTree writes unknown parts as 00: "1933-00-00" is just 1933, "0000-00-00" is nothing.
export function normDate(d) {
  if (!d || /^0000/.test(d)) return '';
  return String(d).replace(/-00-00$/, '').replace(/-00$/, '');
}

export function displayName(p) {
  const given = [p.FirstName || p.RealName, p.MiddleName].filter(Boolean).join(' ');
  return [p.Prefix, given, p.LastNameAtBirth || p.LastNameCurrent, p.Suffix].filter(Boolean).join(' ').trim() || p.Name || '';
}

// Hidden profiles come back with no name. Living and non-public ones are dropped.
export function isTourable(p) {
  if (!p) return false;
  if (!(p.FirstName || p.LastNameAtBirth || p.RealName)) return false;
  if (p.IsLiving === 1 || p.IsLiving === '1' || p.IsLiving === true) return false;
  if (p.Privacy !== undefined && Number(p.Privacy) < MIN_PRIVACY) return false;
  return true;
}

const categoriesOf = (p) => (Array.isArray(p.Categories) ? p.Categories : Object.values(p.Categories || {})).map(String);

// Parents and marriages come with the profiles already fetched. Names of people who are
// hidden, private or living are left out; a marriage keeps its date and place.
export function familyOf(p, people) {
  const nameOf = (id) => { const q = people[id]; return q && isTourable(q) ? displayName(q) : ''; };
  const nameWithYears = (id) => { const q = people[id]; const n = nameOf(id); if (!n) return ''; const y = (d) => (normDate(d).match(/^\d{4}/) || [''])[0]; return y(q.BirthDate) || y(q.DeathDate) ? `${n} (${y(q.BirthDate)}–${y(q.DeathDate)})` : n; };
  const parents = [nameOf(positive(p.Father)), nameOf(positive(p.Mother))].filter(Boolean);
  const spouses = Object.values(p.Spouses || {}).map((s) => ({
    name: nameWithYears(positive(s && s.Id)), date: normDate(s && s.MarriageDate), place: (s && s.MarriageLocation) || '',
  })).filter((s) => s.name || s.date || s.place);
  return { parents, spouses };
}

// ---------- relationship to the starting person ----------

export function buildGraph(people) {
  const nbrs = new Map(), parents = new Map(), children = new Map();
  const link = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
  for (const [key, p] of Object.entries(people)) {
    const id = positive(p.Id || key);
    if (!id) continue;
    for (const par of [positive(p.Father), positive(p.Mother)]) {
      if (!par) continue;
      link(parents, id, par); link(children, par, id); link(nbrs, id, par); link(nbrs, par, id);
    }
    for (const s of Object.values(p.Spouses || {})) {
      const sid = positive(s && s.Id);
      if (sid) { link(nbrs, id, sid); link(nbrs, sid, id); }
    }
  }
  // siblings are one step apart: both are a step from the shared parent, so link them directly
  for (const kids of children.values()) {
    for (const a of kids) for (const b of kids) if (a !== b) link(nbrs, a, b);
  }
  return { nbrs, parents, children };
}

function bfs(start, next) {
  const dist = new Map([[start, 0]]);
  let frontier = [start];
  while (frontier.length) {
    const out = [];
    for (const id of frontier) for (const n of next(id) || []) {
      if (!dist.has(n)) { dist.set(n, dist.get(id) + 1); out.push(n); }
    }
    frontier = out;
  }
  return dist;
}

const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
const sex = (gender, m, f, n) => (gender === 'Male' ? m : gender === 'Female' ? f : n);

function ancestorWord(n, g) {
  if (n === 1) return sex(g, 'father', 'mother', 'parent');
  if (n === 2) return sex(g, 'grandfather', 'grandmother', 'grandparent');
  const base = sex(g, 'grandfather', 'grandmother', 'grandparent');
  return n === 3 ? `great-${base}` : `${ord(n - 2)} great-${base}`;
}
function descendantWord(n, g) {
  if (n === 1) return sex(g, 'son', 'daughter', 'child');
  const base = sex(g, 'grandson', 'granddaughter', 'grandchild');
  return n === 2 ? base : n === 3 ? `great-${base}` : `${ord(n - 2)} great-${base}`;
}

// Labels are written to follow "They were ...".
export function relationships(people, startId) {
  const g = buildGraph(people);
  const up = bfs(startId, (id) => g.parents.get(id));
  const down = bfs(startId, (id) => g.children.get(id));
  const degrees = bfs(startId, (id) => g.nbrs.get(id));
  const mine = g.parents.get(startId) || new Set();
  const spouseOf = new Set(Object.values((people[startId] || {}).Spouses || {}).map((s) => positive(s && s.Id)));

  return (id, gender, metaDegrees = 0) => {
    if (id === startId) return { label: '', kind: 'self', degrees: 0 };
    if (up.has(id)) return { label: `your ${ancestorWord(up.get(id), gender)}`, kind: 'ancestor', degrees: degrees.get(id) };
    if (down.has(id)) return { label: `your ${descendantWord(down.get(id), gender)}`, kind: 'descendant', degrees: degrees.get(id) };
    if (spouseOf.has(id)) return { label: `your ${sex(gender, 'husband', 'wife', 'spouse')}`, kind: 'spouse', degrees: 1 };
    const sharesParent = [...(g.parents.get(id) || [])].some((p) => mine.has(p));
    if (sharesParent) return { label: `your ${sex(gender, 'brother', 'sister', 'sibling')}`, kind: 'sibling', degrees: 1 };
    const d = metaDegrees || degrees.get(id);
    return d ? { label: `connected to you, ${d} degree${d === 1 ? '' : 's'} away`, kind: 'connection', degrees: d } : { label: '', kind: 'unknown', degrees: 0 };
  };
}

// ---------- biographies (wiki markup to plain sentences) ----------

const STOP_HEADINGS = /^(sources?|acknowledg\w*|research notes?|dna.*|see also|footnotes?|references?)$/i;

export function wikiToText(wiki) {
  if (!wiki) return '';
  let t = String(wiki).replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let i = 0; i < 5; i++) t = t.replace(/\{\{[^{}]*\}\}/g, ''); // templates, including nested ones
  t = t.replace(/\[\[(?:Category|Image|File|Media):[^\]]*\]\]/gi, '') // these carry no sentences
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const kept = [];
  let items = [];
  // Short bullets are rarely prose, but a list with dates is facts ("He married" 1. Betty (1922-2011) 10 August 1940; 2. ...),
  // so those items are joined into one sentence, onto the line that introduces them when there is one.
  const flush = () => {
    if (!items.length) return;
    const joined = items.join('; ') + '.';
    const last = kept.length ? kept[kept.length - 1] : '';
    if (last && last.length < 80 && !/[.!?:"')]$/.test(last)) kept[kept.length - 1] = last + ' ' + joined;
    else kept.push(joined);
    items = [];
  };
  for (const line of t.split('\n')) {
    const h = /^\s*=+\s*(.*?)\s*=+\s*$/.exec(line);
    if (h) { flush(); if (STOP_HEADINGS.test(h[1])) break; continue; }
    if (/^\s*[*#:]/.test(line) && !/^\s*[*#:]+\s*\S{25,}/.test(line)) {
      const item = line.replace(/^\s*[*#:]+\s*/, '').replace(/[\s;,.]+$/, '');
      if (/\b1[5-9]\d\d\b|\b20\d\d\b/.test(item)) items.push(item);
      continue;
    }
    flush();
    kept.push(line.trim());
  }
  flush();
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= BIO_CHARS) return text;
  const cut = text.slice(0, BIO_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (end > BIO_CHARS / 2 ? cut.slice(0, end + 1) : cut).trim() + ' …';
}

// ---------- category names ----------

export function parseCategoryInput(s) {
  let c = String(s || '').trim();
  const m = /Category:([^?#]+)/i.exec(c);
  if (m) { try { c = decodeURIComponent(m[1]); } catch { c = m[1]; } }
  return c.replace(/\s+/g, '_').replace(/^Category:/i, '');
}

// ---------- the builder ----------

export async function buildTourPack({
  api, startId, mode = 'ancestors', generations = 6, maxDegree = 7, category = '', now, onProgress = () => {}, wait = sleep,
  fetchFn = fetch,
}) {
  const start = String(startId || '').trim();
  if (!start) throw new Error('Enter your WikiTree ID, for example Robinson-27225.');
  const cat = mode === 'category' ? parseCategoryInput(category) : '';
  if (mode === 'category' && !cat) throw new Error('Enter a category name or paste its WikiTree address.');
  let wanted = cat.toLowerCase();
  const inCategory = (p, name = wanted) => categoriesOf(p).some((c) => c.toLowerCase() === name);

  const BIO_LIMIT = 200; // a cemetery with more profiles than this skips biographies: it would be a very large download
  let withBio = mode === 'ancestors';
  let fit = null, people, memberKeys = null, categoryInfo = null, memberLines = null, myDeepLine = null;
  const labelFields = ['Id', 'Name', 'FirstName', 'LastNameAtBirth', 'Gender', 'Father', 'Mother', 'Spouses', 'BirthDate', 'DeathDate', 'IsLiving', 'Privacy'];

  if (mode === 'ancestors') {
    people = await fetchPeople({ api, keys: [start], fields: [...FIELDS, 'Bio'],
      params: { ancestors: Math.min(Math.max(generations, 1), 10) }, onProgress, wait });
  } else if (mode === 'cc7') {
    fit = await fitDegrees({ api, key: start, maxDegree: Math.min(Math.max(maxDegree, 1), 7), onProgress, wait });
    people = await fetchPeople({ api, keys: [start], fields: [...FIELDS, 'Meta'], params: { nuclear: fit.degrees }, onProgress, wait });
  } else {
    // A cemetery: ask WikiTree Plus who is in the category. No CC search at all.
    onProgress(`Asking WikiTree Plus who is in ${cat.replace(/_/g, ' ')}…`);
    const plus = await fetchCategoryIds(cat, fetchFn);
    if (!plus.ids) throw new Error(plusProblemMessage(plus.problem, cat));
    onProgress(`${plus.ids.length} profiles found. Reading them and their biographies…`);
    withBio = plus.ids.length <= BIO_LIMIT;
    const found = await fetchByIds({ api, ids: plus.ids, fields: withBio ? [...FIELDS, 'Bio'] : FIELDS, onProgress, wait });

    let used = cat, members = Object.entries(found).filter(([, p]) => inCategory(p, wanted));
    if (!members.length) {
      used = bestCategory(found, cat);
      members = used ? Object.entries(found).filter(([, p]) => inCategory(p, used.toLowerCase())) : [];
    }
    if (!members.length) {
      throw new Error(`WikiTree Plus listed ${plus.ids.length} profiles for "${cat.replace(/_/g, ' ')}", but none of them has that category. ` +
        'Check the spelling against the category page on WikiTree.');
    }
    categoryInfo = { source: plus.via, found: plus.ids.length, used: used === cat ? '' : used };

    // Labels need only your direct line: members who are your ancestors say so, the rest have no label.
    onProgress('Working out which of them are your ancestors…');
    const line = await fetchPeople({ api, keys: [start], fields: labelFields, params: { ancestors: 10 }, onProgress: () => {}, wait });
    people = { ...line };
    memberKeys = new Set();
    for (const [k, p] of members) { people[k] = line[k] ? { ...line[k], ...p } : p; memberKeys.add(k); }
    wanted = used.toLowerCase();

    // Spouses are not members of the category and not your ancestors, so they are fetched to be named
    // ("Married Betty L. Wyland (1931–2000)"). Anyone private or living is still left unnamed by familyOf.
    const spouseIds = new Set();
    for (const k of memberKeys) for (const s of Object.values(people[k].Spouses || {})) { const id = positive(s && s.Id); if (id && !people[id]) spouseIds.add(id); }
    if (spouseIds.size) {
      onProgress('Looking up their spouses…');
      const sp = await fetchByIds({ api, ids: [...spouseIds], fields: withBio ? [...FIELDS, 'Bio'] : FIELDS, onProgress: () => {}, wait });
      for (const [k, p] of Object.entries(sp)) {
        if (people[k]) continue;
        people[k] = p;
        // Plus lists a category a day or so behind WikiTree, so a spouse added to the cemetery just now is still a stop.
        if (inCategory(p)) memberKeys.add(k);
      }
    }
    onProgress('Tracing how each of them is related to you…');
    memberLines = await fetchAncestorLines({ api, ids: [...memberKeys].map(Number), onProgress, wait });

    // Your own line further back, so relatives who branch off more than ten generations up can be named too:
    // the ancestors exactly ten generations out each start another ten.
    const meNow = Object.values(line).find((p) => p.Name === start);
    if (meNow) {
      const gens = ancestorGenerations(parentGraph(line), positive(meNow.Id), 10);
      const frontier = [...gens].filter(([, g]) => g === 10).map(([id]) => id);
      if (frontier.length) {
        myDeepLine = await fetchAncestorLines({ api, ids: frontier, batch: 20, wait,
          onProgress: (m) => onProgress(m.replace('Tracing family lines', 'Tracing your own line back to 20 generations')) });
      }
    }
  }

  const me = Object.values(people).find((p) => p.Name === start) || people[start];
  if (!me) throw new Error(`The WikiTree API did not return ${start}. Are you logged in to WikiTree in this browser?`);
  const relate = relationships(people, positive(me.Id));

  // Blood relatives other than direct ancestors: "your half fourth cousin four times removed", through a shared ancestor.
  const kin = new Map();
  if (memberLines) {
    const lookup = { ...memberLines, ...myDeepLine, ...people };
    const graph = parentGraph(lookup);
    const mine = ancestorGenerations(graph, positive(me.Id), myDeepLine ? 20 : 10);
    const yearsOf = (p) => { const y = (d) => (normDate(d).match(/^\d{4}/) || [''])[0]; return y(p.BirthDate) || y(p.DeathDate) ? ` (${y(p.BirthDate)}–${y(p.DeathDate)})` : ''; };
    for (const key of memberKeys) {
      const id = positive(people[key].Id || key);
      if (mine.has(id)) continue; // a direct ancestor: named by relate()
      const k = kinOf(graph, mine, id, 10);
      if (!k) continue;
      const via = k.via.map((v) => lookup[v]).filter((q) => q && isTourable(q)).map((q) => displayName(q) + yearsOf(q)).join(' and ');
      kin.set(id, { label: describeKin(k.a, k.b, k.half, people[key].Gender || ''), generations: k.total, via });
    }
  }

  const records = [];
  let hidden = 0;
  for (const [key, p] of Object.entries(people)) {
    if (memberKeys && !memberKeys.has(key)) continue;
    if (!isTourable(p)) { hidden++; continue; }
    const cats = categoriesOf(p);
    const gender = p.Gender || '';
    const numId = positive(p.Id || key);
    let rel = relate(numId, gender, positive(p.Meta && p.Meta.Degrees));
    const k = kin.get(numId);
    if (k && (rel.kind === 'unknown' || rel.kind === 'connection')) rel = { label: k.label, kind: 'cousin', degrees: rel.degrees, generations: k.generations, via: k.via };
    else if (memberLines && (rel.kind === 'unknown' || rel.kind === 'connection')) rel = { label: '', kind: 'untraced', degrees: rel.degrees }; // no shared ancestor within reach
    const rec = {
      id: p.Name, userId: String(positive(p.Id || key)), name: displayName(p), lastNameAtBirth: p.LastNameAtBirth || '', gender,
      birth: { date: normDate(p.BirthDate), place: p.BirthLocation || '' },
      death: { date: normDate(p.DeathDate), place: p.DeathLocation || '' },
      categories: cats, relationship: rel.label, relation: { kind: rel.kind, degrees: rel.degrees, generations: rel.generations, via: rel.via || '' },
      bio: withBio ? wikiToText(p.bio ?? p.Bio) : '',
      family: familyOf(p, people),
    };
    if (mode === 'category') rec.cemeteryCategories = [cats.find((c) => c.toLowerCase() === wanted)];
    records.push(rec);
  }

  const title = { ancestors: `Ancestors of ${displayName(me)}`, cc7: `CC7 of ${displayName(me)}`, category: `${wanted ? (categoryInfo && categoryInfo.used ? categoryInfo.used : cat).replace(/_/g, ' ') : ''}` }[mode];
  const pack = buildPack(records, { name: title, source: `WikiTree API (${mode})`, now });
  pack.viewer = start;
  pack.stats.hidden = hidden;
  if (withBio) pack.stats.withBio = pack.people.filter((p) => p.bio).length;
  if (categoryInfo) {
    pack.stats.category = categoryInfo;
    // The category page knows where the cemetery is; that beats a guess from a map search.
    const spot = pack.places.find((pl) => pl.kind === 'cemetery');
    if (spot) {
      onProgress('Looking up where the cemetery is…');
      const at = await fetchCategoryCoordinate(categoryInfo.used || cat, fetchFn);
      if (at) { spot.lat = at.lat; spot.lng = at.lng; categoryInfo.coordinate = true; }
    }
  }
  if (memberLines && pack.people) pack.stats.kinship = { related: kin.size + pack.people.filter((p) => p.relation && p.relation.kind === 'ancestor').length, members: pack.people.length, deep: !!myDeepLine };
  if (fit) pack.stats.reach = { degrees: fit.degrees, asked: fit.asked, capped: fit.capped, profiles: fit.count };
  return pack;
}

export { isCemeteryCategory };
