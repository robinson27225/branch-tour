// Geocode each distinct place once, at pack-build time, with OpenStreetMap
// Nominatim. Usage policy: max 1 request/second, identify the app.
// https://operations.osmfoundation.org/policies/nominatim/

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export async function geocodeName(name, fetchFn = fetch) {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(name)}`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const hits = await res.json();
  if (!hits.length) return null;
  return { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
}

// Fills lat/lng on pack.places in place. Skips places already located.
// Cemeteries: try the full name, then fall back to "town, state" (the part
// after the first comma) so a missing OSM cemetery still lands in town.
export async function geocodePack(pack, { fetchFn = fetch, delayMs = 1100, onProgress = () => {}, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const todo = pack.places.filter((p) => p.lat === null);
  let done = 0, missed = 0;
  for (const place of todo) {
    const candidates = [place.name];
    const rest = place.name.split(',').slice(1).join(',').trim();
    if (place.kind === 'cemetery' && rest) candidates.push(rest);
    let hit = null;
    for (const q of candidates) {
      try { hit = await geocodeName(q, fetchFn); } catch { hit = null; }
      await wait(delayMs);
      if (hit) { place.approximate = q !== place.name; break; }
    }
    if (hit) { place.lat = hit.lat; place.lng = hit.lng; } else missed++;
    onProgress(++done, todo.length, place);
  }
  return { located: todo.length - missed, missed };
}
