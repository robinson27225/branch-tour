// Gemma inside the browser with WebLLM (bundled in vendor/, Apache-2.0). WebGPU does the work on the
// device's own graphics chip. The weights are downloaded once, kept by the browser, and then run with no signal.

export const BROWSER_MODELS = [
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B: smaller, suits phones' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC-1k', label: 'Gemma 2 2B: better writing, suits laptops' },
  { id: 'gemma-2-2b-it-q4f32_1-MLC-1k', label: 'Gemma 2 2B, compatibility mode: slower, for devices that garble the others' },
];

import { looksBroken } from './quality.js';

export const webGpuAvailable = (nav = globalThis.navigator) => !!(nav && nav.gpu);

let libPromise = null;
const defaultLib = () => (libPromise ??= import('../vendor/web-llm.js'));

let loaded = null; // { id, engine }

export async function isDownloaded(modelId, lib) {
  return (lib || await defaultLib()).hasModelInCache(modelId);
}

// A model may use a full context window or a sliding window, not both. WebLLM's preset for Gemma 3 asks for
// a 4096-token window while the model's own config asks for a 512-token sliding window, so loading stops with
// "Only one of context_window_size and sliding_window_size can be positive". Which one the compiled model
// expects cannot be told from outside, so these are tried in turn and the one that works is remembered.
const WINDOW_CONFLICT = /Only one of context_window_size and sliding_window_size|attention_sink_size/i;
// Gemma 3 was built with a sliding window, so its own setting (the full window off) goes first. Switching the
// sliding window off instead loads fine but gives garbage once a prompt passes 512 tokens, so every setting that
// loads is also checked with a long prompt before it is trusted.
export const WINDOW_ATTEMPTS = [undefined, { sliding_window_size: -1 }, { context_window_size: -1, attention_sink_size: 0 }];
const GEMMA3_ATTEMPTS = [{ context_window_size: -1, attention_sink_size: 0 }, { sliding_window_size: -1 }];
const attemptsFor = (id) => (/^gemma3/i.test(id) ? GEMMA3_ATTEMPTS : WINDOW_ATTEMPTS); // the preset alone is known to fail

const MEMORY = 'branches-window2:'; // 2: settings saved by the first version were never checked, and gave garbage
const remembered = (id) => { try { const v = localStorage.getItem(MEMORY + id); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };
const remember = (id, opts) => { try { localStorage.setItem(MEMORY + id, JSON.stringify(opts ?? null)); } catch { /* optional */ } };

// Downloads the model if needed, then loads it onto the graphics chip. `onProgress({ progress, text })`.
export async function loadModel(modelId, { onProgress = () => {}, lib } = {}) {
  if (loaded && loaded.id === modelId) return loaded.engine;
  const l = lib || await defaultLib();
  const initProgressCallback = (p) => onProgress(p);
  if (!l.MLCEngine) { // a stand-in library, or an older one
    const engine = await l.CreateMLCEngine(modelId, { initProgressCallback });
    loaded = { id: modelId, engine };
    return engine;
  }
  const engine = new l.MLCEngine({ initProgressCallback });
  const known = remembered(modelId);
  const attempts = known !== undefined ? [known === null ? undefined : known] : attemptsFor(modelId);
  let last;
  for (const opts of attempts) {
    try {
      await engine.reload(modelId, opts);
      if (known === undefined) { // a setting not yet proven on this device: make sure the model writes sensibly with it
        onProgress({ progress: 1, text: 'Checking that Gemma writes sensibly on this device…' });
        if (!(await selfTest(engine))) { last = new Error('GARBLED: the model loaded but wrote broken text with this setting'); continue; }
      }
      remember(modelId, opts);
      loaded = { id: modelId, engine };
      return engine;
    } catch (e) {
      last = e;
      if (!WINDOW_CONFLICT.test(String((e && e.message) || e))) throw e;
    }
  }
  if (known !== undefined) { try { localStorage.removeItem(MEMORY + modelId); } catch { /* optional */ } } // it stopped working: start again next time
  throw last;
}

// A long prompt, longer than a 512-token window, then a short question. A model set up wrongly answers with
// repeated words or the same name on every line; one set up properly answers in a sentence.
const SELF_TEST_PROMPT =
  'Anna Example was born in the village of Millbrook in 1850 and died there in 1921. She kept bees behind the church and sold honey to her neighbours every summer. '.repeat(18) +
  '\n\nIn one short sentence, say who Anna Example was.';

async function selfTest(engine) {
  try {
    const text = await generatorFor(engine)(SELF_TEST_PROMPT, { maxTokens: 60 });
    return !looksBroken(text, { minWords: 3 });
  } catch { return false; }
}

// What to tell the member when the model cannot be set up.
export function friendlyLoadError(err) {
  const m = String((err && err.message) || err);
  if (/^GARBLED/.test(m)) {
    return 'Gemma loaded but wrote garbled text on this device, so it was not switched on. The plain narration is used instead. Try the other Gemma in the list, or a laptop with Chrome.';
  }
  if (WINDOW_CONFLICT.test(m)) {
    return 'This Gemma build could not be set up with the version of the runtime in this app. Choose the other Gemma in the list and download that one instead.';
  }
  return m;
}

export const isLoaded = (modelId) => !!loaded && loaded.id === modelId;

// Each retry is a little more careful than the one before: cooler sampling, and a firmer push away from repeating itself.
const SAMPLING = [
  { temperature: 0.4, repetition_penalty: 1.1 },
  { temperature: 0.2, repetition_penalty: 1.15 },
  { temperature: 0.3, repetition_penalty: 1.2 },
];

export function generatorFor(engine) {
  return async (prompt, { maxTokens = 260, attempt = 0 } = {}) => {
    const r = await engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }], top_p: 0.9, max_tokens: maxTokens, ...SAMPLING[Math.min(attempt, SAMPLING.length - 1)],
    });
    return (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '';
  };
}

export async function removeModel(modelId, lib) {
  if (loaded && loaded.id === modelId) { try { await loaded.engine.unload(); } catch { /* already gone */ } loaded = null; }
  await (lib || await defaultLib()).deleteModelAllInfoInCache(modelId);
}
