// Nadia — the persona this example is designed around, written as the
// toolkit profile a first run starts from. A profile is a starting point,
// not a characterization: every value here can be changed on the Settings
// screen, by voice, or by Nadia's own onboarding.
//
// Nadia can't see. She walks on her own with a white cane, hears well,
// orients herself and talks. She uses a screen reader on her phone.

export const APP = { appId: 'door-to-ride', app: 'Door to Ride' };

// Needs this app meets, registered with the Librarian as "door-to-ride/<id>"
// (toolkit/protocol/adapter/needs.js). The profile agent can then suggest
// them to other people whose profiles call for them.
export const REGISTERED_NEEDS = [
  {
    id: 'clock-directions',
    phrase: 'Directions as clock positions',
    description: 'Says where things are as hours on a clock face ("the car is at 2 o\'clock") instead of "slightly right".',
    abilities: 'For people who cannot see the screen or the street and orient by their body: blindness, low vision, a person trained in orientation and mobility.',
  },
  {
    id: 'steps',
    phrase: 'Distances in my own steps',
    description: 'Gives distances as a count of the person\'s steps, using their step length, instead of feet or meters.',
    abilities: 'For people who judge distance by walking rather than by sight: blindness, low vision.',
    value: { kind: 'number', min: 0.4, max: 1.2, start: 0.7, unit: 'meters per step' },
  },
  {
    id: 'sound-beacon',
    phrase: 'A sound that leads me to my car',
    description: 'Plays a soft repeating tone placed in stereo where the car is: louder on the side the car is on, faster as the person gets closer.',
    abilities: 'For people who cannot see where the car is and can hear in both ears, ideally with one earbud or bone-conduction headphones so street sound stays clear.',
  },
  {
    id: 'vibration-cues',
    phrase: 'Phone buzzes when I face my car',
    description: 'Short vibration patterns: a double buzz when facing the car, a long buzz on arrival.',
    abilities: 'For people who cannot see the screen, and anyone who wants guidance without sound in a noisy street.',
  },
];

/** The profile a first run starts from (librarian.replaceProfile shape). */
export const NADIA_PROFILE = {
  supportAreas: ['vision'],
  freeText:
    "I can't see. I walk on my own with a white cane, hear well and know how to orient myself. " +
    'I use VoiceOver on my phone. Tell me directions as clock positions and distances in steps.',
  fields: {
    visionKind: 'blind',
    needs: [
      // A screen-reader user: the toolkit's controller presentation then
      // delivers results through the ARIA live region (her screen reader
      // reads them in her own voice and rate) instead of a second TTS voice.
      { dimension: 'announceUpdates', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'readAloudRate', value: 1.0, strength: 'preference', source: 'onboarding' },
      { dimension: 'door-to-ride/clock-directions', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'door-to-ride/steps', value: 0.7, strength: 'preference', source: 'onboarding' },
      { dimension: 'door-to-ride/sound-beacon', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'door-to-ride/vibration-cues', value: true, strength: 'preference', source: 'onboarding' },
    ],
  },
  metaPreferences: {},
};
