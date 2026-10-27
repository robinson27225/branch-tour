const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Places that have coordinates, nearest first, each with `meters`.
export function nearestPlaces(pos, places, limit = 10) {
  return places
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => ({ place: p, meters: distanceMeters(pos, p) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

export const UNIT_METERS = { mi: 1609.344, km: 1000 };

// Miles for people whose browser says US English or UK English, kilometres for the rest.
export const defaultUnit = (lang = '') => (/^en-(US|GB)$/i.test(lang) ? 'mi' : 'km');

// "25" and "mi" -> metres; null when there is no usable limit.
export function radiusMeters(value, unit) {
  const n = Number(value);
  return n > 0 && n < 100000 && UNIT_METERS[unit] ? n * UNIT_METERS[unit] : null;
}

// Where you are against a distance limit: the places inside it (nearest first, at most `limit`),
// the nearest place of all (to say how far off it is when nothing is inside), and how many have no map position.
export function placesWithin(pos, places, meters, limit = 50) {
  const all = nearestPlaces(pos, places, Infinity);
  return {
    inside: all.filter((r) => r.meters <= meters).slice(0, limit),
    nearest: all[0] || null,
    unlocated: places.filter((p) => p.lat === null || p.lng === null).length,
  };
}

export function formatDistance(m, unit = 'km') {
  if (unit === 'mi') {
    if (m < 300) return `${Math.round((m * 3.28084) / 10) * 10} ft`;
    const mi = m / UNIT_METERS.mi;
    return `${Math.round(mi * 10) / 10 < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
