// Is this text language at all? A small model on a phone can break down into "the the the" or the same
// name on every line. The fact checks look for invented facts; this looks for text that is not a story.

const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);

export function looksBroken(text, { minWords = 8 } = {}) {
  const t = String(text || '').trim();
  const w = words(t);
  if (w.length < minWords) return true;

  // the same word four or more times in a row
  let run = 1;
  for (let i = 1; i < w.length; i++) {
    run = w[i] === w[i - 1] ? run + 1 : 1;
    if (run >= 4) return true;
  }

  // a few words over and over
  if (w.length >= 25 && new Set(w).size / w.length < 0.4) return true;

  // the same line three or more times
  const lines = t.split(/\n+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  const seen = new Map();
  for (const l of lines) seen.set(l, (seen.get(l) || 0) + 1);
  if ([...seen.values()].some((n) => n >= 3)) return true;

  // a column of fragments instead of sentences
  if (lines.length >= 12 && w.length / lines.length < 3) return true;

  // a long run with no sentence ending at all
  if (w.length >= 30 && !/[.!?]/.test(t)) return true;
  return false;
}
