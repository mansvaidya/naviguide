// Door to Ride — the host page. Wires the toolkit (profile, Controller),
// the ride, the sensors and the guide to the screen, the voice and the
// settings.

import { startToolkit } from './toolkit-host.js';
import { describePresentation } from '../../../controller/presentation.js';
import { createController } from '../../../controller/createController.js';
import { APP } from './persona.js';
import { createSpeaker, createBeacon, createHaptics } from './feedback.js';
import { createListener } from './voice-in.js';
import { matchRideIntent } from './ride-intents.js';
import { createGuide } from './guide.js';
import { createProvider } from './ride-provider.js';
import { createSimulatedSensors, createRealSensors } from './sensors.js';
import { buildScenario, DEFAULT_ROUTE } from './scenario.js';
import { createRideControlPort } from './control-port.js';
import { createVisionChecker } from './vision.js';
import { toLocalXY, spellPlate, directionPhrase, distancePhrase } from './geo.js';

const $ = (id) => document.getElementById(id);

// A fictional street for the practice walk. Only distances and directions
// matter; no real address is used.
const SIM_EXIT = { lat: 40.0, lng: -100.0 };
const SIM_STREET_BEARING = 270; // she steps out facing west

// Small per-device conveniences (not profile data): the route text, tone
// volume, ride type, practice clock, toolkit address.
const LOCAL_KEY = 'door-to-ride:local';
const local = (() => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } })();
const saveLocal = () => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch {} };

let host, prefs, speaker, beacon, haptics, listener, vision, controller, port;
let sensors, provider, guide, scenario;
let route = Array.isArray(local.route) && local.route.length ? local.route : DEFAULT_ROUTE;
let wakeLock = null;

// ---------------------------------------------------------------- boot

async function boot() {
  host = await startToolkit();
  prefs = await host.prefs();

  speaker = createSpeaker({ politeEl: $('live-polite'), assertiveEl: $('live-assert'), onSay: logLine });
  beacon = createBeacon();
  beacon.setVolume(Number(local.volume) || 0.16);
  haptics = createHaptics();
  applyPrefs();

  scenario = buildScenario(SIM_EXIT, SIM_STREET_BEARING);
  sensors = createSimulatedSensors({ start: scenario.exit, headingDeg: SIM_STREET_BEARING, stepLengthM: prefs.stepLengthM });

  port = createRideControlPort({
    host,
    runIntent,
    readContent: () => guide.content(),
    applyLook,
    initial: { speechRate: prefs.speechRate },
  });
  controller = createController({ control: port, operator: { librarian: host.librarian } });
  await controller.loadPresentation();

  listener = createListener({ onResult: (t) => handle(t), onState: onListenState });
  vision = createVisionChecker({ toolkitService: { url: local.svcUrl, token: local.svcToken } });

  wire();
  newJourney({ quiet: true });
  renderSettings();
  renderToolkit();
  // The first sentence waits a moment so a screen reader finishes the page title.
  setTimeout(() => guide.ready(), 600);
}

function newJourney({ quiet = false } = {}) {
  if (guide) guide.destroy();
  if (provider) provider.stop();
  beacon.stop();
  scenario = buildScenario(SIM_EXIT, SIM_STREET_BEARING);
  if (sensors.kind === 'simulated') sensors.place(scenario.exit, SIM_STREET_BEARING);
  provider = createProvider(local.rideKind || 'driver', { scenario, speed: Number(local.speed || 4) });
  guide = createGuide({ provider, sensors, speaker, beacon, haptics, prefs, route, scenario, onChange: render });
  provider.start();
  if (!quiet) guide.ready();
  render(guide.state);
}

// ------------------------------------------------------------- toolkit

async function refreshPrefs() {
  prefs = await host.prefs();
  applyPrefs();
  guide.setPrefs(prefs);
  controller.refreshPresentation(await host.model());
  port.sync('speechRate', prefs.speechRate);
  renderSettings();
  renderToolkit();
}

function applyPrefs() {
  speaker.configure({ selfVoice: prefs.selfVoice, rate: prefs.speechRate });
  haptics.enabled = prefs.haptics;
  if (sensors && sensors.setStepLength) sensors.setStepLength(prefs.stepLengthM);
}

// Visual settings the Controller can change for a sighted companion.
function applyLook(active) {
  const root = document.documentElement;
  if ('fontScale' in active) root.style.fontSize = `${Math.round(Number(active.fontScale) || 100)}%`;
  if ('darkMode' in active) root.dataset.theme = active.darkMode ? 'dark' : 'light';
  if ('speechRate' in active) refreshPrefs();
}

// ------------------------------------------------------------- input

async function handle(text) {
  const t = String(text || '').trim();
  if (!t) return;
  beacon.unlock();
  logLine(`You: ${t}`, { me: true });
  const intent = matchRideIntent(t);
  if (intent) return runIntent(intent);
  // Not a ride request: the toolkit Controller's shared vocabulary.
  const res = await controller.handle(t);
  const it = res && res.intent;
  if (it && it.type === 'command' && it.action === 'task' && !res.ok) {
    speaker.say(`I didn't catch "${t}". Say "help" to hear what you can say.`);
  } else if (res && res.say) {
    speaker.say(res.say);
  }
}

async function runIntent(id) {
  const av = provider.kind === 'autonomous';
  switch (id) {
    case 'help': return guide.help();
    case 'start': return guide.state.phase === 'ready' ? (keepAwake(), guide.start()) : guide.where();
    case 'next': if (guide.state.phase === 'ready') keepAwake(); return guide.next();
    case 'back': return guide.back();
    case 'repeat': return guide.repeat();
    case 'where': case 'whereAmI': return guide.where();
    case 'distance': return guide.distance();
    case 'status': return guide.status();
    case 'describe': return guide.describe();
    case 'door': return guide.door();
    case 'honk': return guide.signal(av ? 'chime' : 'honk');
    case 'message': return av ? speaker.say('There is no driver in this car. You can ask it to play its sound, or to unlock your door.') : guide.signal('heads-up');
    case 'call': return av ? speaker.say('There is no driver to call. For help, the car has a support button inside.') : guide.signal('call');
    case 'unlock': return av ? guide.signal('unlock') : speaker.say('Your driver unlocks the door. Ask him when you reach the car.');
    case 'arrived': return guide.arrived();
    case 'boarded': return guide.boarded();
    case 'beaconOff': return guide.setBeacon(false);
    case 'beaconOn': return guide.setBeacon(true);
    case 'check': return speaker.say('Press "Check car with a photo", then point the camera at the back of the car.');
    default: return speaker.say('Say "help" to hear what you can say.');
  }
}

function onListenState(state) {
  const b = $('talk');
  b.setAttribute('aria-pressed', String(state === 'listening'));
  $('talk-label').textContent = state === 'listening' ? 'Listening… tap to stop' : 'Talk';
  if (state === 'blocked') speaker.say('The microphone is not available here. Type your request in the box instead.');
  if (state === 'unavailable') speaker.say('Voice input is not available in this browser. Type your request in the box instead.');
  if (state === 'no-speech') speaker.say('I did not hear anything. Tap Talk and try again.');
  if (state === 'blocked' || state === 'unavailable') $('ask-input').focus();
}

async function keepAwake() {
  try { if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}

// ------------------------------------------------------------- wiring

function wire() {
  document.addEventListener('pointerdown', () => beacon.unlock(), { once: true });
  document.addEventListener('keydown', () => beacon.unlock(), { once: true });

  $('primary').addEventListener('click', () => {
    const ph = guide.state.phase;
    if (ph === 'ready') return runIntent('start');
    if (ph === 'indoor') return runIntent('next');
    if (ph === 'outdoor') return runIntent('arrived');
    if (ph === 'atCar') return runIntent('boarded');
    return newJourney();
  });
  $('btn-repeat').addEventListener('click', () => runIntent('repeat'));
  $('btn-where').addEventListener('click', () => runIntent('where'));
  $('btn-signal').addEventListener('click', () => runIntent('honk'));
  $('btn-describe').addEventListener('click', () => runIntent('describe'));
  $('btn-message').addEventListener('click', () => runIntent(provider.kind === 'autonomous' ? 'unlock' : 'message'));

  $('talk').addEventListener('click', () => { beacon.unlock(); if (listener.listening) listener.stop(); else listener.start(); });
  $('ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('ask-input').value;
    $('ask-input').value = '';
    handle(v);
  });

  $('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !provider.ride) return;
    speaker.say('Checking the photo…');
    try {
      const res = await vision.check(file, provider.ride.vehicle);
      speaker.say(res.say, { urgent: true });
    } catch (err) {
      speaker.say(`${err.message || 'The photo check did not work.'} Ask the driver who they are picking up before you get in.`, { urgent: true });
    }
  });

  // Practice walk.
  const pad = document.querySelector('.sim-pad');
  pad.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sim]');
    if (!b) return;
    simMove(b.dataset.sim);
  });
  pad.addEventListener('keydown', (e) => {
    const map = { ArrowUp: 'walk:1', ArrowDown: 'walk:-1', ArrowLeft: 'turn:-15', ArrowRight: 'turn:15' };
    if (map[e.key]) { e.preventDefault(); simMove(map[e.key]); }
  });
  $('sim-arrive').addEventListener('click', () => provider.arriveNow());
  $('sim-restart').addEventListener('click', () => newJourney());
  $('sim-speed').value = String(local.speed || 4);
  $('sim-speed').addEventListener('change', (e) => { local.speed = Number(e.target.value); saveLocal(); newJourney(); });

  // Settings: each one writes the profile through the toolkit host.
  $('set-sr').addEventListener('change', async (e) => { await host.setNeed('announceUpdates', e.target.checked ? true : undefined); await refreshPrefs(); speaker.say(e.target.checked ? 'Using your screen reader.' : "Using the app's own voice."); });
  let rateTimer = null;
  $('set-rate').addEventListener('input', (e) => {
    $('set-rate-out').textContent = `${Number(e.target.value).toFixed(1)}×`;
    clearTimeout(rateTimer);
    rateTimer = setTimeout(async () => { await host.setSpeechRate(Number(e.target.value)); await refreshPrefs(); speaker.say('This is the new speaking speed.'); }, 350);
  });
  for (const id of ['set-clock', 'set-plain']) $(id).addEventListener('change', async () => { await host.setNeed(`${APP.appId}/clock-directions`, $('set-clock').checked); await refreshPrefs(); });
  const saveUnit = async () => {
    const len = Math.min(1.2, Math.max(0.4, Number($('set-step').value) || 0.7));
    await host.setNeed(`${APP.appId}/steps`, $('set-steps').checked ? len : false);
    await refreshPrefs();
  };
  $('set-steps').addEventListener('change', saveUnit);
  $('set-feet').addEventListener('change', saveUnit);
  $('set-step').addEventListener('change', saveUnit);
  $('set-beacon').addEventListener('change', async (e) => { await host.setNeed(`${APP.appId}/sound-beacon`, e.target.checked); await refreshPrefs(); });
  $('set-vol').addEventListener('change', (e) => { local.volume = Number(e.target.value); saveLocal(); beacon.unlock(); beacon.setVolume(local.volume); beacon.cue('chime'); });
  $('set-haptics').addEventListener('change', async (e) => { await host.setNeed(`${APP.appId}/vibration-cues`, e.target.checked); await refreshPrefs(); haptics.facing(); });
  for (const id of ['set-lyft', 'set-av']) $(id).addEventListener('change', (e) => { local.rideKind = e.target.value; saveLocal(); newJourney(); });

  $('btn-real').addEventListener('click', toggleRealSensors);

  $('set-route').value = routeToText(route);
  $('btn-route-save').addEventListener('click', () => {
    const parsed = textToRoute($('set-route').value);
    if (!parsed.length) return speaker.say('The route is empty. Write one step per line.');
    route = parsed; local.route = parsed; saveLocal();
    guide.setRoute(route); renderRoute(guide.state);
    speaker.say(`Route saved: ${parsed.length} steps. It starts at your next journey.`);
  });
  $('btn-route-reset').addEventListener('click', () => {
    route = DEFAULT_ROUTE; delete local.route; saveLocal();
    $('set-route').value = routeToText(route); guide.setRoute(route); renderRoute(guide.state);
    speaker.say('Using the example route.');
  });

  $('set-svc-url').value = local.svcUrl || '';
  $('set-svc-token').value = local.svcToken || '';
  const saveSvc = () => {
    local.svcUrl = $('set-svc-url').value.trim(); local.svcToken = $('set-svc-token').value.trim(); saveLocal();
    vision = createVisionChecker({ toolkitService: { url: local.svcUrl, token: local.svcToken } });
  };
  $('set-svc-url').addEventListener('change', saveSvc);
  $('set-svc-token').addEventListener('change', saveSvc);

  $('btn-reset').addEventListener('click', async () => { await host.resetToNadia(); await refreshPrefs(); speaker.say("Profile reset to Nadia's starting profile."); });
}

function simMove(cmd) {
  if (sensors.kind !== 'simulated') return speaker.say('The practice walk is off while your real location is in use.');
  beacon.unlock();
  const [op, n] = cmd.split(':');
  if (op === 'walk') sensors.walk(Number(n));
  if (op === 'turn') sensors.turn(Number(n));
  if (guide.state.phase !== 'outdoor') drawMap(guide.state);
}

async function toggleRealSensors() {
  if (sensors.kind === 'real') {
    sensors.stop();
    sensors = createSimulatedSensors({ start: guide.scenario.exit, headingDeg: guide.scenario.streetBearing, stepLengthM: prefs.stepLengthM });
    guide.setSensors(sensors);
    $('btn-real').textContent = 'Use my real location and compass';
    $('loc-note').textContent = 'Using the practice walk.';
    return speaker.say('Back to the practice walk.');
  }
  try {
    const real = await createRealSensors();
    sensors = real;
    guide.setSensors(real);
    $('btn-real').textContent = 'Use the practice walk instead';
    $('loc-note').textContent = `Using your phone's location${real.hasCompass ? ' and compass' : ''}. The car is still simulated: it pulls up a few meters from where you step outside.`;
    speaker.say("Using your phone's location and compass. When you step outside, face the street; the simulated car will pull up a few steps away.");
  } catch (err) {
    speaker.say(err.message, { urgent: true });
  }
}

const routeToText = (r) => r.map((s) => [s.say, s.landmark || '', s.seconds || ''].join(' | ')).join('\n');
function textToRoute(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [say, landmark = '', seconds = ''] = l.split('|').map((x) => x.trim());
    return { say, landmark, seconds: Number(seconds) || 20 };
  }).filter((s) => s.say);
}

// ------------------------------------------------------------- render

function logLine(text, { urgent = false, me = false } = {}) {
  const li = document.createElement('li');
  li.textContent = text;
  if (urgent) li.className = 'urgent';
  if (me) li.className = 'me';
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

const PHASE = {
  ready: () => 'Before you leave',
  indoor: (s) => `Inside · step ${s.stepIndex + 1} of ${s.routeLength}`,
  outdoor: (s) => (s.ride && s.ride.status === 'arrived' ? 'Outside · to the car door' : 'Outside · to the pickup spot'),
  atCar: () => 'At the car',
  boarded: () => 'On your way',
};
const PRIMARY = {
  ready: () => "Start: I'm at my door",
  indoor: (s) => (s.stepIndex >= s.routeLength - 1 ? "Done: I'm outside" : 'Next step'),
  outdoor: () => "I'm at the car",
  atCar: () => "I'm in the car",
  boarded: () => 'Plan another trip',
};

let drawQueued = false;
function render(s) {
  if (!s) return;
  $('phase-label').textContent = PHASE[s.phase](s);
  $('now-h').textContent = s.instruction || 'Ready when you are';
  $('now-detail').textContent = s.detail || '';
  $('primary').textContent = PRIMARY[s.phase](s);

  const av = provider.kind === 'autonomous';
  $('btn-signal').textContent = av ? 'Play car sound' : 'Ask to honk';
  $('btn-message').textContent = av ? 'Unlock my door' : "Tell driver I'm coming";

  // Pointer for a sighted companion; the same facts are in the words.
  const p = $('pointer');
  if (s.phase === 'outdoor' && s.nav) {
    p.hidden = false;
    p.dataset.facing = String(Math.abs(s.nav.rel) <= 15);
    $('pointer-arrow').style.transform = `rotate(${s.nav.rel}deg)`;
    $('pointer-dist').textContent = distancePhrase(s.nav.distM, prefs.unit, prefs.stepLengthM);
    $('pointer-where').textContent = `${s.nav.targetLabel} · ${directionPhrase(s.nav.rel, prefs.clock ? 'clock' : 'plain')}`;
  } else p.hidden = true;

  renderRide(s);
  renderRoute(s);
  if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawMap(guide.state); }); }
}

function renderRide(s) {
  const r = s.ride;
  const chip = $('ride-chip');
  if (!r) { chip.textContent = 'No ride'; return; }
  const name = r.driver ? r.driver.name : 'Car';
  chip.dataset.state = r.status;
  chip.textContent = r.status === 'arrived' ? `${name} · here` : r.status === 'boarded' ? `${name} · on board` : `${name} · ${r.etaMin} min`;

  const v = r.vehicle;
  const rows = [];
  if (r.driver) rows.push(['Driver', esc(r.driver.name)]);
  rows.push(['Car', esc(`${v.color} ${v.make === 'Autonomous' ? 'self-driving' : v.make} ${v.model}`)]);
  rows.push(['Plate', `<span class="plate" aria-label="${esc(spellPlate(v.plate))}">${esc(v.plate)}</span>`]);
  rows.push(['Pickup', esc(r.pickup && r.pickup.note || 'At the curb')]);
  rows.push(['Status', esc(provider.statusSentence())]);
  const html = rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');
  if ($('ride-facts').innerHTML !== html) $('ride-facts').innerHTML = html;

  const msgs = s.messages || [];
  const mhtml = msgs.map((m) => `<li class="${m.from === 'me' ? 'me' : ''}"><span class="sr-only">${m.from === 'me' ? 'You' : (r.driver ? r.driver.name : 'Car')}: </span>${esc(m.text)}</li>`).join('');
  if ($('messages').innerHTML !== mhtml) $('messages').innerHTML = mhtml;
}

function renderRoute(s) {
  const items = route.map((st, i) => {
    let attrs = '';
    if (s.phase === 'indoor' && i === s.stepIndex) attrs = ' aria-current="step"';
    else if (s.phase !== 'ready' && (s.phase !== 'indoor' || i < s.stepIndex)) attrs = ' class="done"';
    return `<li${attrs}>${esc(st.say)}${st.landmark ? `<small>${esc(st.landmark)}</small>` : ''}</li>`;
  });
  const outside = s.phase === 'outdoor' ? ' aria-current="step"' : (s.phase === 'atCar' || s.phase === 'boarded') ? ' class="done"' : '';
  items.push(`<li${outside}>Outside: follow the voice and the tone to the rear passenger door.<small>Hazards on the way are announced before you reach them.</small></li>`);
  const html = items.join('');
  if ($('route-list').innerHTML !== html) $('route-list').innerHTML = html;
}

function renderSettings() {
  $('set-sr').checked = prefs.screenReader;
  $('set-rate').value = String(prefs.speechRate);
  $('set-rate-out').textContent = `${prefs.speechRate.toFixed(1)}×`;
  $('set-clock').checked = prefs.clock; $('set-plain').checked = !prefs.clock;
  $('set-steps').checked = prefs.unit === 'steps'; $('set-feet').checked = prefs.unit !== 'steps';
  $('set-step').value = String(prefs.stepLengthM);
  $('set-beacon').checked = prefs.beacon;
  $('set-vol').value = String(local.volume || 0.16);
  $('set-haptics').checked = prefs.haptics;
  $('haptics-note').textContent = haptics.supported ? '' : 'This phone or browser cannot vibrate (iPhones do not allow it in web apps). Sound and voice still work.';
  $('set-lyft').checked = (local.rideKind || 'driver') === 'driver';
  $('set-av').checked = local.rideKind === 'autonomous';
  $('voice-note').innerHTML = prefs.screenReader
    ? `Nadia's profile says she uses a screen reader, so the app sends its words to the screen reader and does not speak itself. Without one running, <button type="button" id="btn-voice">Use the app's own voice</button>`
    : `The app speaks in its own voice. <button type="button" id="btn-voice">Send words to a screen reader instead</button>`;
  $('btn-voice').addEventListener('click', () => { $('set-sr').checked = !prefs.screenReader; $('set-sr').dispatchEvent(new Event('change')); });
}

async function renderToolkit() {
  const model = await host.model();
  $('tk-presentation').textContent = `Controller presentation from this profile: ${describePresentation(prefs.presentation)}${host.persistent ? '' : ' (This browser blocks storage, so changes last until you close the page.)'}`;
  const { presentation, ...rest } = prefs;
  $('tk-prefs').textContent = JSON.stringify(rest, null, 2);
  $('tk-model').textContent = JSON.stringify(model, null, 2);
  const regs = await host.librarian.listRegisteredNeeds();
  $('tk-needs').innerHTML = regs.map((n) => `<li><strong>${esc(n.phrase)}</strong> <code>${esc(n.key)}</code></li>`).join('');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --------------------------------------------------------------- map

function drawMap(s) {
  const c = $('map');
  if (!c || !$('practice').open) return;
  const ctx = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const sc = guide.scenario;
  const W = c.width, H = c.height;
  const pxm = 22; // pixels per meter
  const ox = 4 * pxm, oy = 3.5 * pxm; // where the exit sits on the canvas
  const rad = (d) => (d * Math.PI) / 180;
  const fwdV = { x: Math.sin(rad(sc.streetBearing)), y: Math.cos(rad(sc.streetBearing)) };
  const alongB = (sc.streetBearing + 90) % 360;
  const alV = { x: Math.sin(rad(alongB)), y: Math.cos(rad(alongB)) };
  // Screen x = along the street, screen y = toward the street.
  const toS = (pos) => { const v = toLocalXY(sc.exit, pos); return { x: ox + (v.x * alV.x + v.y * alV.y) * pxm, y: oy + (v.x * fwdV.x + v.y * fwdV.y) * pxm }; };
  const dirS = (bearing) => { const b = { x: Math.sin(rad(bearing)), y: Math.cos(rad(bearing)) }; return { x: b.x * alV.x + b.y * alV.y, y: b.x * fwdV.x + b.y * fwdV.y }; };

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = col('--building'); ctx.fillRect(0, 0, W, oy);
  ctx.fillStyle = col('--sidewalk'); ctx.fillRect(0, oy, W, sc.curbM * pxm);
  ctx.fillStyle = col('--street'); ctx.fillRect(0, oy + sc.curbM * pxm, W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, oy + sc.curbM * pxm - 2, W, 3);
  ctx.setLineDash([18, 14]); ctx.strokeStyle = '#d9d9d0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, oy + 12 * pxm); ctx.lineTo(W, oy + 12 * pxm); ctx.stroke(); ctx.setLineDash([]);
  // Door of the building.
  ctx.fillStyle = col('--paving'); ctx.fillRect(ox - 18, oy - 6, 36, 6);
  ctx.font = '700 13px "Atkinson Hyperlegible", sans-serif';
  ctx.fillStyle = '#15171a'; ctx.fillText('Building · front door', ox - 16, oy - 14);
  ctx.fillStyle = '#e8e8e0'; ctx.fillText('Street', W - 60, H - 14);

  for (const h of sc.hazards) {
    const p = toS(h.pos);
    ctx.fillStyle = '#f08c00'; ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
    ctx.fillStyle = '#15171a'; ctx.font = '12px "Atkinson Hyperlegible", sans-serif'; ctx.fillText(h.text, p.x + 10, p.y + 4);
  }
  const pin = toS(sc.pickup.pos);
  ctx.fillStyle = '#e5484d'; ctx.beginPath(); ctx.arc(pin.x, pin.y, 7, 0, Math.PI * 2); ctx.fill();

  const r = s.ride;
  if (r && r.car) {
    const p = toS(r.car.pos);
    const d = dirS(r.car.headingDeg);
    const ang = Math.atan2(d.y, d.x);
    const onScreen = p.x > -60 && p.x < W + 60 && p.y > -60 && p.y < H + 60;
    if (onScreen) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
      ctx.fillStyle = col('--paving'); ctx.strokeStyle = '#15171a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-2.25 * pxm, -0.9 * pxm, 4.5 * pxm, 1.8 * pxm, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(0.6 * pxm, -0.75 * pxm, 0.7 * pxm, 1.5 * pxm);
      ctx.restore();
      if (r.status === 'arrived') {
        const dp = s.target && s.phase === 'outdoor' ? toS(s.target.pos) : null;
        if (dp) { ctx.strokeStyle = '#2f7cf6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(dp.x, dp.y, 9, 0, Math.PI * 2); ctx.stroke(); }
      }
    } else {
      ctx.fillStyle = '#e8e8e0'; ctx.font = '700 13px "Atkinson Hyperlegible", sans-serif';
      ctx.fillText(`Car on its way · ${r.etaMin} min ←`, 12, H - 14);
    }
  }

  if (s.phase === 'outdoor' || sensors.kind === 'simulated') {
    const cur = sensors.current;
    if (cur && s.phase !== 'ready' && s.phase !== 'indoor') {
      const me = toS(cur.pos);
      if (s.target) {
        const t = toS(s.target.pos);
        ctx.setLineDash([6, 6]); ctx.strokeStyle = '#2f7cf6'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]);
      }
      const hd = dirS(cur.headingDeg);
      ctx.fillStyle = 'rgba(47,124,246,.28)';
      ctx.beginPath(); ctx.moveTo(me.x, me.y);
      const a = Math.atan2(hd.y, hd.x);
      ctx.arc(me.x, me.y, 46, a - 0.4, a + 0.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2f7cf6'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(me.x, me.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = '#15171a'; ctx.font = '13px "Atkinson Hyperlegible", sans-serif';
      ctx.fillText(s.phase === 'indoor' ? 'Nadia is inside, following her route' : 'Nadia is at her apartment door', ox + 30, 22);
    }
  }
}

$('practice').addEventListener('toggle', () => guide && drawMap(guide.state));

boot().catch((err) => {
  console.error(err);
  $('now-h').textContent = 'Door to Ride could not start';
  $('now-detail').textContent = String(err && err.message || err);
});
