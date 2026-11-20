import { env } from './env.js';

/**
 * Emergency contact numbers per region. Bangladesh is the default region for
 * this product; the structure allows other regions to be added later without
 * hard-coding numbers into the UI.
 *
 * Numbers are the national emergency numbers used by the public emergency
 * services. They are configuration, never literals in the interface.
 */
const REGIONS = {
  bd: {
    code: 'bd',
    name: 'বাংলাদেশ',
    nameEn: 'Bangladesh',
    countryCode: '+880',
    emergency: '999',
    ambulance: '999',
    fire: '999',
    police: '999',
    languages: ['bn', 'en'],
  },
};

export function getRegion(code = env.emergencyRegion) {
  const region = REGIONS[code];
  if (!region) {
    throw new Error(`Unknown emergency region: ${code}`);
  }
  return region;
}

export function listRegions() {
  return Object.values(REGIONS);
}
