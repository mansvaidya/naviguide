// Door to Ride as a receiver for the toolkit's Controller
// (controller/control-port.js). The Controller's grammar then gives Nadia
// the toolkit's shared voice vocabulary for free ("speak slower", "dark
// mode", "undo", "read this"), and anything it does not recognize arrives
// here as a `task`, which the ride grammar answers.
//
// Settings the Controller changes are written back to the profile through
// the toolkit host, so "speak slower" on the street is still slower next
// time, and in every other app that reads her profile.

import { matchRideIntent } from './ride-intents.js';

const SETTING_KEYS = ['speechRate', 'fontScale', 'darkMode', 'contrastMode'];

export function createRideControlPort({ host, runIntent, readContent, applyLook, initial = {} }) {
  const active = { ...initial };
  const journal = [];

  async function write(changes) {
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'speechRate') active[k] = await host.setSpeechRate(v);
      else active[k] = v;
    }
    applyLook && applyLook({ ...active });
  }

  return {
    async describeCapabilities() {
      return { platform: 'web', settingKeys: [...SETTING_KEYS], actions: ['task'], canReadContent: true, canStop: true };
    },
    async getContext() {
      return { focus: 'journey', activeSettings: { ...active }, capabilities: await this.describeCapabilities() };
    },
    async applySettings(changes) {
      const applied = {}; const previous = {}; const rejected = [];
      for (const [k, v] of Object.entries(changes || {})) {
        if (!SETTING_KEYS.includes(k)) { rejected.push(k); continue; }
        previous[k] = active[k]; applied[k] = v;
      }
      if (!Object.keys(applied).length) return { error: 'no applicable settings', rejected };
      journal.push(previous);
      await write(applied);
      return { applied, previous, rejected };
    },
    async undoLast() {
      if (!journal.length) return { error: 'nothing to undo' };
      const prev = journal.pop();
      const restore = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) { if (k === 'speechRate') restore[k] = 1; else delete active[k]; }
        else restore[k] = v;
      }
      await write(restore);
      return { reverted: { ...restore }, remainingUndos: journal.length };
    },
    async resetUndo() { journal.length = 0; return { ok: true }; },
    async getContent(mode = 'text') {
      const c = readContent();
      return mode === 'outline'
        ? { source: 'app', title: c.title, outline: [c.text] }
        : { source: 'app', title: c.title, text: c.text, chunk: 0, totalChunks: 1 };
    },
    async performAction(action, target, text) {
      if (action !== 'task') return { ok: false, error: `unsupported action ${action}` };
      const intent = matchRideIntent(text);
      if (!intent) return { ok: false, error: 'not understood' };
      await runIntent(intent);
      // The guide already spoke; an empty `say` keeps the Controller quiet.
      return { ok: true, say: '' };
    },
    async stop() { return { ok: true, stopped: false }; },
    get settings() { return { ...active }; },
    /** Keep the port's view in step when Settings changes a value directly. */
    sync(key, value) { active[key] = value; },
  };
}
