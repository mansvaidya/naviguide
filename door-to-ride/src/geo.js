// Geometry for wayfinding: distances, bearings, and the ways a person who
// can't see the screen hears them (clock-face directions, steps or feet).
// Pure functions, no browser globals, so they run in tests under Node.

const R = 6371000; // Earth radius, meters
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in meters between two {lat, lng} points. */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial compass bearing from a to b, degrees clockwise from north, 0–360. */
export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
    - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed angle from where the person faces to the target, -180..180 (negative = left). */
export function relativeBearing(headingDeg, targetBearingDeg) {
  let d = (targetBearingDeg - headingDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** A point `meters` away from `p` along compass `bearing`. Used by the simulator. */
export function offset(p, meters, bearing) {
  const d = meters / R;
  const br = toRad(bearing);
  const lat1 = toRad(p.lat);
  const lng1 = toRad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/** Local east/north meters of `p` relative to `origin` (flat-earth; fine under ~1 km). */
export function toLocalXY(origin, p) {
  const x = toRad(p.lng - origin.lng) * R * Math.cos(toRad(origin.lat));
  const y = toRad(p.lat - origin.lat) * R;
  return { x, y };
}

/** Relative bearing as a clock hour, 12 = straight ahead, 3 = right, 6 = behind. */
export function clockHour(rel) {
  let h = Math.round(rel / 30);
  if (h <= 0) h += 12;
  return h;
}

/**
 * The direction in words. `style` is 'clock' ("at 2 o'clock") or 'plain'
 * ("slightly to your right"). Straight ahead is always said plainly.
 */
export function directionPhrase(rel, style = 'clock') {
  const a = Math.abs(rel);
  if (a <= 12) return 'straight ahead';
  if (style === 'clock') return `at ${clockHour(rel)} o'clock`;
  const side = rel < 0 ? 'left' : 'right';
  if (a <= 40) return `slightly to your ${side}`;
  if (a <= 110) return `to your ${side}`;
  if (a <= 160) return `behind you, to your ${side}`;
  return 'behind you';
}

/** A turn instruction a person can act on, e.g. "Turn right about 60 degrees". */
export function turnPhrase(rel) {
  const a = Math.abs(rel);
  if (a <= 12) return 'Keep going straight';
  if (a >= 160) return 'Turn around';
  const side = rel < 0 ? 'left' : 'right';
  if (a <= 35) return `Bear ${side}`;
  const rounded = Math.round(a / 15) * 15;
  return `Turn ${side} about ${rounded} degrees`;
}

/**
 * Distance in the person's unit. `unit` is 'steps' | 'feet' | 'meters'.
 * Steps use the person's own step length, which the profile holds.
 */
export function distancePhrase(meters, unit = 'steps', stepLengthM = 0.7) {
  if (unit === 'feet') {
    const ft = meters * 3.281;
    return ft < 10 ? `${Math.max(1, Math.round(ft))} feet` : `${Math.round(ft / 5) * 5} feet`;
  }
  if (unit === 'meters') {
    return meters < 10 ? `${Math.max(1, Math.round(meters))} meters` : `${Math.round(meters / 5) * 5} meters`;
  }
  const steps = Math.max(1, Math.round(meters / stepLengthM));
  return steps === 1 ? 'one step' : steps < 15 ? `${steps} steps` : `about ${Math.round(steps / 5) * 5} steps`;
}

/** Spell a plate so a speech engine reads it one character at a time: "8 K L M 3 9 2". */
export function spellPlate(plate) {
  return String(plate || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().split('').join(' ');
}
