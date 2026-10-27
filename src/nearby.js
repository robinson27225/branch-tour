// Keeps only the people who rest within a distance of a point, for a pack that is built before a trip.
//
// Places arrive as names with no position, and the map lookup is one place per second, so looking up everything
// (a family circle has about 2,000 places) would take half an hour. Instead the regions are looked up first
// (a state or country, with its bounding box), regions that are out of reach are dropped whole, and only the
// places in the regions that remain are looked up.

import { distanceMeters } from './geo.js';
import { geocodePack } from './geocode.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const COUNTRY = /^(united states( of america)?|usa|us)$/i;

// "Molalla, Clackamas, Oregon, United States" -> "Oregon, United States"; "Fairmont Cemetery, Raton, New Mexico" -> "New Mexico".
export function regionOf(placeName) {
  const parts = String(placeName || '').split(',').map((s) => s.trim()).filter(Boolean);
  let country = '';
  if (parts.length > 1 && COUNTRY.test(parts[parts.length - 1])) { country = ', United States'; parts.pop(); }
  return parts.length ? parts[parts.length - 1] + country : '';
}

// Nominatim's boundingbox is [south, north, west, east], as strings.
export async function geocodeRegion(name, fetchFn = fetch) {
  const res = await fetchFn(`${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(name)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const hit = (await res.json())[0];
  if (!hit || !hit.boundingbox) return null;
  const [s, n, w, e] = hit.boundingbox.map(Number);
  return [s, n, w, e].some(Number.isNaN) ? null : { s, n, w, e };
}

// Metres from a point to the nearest edge of a box, 0 when it is inside.
export function distanceToBox(pos, box) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return distanceMeters(pos, { lat: clamp(pos.lat, box.s, box.n), lng: clamp(pos.lng, box.w, box.e) });
}

export async function limitToNearby(pack, { center, radiusMeters, fetchFn = fetch, delayMs = 1100, sleep, onProgress = () => {} }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const before = { people: pack.people.length, places: pack.places.length };

  // 1. Which regions could be in reach? A region that cannot be looked up is kept: better too many than too few.
  const groups = new Map();
  for (const pl of pack.places) if (pl.lat === null) {
    const r = regionOf(pl.name);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pl);
  }
  const lookup = [];
  let done = 0, farRegions = 0;
  for (const [region, places] of groups) {
    let near = true;
    if (region) {
      let box = null;
      try { box = await geocodeRegion(region, fetchFn); } catch { box = null; }
      await wait(delayMs);
      near = !box || distanceToBox(center, box) <= radiusMeters;
    }
    if (near) lookup.push(...places); else { farRegions++; for (const pl of places) pl.far = true; }
    onProgress({ stage: 'regions', done: ++done, total: groups.size, region });
  }

  // 2. Find those places on the map.
  await geocodePack({ places: lookup }, { fetchFn, delayMs, sleep, onProgress: (d, n, p) => onProgress({ stage: 'places', done: d, total: n, place: p.name }) });

  // 3. Keep the places that are in reach, and only the people who rest in them.
  const keep = pack.places.filter((pl) => !pl.far && pl.lat !== null && distanceMeters(center, pl) <= radiusMeters);
  const keepIds = new Set(keep.flatMap((pl) => pl.personIds));
  pack.places = keep;
  pack.people = pack.people.filter((p) => keepIds.has(p.id));
  pack.stats.people = pack.people.length;
  pack.stats.nearby = { radiusMeters, center, peopleBefore: before.people, placesBefore: before.places, farRegions };
  return pack.stats.nearby;
}
