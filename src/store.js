// Tour packs live on the device in IndexedDB. Falls back to memory if
// IndexedDB is blocked (private windows), so the app still works for a session.

// The app was first called Ghost Tour. The storage names below keep that name on purpose: they are never
// shown, and changing them would orphan the packs, settings, stories and voice clips already on people's devices.
const DB = 'ghost-tour', STORE = 'packs';
const memory = new Map();

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out.result);
    tx.onerror = () => reject(tx.error);
  });
};

export async function savePack(pack) {
  try { await run('readwrite', (s) => s.put(pack)); } catch { memory.set(pack.name, pack); }
}
export async function listPacks() {
  try { return await run('readonly', (s) => s.getAll()); } catch { return [...memory.values()]; }
}
export async function deletePack(name) {
  try { await run('readwrite', (s) => s.delete(name)); } catch { memory.delete(name); }
}

const SETTINGS_KEY = 'ghost-tour-settings';
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
