// Ride providers: where the car is, who (or what) is driving it, and the
// signals the rider can ask it to make. The guide only talks to this
// interface, so a ride-hail driver and an autonomous vehicle are two
// implementations of the same thing.
//
//   provider.kind          'driver' | 'autonomous'
//   provider.ride          { status, etaMin, driver?, vehicle, car: {pos, headingDeg}, pickup }
//   provider.subscribe(fn) fn(ride, event) on every change; returns unsubscribe
//   provider.signals()     [{ id, label, say }] what the rider can ask for
//   provider.signal(id)    Promise<{ ok, say }>
//   provider.start()/stop()
//
// Both providers here are SIMULATIONS. Lyft's public API does not give a
// rider's third-party app live vehicle position or a "honk" request, so a
// real integration needs a partner agreement (or runs inside the ride
// app). The simulated timeline, messages and signals are what this example
// proposes a provider should expose for riders who can't see the car.

import { offset } from './geo.js';

const STATUS_WORDS = {
  matched: 'is on the way',
  arriving: 'is almost here',
  arrived: 'has arrived',
  boarded: 'has you on board',
};

function emitter() {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(...a) { for (const fn of subs) { try { fn(...a); } catch (e) { console.error(e); } } },
  };
}

/**
 * The car's simulated trip: it starts `startM` meters south of where it
 * will stop and drives north to `stopAt`. `stopAt` is deliberately a few
 * meters from the planned pickup spot, because real cars rarely stop
 * exactly on the pin, and the guide has to say so.
 */
function simulatedTrip({ stopAt, headingDeg, etaMin, speed = 1 }) {
  // stopAt / headingDeg are getters, so relocate() can move the street.
  const startM = 600;
  const totalMs = (etaMin * 60 * 1000) / speed;
  const t0 = Date.now();
  return {
    progress() { return Math.min(1, (Date.now() - t0) / totalMs); },
    position() {
      const remaining = startM * (1 - this.progress());
      return offset(stopAt(), remaining, (headingDeg() + 180) % 360);
    },
    // Minutes on the ride clock, not the (possibly sped-up) wall clock.
    etaMin() { return Math.max(0, Math.ceil((1 - this.progress()) * etaMin)); },
  };
}

class SimulatedProvider {
  constructor({ scenario, speed = 1, etaMin = 4 }) {
    this.scenario = scenario;
    this.speed = speed;
    this.etaMin0 = etaMin;
    this.ev = emitter();
    this.timer = null;
    this.ride = null;
  }
  subscribe(fn) { return this.ev.on(fn); }
  start() {
    const carHeadingDeg = this.scenario.carHeadingDeg;
    this.trip = simulatedTrip({ stopAt: () => this.scenario.carStop, headingDeg: () => this.scenario.carHeadingDeg, etaMin: this.etaMin0, speed: this.speed });
    this.ride = {
      status: 'matched',
      etaMin: this.etaMin0,
      ...this.identity(),
      car: { pos: this.trip.position(), headingDeg: carHeadingDeg },
      pickup: this.scenario.pickup,
    };
    this.ev.emit(this.ride, { type: 'matched' });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  /** Move the street (real sensors: laid out from where the rider steps outside). */
  relocate(scenario) {
    this.scenario = scenario;
    if (!this.ride) return;
    this.ride.pickup = scenario.pickup;
    this.ride.car.headingDeg = scenario.carHeadingDeg;
    this.ride.car.pos = this.trip.position();
    this.ev.emit(this.ride, { type: 'tick' });
  }
  /** Jump the simulation to "the car has pulled up" (for demos and tests). */
  arriveNow() {
    if (!this.ride) this.start();
    this.trip = { progress: () => 1, position: () => this.scenario.carStop, etaMin: () => 0 };
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }
  tick() {
    if (!this.ride || this.ride.status === 'boarded') return;
    const prev = this.ride.status;
    const p = this.trip.progress();
    this.ride.car.pos = this.trip.position();
    this.ride.etaMin = this.trip.etaMin();
    this.ride.status = p >= 1 ? 'arrived' : this.ride.etaMin <= 1 ? 'arriving' : 'matched';
    if (this.ride.status !== prev) {
      if (this.ride.status === 'arrived') this.ride.arrivedAt = Date.now();
      this.ev.emit(this.ride, { type: 'status', from: prev, to: this.ride.status });
    } else {
      this.ev.emit(this.ride, { type: 'tick' });
    }
    if (this.ride.status === 'arrived') clearInterval(this.timer);
  }
  boarded() {
    if (!this.ride) return;
    this.ride.status = 'boarded';
    this.stop();
    this.ev.emit(this.ride, { type: 'status', to: 'boarded' });
  }
  statusSentence() {
    const r = this.ride;
    if (!r) return 'No ride yet.';
    const who = this.whoPhrase();
    if (r.status === 'arrived') return `${who} has arrived and is waiting at the curb.`;
    const eta = r.etaMin <= 1 ? 'less than a minute away' : `about ${r.etaMin} minutes away`;
    return `${who} ${STATUS_WORDS[r.status] || 'is on the way'}, ${eta}.`;
  }
}

/** A ride-hail trip with a human driver. Signals go to the driver as messages. */
export class SimulatedLyftProvider extends SimulatedProvider {
  get kind() { return 'driver'; }
  get serviceName() { return 'Lyft'; }
  identity() {
    return {
      driver: { name: 'Marcus', phoneMasked: '(555) 010-4471' },
      vehicle: { color: 'grey', make: 'Toyota', model: 'Prius', plate: '8KLM392', bodyType: 'hatchback' },
    };
  }
  whoPhrase() { return `${this.ride.driver.name}, in a ${this.ride.vehicle.color} ${this.ride.vehicle.make} ${this.ride.vehicle.model},`; }
  signals() {
    return [
      { id: 'honk', label: 'Ask driver to honk', say: 'Asked Marcus to give a short honk.' },
      { id: 'heads-up', label: 'Tell driver I\'m coming', say: 'Sent Marcus a message.' },
      { id: 'call', label: 'Call driver', say: 'Calling Marcus.' },
    ];
  }
  /** The message a rider sends with one tap, written so a driver knows what to do. */
  headsUpMessage() {
    return "Hi, I'm Nadia. I'm blind and on my way down now, finding the car with an app. " +
      "Please stay at the pickup spot, and when I'm close, say my name or honk once. Thank you!";
  }
  async signal(id) {
    const r = this.ride;
    if (!r) return { ok: false, say: 'There is no ride yet.' };
    if (id === 'heads-up') {
      this.ev.emit(r, { type: 'message-sent', text: this.headsUpMessage() });
      setTimeout(() => this.ev.emit(r, { type: 'driver-reply', text: "Got it Nadia, I'll be right at the curb. Take your time." }), 2500 / Math.max(1, this.speed / 4));
      return { ok: true, say: 'Sent Marcus a message that you are coming down and finding the car by sound. ' };
    }
    if (id === 'honk') {
      if (r.status !== 'arrived') return { ok: false, say: 'Marcus has not arrived yet, so a honk would not help. I will tell you when he pulls up.' };
      this.ev.emit(r, { type: 'message-sent', text: 'Could you give one short honk so I can find the car? Thanks!' });
      setTimeout(() => this.ev.emit(r, { type: 'sound', kind: 'horn' }), 1800);
      return { ok: true, say: 'Asked Marcus for one short honk. Listen for it.' };
    }
    if (id === 'call') {
      this.ev.emit(r, { type: 'call', number: r.driver.phoneMasked });
      return { ok: true, say: `Marcus's masked number is ${r.driver.phoneMasked}. In the real app this places the call.` };
    }
    return { ok: false, say: 'That is not something a driver can do.' };
  }
  doorInstructions() {
    return 'The rear passenger door is on the curb side. The handle is a pull handle about waist height, near the back edge of the door. ' +
      'Before you get in, ask: "Who are you picking up?" The driver should say Nadia.';
  }
}

/**
 * An autonomous vehicle. There is no one to ask, so the car itself has to
 * be findable: an exterior sound on request, unlocking, and announcing the
 * door that opens. Named generically; no AV operator's API is assumed.
 */
export class SimulatedAutonomousProvider extends SimulatedProvider {
  get kind() { return 'autonomous'; }
  get serviceName() { return 'Autonomous ride'; }
  identity() {
    return {
      vehicle: { color: 'white', make: 'Autonomous', model: 'SUV', plate: 'AV4207', bodyType: 'SUV with roof sensors' },
      unlocked: false,
    };
  }
  whoPhrase() { return `Your self-driving car, a white SUV,`; }
  signals() {
    return [
      { id: 'chime', label: 'Play car sound', say: 'The car will play its chime for 10 seconds.' },
      { id: 'honk', label: 'Honk horn once', say: 'The car will honk once.' },
      { id: 'unlock', label: 'Unlock and open my door', say: 'Unlocking.' },
    ];
  }
  async signal(id) {
    const r = this.ride;
    if (!r) return { ok: false, say: 'There is no ride yet.' };
    if (r.status !== 'arrived' && id !== 'unlock') return { ok: false, say: 'The car has not arrived yet. I will tell you when it pulls up.' };
    if (id === 'chime') {
      for (let i = 0; i < 5; i++) setTimeout(() => this.ev.emit(r, { type: 'sound', kind: 'chime' }), 400 + i * 2000);
      return { ok: true, say: 'The car is playing its chime for the next 10 seconds. Walk toward the sound.' };
    }
    if (id === 'honk') {
      setTimeout(() => this.ev.emit(r, { type: 'sound', kind: 'horn' }), 500);
      return { ok: true, say: 'The car will honk once. Listen for it.' };
    }
    if (id === 'unlock') {
      if (r.status !== 'arrived') return { ok: false, say: 'The car can only unlock once it has arrived.' };
      r.unlocked = true;
      this.ev.emit(r, { type: 'unlocked' });
      return { ok: true, say: 'Unlocked. The rear curb-side door is open a little; you will hear a soft tone from it.' };
    }
    return { ok: false, say: 'The car cannot do that.' };
  }
  doorInstructions() {
    return 'Your door is the rear door on the curb side. Say "unlock" and the car opens it a little and plays a soft tone from that door. ' +
      'Inside, the car will greet you by name. If it does not say Nadia, step back and tell me.';
  }
}

export function createProvider(kind, opts) {
  return kind === 'autonomous' ? new SimulatedAutonomousProvider(opts) : new SimulatedLyftProvider(opts);
}
