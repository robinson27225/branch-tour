// Setup help for Ollama: is it running, will it talk to this page, is Gemma installed?

export const pullCommand = (model = 'gemma3') => `ollama pull ${model.split(':')[0]}`;
export const serveCommand = (origin) => `OLLAMA_ORIGINS="${origin}" ollama serve`;

export async function checkOllama(url, model, fetchFn = fetch) {
  const base = String(url || '').replace(/\/$/, '');
  let res;
  try { res = await fetchFn(base + '/api/tags'); } catch { return { ok: false, kind: 'unreachable' }; }
  if (!res.ok) return { ok: false, kind: 'http', status: res.status };
  const names = ((await res.json()).models || []).map((m) => m.name || m.model).filter(Boolean);
  const family = String(model || '').split(':')[0];
  const hasModel = names.some((n) => n === model || (!String(model).includes(':') && n.split(':')[0] === family));
  return { ok: true, models: names, hasModel };
}

export function describeOllama(r, model, origin) {
  if (!r.ok && r.kind === 'unreachable') {
    return `Could not reach Ollama. If it is not running, start it. If it is running, it may be refusing this page: quit it and start it with  ${serveCommand(origin)}`;
  }
  if (!r.ok) return `Ollama answered with an error (${r.status}).`;
  if (!r.hasModel) {
    return `Ollama is running and this page can reach it, but "${model}" is not installed. Run:  ${pullCommand(model)}` +
      (r.models.length ? `  (installed: ${r.models.join(', ')})` : '');
  }
  return `Connected. "${model}" is installed and ready.`;
}
