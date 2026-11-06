// "Is this my car?" from a photo. Two optional back ends, tried in order:
//
// 1. The toolkit service's building-block AI (`POST /v1/ai/vision`,
//    server/API.md) with the toolkit's own "describe" prompt; the answer is
//    matched against the ride's color, make, model and plate here.
// 2. Claude, when the page runs as a claude.ai artifact with the `sample`
//    capability.
//
// Neither is required. A photo check is a second opinion, never the only
// check: the spoken safety question ("Who are you picking up?") stays.

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Shrink a phone photo before sending it: 1024 px on the long side, JPEG. */
export async function downscale(file, max = 1024) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
  } catch { return file; }
}

/** Judge a free-text description against the expected vehicle. Pure. */
export function judgeDescription(text, vehicle) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const compact = t.replace(/\s+/g, '');
  const plate = String(vehicle.plate || '').toLowerCase();
  const plateSeen = plate && compact.includes(plate);
  const colorSeen = vehicle.color && t.includes(vehicle.color.toLowerCase());
  const makeSeen = vehicle.make && t.includes(vehicle.make.toLowerCase());
  const modelSeen = vehicle.model && t.includes(vehicle.model.toLowerCase());
  const score = (plateSeen ? 3 : 0) + (colorSeen ? 1 : 0) + (makeSeen ? 1 : 0) + (modelSeen ? 1 : 0);
  return { plateSeen, colorSeen, makeSeen, modelSeen, likely: plateSeen || score >= 2 };
}

export function verdictSentence(j, vehicle) {
  if (j.plateSeen) return `The plate in the photo reads ${vehicle.plate.split('').join(' ')}. That matches your ride.`;
  if (j.likely) return `It looks like a ${vehicle.color} ${vehicle.make} ${vehicle.model}, but I could not read the plate. Ask the driver who they are picking up before you get in.`;
  return 'I could not match this car to your ride. It may be a different car, or the photo did not show it clearly. Do not get in yet; ask the driver who they are picking up.';
}

export function createVisionChecker({ toolkitService = null } = {}) {
  let sample = null;
  let sampleImages = false;
  // Light up the artifact back end if the page runs where it exists.
  (async () => {
    try {
      if (!globalThis.claude || typeof globalThis.claude.use !== 'function') return;
      sample = await globalThis.claude.use('sample');
      if (sample && sample.limits) sampleImages = !!(await sample.limits()).images;
    } catch { sample = null; }
  })();

  return {
    get available() { return !!(toolkitService && toolkitService.url && toolkitService.token) || (!!sample && sampleImages); },
    async check(file, vehicle) {
      const img = await downscale(file);
      if (toolkitService && toolkitService.url && toolkitService.token) {
        const data = await blobToBase64(img);
        const r = await fetch(`${toolkitService.url.replace(/\/$/, '')}/v1/ai/vision`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${toolkitService.token}` },
          body: JSON.stringify({ task: 'describe', image: { mimeType: img.type || 'image/jpeg', data }, adapter: 'door-to-ride' }),
        });
        if (!r.ok) throw new Error(`The toolkit service answered ${r.status}.`);
        const { text } = await r.json();
        const j = judgeDescription(text, vehicle);
        return { ...j, say: verdictSentence(j, vehicle), description: text };
      }
      if (sample && sampleImages) {
        const prompt =
          'A blind rider took this photo to check that a car is their ride. ' +
          `Their ride is a ${vehicle.color} ${vehicle.make} ${vehicle.model} with license plate ${vehicle.plate}. ` +
          'Describe only what is visible. Return JSON: {"color": string|null, "make": string|null, "model": string|null, ' +
          '"plate": string|null (exactly as readable, no spaces, null if not readable), "summary": one short sentence a screen reader will read}.';
        const out = await sample.json(prompt, { images: [img], modelTier: 'quick', cache: false });
        const desc = [out.color, out.make, out.model, out.plate].filter(Boolean).join(' ');
        const j = judgeDescription(desc, vehicle);
        return { ...j, say: `${out.summary || ''} ${verdictSentence(j, vehicle)}`.trim(), description: out.summary || desc };
      }
      throw new Error('Photo checking is not set up here.');
    },
  };
}
