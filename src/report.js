// Imports the JSON export of the Genealogy Report app into a tour pack.
// The export already carries bios, cemeteries and relationship labels, which
// the WikiTree Plus tables lack. Living people are excluded by the report
// itself; buildPack() checks again.

import { buildPack } from './pack.js';

export function isReportJson(obj) {
  return !!obj && Array.isArray(obj.people) && typeof obj.generator === 'object' && 'schemaVersion' in obj;
}

// Biographies can end with sections that should not be spoken at a graveside:
// DNA match notes name living people, and sources are footnote noise.
const CUT_FROM = /\n\s*\n(DNA Statements?|Sources?|Research Notes?|Acknowledg\w+|See also)\s*\n/i;

export function cleanBio(text) {
  if (!text) return '';
  const m = CUT_FROM.exec('\n\n' + text);
  const kept = m ? ('\n\n' + text).slice(0, m.index) : text;
  return kept.trim();
}

const placeOf = (x) => (x && x.place) || '';

export function reportToPack(report, { name, now } = {}) {
  if (!isReportJson(report)) throw new Error('This does not look like a Genealogy Report JSON export.');
  const root = report.people.find((p) => p.ahnentafel === 1) || report.people[0];
  const rootName = root ? root.name : '';

  const records = report.people.map((p) => {
    const cems = (p.cemeteries || []).map((c) => c.category).filter(Boolean);
    const rel = p.relationship && p.relationship !== 'self' && rootName ? `the ${p.relationship} of ${rootName}` : '';
    return {
      id: p.wikiTreeId,
      userId: p.id ? String(p.id) : '',
      name: p.name,
      gender: p.gender || '',
      birth: { date: (p.birth && p.birth.date) || '', place: placeOf(p.birth) },
      death: { date: (p.death && p.death.date) || '', place: placeOf(p.death) },
      categories: [...cems, ...(p.categories || []).filter((c) => !cems.includes(c))],
      cemeteryCategories: cems,
      bio: cleanBio(p.biography),
      relationship: rel,
      wikiTreeUrl: p.wikiTreeUrl || '',
    };
  });

  const pack = buildPack(records, {
    name: name || `Report: ${rootName}`,
    source: `Genealogy Report ${report.generator?.version || ''}`.trim(),
    now,
  });
  pack.root = { wikiTreeId: report.root?.wikiTreeId || '', name: rootName };
  return pack;
}
