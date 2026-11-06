// Door to Ride: the pure parts and one whole simulated journey, in Node.
//   node examples/door-to-ride/test/door-to-ride.test.mjs

import assert from 'node:assert/strict';
import { memoryKV } from '../../../toolkit/platforms/node/kv.js';
import { distanceM, bearingDeg, relativeBearing, offset, clockHour, directionPhrase, distancePhrase, spellPlate } from '../src/geo.js';
import { matchRideIntent } from '../src/ride-intents.js';
import { startToolkit, guidancePrefs } from '../src/toolkit-host.js';
import { buildScenario, doorPoint, DEFAULT_ROUTE } from '../src/scenario.js';
import { createSimulatedSensors } from '../src/sensors.js';
import { createProvider } from '../src/ride-provider.js';
import { createGuide } from '../src/guide.js';
import { judgeDescription } from '../src/vision.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await test('geo: distance, bearing, clock', () => {
  const a = { lat: 40, lng: -100 };
  const b = offset(a, 20, 90);
  assert.ok(Math.abs(distanceM(a, b) - 20) < 0.05);
  assert.ok(Math.abs(bearingDeg(a, b) - 90) < 0.1);
  assert.equal(relativeBearing(350, 10), 20);
  assert.equal(relativeBearing(10, 350), -20);
  assert.equal(clockHour(60), 2);
  assert.equal(clockHour(-90), 9);
  assert.equal(clockHour(180), 6);
  assert.equal(directionPhrase(5), 'straight ahead');
  assert.equal(directionPhrase(60, 'clock'), "at 2 o'clock");
  assert.equal(directionPhrase(-25, 'plain'), 'slightly to your left');
  assert.equal(distancePhrase(7, 'steps', 0.7), '10 steps');
  assert.equal(distancePhrase(30, 'steps', 0.7), 'about 45 steps');
  assert.equal(distancePhrase(3, 'feet'), '10 feet');
  assert.equal(spellPlate('8KLM-392'), '8 K L M 3 9 2');
});

await test('intents: ride phrases, and settings left to the Controller', () => {
  const cases = {
    'Where is my car?': 'where', 'how far is it': 'distance', 'is it here yet': 'status', 'next': 'next',
    'say that again': 'repeat', 'go back': 'back', 'honk': 'honk', 'ask him to honk': 'honk',
    'stop the sound': 'beaconOff', 'pause the beacon': 'beaconOff', 'resume the tone': 'beaconOn',
    "I'm at the car": 'arrived', "i'm in the car": 'boarded', 'which door': 'door', 'describe the car': 'describe',
    'what is the plate': 'describe', 'message the driver': 'message', 'call the driver': 'call', 'help': 'help',
    "let's go": 'start', 'when will it arrive': 'status', 'play car sound': 'honk',
  };
  for (const [u, id] of Object.entries(cases)) assert.equal(matchRideIntent(u), id, u);
  for (const u of ['speak slower', 'talk faster', 'bigger text', 'undo', 'dark mode']) assert.equal(matchRideIntent(u), null, u);
});

await test('toolkit: Nadia profile renders to guidance prefs', async () => {
  const host = await startToolkit({ kv: memoryKV() });
  const p = await host.prefs();
  assert.equal(p.screenReader, true);
  assert.equal(p.selfVoice, false, 'a screen-reader user hears the live region, not a second voice');
  assert.equal(p.clock, true);
  assert.equal(p.unit, 'steps');
  assert.equal(p.stepLengthM, 0.7);
  assert.equal(p.beacon, true);
  assert.equal(p.presentation.input.primary, 'voice');
  const regs = await host.librarian.listRegisteredNeeds();
  assert.deepEqual(regs.map((r) => r.key).sort(), ['door-to-ride/clock-directions', 'door-to-ride/sound-beacon', 'door-to-ride/steps', 'door-to-ride/vibration-cues']);

  await host.setNeed('announceUpdates', undefined);
  const q = await host.prefs();
  assert.equal(q.selfVoice, true, 'without a screen reader the app speaks itself');
  assert.equal(await host.setSpeechRate(1.37), 1.4);
  assert.equal((await host.prefs()).speechRate, 1.4);
  assert.equal(guidancePrefs({ supportAreas: [], needs: [] }).beacon, false);
});

await test('a whole journey: door, route, curb, car moves, arrival, boarding', async () => {
  const host = await startToolkit({ kv: memoryKV() });
  const prefs = await host.prefs();
  const said = [];
  const speaker = { last: '', say(t) { said.push(t); this.last = t; }, configure() {}, silence() {} };
  const beaconEvents = [];
  const beacon = { start() { beaconEvents.push('start'); }, stop() { beaconEvents.push('stop'); }, update() {}, cue(k) { beaconEvents.push(k); }, unlock() {} };
  const haptics = { facing() {}, step() {}, warn() {}, arrive() {}, enabled: true };
  const scenario = buildScenario({ lat: 40, lng: -100 }, 270);
  const sensors = createSimulatedSensors({ start: scenario.exit, headingDeg: 270, stepLengthM: 0.7 });
  const provider = createProvider('driver', { scenario, speed: 1, etaMin: 4 });
  const guide = createGuide({ provider, sensors, speaker, beacon, haptics, prefs, route: DEFAULT_ROUTE, scenario });
  provider.start();

  guide.ready();
  assert.match(said.at(-1), /Marcus, in a grey Toyota Prius, is on the way, about 4 minutes away/);
  guide.start();
  assert.match(said.at(-1), /Step 1 of 5/);
  for (let i = 1; i < DEFAULT_ROUTE.length; i++) guide.next();
  assert.match(said.at(-1), /Step 5 of 5/);
  guide.next(); // out the front door
  assert.equal(guide.state.phase, 'outdoor');
  assert.match(said.at(-1), /pickup spot/);
  assert.ok(beaconEvents.includes('start'));

  // Walk to the pickup pin by following the guide's own directions.
  const walkToTarget = (maxSteps = 60) => {
    for (let i = 0; i < maxSteps && guide.state.phase === 'outdoor'; i++) {
      const nav = guide.state.nav;
      if (!nav) { sensors.walk(0); continue; }
      if (Math.abs(nav.rel) > 10) sensors.turn(nav.rel);
      if (nav.distM < 1.0) break;
      sensors.walk(Math.min(1, nav.distM / 0.7) >= 1 ? 1 : 0.5);
    }
  };
  sensors.walk(1);
  walkToTarget();
  assert.ok(said.some((t) => /You are at the pickup spot/.test(t)), 'told to wait at the pin');
  assert.ok(said.some((t) => /Careful: /.test(t)), 'a hazard was announced');

  // The car pulls up 3 m past the pin; the target moves to its rear curb-side door.
  provider.arriveNow();
  assert.match(said.at(-1), /has arrived/);
  assert.match(said.at(-1), /The car stopped about .* from the pickup spot/);
  const res = await guide.signal('honk');
  assert.ok(res.ok);
  walkToTarget();
  assert.equal(guide.state.phase, 'atCar');
  assert.match(said.at(-1), /rear passenger door/);
  assert.match(said.at(-1), /Who are you picking up/);
  const door = doorPoint(provider.ride.car.pos, provider.ride.car.headingDeg);
  assert.ok(distanceM(sensors.current.pos, door) <= 1.2);
  guide.next();
  assert.equal(guide.state.phase, 'boarded');
  assert.equal(provider.ride.status, 'boarded');
  guide.destroy();
});

await test('autonomous ride: no driver, the car plays its own sound and unlocks', async () => {
  const scenario = buildScenario({ lat: 40, lng: -100 }, 270);
  const p = createProvider('autonomous', { scenario });
  p.start();
  assert.equal((await p.signal('chime')).ok, false, 'not before it arrives');
  p.arriveNow();
  assert.equal((await p.signal('chime')).ok, true);
  assert.equal((await p.signal('unlock')).ok, true);
  assert.equal(p.ride.unlocked, true);
  assert.equal(p.ride.driver, undefined);
  p.stop();
});

await test('photo check: description matched to the ride', () => {
  const v = { color: 'grey', make: 'Toyota', model: 'Prius', plate: '8KLM392' };
  assert.equal(judgeDescription('A grey Toyota Prius, plate 8KL M392', v).plateSeen, true);
  assert.equal(judgeDescription('A grey Toyota hatchback', v).likely, true);
  assert.equal(judgeDescription('A red pickup truck', v).likely, false);
});

console.log(`\n${n} tests passed`);
process.exit(0);
