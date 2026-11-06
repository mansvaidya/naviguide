// The toolkit host for Door to Ride: a browser KVStore port, the core
// (`createToolkit` → datastore + Librarian), Nadia's profile, and the
// translation from her AbilityModel into how this app guides her.
//
// The AbilityModel stays the source of truth (toolkit CLAUDE.md): the app
// never stores "beacon on" or "speech rate 1.2" itself. It reads the model,
// renders it with the toolkit's own surface (`renderMobileSettings`) and
// the Controller's presentation rules, and writes changes back through the
// Librarian.

import { createToolkit } from '../../../toolkit/index.js';
import { renderMobileSettings } from '../../../toolkit/surfaces/mobile.js';
import { deriveControllerPresentation } from '../../../controller/presentation.js';
import { APP, REGISTERED_NEEDS, NADIA_PROFILE } from './persona.js';

/**
 * KVStore port backed by localStorage, one JSON value per area/key. Falls
 * back to memory when storage is blocked (private windows, sandboxed
 * previews), so the app still runs, it just forgets on reload.
 */
export function browserKV(prefix = 'door-to-ride') {
  const mem = new Map();
  let ls = null;
  try { ls = globalThis.localStorage; ls.setItem(`${prefix}:probe`, '1'); ls.removeItem(`${prefix}:probe`); } catch { ls = null; }
  const k = (area, key) => `${prefix}:${area}:${key}`;
  return {
    persistent: !!ls,
    async get(area, key) {
      const raw = ls ? (() => { try { return ls.getItem(k(area, key)); } catch { return null; } })() : mem.get(k(area, key));
      if (raw == null) return undefined;
      try { return JSON.parse(raw); } catch { return undefined; }
    },
    async set(area, key, value) {
      const id = k(area, key);
      if (value === undefined) { if (ls) { try { ls.removeItem(id); } catch {} } mem.delete(id); return; }
      const raw = JSON.stringify(value);
      if (ls) { try { ls.setItem(id, raw); return; } catch { /* quota: fall through */ } }
      mem.set(id, raw);
    },
    async getAll(area) {
      const out = {};
      const head = `${prefix}:${area}:`;
      const keys = ls ? Object.keys(ls) : [...mem.keys()];
      for (const id of keys) {
        if (!id.startsWith(head)) continue;
        const raw = ls ? ls.getItem(id) : mem.get(id);
        try { out[id.slice(head.length)] = JSON.parse(raw); } catch {}
      }
      return out;
    },
  };
}

const need = (model, dim) => {
  let found;
  for (const n of (model && model.needs) || []) if (n.dimension === dim) found = n.value;
  return found;
};

/**
 * Turn an AbilityModel into this app's guidance preferences. Pure, so the
 * Settings screen, the guide and the tests all agree.
 */
export function guidancePrefs(model) {
  const presentation = deriveControllerPresentation(model);
  const mobile = renderMobileSettings(model);
  const steps = need(model, `${APP.appId}/steps`);
  return {
    presentation,
    // A screen-reader user hears results through the live region in their
    // own screen reader; anyone else hears the app's own voice.
    selfVoice: presentation.output.primary === 'speech',
    screenReader: !!presentation.output.assistiveTech,
    speechRate: mobile.speech.rate,
    verbosity: presentation.verbosity,
    clock: need(model, `${APP.appId}/clock-directions`) !== false,
    unit: typeof steps === 'number' && steps > 0 ? 'steps' : 'feet',
    stepLengthM: typeof steps === 'number' && steps > 0 ? steps : 0.7,
    beacon: need(model, `${APP.appId}/sound-beacon`) === true,
    haptics: need(model, `${APP.appId}/vibration-cues`) === true,
  };
}

/** Start the toolkit, seeding Nadia's profile on the first run. */
export async function startToolkit({ kv = browserKV(), seed = NADIA_PROFILE } = {}) {
  const { datastore, librarian } = createToolkit({ kv });
  await datastore.runMigrations();
  const existing = await datastore.get('mine.profile');
  if (!existing && seed) await librarian.replaceProfile(seed);
  try { await librarian.registerNeeds(APP, REGISTERED_NEEDS); } catch (e) { console.warn('registerNeeds failed', e); }

  async function model() { return librarian.getAbilityModel(); }

  /** Set (or with `value === undefined`, remove) one need in the profile. */
  async function setNeed(dimension, value) {
    const profile = await librarian.getProfile();
    const needs = ((profile.fields && profile.fields.needs) || []).filter((n) => n.dimension !== dimension);
    if (value !== undefined) needs.push({ dimension, value, strength: 'preference', source: 'user-explicit' });
    await librarian.setProfileField('fields.needs', needs);
    return model();
  }

  return {
    datastore,
    librarian,
    persistent: kv.persistent !== false,
    model,
    prefs: async () => guidancePrefs(await model()),
    setNeed,
    /** A direct change the person made by voice or in Settings: kept in the profile and recorded as explicit. */
    async setSpeechRate(rate) {
      const r = Math.min(2, Math.max(0.5, Math.round(rate * 10) / 10));
      await setNeed('readAloudRate', r);
      try { await librarian.recordExplicitSetting('speechRate', r, APP.appId); } catch {}
      return r;
    },
    async resetToNadia() {
      await librarian.replaceProfile(NADIA_PROFILE);
      return model();
    },
  };
}
