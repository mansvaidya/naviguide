// The guide: Nadia's journey from her door to the car door, as a small
// state machine.
//
//   ready   → she knows the ride status and how long the walk takes
//   indoor  → one recorded route step at a time; she confirms each
//   outdoor → position + compass toward the car's rear curb-side door,
//             spoken clock directions, the sound beacon, hazard warnings
//   atCar   → which door, how to open it, and the safety check
//   boarded → hand back to the ride
//
// Everything Nadia hears goes through `speaker.say`, so the same sentence
// shows on screen, reaches her screen reader and is in the transcript.

import { distanceM, bearingDeg, relativeBearing, directionPhrase, distancePhrase, turnPhrase, spellPlate } from './geo.js';
import { doorPoint, routeSeconds, buildScenario } from './scenario.js';
import { HELP_TEXT } from './ride-intents.js';

const BANDS = [40, 25, 15, 8, 4]; // meters; crossing one is worth a sentence
const band = (d) => BANDS.findIndex((b) => d > b);

export function createGuide({ provider, sensors, speaker, beacon, haptics, prefs, route, scenario, onChange = () => {} }) {
  const s = {
    phase: 'ready',
    stepIndex: 0,
    instruction: '',
    detail: '',
    nav: null, // { distM, rel, targetLabel, accuracyM }
    hazardsSaid: new Set(),
    lastGuideAt: 0,
    lastHour: null,
    lastBand: null,
    facing: false,
    atPickupSaid: false,
    gpsLimitSaid: false,
    beaconPaused: false,
    messages: [],
  };
  let unsubSensors = null;
  let unsubRide = null;

  const P = () => prefs;
  const dist = (m) => distancePhrase(m, P().unit, P().stepLengthM);
  const ride = () => provider.ride;
  const arrived = () => ride() && ride().status === 'arrived';
  const isSim = () => sensors.kind === 'simulated';

  function set(instruction, detail = '') {
    s.instruction = instruction;
    s.detail = detail;
    onChange(snapshot());
  }

  function say(text, opts) { speaker.say(text, opts); }

  // ---- targets -----------------------------------------------------------

  function target() {
    const r = ride();
    if (r && r.status === 'arrived') return { pos: doorPoint(r.car.pos, r.car.headingDeg), label: 'Your car door', short: 'the car door' };
    return { pos: scenario.pickup.pos, label: 'The pickup spot', short: 'the pickup spot' };
  }

  function navFrom(reading) {
    const t = target();
    const d = distanceM(reading.pos, t.pos);
    const rel = relativeBearing(reading.headingDeg, bearingDeg(reading.pos, t.pos));
    return { distM: d, rel, targetLabel: t.label, targetShort: t.short, accuracyM: reading.accuracyM };
  }

  function guidanceSentence(nav = s.nav) {
    if (!nav) return 'I do not know where you are yet.';
    const where = directionPhrase(nav.rel, P().clock ? 'clock' : 'plain');
    const far = dist(nav.distM);
    let line = where === 'straight ahead'
      ? `${nav.targetLabel} is straight ahead, ${far}.`
      : `${nav.targetLabel} is ${where}, ${far}. ${turnPhrase(nav.rel)}.`;
    if (!isSim() && nav.accuracyM > 8 && nav.distM < 25) {
      line += ` Your location is only accurate to about ${dist(nav.accuracyM)}, so listen for the car too.`;
    }
    return line;
  }

  /** The short form for the screen heading: "Car door · 2 o'clock · 15 steps". */
  function headline(nav) {
    return `${nav.targetLabel.replace(/^(Your|The) /, '').replace(/^./, (c) => c.toUpperCase())}: ${directionPhrase(nav.rel, P().clock ? 'clock' : 'plain')}, ${dist(nav.distM)}`;
  }

  // ---- phases ------------------------------------------------------------

  function introText() {
    const r = ride();
    const walkMin = Math.max(1, Math.round((routeSeconds(route) + 60) / 60));
    const status = provider.statusSentence();
    let timing = '';
    if (r && r.status !== 'arrived') {
      const spare = r.etaMin - walkMin;
      timing = spare >= 2
        ? ` The walk to the curb takes about ${walkMin} minutes, so you have about ${spare} minutes before you need to leave.`
        : ` The walk to the curb takes about ${walkMin} minutes, so it is a good time to start.`;
    }
    return `${status}${timing}`;
  }

  function ready() {
    s.phase = 'ready';
    const text = introText();
    set('Ready when you are', text);
    say(`${text} Say "start", or press Start, when you are at your door.`);
  }

  function start() {
    if (!route.length) return goOutdoor();
    s.phase = 'indoor';
    s.stepIndex = 0;
    sayStep(true);
  }

  function sayStep(first = false) {
    const step = route[s.stepIndex];
    const n = `Step ${s.stepIndex + 1} of ${route.length}.`;
    set(step.say, step.landmark);
    const extra = P().verbosity === 'concise' ? '' : ` ${step.landmark}`;
    say(`${first ? 'Starting. ' : ''}${n} ${step.say}${extra} Say "next" when you are there.`);
  }

  function next() {
    if (s.phase === 'ready') return start();
    if (s.phase === 'indoor') {
      haptics.step(); beacon.cue('step');
      if (s.stepIndex < route.length - 1) { s.stepIndex++; return sayStep(); }
      return goOutdoor();
    }
    if (s.phase === 'outdoor') return where();
    if (s.phase === 'atCar') return boarded();
    return repeat();
  }

  function back() {
    if (s.phase === 'indoor' && s.stepIndex > 0) { s.stepIndex--; return sayStep(); }
    if (s.phase === 'outdoor' && route.length) { stopNav(); s.phase = 'indoor'; s.stepIndex = route.length - 1; return sayStep(); }
    say('You are at the first step.');
  }

  function goOutdoor() {
    s.phase = 'outdoor';
    s.hazardsSaid.clear();
    s.lastHour = null; s.lastBand = null; s.atPickupSaid = false; s.gpsLimitSaid = false;
    // With real sensors, the street is laid out from where Nadia actually
    // steps out, facing the street, so the simulated car is placed around
    // her real position.
    if (!isSim() && sensors.current) {
      scenario = buildScenario(sensors.current.pos, sensors.current.headingDeg);
      provider.relocate && provider.relocate(scenario);
    } else if (isSim() && sensors.place) {
      sensors.place(scenario.exit, scenario.streetBearing);
    }
    // Work out the first direction before listening, so the opening
    // sentence carries it and the first reading does not repeat it.
    if (sensors.current) {
      s.nav = navFrom(sensors.current);
      s.lastHour = Math.round(s.nav.rel / 30); s.lastBand = band(s.nav.distM);
    }
    s.lastGuideAt = Date.now();
    unsubSensors = sensors.subscribe(onReading);
    const r = ride();
    const lead = r && r.status === 'arrived'
      ? `You are outside. ${provider.statusSentence()}`
      : `You are outside. ${provider.statusSentence()} I will guide you to the pickup spot at the curb.`;
    const beaconNote = P().beacon && !s.beaconPaused ? ' The tone is on: it sounds from the side the car is on, and gets faster as you get closer.' : '';
    say(`${lead} Hold your phone flat, pointing the way you face. ${guidanceSentence()}${beaconNote}`);
    s.lastGuideAt = Date.now();
    if (P().beacon && !s.beaconPaused) beacon.start();
  }

  function stopNav() {
    if (unsubSensors) { unsubSensors(); unsubSensors = null; }
    beacon.stop();
  }

  function onReading(reading) {
    if (s.phase !== 'outdoor') return;
    const nav = navFrom(reading);
    s.nav = nav;
    beacon.update(nav.rel, nav.distM);

    // Facing the target: a buzz, once per time she lines up.
    const facing = Math.abs(nav.rel) <= 15;
    if (facing && !s.facing) haptics.facing();
    s.facing = facing;

    // Hazards ahead of her within their radius, once each.
    for (const [i, h] of scenario.hazards.entries()) {
      if (s.hazardsSaid.has(i)) continue;
      const d = distanceM(reading.pos, h.pos);
      const rel = relativeBearing(reading.headingDeg, bearingDeg(reading.pos, h.pos));
      if (d <= h.radiusM && Math.abs(rel) <= 75) {
        s.hazardsSaid.add(i);
        haptics.warn(); beacon.cue('warn', { rel, distM: d });
        say(`Careful: ${P().verbosity === 'concise' ? h.text : h.detail}, ${directionPhrase(rel, P().clock ? 'clock' : 'plain')}, ${dist(d)}.`, { urgent: true });
        s.lastGuideAt = Date.now();
      }
    }

    // The curb edge. Only the practice walk knows where it is to the
    // centimeter; on a real street her cane finds it, not GPS.
    if (isSim()) {
      const v = distanceM(scenario.exit, reading.pos);
      const fwd = v * Math.cos(((bearingDeg(scenario.exit, reading.pos) - scenario.streetBearing) * Math.PI) / 180);
      if (fwd > scenario.curbM - 0.3 && !s.curbSaid) {
        s.curbSaid = true;
        haptics.warn(); beacon.cue('warn');
        say('Stop. You are at the curb edge; the street is in front of you.', { urgent: true });
        s.lastGuideAt = Date.now();
      } else if (fwd < scenario.curbM - 1.5) s.curbSaid = false;
    }

    // Arrival.
    if (arrived()) {
      if (isSim() && nav.distM <= 1.2) return arriveAtCar();
      if (!isSim() && nav.distM <= Math.max(6, reading.accuracyM) && !s.gpsLimitSaid) {
        s.gpsLimitSaid = true;
        say(`You are within a few steps of the car, closer than your location can show. ${provider.kind === 'driver' ? 'Ask the driver to honk, or call out his name.' : 'Ask the car to play its sound.'} Say "I'm at the car" when you touch it.`, { urgent: true });
      }
    } else if (nav.distM <= 1.5 && !s.atPickupSaid) {
      s.atPickupSaid = true;
      haptics.arrive();
      say(`You are at the pickup spot, at the curb by the tree. ${provider.statusSentence()} Wait here. I will tell you when the car pulls up and where it stopped.`, { urgent: true });
      s.lastGuideAt = Date.now();
    }

    // Spoken guidance: when the direction changes a lot, when she crosses a
    // distance band, or every 12 seconds. Never more than one every 4 seconds.
    const hour = Math.round(nav.rel / 30);
    const b = band(nav.distM);
    const now = Date.now();
    const turned = s.lastHour == null || Math.abs(hour - s.lastHour) >= 2;
    const crossed = s.lastBand == null || b !== s.lastBand;
    const stale = now - s.lastGuideAt > 12000;
    if (!(s.atPickupSaid && !arrived()) && now - s.lastGuideAt > 4000 && (turned || crossed || stale)) {
      say(guidanceSentence(nav));
      s.lastGuideAt = now; s.lastHour = hour; s.lastBand = b;
    }
    set(nav.distM < 1.5 && !arrived() ? 'Wait at the curb' : headline(nav), arrived() ? 'Walk toward the rear passenger door.' : 'Head to the pickup spot at the curb.');
  }

  function arriveAtCar() {
    stopNav();
    s.phase = 'atCar';
    haptics.arrive(); beacon.cue('arrive');
    const text = `You are at the car. ${provider.doorInstructions()}`;
    set('You are at the car', provider.doorInstructions());
    say(text, { urgent: true });
  }

  function boarded() {
    stopNav();
    s.phase = 'boarded';
    provider.boarded();
    set('Have a good ride', 'Door to Ride is finished. Your ride app takes it from here.');
    say('Have a good ride, Nadia. Door to Ride is finished; your ride app takes it from here.');
  }

  // ---- questions and requests --------------------------------------------

  function where() {
    if (s.phase === 'ready') return say(`You have not started yet. ${introText()}`);
    if (s.phase === 'indoor') return say(`You are still inside, on step ${s.stepIndex + 1} of ${route.length}: ${route[s.stepIndex].say} ${provider.statusSentence()}`);
    if (s.phase === 'atCar') return say('You are at the car. ' + provider.doorInstructions());
    if (s.phase === 'boarded') return say('You are in the car.');
    if (sensors.current && !s.nav) s.nav = navFrom(sensors.current);
    say(guidanceSentence());
    s.lastGuideAt = Date.now();
  }

  function distance() {
    if (s.phase !== 'outdoor' || !s.nav) {
      const left = route.slice(s.phase === 'indoor' ? s.stepIndex : 0);
      return say(`You are inside. About ${Math.max(1, Math.round((routeSeconds(left) + 60) / 60))} minutes of walking to the curb.`);
    }
    say(`${s.nav.targetLabel} is ${dist(s.nav.distM)} away, about ${Math.round(s.nav.distM)} meters.`);
  }

  function status() {
    let text = provider.statusSentence();
    if (arrived() && s.phase === 'outdoor' && s.nav) text += ' ' + guidanceSentence();
    say(text);
  }

  function describe() {
    const r = ride();
    if (!r) return say('No ride yet.');
    const v = r.vehicle;
    const who = r.driver ? `${r.driver.name} drives` : 'It is';
    say(`${who} a ${v.color} ${v.make === 'Autonomous' ? '' : v.make + ' '}${v.model}, ${v.bodyType}. License plate ${spellPlate(v.plate)}. Someone near you can check the plate for you.`);
  }

  async function signal(id) {
    const res = await provider.signal(id);
    say(res.say, { urgent: true });
    return res;
  }

  function door() {
    let text = provider.doorInstructions();
    if (s.phase === 'outdoor' && s.nav && arrived()) text = `${guidanceSentence()} ${text}`;
    say(text);
  }

  function repeat() { say(speaker.last || s.instruction || 'Nothing to repeat yet.', { remember: false }); }
  function help() { say(HELP_TEXT); }

  function setBeacon(on) {
    s.beaconPaused = !on;
    if (on && P().beacon && s.phase === 'outdoor') { beacon.start(); say('Tone on.'); }
    else { beacon.stop(); say(on ? 'The tone is off in your settings. Turn on "A sound that leads me to my car" to use it.' : 'Tone paused. Say "resume the tone" to bring it back.'); }
    onChange(snapshot());
  }

  // ---- ride events --------------------------------------------------------

  function onRide(r, ev) {
    if (!ev) return;
    if (ev.type === 'status' && ev.to === 'arriving') say(`${provider.whoPhrase()} is about a minute away.`);
    if (ev.type === 'status' && ev.to === 'arrived') {
      s.lastHour = null; s.lastBand = null; s.gpsLimitSaid = false;
      let text = `${provider.whoPhrase()} has arrived.`;
      if (s.phase === 'outdoor' && sensors.current) {
        const off = distanceM(scenario.pickup.pos, r.car.pos);
        s.nav = navFrom(sensors.current);
        if (off > 2.5) text += ` The car stopped about ${dist(off)} from the pickup spot, so I have moved the target.`;
        text += ' ' + guidanceSentence();
        set(headline(s.nav), 'Walk toward the rear passenger door.');
        haptics.facing();
        if (P().beacon && !s.beaconPaused) beacon.start();
      } else if (s.phase === 'indoor' || s.phase === 'ready') {
        text += ' Take your time. I will guide you to the car when you are outside.';
      }
      say(text, { urgent: true });
      s.lastGuideAt = Date.now();
      if (s.phase === 'ready') set('Ready when you are', introText());
    }
    if (ev.type === 'driver-reply') { s.messages.push({ from: 'driver', text: ev.text }); say(`Message from ${r.driver ? r.driver.name : 'the car'}: ${ev.text}`); }
    if (ev.type === 'message-sent') s.messages.push({ from: 'me', text: ev.text });
    if (ev.type === 'sound' && isSim() && sensors.current) {
      const p = sensors.current;
      const rel = relativeBearing(p.headingDeg, bearingDeg(p.pos, r.car.pos));
      beacon.cue(ev.kind, { rel, distM: distanceM(p.pos, r.car.pos) });
    }
    if (ev.type === 'unlocked' && isSim() && sensors.current) {
      const p = sensors.current; const d = doorPoint(r.car.pos, r.car.headingDeg);
      beacon.cue('chime', { rel: relativeBearing(p.headingDeg, bearingDeg(p.pos, d)), distM: distanceM(p.pos, d) });
    }
    onChange(snapshot());
  }
  unsubRide = provider.subscribe(onRide);

  function snapshot() {
    return {
      phase: s.phase, stepIndex: s.stepIndex, routeLength: route.length,
      instruction: s.instruction, detail: s.detail,
      nav: s.nav, ride: ride(), facing: s.facing, beaconPaused: s.beaconPaused,
      messages: s.messages.slice(-6), scenario, target: s.phase === 'outdoor' ? target() : null,
    };
  }

  return {
    get state() { return snapshot(); },
    get scenario() { return scenario; },
    ready, start, next, back, where, distance, status, describe, door, repeat, help,
    signal, setBeacon, arrived: () => (s.phase === 'outdoor' || s.phase === 'indoor' ? arriveAtCar() : where()),
    boarded,
    setPrefs(p) { prefs = p; if (!p.beacon) beacon.stop(); else if (s.phase === 'outdoor' && !s.beaconPaused) beacon.start(); haptics.enabled = p.haptics; onChange(snapshot()); },
    setRoute(r) { route = r; },
    setSensors(next) {
      const wasOut = s.phase === 'outdoor';
      if (unsubSensors) { unsubSensors(); unsubSensors = null; }
      sensors = next;
      if (wasOut) unsubSensors = sensors.subscribe(onReading);
    },
    setProvider(p) { if (unsubRide) unsubRide(); provider = p; unsubRide = provider.subscribe(onRide); },
    /** Readable content for the Controller's "read this". */
    content() { return { title: s.instruction, text: [s.instruction, s.detail].filter(Boolean).join('. ') }; },
    destroy() { stopNav(); if (unsubRide) unsubRide(); },
  };
}
