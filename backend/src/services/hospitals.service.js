import { HttpError } from '../utils/http-error.js';

/**
 * Nearby hospitals from OpenStreetMap's Overpass API.
 *
 * No API key is required and the data is genuinely sourced from OSM, so no
 * hospital details are invented. Only the fields OSM actually tags are
 * returned, and emergency-department availability is never claimed because
 * OSM does not carry real-time availability.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const DEFAULT_RADIUS_METERS = 5000;

function buildQuery(lat, lng, radius) {
  return `[out:json][timeout:20];
(
  node["amenity"="hospital"](around:${radius},${lat},${lng});
  node["amenity"="clinic"]["emergency"="yes"](around:${radius},${lat},${lng});
  way["amenity"="hospital"](around:${radius},${lat},${lng});
);
out center 40;`;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Find hospitals near a coordinate.
 *
 * When the provider cannot be reached the caller receives an HttpError and
 * the interface falls back to opening a map search.
 */
export async function findNearbyHospitals({ lat, lng, radius = DEFAULT_RADIUS_METERS }) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new HttpError(400, 'অবস্থান সঠিক নয়।');
  }

  const query = buildQuery(latitude, longitude, Math.min(20000, Math.max(500, Number(radius) || DEFAULT_RADIUS_METERS)));

  let payload = null;
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        lastError = new Error(`Overpass responded ${response.status}`);
        continue;
      }
      payload = await response.json();
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!payload) {
    console.error('Hospital lookup failed:', lastError?.message || 'unknown error');
    throw new HttpError(503, 'হাসপাতালের তালিকা এখন লোড করা যাচ্ছে না। মানচিত্রে খুঁজে দেখুন।');
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];

  const hospitals = elements
    .map((element) => {
      const tags = element.tags || {};
      const nodeLat = element.lat ?? element.center?.lat;
      const nodeLng = element.lon ?? element.center?.lon;
      if (nodeLat === undefined || nodeLng === undefined) return null;

      const name = tags.name || tags['name:bn'] || tags['name:en'];
      if (!name) return null;

      return {
        name,
        nameBn: tags['name:bn'] || null,
        nameEn: tags['name:en'] || null,
        type: tags.amenity === 'hospital' ? 'hospital' : 'clinic',
        phone: tags.phone || tags['contact:phone'] || null,
        emergency: tags.emergency === 'yes',
        address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null,
        location: { lat: Number(nodeLat), lng: Number(nodeLng) },
        distanceMeters: distanceMeters(latitude, longitude, Number(nodeLat), Number(nodeLng)),
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${Number(nodeLat)},${Number(nodeLng)}`,
        directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${Number(nodeLat)},${Number(nodeLng)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 20);

  return {
    source: 'OpenStreetMap (Overpass)',
    availabilityNote:
      'জরুরি বিভাগের খোলা আছে কি না তা এই তথ্যে নেই — ফোনে নিশ্চিত করুন।',
    hospitals,
  };
}

/** A map search link used when the provider fails or the location is unknown. */
export function mapSearchUrl(query = 'hospital emergency') {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
