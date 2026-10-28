// Stories written on one device (a laptop running Ollama writes better ones than a phone) can be saved to a file and
// loaded on another. Only the story text and where it came from travel; a loaded story is checked against the record
// again before it is used, the same as one made on the device.

import { storyKey } from './voice.js';

export const STORIES_FORMAT = 'tour-of-the-branches-stories';

export async function exportStories(media, pack, people = pack.people) {
  const stories = {};
  for (const p of people) {
    const s = await media.getJson(storyKey(pack.name, p.id));
    if (s && s.text) stories[p.id] = { text: s.text, source: s.source, reason: s.reason || '' };
  }
  return { format: STORIES_FORMAT, version: 1, pack: pack.name, savedAt: new Date().toISOString(), stories };
}

// Returns { loaded, skipped }: a story is skipped when its person is not in this pack or it is not a story.
export async function importStories(media, pack, data) {
  if (!data || data.format !== STORIES_FORMAT || typeof data.stories !== 'object') throw new Error('This is not a saved stories file from Tour of the Branches.');
  const ids = new Set(pack.people.map((p) => p.id));
  let loaded = 0, skipped = 0;
  for (const [id, s] of Object.entries(data.stories)) {
    if (!ids.has(id) || !s || typeof s.text !== 'string' || !s.text.trim() || typeof s.source !== 'string') { skipped++; continue; }
    await media.putJson(storyKey(pack.name, id), { text: s.text, source: s.source, reason: s.reason || '' });
    loaded++;
  }
  return { loaded, skipped };
}
