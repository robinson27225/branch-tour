// Optional spoken narration with ElevenLabs. The member brings their own API key.
// Only the finished story text is sent to ElevenLabs; packs, GPS and the model stay on the device.
// Every story and every clip is kept on the device once made, so a cemetery with no signal still talks.

export const VOICE_DEFAULTS = {
  voiceId: 'JBFqnCBsd6RMkjVDRZzb', // "George", a warm British storyteller (ElevenLabs premade); any Voice ID from the member's account works
  modelId: 'eleven_flash_v2_5',    // low cost and fast; eleven_multilingual_v2 sounds richer for more credit
};

// Premade voices listed by ElevenLabs without an account, offered as suggestions.
export const VOICE_SUGGESTIONS = [
  ['JBFqnCBsd6RMkjVDRZzb', 'George: warm storyteller, British'],
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily: velvety, British'],
  ['pqHfZKP75CvOlQylNhV4', 'Bill: wise, mature'],
  ['nPczCjzI2devNBz1zQrb', 'Brian: deep, comforting'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice: clear, British'],
  ['SAz9YHcvj6GT2YYXdXww', 'River: calm, neutral'],
];

const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_128';

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const clipKey = async (text, voiceId, modelId) => 'clip/' + (await sha256Hex(`${modelId}|${voiceId}|${text}`));
// Bump STORY_VERSION when the narration changes, so saved stories are made again.
const STORY_VERSION = 3;
export const storyKey = (packName, personId) => `story${STORY_VERSION}/${encodeURIComponent(packName)}/${encodeURIComponent(personId)}`;

export function friendlyError(status, detail = '') {
  if (status === 401) return 'ElevenLabs did not accept that API key.';
  if (status === 402 || status === 429) return 'ElevenLabs says the account is out of credit or rate limited. Try again later.';
  if (status === 404 || status === 422) return 'ElevenLabs could not use that Voice ID or model. Check them on the Narrator tab.';
  return `ElevenLabs returned an error (${status})${detail ? ': ' + detail : ''}.`;
}

export async function synthesize({ text, apiKey, voiceId = VOICE_DEFAULTS.voiceId, modelId = VOICE_DEFAULTS.modelId, fetchFn = fetch }) {
  if (!apiKey) throw new Error('Add your ElevenLabs API key on the Narrator tab first.');
  let res;
  try {
    res = await fetchFn(`${ENDPOINT}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: modelId }),
    });
  } catch {
    throw new Error('Could not reach ElevenLabs. Are you online?');
  }
  if (!res.ok) throw new Error(friendlyError(res.status));
  return res.blob();
}

// Device storage for clips and stories. Uses the Cache API where there is one
// (needs HTTPS); otherwise a map that lasts until the page closes.
export class MediaStore {
  constructor(name = 'ghost-tour-media') { this.name = name; this.mem = new Map(); }

  async _cache() {
    try { return typeof caches !== 'undefined' ? await caches.open(this.name) : null; } catch { return null; }
  }
  _req(key) { return new Request('https://ghost-tour.invalid/' + key); }

  async putBlob(key, blob) {
    const c = await this._cache();
    if (c) { try { await c.put(this._req(key), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } })); return; } catch { /* fall through */ } }
    this.mem.set(key, blob);
  }
  async getBlob(key) {
    const c = await this._cache();
    if (c) { const r = await c.match(this._req(key)); if (r) return r.blob(); }
    return this.mem.get(key) || null;
  }
  async putJson(key, value) { await this.putBlob(key, new Blob([JSON.stringify(value)], { type: 'application/json' })); }
  async getJson(key) {
    const b = await this.getBlob(key);
    if (!b) return null;
    try { return JSON.parse(await b.text()); } catch { return null; }
  }
  async delete(key) {
    const c = await this._cache();
    if (c) await c.delete(this._req(key));
    this.mem.delete(key);
  }
}

// Returns { blob, fromCache }. A clip is made once per (text, voice, model) and then reused.
export async function getClip({ text, settings, store, fetchFn = fetch }) {
  const voiceId = settings.voiceId || VOICE_DEFAULTS.voiceId;
  const modelId = settings.voiceModel || VOICE_DEFAULTS.modelId;
  const key = await clipKey(text, voiceId, modelId);
  const hit = await store.getBlob(key);
  if (hit) return { blob: hit, fromCache: true };
  const blob = await synthesize({ text, apiKey: settings.elevenKey, voiceId, modelId, fetchFn });
  await store.putBlob(key, blob);
  return { blob, fromCache: false };
}

export async function hasClip(text, settings, store) {
  const key = await clipKey(text, settings.voiceId || VOICE_DEFAULTS.voiceId, settings.voiceModel || VOICE_DEFAULTS.modelId);
  return !!(await store.getBlob(key));
}
