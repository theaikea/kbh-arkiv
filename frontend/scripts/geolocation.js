/**
 * Approximate Copenhagen bydel bounds (lat/lng).
 * Used for GPS → district when EXIF coordinates are present.
 * Borders are simplified; official KK GeoJSON can replace this later.
 */
export const BYDELE_BOUNDS = [
  { id: 'indre-by', minLat: 55.665, maxLat: 55.694, minLng: 12.555, maxLng: 12.598 },
  { id: 'vestebro', minLat: 55.652, maxLat: 55.678, minLng: 12.518, maxLng: 12.562 },
  { id: 'norrebro', minLat: 55.688, maxLat: 55.712, minLng: 12.532, maxLng: 12.568 },
  { id: 'osterbro', minLat: 55.698, maxLat: 55.728, minLng: 12.562, maxLng: 12.612 },
  { id: 'amager-vest', minLat: 55.628, maxLat: 55.668, minLng: 12.548, maxLng: 12.602 },
  { id: 'amager-ost', minLat: 55.608, maxLat: 55.642, minLng: 12.578, maxLng: 12.655 },
  { id: 'valby', minLat: 55.628, maxLat: 55.662, minLng: 12.478, maxLng: 12.538 },
  { id: 'vanloese', minLat: 55.662, maxLat: 55.698, minLng: 12.438, maxLng: 12.498 },
  { id: 'broenshoej-husum', minLat: 55.692, maxLat: 55.728, minLng: 12.458, maxLng: 12.522 },
  { id: 'bispebjerg', minLat: 55.702, maxLat: 55.738, minLng: 12.512, maxLng: 12.558 },
  { id: 'frederiksberg', minLat: 55.662, maxLat: 55.692, minLng: 12.498, maxLng: 12.548 },
];

/** Greater Copenhagen area — reject GPS clearly outside the city. */
const CPH_BOUNDS = {
  minLat: 55.58,
  maxLat: 55.78,
  minLng: 12.38,
  maxLng: 12.72,
};

export function isInCopenhagenArea(lat, lng) {
  return (
    lat >= CPH_BOUNDS.minLat &&
    lat <= CPH_BOUNDS.maxLat &&
    lng >= CPH_BOUNDS.minLng &&
    lng <= CPH_BOUNDS.maxLng
  );
}

function bboxArea(box) {
  return (box.maxLat - box.minLat) * (box.maxLng - box.minLng);
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {string | null} bydel id
 */
export function districtFromCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isInCopenhagenArea(lat, lng)) return null;

  const matches = BYDELE_BOUNDS.filter(
    (box) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng
  );

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0].id;

  matches.sort((a, b) => bboxArea(a) - bboxArea(b));
  return matches[0].id;
}

/**
 * @param {number} lat
 * @param {number} lng
 */
export function roundCoordinate(value) {
  return Math.round(value * 1e6) / 1e6;
}
