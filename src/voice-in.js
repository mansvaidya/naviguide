// Push-to-talk speech input (Web Speech SpeechRecognition), feature-detected
// the same way the toolkit's onboarding and Controller do. A text field is
// always offered too: noisy streets, non-standard speech, and browsers
// without recognition all need it.

export function createListener({ onResult, onState, lang = 'en-US' } = {}) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  let rec = null;
  let listening = false;
  let blocked = false;

  const set = (s, detail) => { listening = s === 'listening'; if (onState) onState(s, detail); };

  return {
    get supported() { return !!SR && !blocked; },
    get listening() { return listening; },
    start() {
      if (!SR || blocked) { set('unavailable'); return false; }
      if (listening) { this.stop(); return false; }
      // Stop any speech first so the app does not transcribe itself.
      try { globalThis.speechSynthesis && globalThis.speechSynthesis.cancel(); } catch {}
      rec = new SR();
      rec.lang = lang;
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript.trim());
        if (onResult) onResult(alts[0], alts);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { blocked = true; set('blocked'); }
        else if (e.error === 'no-speech') set('no-speech');
        else set('error', e.error);
      };
      rec.onend = () => { if (listening) set('idle'); };
      try { rec.start(); set('listening'); return true; } catch { set('error'); return false; }
    },
    stop() { try { rec && rec.stop(); } catch {} set('idle'); },
  };
}
