// Reads a saved WikiTree "My Connections" page for one category (a cemetery).
// The page lists up to 200 members of the category, alphabetically by
// surname, with their relationship to the logged-in viewer. Use "Next" on
// WikiTree and save each page to cover a larger cemetery.
//
// This is the viewer's own page, saved from their own browser.

import { buildPack, parseYear } from './pack.js';

export function isConnectionsHtml(html) {
  return /wgCanonicalSpecialPageName\s*=\s*"MyConnections"/.test(html) && /person2Name=/.test(html);
}

const decodeEntities = (s) =>
  s.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// "Leona Catherine (Budd) Robinson (1904-1966)" -> name + years.
// Only a last parenthesis made of dates counts as years, so a maiden name stays in the name.
export function splitNameYears(text) {
  const t = decodeEntities(text).trim();
  const m = /^(.*?)\s*\(([^()]*\d{4}[^()]*|-)\)$/.exec(t);
  if (!m || !/^[\d\s\-?a-z.]*$/i.test(m[2])) return { name: t, birth: '', death: '' };
  const [b, d = ''] = m[2].split('-');
  const year = (s) => (/\d{4}/.exec(s) || [''])[0];
  return { name: m[1].trim(), birth: year(b), death: year(d) };
}

export function parseConnectionsHtml(html) {
  if (!isConnectionsHtml(html)) throw new Error('This does not look like a saved WikiTree My Connections page.');

  const viewer = safeDecode((/person1Name=([^"&]+)/.exec(html) || [])[1] || '');
  const category = decodeEntities((/name="c"\s+value="([^"]+)"/.exec(html) || [])[1] || '');
  const nextHref = /<a href="([^"]*(?:[?&]|&amp;)from=[^"]*)"[^>]*>\s*<button[^>]*>\s*Next/.exec(html);

  const aIdx = html.indexOf('<section id="Ancestors"');
  const cIdx = html.indexOf('<section id="Connections"');
  const sections = [
    ['cousin', aIdx < 0 ? '' : html.slice(aIdx, cIdx > aIdx ? cIdx : undefined)],
    ['connection', cIdx < 0 ? '' : html.slice(cIdx)],
  ];

  const entries = [];
  const seen = new Set();
  for (const [sectionKind, body] of sections) {
    for (const chunk of body.split('<div class="row">')) {
      const id = /person2Name=([^"&]+)"/.exec(chunk);
      const dist = /<b>(\d+)<\/b>\s*(generations?|degrees?)/.exec(chunk);
      const link = /<a href="\/wiki\/[^"]+"[^>]*>([^<]+)<\/a>/.exec(chunk);
      if (!id || !dist || !link) continue;
      const wikiTreeId = safeDecode(id[1]);
      if (seen.has(wikiTreeId)) continue;
      seen.add(wikiTreeId);
      const kind = sectionKind === 'cousin' && /<mark>\s*ancestor/.test(chunk) ? 'ancestor' : sectionKind;
      entries.push({ wikiTreeId, ...splitNameYears(link[1]), kind, distance: Number(dist[1]) });
    }
  }

  return { viewer, category, next: nextHref ? decodeEntities(nextHref[1]) : '', entries };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Wording is WikiTree's own: the page counts "generations" for blood relatives
// and "degrees" for connections through marriage.
export function relationLabel({ kind, distance }) {
  if (kind === 'ancestor') return `your ancestor, ${plural(distance, 'generation')} back`;
  if (kind === 'connection') return `connected to you through marriage, ${plural(distance, 'degree')} away`;
  return `a relative of yours, ${plural(distance, 'generation')} apart on WikiTree's count`;
}

// Merge a parsed page into an existing pack (or start one). People already in
// the pack keep their data (bio, burial) and gain the viewer-relative label.
// New people become short entries placed at the page's cemetery. Anyone with
// no years at all is left out by buildPack's living-people rule.
export function addConnections(pack, parsed, { now } = {}) {
  const cat = parsed.category;
  const byId = new Map(parsed.entries.map((e) => [e.wikiTreeId, e]));
  const records = [];
  const known = new Set();

  for (const p of pack ? pack.people : []) {
    known.add(p.id);
    const e = byId.get(p.id);
    // A cousin relationship worked out from the tree ("half fourth cousin four times removed") is more exact than
    // WikiTree's page count, so it stays; the page fills in people who could not be traced.
    const exact = p.relation && p.relation.kind === 'cousin';
    records.push(e && !exact ? { ...p, relationship: relationLabel(e), relation: { kind: e.kind, distance: e.distance } } : p);
  }
  for (const e of parsed.entries) {
    if (known.has(e.wikiTreeId)) continue;
    records.push({
      id: e.wikiTreeId, userId: '', name: e.name, gender: '',
      birth: { date: e.birth, place: '' }, death: { date: e.death, place: '' },
      categories: cat ? [cat] : [], cemeteryCategories: cat ? [cat] : [],
      relationship: relationLabel(e), relation: { kind: e.kind, distance: e.distance },
    });
  }

  const next = buildPack(records, {
    name: pack ? pack.name : `Connections: ${cat.replace(/_/g, ' ')}`,
    source: pack ? pack.source : 'WikiTree My Connections',
    now,
  });
  if (pack) {
    // Keep coordinates already looked up, and who the pack was built for.
    const old = new Map(pack.places.map((pl) => [pl.key, pl]));
    for (const pl of next.places) {
      const o = old.get(pl.key);
      if (o) { pl.lat = o.lat; pl.lng = o.lng; if (o.approximate) pl.approximate = true; }
    }
    if (pack.root) next.root = pack.root;
  }
  next.viewer = parsed.viewer || (pack && pack.viewer) || '';
  return next;
}

export { parseYear };
