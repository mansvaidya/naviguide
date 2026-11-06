# Door to Ride

A web app that guides a rider who can't see from her apartment door to the
car waiting for her, by voice, sound and touch. It is built around one
persona, **Nadia**: she can't see, and she walks on her own with a white
cane, hears well, orients herself and talks. The ride is a Lyft for now,
with an autonomous car as the second ride type.

> **Status:** a research prototype on the AI for Accessibility Toolkit
> (pre-alpha), a technology probe. It has not been tested with blind
> riders, and it does not replace a cane, a guide dog or orientation and
> mobility training. The ride and the street are simulated, so nobody
> should rely on it to find a real car yet.

## The journey

| Phase | What Nadia hears and does |
|---|---|
| Before you leave | Who is coming, in what car, how far away, and whether it is time to leave (ride ETA against how long her route takes). |
| Inside | Her route, one step at a time, each with a landmark she can feel or hear ("the carpet ends at a metal strip"). She says "next" at each one. GPS doesn't work indoors, so the route is recorded, the way orientation and mobility instructors teach one. |
| Outside | Clock directions and distances in her own steps toward the pickup spot, then toward the car's **rear curb-side door** once it arrives. A quiet stereo tone comes from the side the car is on and speeds up as she gets closer. The phone buzzes when she faces the car. Fixed hazards (bike rack, tree grate, hydrant) and the curb edge are announced before she reaches them. |
| The car arrives | Where it actually stopped (cars rarely stop on the pin), the target moves, and she can ask the driver to honk (Lyft) or the car to play its chime (autonomous). |
| At the car | Which door, how its handle works, and the safety check: ask "Who are you picking up?" before getting in. A photo check of the plate is optional. |

Everything works by voice ("where is my car", "how far", "is it here",
"ask him to honk", "which door", "speak slower", "help"), by typing, or by
the large buttons. Every sentence also goes to an ARIA live region and the
on-screen log.

## How it uses the toolkit

- **Core** (`createToolkit` with a localStorage `KVStore` port,
  `src/toolkit-host.js`): Nadia's profile is the source of truth. A first
  run seeds it from `src/persona.js`; Settings and voice commands write
  back through the Librarian (`setProfileField`, `recordExplicitSetting`).
- **Registered needs** (`librarian.registerNeeds`): the app registers what
  it offers as `door-to-ride/clock-directions`, `door-to-ride/steps` (a
  number: step length in meters), `door-to-ride/sound-beacon` and
  `door-to-ride/vibration-cues`, so the profile agent can suggest them to
  other people whose profiles call for them.
- **Surfaces and presentation**: speaking rate comes from
  `renderMobileSettings(model).speech.rate`; whether the app speaks itself
  or hands words to the screen reader comes from the Controller's
  `deriveControllerPresentation` (a profile with screen-reader needs gets
  the live region, not a second voice).
- **Controller** (`createController` + `src/control-port.js`): ride
  phrases are matched first (`src/ride-intents.js`); anything else goes to
  the toolkit's shared grammar, so "speak slower", "undo", "read this" and
  "dark mode" work as in any toolkit app, and a speed change is saved to
  the profile.
- **AI vision** (optional, `src/vision.js`): the photo check calls the
  toolkit service's `POST /v1/ai/vision` with a toolkit address and token
  from Settings, or Claude when the page runs as a claude.ai artifact.

## Run it

```bash
npm ci                                   # once, at the repository root (esbuild)
node examples/door-to-ride/build.mjs     # writes index.html and dist/
node examples/door-to-ride/test/door-to-ride.test.mjs
```

- **Desktop or co-design session:** serve the repository root
  (`npx serve .`) and open `/examples/door-to-ride/`, or open
  `dist/index.html` directly. The **Practice walk** panel moves a
  simulated Nadia on a simulated street; a facilitator can drive it while a
  participant listens (headphones recommended for the stereo tone).
- **On a phone, outdoors:** host `dist/index.html` over HTTPS (location,
  compass and microphone need it), open Settings and choose **Use my real
  location and compass**. The car is still simulated: it pulls up a few
  meters from wherever she steps outside, facing the street.

## Files

| File | What it does |
|---|---|
| `src/persona.js` | Nadia's starting profile and the needs the app registers |
| `src/toolkit-host.js` | KV port, `createToolkit`, profile → guidance preferences |
| `src/guide.js` | The journey state machine and every sentence Nadia hears |
| `src/scenario.js` | The recorded indoor route and the street layout |
| `src/ride-provider.js` | Simulated Lyft and autonomous providers (one interface) |
| `src/sensors.js` | Real GPS + compass, or the simulated walker |
| `src/feedback.js` | Live region + speech, the stereo tone, vibration |
| `src/ride-intents.js`, `src/voice-in.js`, `src/control-port.js` | Voice and typed commands |
| `src/vision.js` | Optional photo check of the car |
| `src/main.js`, `src/page.html`, `src/styles.css` | The page |

## Known limits and open questions

- **Last few meters.** City GPS is good to 5–15 m, so near the car the app
  says so and leans on sound: the honk, the car's chime, the driver's voice.
  Ultra-wideband, Bluetooth beacons in the car or camera-based detection
  are the obvious next steps, and each needs the ride provider's help.
- **Provider access.** Lyft's public API doesn't give a rider's
  third-party app live car position or a "honk" request. The provider
  interface in `src/ride-provider.js` is a proposal for what a provider
  (or an autonomous fleet) should expose to riders who can't see the car.
- **iPhone vibration.** iOS Safari does not allow web pages to vibrate;
  sound and voice carry the cues there.
- **Headphones vs. traffic.** The tone is quiet and sparse, but whether
  riders accept any audio over street sound, and with which headphones, is
  a question for co-design sessions.
- **Recording the route.** Who records it (Nadia, a helper, an O&M
  instructor), how, and how often it goes out of date (construction, a
  locked door) are open.
