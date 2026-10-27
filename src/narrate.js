// Grounded narration. The model only ever sees the facts in the pack.
// If the model is unreachable, or it invents a year, we fall back to a
// plain template built from the same facts.

import { parseYear } from './pack.js';
import { looksBroken } from './quality.js';

export const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://localhost:11434',
  model: 'gemma3',
  tone: 'warm',
};

// Enough for a short story, small enough for a small local model.
const BIO_CHARS = 4000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "1933-11-13" -> "13 November 1933", "1933-11" -> "November 1933", "1933" -> "1933". Other text is left as it is.
export function humanDate(d) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(d || '');
  if (!m) return d || '';
  const [, y, mo, day] = m;
  const month = MONTHS[Number(mo) - 1];
  if (month && Number(day) > 0) return `${Number(day)} ${month} ${y}`;
  return month ? `${month} ${y}` : y;
}

// " on 13 November 1933" for a full date, " in November 1933" or " in 1933" for less.
export function datePhrase(d) {
  const h = humanDate(d);
  if (!h) return '';
  return /^\d{1,2} [A-Za-z]+ \d{4}$/.test(h) ? ` on ${h}` : ` in ${h}`;
}

export function factsFor(person, place, { withBio = true } = {}) {
  const f = [];
  f.push(`Name: ${person.name}`);
  if (person.gender) f.push(`Gender: ${person.gender}`);
  if (person.birth.date || person.birth.place)
    f.push(`Born: ${[humanDate(person.birth.date), person.birth.place].filter(Boolean).join(', in ')}`);
  if (person.death.date || person.death.place)
    f.push(`Died: ${[humanDate(person.death.date), person.death.place].filter(Boolean).join(', in ')}`);
  if (place) f.push(`Resting place: ${place.name}`);
  if (person.relationship) f.push(`Relationship to the visitor: ${person.relationship.replace(/^your /, "the visitor's ")}`);
  if (person.relation && person.relation.via) f.push(`Shared ancestor with the visitor: ${person.relation.via}`);
  const fam = person.family || {};
  if (fam.parents && fam.parents.length) f.push(`Parents: ${fam.parents.join(' and ')}`);
  for (const s of (fam.spouses || []).slice(0, 3)) {
    f.push(`Married: ${[s.name, humanDate(s.date), s.place].filter(Boolean).join(', ')}`);
  }
  if (withBio && person.bio) f.push(`Biography notes: ${person.bio.slice(0, BIO_CHARS)}`);
  return f;
}

// Small models drown in a long biography, so the prompt carries a short selection of its story
// sentences (the same ones the plain narration uses), not the whole text.
export function bioForPrompt(bio, max = 750) {
  if (!bio) return '';
  return bioExcerpt(bio, max) || bio.slice(0, 500);
}

export function buildPrompt(person, place, tone = 'warm') {
  const facts = factsFor(person, place, { withBio: false }).map((l) => '- ' + l).join('\n');
  const story = bioForPrompt(person.bio);
  return [
    'You are a quiet, respectful guide speaking to a visitor at a graveside.',
    `Tell this person's story in 4 to 6 short spoken sentences (about 70 to 110 words), in a ${tone} tone.`,
    'Rules:',
    '- Use ONLY the facts below. Never invent places, people, dates, jobs, feelings, or how they were remembered.',
    '- Start with their name and where they rest.',
    story
      ? '- Then retell at least two concrete details from "From the biography" in your own simple words.'
      : '- Then say when and where they were born and died, and who their family was, if listed.',
    '- Do not say they were loved, remembered, admired, peaceful or part of the community unless the facts say so.',
    '- Do not say how many children, siblings or other relatives anyone had unless that number is written in the facts. Say nothing about the visitor.',
    '- No lists, no headings, no quotation marks.',
    '',
    'Facts:',
    facts,
    ...(story ? ['', 'From the biography:', story] : []),
    '',
    'Story:',
  ].join('\n');
}

const approxYears = (d) => {
  const y = parseYear(d);
  return y === null ? '' : ` in ${y}`;
};

// A few whole sentences from the biography, for the plain narration. Birth and death
// statements are skipped because the narration already says those, as are picture
// captions and other lines that are not sentences. Nothing is rewritten.
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z"'(])/;
const VITAL_RE = /\b(was born|were born|born on|born in|was baptized|was baptised|died|passed away|was buried)\b[^.]*\d{4}/i;

export function bioExcerpt(bio, max = 380, skip = () => false) {
  if (!bio) return '';
  const sentences = bio.split(/\n+/)
    .filter((line) => line.trim().length >= 40 && /[.!?"')]$/.test(line.trim()))
    .flatMap((line) => line.trim().split(SENTENCE_SPLIT));
  const story = sentences.filter((s) => !VITAL_RE.test(s) && !skip(s));
  const pool = story.length ? story : sentences;
  let out = '';
  for (const s of pool) {
    if (out && (out + ' ' + s).length > max) break;
    if (!out && s.length > max) return '';
    out = out ? out + ' ' + s : s;
  }
  return out;
}

const childWord = (g) => (g === 'Male' ? 'Son' : g === 'Female' ? 'Daughter' : 'Child');

// Deterministic narration from the facts alone.
export function templateNarration(person, place) {
  const parts = [];
  const where = place && place.kind === 'cemetery' ? ` at ${place.name.split(',')[0]}` : '';
  parts.push(`Here${where} we remember ${person.name}.`);
  if (person.birth.date || person.birth.place) {
    const bp = person.birth.place ? ` in ${person.birth.place}` : '';
    parts.push(`Born${datePhrase(person.birth.date)}${bp}.`);
  }
  if (person.death.date || person.death.place) {
    const dp = person.death.place ? ` in ${person.death.place}` : '';
    parts.push(`Died${datePhrase(person.death.date)}${dp}.`);
  }
  const fam = person.family || {};
  if (fam.parents && fam.parents.length) parts.push(`${childWord(person.gender)} of ${fam.parents.join(' and ')}.`);
  for (const s of (fam.spouses || []).slice(0, 2)) {
    const when = datePhrase(s.date);
    const at = s.place ? `${when ? ',' : ''} in ${s.place}` : '';
    parts.push(`Married${s.name ? ' ' + s.name : ''}${when}${at}.`);
  }
  if (person.relationship) {
    const via = person.relation && person.relation.via;
    parts.push(`They were ${person.relationship}${via ? `, through their shared ancestor ${via}` : ''}.`);
  }
  // "She married William Bird in 1881." only says again what the marriage line above already said. A list of marriages
  // (joined with ";") can name someone who has no profile, so that stays.
  const spouseNames = (fam.spouses || []).map((sp) => (sp.name || '').replace(/\s*\(.*$/, '').toLowerCase()).filter(Boolean);
  const restatesMarriage = (sentence) => /\bmarried\b/i.test(sentence) && !sentence.includes(';') && spouseNames.some((n) => sentence.toLowerCase().includes(n));
  const excerpt = bioExcerpt(person.bio, 380, restatesMarriage);
  if (excerpt) parts.push(excerpt);
  return parts.join(' ');
}

const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/g;

// Capitalised words in the middle of a sentence are names and places. Common words that may be capitalised anyway.
const ALWAYS_OK = new Set(['i', 'god', 'mr', 'mrs', 'ms', 'dr', 'sr', 'jr', 'sir',
  // ordinary words a model capitalises after a colon, a quote mark, a dash or a new line
  'let', 'here', 'now', 'then', 'this', 'that', 'these', 'those', 'there', 'they', 'she', 'her', 'his', 'its', 'our', 'their', 'your', 'you',
  'and', 'but', 'yet', 'for', 'with', 'after', 'before', 'when', 'while', 'where', 'what', 'who', 'why', 'how', 'because', 'since', 'though',
  'today', 'once', 'every', 'each', 'some', 'many', 'much', 'still', 'also', 'perhaps', 'maybe', 'yes', 'okay', 'please',
  'remember', 'imagine', 'picture', 'consider', 'think', 'take', 'stand', 'walk', 'listen', 'look', 'come', 'welcome', 'rest', 'resting', 'born', 'died']);

// Stock phrases a small model reaches for when it has little to say. They claim feelings and standing the
// record never states, so they are refused unless the record uses the same words.
const FILLER = ['peaceful', 'remembered as', 'beloved', 'part of this community', 'rest in peace', 'legacy', 'will be remembered'];

// "a father to one child", "five sisters": a count of relatives is a claim the record must make itself.
const COUNT_RE = /\b(?:an? only|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:\w+\s+)?(?:child|children|son|sons|daughter|daughters|brother|brothers|sister|sisters|sibling|siblings|grandchild|grandchildren)\b/gi;

// Words the story uses that the record does not have: a year, or a name or place in mid-sentence.
// Returns the first offending word, or '' when the story sticks to the record.
export function ungroundedWord(text, person, place) {
  const facts = factsFor(person, place).join(' ');
  const years = new Set(facts.match(YEAR_RE) || []);
  for (const y of text.match(YEAR_RE) || []) if (!years.has(y)) return y;

  const lower = text.toLowerCase();
  for (const phrase of FILLER) if (lower.includes(phrase) && !facts.toLowerCase().includes(phrase)) return phrase;

  for (const claim of text.match(COUNT_RE) || []) if (!facts.toLowerCase().includes(claim.toLowerCase())) return claim;

  const known = new Set((facts.toLowerCase().match(/[a-z\u00c0-\u024f]+/g)) || []);
  // The first word after a full stop, colon, quote mark, dash or new line is capitalised anyway, so only later words say anything.
  let startsClause = true;
  for (const m of text.matchAll(/([A-Za-z\u00c0-\u024f]+(?:['\u2019][A-Za-z]+)?)|([.!?:;\n\r"\u201c\u201d(\u2014\u2013*#]|\s-\s)/g)) {
    if (m[2] !== undefined) { startsClause = true; continue; }
    if (startsClause) { startsClause = false; continue; }
    const word = m[1].replace(/['\u2019].*$/, ''); // Carl's -> Carl
    if (!/^[A-Z][a-z\u00e0-\u024f]{2,}$/.test(word)) continue;
    const w = word.toLowerCase();
    if (!known.has(w) && !ALWAYS_OK.has(w)) return word;
  }
  return '';
}

// True if the story only uses years, names and places that are in the record.
export function isGrounded(text, person, place) {
  return ungroundedWord(text, person, place) === '';
}

// "template" | "browser" (Gemma in this browser) | "ollama" (Gemma through Ollama on this computer).
// Older saved settings only had useModel, which meant Ollama.
export const engineOf = (s = {}) => s.engine || (s.useModel ? 'ollama' : 'template');

// A small model sometimes loses the thread (a loop of dashes, a repeated name) or invents a year. That is chance as much as
// fault: asking again, a little more carefully each time, usually gives a clean story, so the in-browser model gets this many tries.
export const BROWSER_TRIES = 3;

// `generate(prompt, { attempt }) -> text` is the in-browser model, passed in by the app when it is loaded.
// `onRetry(nextAttempt, tries, reason)` lets the screen say that another try is under way.
export async function narrate(person, place, settings = {}, fetchFn = fetch, generate = null, onRetry = () => {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const engine = engineOf(s);
  const fallback = (reason) => ({ text: templateNarration(person, place), source: 'template', reason });
  if (engine === 'template') return fallback('model off');
  const prompt = buildPrompt(person, place, s.tone);
  // '' when the text is good, otherwise why it was refused.
  const problemWith = (text) => {
    if (!text) return 'empty reply';
    if (looksBroken(text)) return 'the model\'s answer was garbled';
    const stray = ungroundedWord(text, person, place);
    return stray ? `the model mentioned "${stray}", which the record does not support` : '';
  };
  try {
    if (engine === 'browser') {
      if (!generate) return fallback('Gemma is not downloaded on this device');
      let last = { text: '', problem: '' };
      for (let attempt = 0; attempt < BROWSER_TRIES; attempt++) {
        const text = ((await generate(prompt, { attempt })) || '').trim();
        const problem = problemWith(text);
        if (!problem) return { text, source: 'Gemma in this browser' };
        last = { text, problem };
        if (attempt + 1 < BROWSER_TRIES) onRetry(attempt + 2, BROWSER_TRIES, problem);
      }
      const out = fallback(`${last.problem} (${BROWSER_TRIES} tries)`);
      return last.text ? { ...out, attempt: last.text } : out;
    }
    const res = await fetchFn(s.ollamaUrl.replace(/\/$/, '') + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.model, prompt, stream: false, options: { temperature: 0.4, num_predict: 260 } }),
    });
    if (!res.ok) return fallback(`model HTTP ${res.status}`);
    const text = (((await res.json()).response) || '').trim();
    const problem = problemWith(text);
    return problem ? (text ? { ...fallback(problem), attempt: text } : fallback(problem)) : { text, source: `${s.model} via Ollama` };
  } catch (e) {
    return fallback(engine === 'browser' ? 'Gemma could not run here' : 'model unreachable');
  }
}
