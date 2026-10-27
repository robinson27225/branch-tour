import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, getClip, hasClip, clipKey, MediaStore, friendlyError, VOICE_DEFAULTS, storyKey } from '../src/voice.js';

const audio = () => new Blob(['ID3fake'], { type: 'audio/mpeg' });
const okFetch = (calls = []) => async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, blob: async () => audio() }; };

test('synthesize posts the documented request', async () => {
  const calls = [];
  const blob = await synthesize({ text: 'Hello', apiKey: 'k123', voiceId: 'V1', modelId: 'M1', fetchFn: okFetch(calls) });
  assert.equal(blob.type, 'audio/mpeg');
  const { url, init } = calls[0];
  assert.match(url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/V1\?output_format=mp3_44100_128$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['xi-api-key'], 'k123');
  assert.deepEqual(JSON.parse(init.body), { text: 'Hello', model_id: 'M1' });
});

test('synthesize: no key, bad key, quota, bad voice, offline all give plain messages', async () => {
  await assert.rejects(synthesize({ text: 'x' }), /API key/);
  const bad = (status) => async () => ({ ok: false, status });
  await assert.rejects(synthesize({ text: 'x', apiKey: 'k', fetchFn: bad(401) }), /did not accept/);
  await assert.rejects(synthesize({ text: 'x', apiKey: 'k', fetchFn: bad(429) }), /credit/);
  await assert.rejects(synthesize({ text: 'x', apiKey: 'k', fetchFn: bad(422) }), /Voice ID/);
  await assert.rejects(synthesize({ text: 'x', apiKey: 'k', fetchFn: async () => { throw new TypeError('net'); } }), /online/);
  assert.match(friendlyError(500), /500/);
});

test('clips are made once, then served from the device', async () => {
  const store = new MediaStore('t'); const calls = [];
  const settings = { elevenKey: 'k' };
  assert.equal(await hasClip('Hi', settings, store), false);
  const a = await getClip({ text: 'Hi', settings, store, fetchFn: okFetch(calls) });
  const b = await getClip({ text: 'Hi', settings, store, fetchFn: okFetch(calls) });
  assert.equal(a.fromCache, false); assert.equal(b.fromCache, true); assert.equal(calls.length, 1);
  assert.equal(await hasClip('Hi', settings, store), true);
  assert.match(calls[0].url, new RegExp(VOICE_DEFAULTS.voiceId));
});

test('a different text, voice or model is a different clip', async () => {
  const a = await clipKey('Hi', 'V1', 'M1');
  assert.notEqual(a, await clipKey('Hi!', 'V1', 'M1'));
  assert.notEqual(a, await clipKey('Hi', 'V2', 'M1'));
  assert.notEqual(a, await clipKey('Hi', 'V1', 'M2'));
  assert.equal(a, await clipKey('Hi', 'V1', 'M1'));
});

test('stories round-trip as JSON and can be deleted', async () => {
  const store = new MediaStore('t2'); const k = storyKey('My pack', 'Test-1');
  await store.putJson(k, { text: 'Once.', source: 'gemma3' });
  assert.deepEqual(await store.getJson(k), { text: 'Once.', source: 'gemma3' });
  await store.delete(k);
  assert.equal(await store.getJson(k), null);
});
