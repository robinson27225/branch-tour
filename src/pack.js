// Turns WikiTree Plus exports (CSV/TSV rows, JSON index) into a "tour pack".
// Pure functions only: no DOM, no network.

export const SCHEMA_VERSION = 1;

const CEMETERY_RE =
  /(cemetery|cemetary|graveyard|churchyard|burial|memorial[ _]park|mausoleum|columbarium|crematorium|burying)/i;
// Category pages about records or projects, not a place of burial.
const NOT_A_PLACE_RE = /(records|project|photographers|inscriptions|transcriptions|stubs|needed)/i;

const LIVING_WINDOW_YEARS = 110;

export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function detectDelimiter(text) {
  const head = text.slice(0, 2000).split(/\r?\n/)[0] || '';
  return (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// rows[0] is the header. Returns plain objects keyed by normalized header.
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const keys = rows[0].map(norm);
  return rows.slice(1).map((r) => {
    const o = {};
    keys.forEach((k, i) => { if (k) o[k] = (r[i] ?? '').toString().trim(); });
    return o;
  });
}

export function parseYear(date) {
  const m = /(\d{4})/.exec(date || '');
  return m ? Number(m[1]) : null;
}

export function categoryLabel(cat) {
  return cat.replace(/_/g, ' ').trim();
}

export function isCemeteryCategory(cat) {
  return CEMETERY_RE.test(cat) && !NOT_A_PLACE_RE.test(cat);
}

export function splitCategories(s) {
  return (s || '').split(/\r?\n|;/).map((c) => c.trim()).filter(Boolean);
}

// A person is treated as possibly living unless a death is recorded, or
// they were born long enough ago. Err on the side of exclusion.
export function mayBeLiving(p, now = new Date()) {
  if (p.death.date || p.death.place) return false;
  const by = parseYear(p.birth.date);
  if (by === null) return true;
  return now.getFullYear() - by < LIVING_WINDOW_YEARS;
}

export function normalizeRecord(o) {
  const place = (loc, country) => [loc, country].filter(Boolean).join(', ');
  const full = o.fullname || [o.firstname, o.lastnameatbirth || o.lastnamecurrent].filter(Boolean).join(' ');
  return {
    id: o.wikitreeid || '',
    userId: o.userid ? String(parseInt(o.userid, 10) || '') : '',
    name: full,
    lastNameAtBirth: o.lastnameatbirth || '',
    gender: o.gender || '',
    birth: { date: o.birthdate || '', place: place(o.birthlocation, o.birthcountry) },
    death: { date: o.deathdate || '', place: place(o.deathlocation, o.deathcountry) },
    categories: splitCategories(o.allcategories),
  };
}

function townKey(placeStr) {
  return 'town:' + placeStr.toLowerCase().replace(/\s+/g, ' ');
}

// Group people into stops. Cemetery categories win; otherwise death place
// (then birth place) gives a town stop. Living people never enter the pack.
export function buildPack(records, { name = 'Tour pack', source = '', now = new Date() } = {}) {
  const people = [];
  const places = new Map();
  let excludedLiving = 0, unplaced = 0;

  const addToPlace = (key, label, kind, personId) => {
    if (!places.has(key)) places.set(key, { key, kind, name: label, lat: null, lng: null, personIds: [] });
    places.get(key).personIds.push(personId);
  };

  for (const rec of records) {
    const p = rec.name !== undefined && rec.birth ? rec : normalizeRecord(rec);
    if (!p.id && !p.userId) continue;
    if (mayBeLiving(p, now)) { excludedLiving++; continue; }
    const pid = p.id || 'u' + p.userId;
    const person = { ...p, id: pid };
    people.push(person);

    // An importer that knows the burial place (the report) is authoritative.
    const cems = p.cemeteryCategories?.length ? p.cemeteryCategories : p.categories.filter(isCemeteryCategory);
    if (cems.length) {
      // A person is narrated at the first cemetery category only.
      addToPlace('cem:' + cems[0], categoryLabel(cems[0]), 'cemetery', pid);
    } else if (p.death.place || p.birth.place) {
      const where = p.death.place || p.birth.place;
      addToPlace(townKey(where), where, 'town', pid);
    } else unplaced++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    source,
    builtAt: now.toISOString(),
    people,
    places: [...places.values()].sort(
      (a, b) => (a.kind === b.kind ? b.personIds.length - a.personIds.length : a.kind === 'cemetery' ? -1 : 1)
    ),
    stats: { people: people.length, excludedLiving, unplaced },
  };
}

// WikiTree Plus JSON only carries numeric user IDs. Useful as a "which
// profiles" filter on a bigger table, not as a pack on its own.
export function parsePlusJsonIds(text) {
  const j = JSON.parse(text);
  const list = j.response?.profiles ?? j.profiles ?? [];
  return list.map((v) => String(Math.trunc(Number(v)))).filter((s) => s !== 'NaN');
}

export function filterByUserIds(records, ids) {
  const set = new Set(ids);
  return records.filter((r) => set.has(String(r.userid ?? r.userId ?? '')));
}

export function personById(pack, id) {
  return pack.people.find((p) => p.id === id);
}

// Opens WikiTree's own photo upload for a profile. It needs the numeric user id, which packs built from WikiTree carry.
export function uploadPhotoUrl(userId) {
  return /^\d+$/.test(String(userId || '')) ? `https://www.wikitree.com/index.php?title=Special:UploadPhoto&person_id=${userId}` : '';
}

// WikiTree IDs look like Robinson-27225 (surnames may hold apostrophes or hyphens). Anything else gets no link.
export function wikiTreeUrl(id) {
  return /^[^\s/?#]+-\d+$/.test(id || '') ? `https://www.wikitree.com/wiki/${encodeURIComponent(id)}` : '';
}
