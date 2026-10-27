// A checklist for "will this work with no signal?". Everything it looks at is passed in, so each answer can be tested.
// Each row is { ok: true | false | null, text }: true is ready, false will fail with no signal, null is worth knowing.

export async function offlineReport({ nav, cacheStorage, standalone = false, packs = [], gemma = { needed: false, downloaded: false }, version = '' }) {
  const rows = [];

  if (!nav || !('serviceWorker' in nav)) {
    rows.push({ ok: false, text: 'This browser cannot keep the app for use with no signal. On an iPhone, open the app in Safari and use Share, then Add to Home Screen.' });
  } else {
    let saved = false;
    try { saved = (await cacheStorage.keys()).includes(`branches-${version}`) && !!(await cacheStorage.match('index.html')); } catch { saved = false; }
    const controlled = !!(nav.serviceWorker && nav.serviceWorker.controller);
    if (saved && controlled) rows.push({ ok: true, text: `The app is saved on this device (v${version}).` });
    else if (saved) rows.push({ ok: false, text: 'The app is saved, but this page was opened without it. Reload once while you still have signal.' });
    else rows.push({ ok: false, text: 'The app is not saved on this device yet. Stay on this page with signal for a moment, then reload.' });
  }

  rows.push(standalone
    ? { ok: true, text: 'Opened from the home screen.' }
    : { ok: null, text: 'Not opened from the home screen. On an iPhone, the home screen app keeps its saved data longest.' });

  let persisted = null;
  try { persisted = nav && nav.storage && nav.storage.persisted ? await nav.storage.persisted() : null; } catch { persisted = null; }
  rows.push(persisted
    ? { ok: true, text: 'The browser has promised to keep saved data.' }
    : { ok: null, text: 'The browser has not promised to keep saved data, so it may clear it if the phone runs low on space. Check this again before you leave home.' });

  const people = (packs || []).reduce((n, p) => n + (p.people ? p.people.length : 0), 0);
  rows.push(packs && packs.length
    ? { ok: true, text: `Tour pack saved: ${packs.map((p) => p.name).join(', ')} (${people} people).` }
    : { ok: false, text: 'No tour pack is saved yet. Build one on the Packs tab.' });

  if (gemma.needed) rows.push(gemma.downloaded
    ? { ok: true, text: 'Gemma is downloaded on this device.' }
    : { ok: false, text: 'Gemma is not downloaded on this device. Download it on the Narrator tab.' });
  else rows.push({ ok: null, text: 'Gemma in this browser is not selected, so stories use the plain version or another engine.' });

  return rows;
}

export const mark = (ok) => (ok === true ? '\u2713' : ok === false ? '\u2717' : '\u2022');
