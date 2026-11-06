// What Nadia can say, mapped to what the guide does. Checked BEFORE the
// toolkit Controller's grammar, which then handles the app-wide settings
// ("speak slower", "undo"). Order matters: "stop the sound" must be caught
// as pausing the beacon before "sound" reads as a request for the car's.

const RULES = [
  ['help', /^(help|what can i (say|do)|commands?|options)\b/],
  ['beaconOff', /\b(stop|pause|mute|quiet|turn off|silence)\b.*\b(beacon|tone|beep(ing)?|pings?|sound)\b|^(mute|quiet)$/],
  ['beaconOn', /\b(start|resume|unmute|turn on|play)\b.*\b(beacon|tone|beep(ing)?|pings?)\b/],
  ['arrived', /\b(i'?m|i am) (at|by|next to|touching) (the |my )?(car|door)\b|\bfound (it|the car|my car)\b/],
  ['boarded', /\b(i'?m|i am) (in|inside)( the car)?\b|\bgot in\b|\bin the car\b/],
  ['door', /\b(which|what) door\b|\bwhere('?s| is) (the |my )?(door|handle)\b|\bdoor handle\b/],
  ['unlock', /\bunlock\b|\bopen (the |my )?door\b/],
  ['honk', /\b(honk|horn|beep at me|make (a )?(sound|noise)|chime|chirp|car sound)\b/],
  ['call', /\bcall\b/],
  ['message', /\b(message|text|tell|let)\b.*\b(driver|marcus)\b/],
  ['check', /\b(check|verify|is this (my|the) car|photo|picture|camera)\b/],
  ['describe', /\b(describe|what (car|kind of car|does (it|the car) look)|which car|plate|license|what color)\b/],
  ['where', /\bwhere('?s| is) (my |the )?(car|ride|lyft|driver)\b|\bwhich way\b|\bdirection\b|\bpoint me\b|\bguide me\b/],
  ['distance', /\bhow far\b|\bdistance\b|\bhow (close|near)\b/],
  ['status', /\bstatus\b|\bhow long\b|\beta\b|\bwhen\b.*\b(arriv\w*|get here|be here|come)\b|\bis (it|the car|my ride|he|she) here\b|\bhas (it|the car|he|she) arrived\b/],
  ['whereAmI', /\bwhere am i\b|\bwhat step\b|\bwhat'?s next\b/],
  ['start', /^(start|let'?s go|go|i'?m (ready|leaving|heading (out|down))|leaving now|start (walking|guidance|guiding)|begin)$/],
  ['repeat', /^(repeat|say (that|it) again|again|what\??|pardon|sorry\??|come again)$|\brepeat\b/],
  ['back', /^(back|go back|previous( step)?|last step|step back)$/],
  ['next', /^(next( step)?|done|ok(ay)?|got it|continue|i'?m there|i did it|ready|yes|yep)$/],
];

export function matchRideIntent(utterance) {
  const u = String(utterance || '').toLowerCase().replace(/[.!,]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!u) return null;
  for (const [id, re] of RULES) if (re.test(u)) return id;
  return null;
}

export const HELP_TEXT =
  'You can say: next, back, or repeat. Where is my car. How far. Is it here. Describe the car. ' +
  'Ask to honk. Message the driver. Which door. I\'m at the car. Pause the beacon. Speak slower or faster.';
