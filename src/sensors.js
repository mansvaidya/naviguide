// Where Nadia is and which way she faces. Two sources with one shape:
//
//   sensors.subscribe(fn)  fn({ pos: {lat,lng}, headingDeg, accuracyM, source })
//   sensors.current        the last reading, or null
//   sensors.stop()
//
// Real: Geolocation (watchPosition) for position, the compass from
// DeviceOrientation for heading. The phone is held flat, pointing the way
// she wants to go, like a pointer. Typical city GPS is only good to 5–15 m,
// which is why the last few meters rely on sound (a honk, the car's chime)
// and on the driver, not on the dot.
//
// Simulated: a walker a facilitator (or a tester using the keyboard) moves
// step by step, for co-design sessions and desktop demos.

import { offset } from './geo.js';

function emitter() {
  const subs = new Set();
  return { on(fn) { subs.add(fn); return () => subs.delete(fn); }, emit(v) { for (const fn of subs) fn(v); } };
}

export function createSimulatedSensors({ start, headingDeg = 270, stepLengthM = 0.7 }) {
  const ev = emitter();
  let state = { pos: start, headingDeg, accuracyM: 1, source: 'simulated' };
  const push = () => ev.emit({ ...state });
  return {
    kind: 'simulated',
    get current() { return { ...state }; },
    subscribe(fn) { const off = ev.on(fn); fn({ ...state }); return off; },
    /** Walk `n` steps the way she faces (negative = back up). */
    walk(n = 1) { state.pos = offset(state.pos, Math.abs(n) * stepLengthM, n >= 0 ? state.headingDeg : (state.headingDeg + 180) % 360); push(); },
    turn(deg) { state.headingDeg = (state.headingDeg + deg + 360) % 360; push(); },
    face(deg) { state.headingDeg = (deg + 360) % 360; push(); },
    place(pos, heading = state.headingDeg) { state.pos = pos; state.headingDeg = heading; push(); },
    setStepLength(m) { stepLengthM = m; },
    stop() {},
  };
}

/**
 * Real sensors. Resolves once the person has granted location (and, on
 * iOS, motion); rejects with a sentence that can be read to her otherwise.
 * Must be called from a tap: iOS only asks for motion inside a user gesture.
 */
export async function createRealSensors() {
  if (!('geolocation' in navigator)) throw new Error('This browser cannot share your location.');
  // iOS 13+: compass access needs an explicit request from a tap.
  const DOE = globalThis.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const r = await DOE.requestPermission();
      if (r !== 'granted') throw new Error('denied');
    } catch { throw new Error('Compass access was not allowed. You can allow Motion and Orientation in your browser settings.'); }
  }

  const ev = emitter();
  let state = null;
  let heading = null;
  let lastCompassAt = 0;

  const onOrient = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS: degrees from magnetic north
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360; // Android absolute
    if (h == null) return;
    // Screen rotation shifts where "forward" is.
    const angle = (screen.orientation && screen.orientation.angle) || 0;
    h = (h + angle) % 360;
    // Light smoothing on the circle, so the spoken direction does not flicker.
    heading = heading == null ? h : (heading + (((h - heading + 540) % 360) - 180) * 0.25 + 360) % 360;
    lastCompassAt = Date.now();
    if (state) { state.headingDeg = heading; ev.emit({ ...state }); }
  };
  const orientEvent = 'ondeviceorientationabsolute' in globalThis ? 'deviceorientationabsolute' : 'deviceorientation';
  globalThis.addEventListener(orientEvent, onOrient, true);

  const first = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      reject(new Error(err.code === 1
        ? 'Location access was not allowed. You can allow it in your browser settings, or keep using the practice walk.'
        : 'Your location is not available right now. Try again outside, away from tall buildings.'));
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  const toState = (p) => {
    const gpsHeading = Number.isFinite(p.coords.heading) && p.coords.speed > 0.4 ? p.coords.heading : null;
    // Prefer the compass; fall back to the direction of travel while walking.
    const h = heading != null && Date.now() - lastCompassAt < 3000 ? heading : (gpsHeading ?? heading ?? 0);
    return {
      pos: { lat: p.coords.latitude, lng: p.coords.longitude },
      headingDeg: h,
      accuracyM: p.coords.accuracy,
      source: heading != null ? 'gps+compass' : 'gps',
    };
  };
  state = toState(first);
  const watchId = navigator.geolocation.watchPosition(
    (p) => { state = toState(p); ev.emit({ ...state }); },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000 },
  );

  return {
    kind: 'real',
    get current() { return state ? { ...state } : null; },
    get hasCompass() { return heading != null; },
    subscribe(fn) { const off = ev.on(fn); if (state) fn({ ...state }); return off; },
    stop() { navigator.geolocation.clearWatch(watchId); globalThis.removeEventListener(orientEvent, onOrient, true); },
  };
}
