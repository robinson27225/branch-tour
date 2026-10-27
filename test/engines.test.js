import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOllama, describeOllama, pullCommand, serveCommand } from '../src/ollama.js';
import { BROWSER_MODELS, webGpuAvailable, isDownloaded, loadModel, generatorFor, removeModel, isLoaded } from '../src/webllm.js';
import { narrate, engineOf } from '../src/narrate.js';

const person = { id: 'S-1', name: 'Ada Sample', gender: 'Female', birth: { date: '1850', place: 'Raton' }, death: { date: '1921', place: 'Raton' } };
const place = { kind: 'cemetery', name: 'Fairmont Cemetery, Raton' };
const tags = (names) => async () => ({ ok: true, status: 200, json: async () => ({ models: names.map((name) => ({ name })) }) });

test('ollama commands name this page as the allowed origin', () => {
  assert.equal(pullCommand('gemma3:latest'), 'ollama pull gemma3');
  assert.equal(serveCommand('https://apps.wikitree.com'), 'OLLAMA_ORIGINS="https://apps.wikitree.com" ollama serve');
});

test('checkOllama: ready, model missing, unreachable, error status', async () => {
  const ready = await checkOllama('http://localhost:11434/', 'gemma3', tags(['gemma3:latest', 'llama3:8b']));
  assert.deepEqual([ready.ok, ready.hasModel], [true, true]);
  assert.match(describeOllama(ready, 'gemma3', 'https://x'), /Connected/);

  const missing = await checkOllama('http://localhost:11434', 'gemma3', tags(['llama3:8b']));
  assert.equal(missing.hasModel, false);
  assert.match(describeOllama(missing, 'gemma3', 'https://x'), /ollama pull gemma3/);

  const down = await checkOllama('http://localhost:11434', 'gemma3', async () => { throw new TypeError('Failed to fetch'); });
  assert.match(describeOllama(down, 'gemma3', 'https://apps.wikitree.com'), /OLLAMA_ORIGINS="https:\/\/apps\.wikitree\.com" ollama serve/);

  const bad = await checkOllama('http://localhost:11434', 'gemma3', async () => ({ ok: false, status: 403 }));
  assert.match(describeOllama(bad, 'gemma3', 'x'), /403/);
  assert.equal(ready.models.length, 2);
  assert.equal((await checkOllama('http://x', 'gemma3:2b', tags(['gemma3:latest']))).hasModel, false); // an exact tag is asked for
});

test('webllm: both Gemma choices, WebGPU check, load once, generate, remove', async () => {
  assert.ok(BROWSER_MODELS.every((m) => /gemma/i.test(m.id)));
  assert.equal(webGpuAvailable({ gpu: {} }), true);
  assert.equal(webGpuAvailable({}), false);
  assert.equal(webGpuAvailable(undefined), false);

  const calls = { create: 0, deleted: [] };
  const lib = {
    hasModelInCache: async (id) => id === 'cached',
    CreateMLCEngine: async (id, { initProgressCallback }) => {
      calls.create++; initProgressCallback({ progress: 0.5, text: 'half' }); initProgressCallback({ progress: 1, text: 'done' });
      return { chat: { completions: { create: async (req) => { calls.req = req; return { choices: [{ message: { content: ' Ada rests here. ' } }] }; } } }, unload: async () => {} };
    },
    deleteModelAllInfoInCache: async (id) => calls.deleted.push(id),
  };
  assert.equal(await isDownloaded('cached', lib), true);
  assert.equal(await isDownloaded('nope', lib), false);

  const seen = [];
  const e1 = await loadModel('m1', { lib, onProgress: (p) => seen.push(p.progress) });
  const e2 = await loadModel('m1', { lib });
  assert.equal(e1, e2); assert.equal(calls.create, 1); assert.deepEqual(seen, [0.5, 1]); assert.ok(isLoaded('m1'));

  const out = await generatorFor(e1)('PROMPT');
  assert.equal(out, ' Ada rests here. ');
  assert.deepEqual(calls.req.messages, [{ role: 'user', content: 'PROMPT' }]);
  await removeModel('m1', lib);
  assert.deepEqual(calls.deleted, ['m1']); assert.equal(isLoaded('m1'), false);
});

test('narrate with the browser engine: used when grounded, template otherwise', async () => {
  const gen = async () => 'Ada Sample rests here in Raton. She was born in 1850 and she lived there until 1921.';
  const ok = await narrate(person, place, { engine: 'browser' }, fetch, gen);
  assert.equal(ok.source, 'Gemma in this browser');
  assert.equal((await narrate(person, place, { engine: 'browser' }, fetch, async () => 'She sailed in 1861.')).source, 'template');
  const none = await narrate(person, place, { engine: 'browser' }, fetch, null);
  assert.equal(none.source, 'template'); assert.match(none.reason, /not downloaded/);
  const boom = await narrate(person, place, { engine: 'browser' }, fetch, async () => { throw new Error('GPU lost'); });
  assert.match(boom.reason, /could not run/);
});

test('engineOf keeps old settings working', () => {
  assert.equal(engineOf({}), 'template');
  assert.equal(engineOf({ useModel: true }), 'ollama');
  assert.equal(engineOf({ engine: 'browser', useModel: true }), 'browser');
});

test('ollama engine sends num_predict and names the model in the source', async () => {
  let body;
  const f = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ response: 'Ada Sample rests here in Raton. She was born in 1850 and she lived there until 1921.' }) }; };
  const r = await narrate(person, place, { engine: 'ollama', model: 'gemma3' }, f);
  assert.equal(r.source, 'gemma3 via Ollama'); assert.equal(body.options.num_predict, 260); assert.equal(body.stream, false);
});

import { WINDOW_ATTEMPTS, friendlyLoadError } from '../src/webllm.js';
import { looksBroken } from '../src/quality.js';

const windowError = () => Object.assign(new Error('Only one of context_window_size and sliding_window_size can be positive. Got: context_window_size: 4096, sliding_window_size: 512'), { name: 'WindowSizeConfigurationError' });
const GOOD = 'Anna Example was a beekeeper who lived in the village of Millbrook.';
const GARBLE = 'Anna Anna Anna Anna Anna Anna Anna';
// accept(opts): does the model load with these settings?  garbled(opts): does it then write garbage?
const libWith = (accept, calls, garbled = () => false) => ({
  MLCEngine: class {
    async reload(id, opts) { this.opts = opts; calls.push(opts); if (!accept(opts)) throw windowError(); }
    async unload() {}
    get chat() { const self = this; return { completions: { create: async () => ({ choices: [{ message: { content: garbled(self.opts) ? GARBLE : GOOD } }] }) } }; }
  },
});
const fakeStore = () => { const m = new Map(); globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; return m; };
const FULL_OFF = { context_window_size: -1, attention_sink_size: 0 };
const SLIDING_OFF = { sliding_window_size: -1 };

test('Gemma 3 tries its own sliding-window setting first and skips the preset known to fail', async () => {
  fakeStore(); const calls = [];
  await loadModel('gemma3-test-A', { lib: libWith(() => true, calls) });
  assert.deepEqual(calls, [FULL_OFF]);
  delete globalThis.localStorage;
});

test('a setting that is refused at load is skipped for the next one', async () => {
  fakeStore(); const calls = [];
  await loadModel('gemma3-test-B', { lib: libWith((o) => o && o.sliding_window_size === -1, calls) });
  assert.deepEqual(calls, [FULL_OFF, SLIDING_OFF]);
  delete globalThis.localStorage;
});

test('a setting that loads but writes garbage is rejected, and the next is tried (the phone case)', async () => {
  const store = fakeStore(); const calls = [];
  const engine = await loadModel('gemma3-test-C', { lib: libWith(() => true, calls, (o) => o && o.context_window_size === -1) });
  assert.ok(engine);
  assert.deepEqual(calls, [FULL_OFF, SLIDING_OFF]);
  assert.equal(store.get('branches-window2:gemma3-test-C'), JSON.stringify(SLIDING_OFF)); // only the setting that wrote sensibly is kept
  delete globalThis.localStorage;
});

test('if every setting writes garbage the model is not switched on, with a plain explanation, and nothing is remembered', async () => {
  const store = fakeStore();
  const err = await loadModel('gemma3-test-D', { lib: libWith(() => true, [], () => true) }).catch((e) => e);
  assert.match(err.message, /^GARBLED/);
  assert.match(friendlyLoadError(err), /garbled text on this device/);
  assert.equal(store.size, 0);
  delete globalThis.localStorage;
});

test('a proven setting is remembered and used straight away, without the check', async () => {
  const store = fakeStore(); store.set('branches-window2:gemma3-test-E', JSON.stringify(SLIDING_OFF));
  const calls = [];
  await loadModel('gemma3-test-E', { lib: libWith(() => true, calls, () => true) }); // would be refused by the check, but it is not run
  assert.deepEqual(calls, [SLIDING_OFF]);
  // settings saved by the first version (old key) are ignored
  store.set('branches-window:gemma3-test-F', JSON.stringify(SLIDING_OFF));
  const calls2 = [];
  await loadModel('gemma3-test-F', { lib: libWith(() => true, calls2) });
  assert.deepEqual(calls2, [FULL_OFF]);
  delete globalThis.localStorage;
});

test('other models try the preset first', async () => {
  const store = fakeStore(); const calls = [];
  await loadModel('gemma-other-G', { lib: libWith(() => true, calls) });
  assert.deepEqual(calls, [undefined]);
  assert.equal(store.get('branches-window2:gemma-other-G'), 'null');
  delete globalThis.localStorage;
});

test('an error that is not about the window stops at once', async () => {
  fakeStore(); const calls = [];
  const boom = { MLCEngine: class { async reload(id, o) { calls.push(o); throw new Error('GPU device lost'); } } };
  await assert.rejects(loadModel('gemma-x-H', { lib: boom }), /GPU device lost/);
  assert.equal(calls.length, 1);
  assert.equal(friendlyLoadError(new Error('Out of memory')), 'Out of memory');
  assert.equal(WINDOW_ATTEMPTS.length, 3);
  delete globalThis.localStorage;
});

test('generation asks for loop-resistant sampling and a token limit', async () => {
  let req;
  const engine = { chat: { completions: { create: async (r) => { req = r; return { choices: [{ message: { content: 'ok' } }] }; } } } };
  await generatorFor(engine)('P', { maxTokens: 60 });
  assert.equal(req.max_tokens, 60); assert.equal(req.repetition_penalty, 1.1); assert.equal(req.top_p, 0.9);
  await generatorFor(engine)('P');
  assert.equal(req.max_tokens, 260);
});

test('looksBroken catches the output seen on the phone, and lets real stories through', () => {
  const johnCook = Array(30).fill('John Cook').join('\n');
  const the = 'John Cook\nwas a man of the\nThe\nHe was a man of\nthe\na man of\n' + Array(30).fill('the').join('\n');
  const laodicia = 'Laodicia Purvis\nThe visitor\u2019s family history is a\nsignificant, and a quiet woman.\nLaodicia Purvis was a woman\n' + Array(20).fill('Laodicia').join('\n');
  for (const bad of [johnCook, the, laodicia, 'the the the the the the the the', 'Short.', '', 'word '.repeat(40)]) assert.equal(looksBroken(bad), true, bad.slice(0, 30));
  const good = 'Carl William Robinson Sr. is resting here at Fern Hill Cemetery in Aberdeen, Washington. He was born in Burlington, Des Moines, Iowa, on November 13, 1933. Carl was the second of three children born to Firman Joseph Robinson and Leona Catherine Budd.';
  assert.equal(looksBroken(good), false);
  assert.equal(looksBroken('Anna Example was a beekeeper.', { minWords: 3 }), false);
});

test('narrate refuses garbled model text and keeps it for the member to see', async () => {
  const r = await narrate(person, place, { engine: 'browser' }, fetch, async () => Array(20).fill('John Cook').join('\n'));
  assert.equal(r.source, 'template');
  assert.match(r.reason, /garbled/);
  assert.match(r.attempt, /John Cook/);
});

const CLEAN = 'Ada Sample rests here in Raton. She was born in 1850 and she lived there until 1921.';
const DASHES = 'Ada Sample was a woman of Raton\n' + Array(25).fill('- ').join('\n');

test('Gemma in the browser gets three tries: a garbled first answer is followed by a clean second one', async () => {
  const seen = [], retries = [];
  const gen = async (prompt, o) => { seen.push(o.attempt); return o.attempt === 0 ? DASHES : CLEAN; };
  const r = await narrate(person, place, { engine: 'browser' }, fetch, gen, (n, tries, why) => retries.push([n, tries, why]));
  assert.equal(r.source, 'Gemma in this browser');
  assert.equal(r.text, CLEAN);
  assert.deepEqual(seen, [0, 1]);
  assert.deepEqual(retries, [[2, 3, 'the model\'s answer was garbled']]);
});

test('after three bad answers the plain story is used, the last answer is kept to show, and the reason says how many tries', async () => {
  let calls = 0;
  const r = await narrate(person, place, { engine: 'browser' }, fetch, async () => { calls++; return calls < 3 ? 'She sailed in 1861.' : DASHES; });
  assert.equal(calls, 3);
  assert.equal(r.source, 'template');
  assert.match(r.reason, /garbled.*3 tries/);
  assert.equal(r.attempt, DASHES.trim());
});

test('a model that throws is not retried, and Ollama is asked only once', async () => {
  let calls = 0;
  const boom = await narrate(person, place, { engine: 'browser' }, fetch, async () => { calls++; throw new Error('GPU lost'); });
  assert.equal(calls, 1); assert.match(boom.reason, /could not run/);
  let asked = 0;
  const f = async () => { asked++; return { ok: true, status: 200, json: async () => ({ response: 'She sailed in 1861.' }) }; };
  const r = await narrate(person, place, { engine: 'ollama', model: 'gemma3' }, f);
  assert.equal(asked, 1); assert.equal(r.source, 'template');
});

test('each retry samples more carefully than the one before', async () => {
  const seen = [];
  const engine = { chat: { completions: { create: async (o) => { seen.push([o.temperature, o.repetition_penalty]); return { choices: [{ message: { content: 'x' } }] }; } } } };
  const gen = generatorFor(engine);
  await gen('p', { attempt: 0 }); await gen('p', { attempt: 1 }); await gen('p', { attempt: 9 });
  assert.deepEqual(seen, [[0.4, 1.1], [0.2, 1.15], [0.3, 1.2]]);
});
