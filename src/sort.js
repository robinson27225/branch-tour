// Orders the people at one stop. The pack keeps its own order; this is only for display.

import { parseYear } from './pack.js';

export const SORTS = [
  { id: 'surname', label: 'Surname (birth name)' },
  { id: 'birth', label: 'Birth date' },
  { id: 'death', label: 'Death date' },
  { id: 'relation', label: 'Closest relative first' },
];
export const DEFAULT_SORT = 'surname';

// The birth surname. Packs built from WikiTree carry it; for older packs and imports the WikiTree ID starts with it
// ("Bagby-165"), and the last word of the name is the last resort.
export function surnameOf(p) {
  if (p.lastNameAtBirth) return p.lastNameAtBirth;
  const m = /^(.+)-\d+$/.exec(p.id || '');
  if (m && !/^unknown$/i.test(m[1])) return m[1].replace(/_/g, ' ');
  const words = String(p.name || '').trim().split(/\s+/);
  return words[words.length - 1] || '';
}

const text = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
const END = Number.MAX_SAFE_INTEGER;

// People with no date, or no relationship, go last whichever way it is sorted.
const dateKey = (d) => { const y = parseYear(d); return y === null ? END : y * 10000 + (Number((/^\d{4}-(\d{2})-(\d{2})/.exec(d || '') || [])[1]) || 0) * 100 + (Number((/^\d{4}-\d{2}-(\d{2})/.exec(d || '') || [])[1]) || 0); };

// Direct and household kin first, then cousins by how far back the shared ancestor is, then marriage connections.
export function closeness(p) {
  const r = p.relation;
  if (!r || !r.kind || r.kind === 'unknown') return END - 1;
  if (r.kind === 'untraced') return END;
  const n = Number(r.generations ?? r.distance ?? r.degrees) || 0;
  if (['self', 'ancestor', 'descendant', 'spouse', 'sibling'].includes(r.kind)) return n;
  if (r.kind === 'cousin') return 1000 + n;
  return 2000 + n; // connection, or an older pack's own wording
}

export function sortPeople(people, by = DEFAULT_SORT) {
  const bySurname = (a, b) => text(surnameOf(a), surnameOf(b)) || text(a.name, b.name) || dateKey(a.birth && a.birth.date) - dateKey(b.birth && b.birth.date);
  const cmp = {
    surname: bySurname,
    birth: (a, b) => dateKey(a.birth && a.birth.date) - dateKey(b.birth && b.birth.date) || bySurname(a, b),
    death: (a, b) => dateKey(a.death && a.death.date) - dateKey(b.death && b.death.date) || bySurname(a, b),
    relation: (a, b) => closeness(a) - closeness(b) || bySurname(a, b),
  }[by] || bySurname;
  return [...people].sort(cmp);
}
