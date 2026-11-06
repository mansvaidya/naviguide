// How the app reaches Nadia: words, sound and touch.
//
// Words always go to an ARIA live region, so a screen reader reads them in
// her own voice and speed. When her profile says she is not using one, the
// app also speaks them itself (speechSynthesis), at the rate her profile
// sets. Never both: two voices at once on a street corner is unusable.
//
// The beacon is a soft repeating tone placed in stereo where the target is.
// It is quiet by default and leaves gaps between pings, because Nadia also
// listens to traffic; one earbud or bone-conduction headphones are the
// intended setup.

export function createSpeaker({ politeEl, assertiveEl, onSay } = {}) {
  let selfVoice = false;
  let rate = 1;
  let voice = null;
  let last = '';
  const synth = globalThis.speechSynthesis || null;

  function pickVoice() {
    if (!synth) return null;
    const vs = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    return vs.find((v) => /premium|enhanced|natural/i.test(v.name) && v.localService)
      || vs.find((v) => v.localService && v.default) || vs.find((v) => v.localService) || vs[0] || null;
  }
  if (synth) { voice = pickVoice(); synth.addEventListener?.('voiceschanged', () => { voice = pickVoice(); }); }

  let clearTimer = null;
  function toRegion(el, text) {
    if (!el) return;
    // Clear first so the same sentence twice is still announced.
    el.textContent = '';
    clearTimeout(clearTimer);
    setTimeout(() => { el.textContent = text; }, 60);
  }

  return {
    configure(opts = {}) {
      if ('selfVoice' in opts) selfVoice = !!opts.selfVoice;
      if ('rate' in opts && Number.isFinite(opts.rate)) rate = opts.rate;
    },
    get selfVoice() { return selfVoice; },
    get rate() { return rate; },
    get last() { return last; },
    /** Say a sentence. `urgent` interrupts whatever is being said. */
    say(text, { urgent = false, remember = true } = {}) {
      if (!text) return;
      if (remember) last = text;
      toRegion(urgent ? assertiveEl : politeEl, text);
      if (onSay) onSay(text, { urgent });
      if (selfVoice && synth) {
        if (urgent || synth.speaking) synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        if (voice) u.voice = voice;
        u.lang = (voice && voice.lang) || 'en-US';
        synth.speak(u);
      }
    },
    silence() { if (synth) synth.cancel(); },
  };
}

export function createBeacon() {
  let ctx = null;
  let master = null;
  let running = false;
  let timer = null;
  let target = { rel: 0, distM: 30 };
  let volume = 0.16;

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function voice({ freq, type = 'sine', dur = 0.12, pan = 0, gain = 1, at = 0, lowpass = null }) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lowpass) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
    node.connect(g);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); } else g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Ahead: clear high ping. Facing it: a two-note "yes". Behind: lower and
  // muffled, the way a sound behind you is.
  function ping() {
    const { rel, distM } = target;
    const a = Math.abs(rel);
    const pan = Math.sin((rel * Math.PI) / 180);
    const near = Math.max(0.35, Math.min(1, 1.2 - distM / 40));
    if (a <= 15) {
      voice({ freq: 988, pan: 0, gain: near });
      voice({ freq: 1319, pan: 0, gain: near, at: 0.11 });
    } else if (a <= 100) {
      voice({ freq: 880, pan, gain: near });
    } else {
      voice({ freq: 494, pan, gain: near * 0.8, lowpass: 900, dur: 0.18 });
    }
  }

  function intervalMs() {
    const d = target.distM;
    if (d <= 2) return 260;
    if (d >= 40) return 1400;
    return 260 + ((d - 2) / 38) * (1400 - 260);
  }

  function loop() {
    if (!running) return;
    ping();
    timer = setTimeout(loop, intervalMs());
  }

  return {
    /** Must run inside a tap or key press: browsers only start audio from a gesture. */
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); return !!c; },
    get running() { return running; },
    start() { if (running) return; if (!ensure()) return; running = true; loop(); },
    stop() { running = false; clearTimeout(timer); },
    update(rel, distM) { target = { rel, distM }; },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    /** One-off sounds. In simulation, the car's horn and chime are played from where the car is. */
    cue(kind, { rel = 0, distM = 10 } = {}) {
      if (!ensure()) return;
      const pan = Math.sin((rel * Math.PI) / 180);
      const g = Math.max(0.25, Math.min(1.4, 2.2 - distM / 15));
      if (kind === 'horn') {
        voice({ freq: 392, type: 'sawtooth', dur: 0.5, pan, gain: g * 0.5, lowpass: 1800 });
        voice({ freq: 494, type: 'sawtooth', dur: 0.5, pan, gain: g * 0.5, lowpass: 1800 });
      } else if (kind === 'chime') {
        [784, 988, 1175].forEach((f, i) => voice({ freq: f, type: 'triangle', dur: 0.35, pan, gain: g * 0.7, at: i * 0.16 }));
      } else if (kind === 'arrive') {
        [523, 659, 784, 1047].forEach((f, i) => voice({ freq: f, type: 'triangle', dur: 0.3, gain: 0.8, at: i * 0.1 }));
      } else if (kind === 'step') {
        voice({ freq: 660, dur: 0.07, gain: 0.5 });
      } else if (kind === 'warn') {
        voice({ freq: 330, type: 'square', dur: 0.12, pan, gain: 0.35, lowpass: 1200 });
        voice({ freq: 330, type: 'square', dur: 0.12, pan, gain: 0.35, lowpass: 1200, at: 0.18 });
      }
    },
  };
}

export function createHaptics() {
  const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  let on = true;
  const buzz = (p) => { if (on && can) { try { navigator.vibrate(p); } catch {} } };
  return {
    supported: can,
    set enabled(v) { on = !!v; },
    get enabled() { return on; },
    facing: () => buzz([40, 60, 40]),
    step: () => buzz(25),
    warn: () => buzz([120, 80, 120, 80, 120]),
    arrive: () => buzz(400),
  };
}
