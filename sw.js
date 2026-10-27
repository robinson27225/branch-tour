// Keeps the app working with no signal in a cemetery, without ever hiding an update.
const CACHE = 'branches-0.9.21'; // the saved stories and clips live in 'ghost-tour-media', kept across updates
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'src/pack.js', 'src/kinship.js', 'src/quality.js', 'src/report.js', 'src/connections.js', 'src/xlsx.js', 'src/geo.js', 'src/geocode.js', 'src/nearby.js', 'src/sort.js', 'src/offline.js', 'src/narrate.js', 'src/store.js', 'src/builder.js', 'src/voice.js', 'src/webllm.js', 'src/ollama.js', 'src/version.js', 'sample-pack.json',
  'img/wt-brand.png', 'fonts/roboto-mono-latin-400-normal.woff2', 'fonts/roboto-mono-latin-700-normal.woff2'];

// Fonts, the logo and the 6.8 MB Gemma library never change: use the saved copy first.
// Pages and code ask the server first, so a new version shows on the next load; the saved copy is for when there is no signal.
const STABLE = /\/(fonts|img|vendor)\//;
const NETWORK_WAIT_MS = 3000;
const SLOW_FOR_MS = 30000;
let slowUntil = 0;

self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !k.startsWith('ghost-tour-media')).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never touch geocoder, model or voice calls
  const keep = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; };

  if (STABLE.test(url.pathname)) {
    // The Gemma library is kept the first time it is used, not at install, so only people who use it pay for it.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(keep)));
    return;
  }
  // Network first, but never for long: with a weak signal a request can hang for a minute before it fails, and a cemetery
  // is where that happens. After a few seconds the saved copy is used. The page loads its code in several waves, so once
  // the network has been too slow the saved copy is used straight away for the next half minute instead of waiting again.
  const saved = () => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'));
  if (Date.now() < slowUntil) {
    e.respondWith(saved().then((hit) => hit || fetch(e.request)));
    return;
  }
  const net = fetch(e.request, { cache: 'no-cache' }).then(keep).then((res) => { slowUntil = 0; return res; });
  net.catch(() => {});
  e.waitUntil(net.catch(() => {}));
  e.respondWith(
    Promise.race([net, new Promise((_, no) => setTimeout(no, NETWORK_WAIT_MS))])
      .catch(async () => {
        const hit = await saved();
        if (hit) slowUntil = Date.now() + SLOW_FOR_MS;
        return hit || net;
      }));
});
