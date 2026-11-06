// The route from Nadia's door to the curb, and the street outside.
//
// Indoors, GPS and compass are unreliable, so the indoor part is a route
// someone walked once and recorded as steps with landmarks Nadia can feel
// or hear (how orientation and mobility instructors teach a route). She
// confirms each step. The default below is an example building; the
// Settings screen lets Nadia or a helper rewrite it for hers.
//
// Outdoors, the street is laid out relative to the building exit: which way
// the street is, where the pickup pin is, and fixed things on the sidewalk
// worth a warning. In simulation the exit is a fixed point; with real
// sensors it is wherever Nadia's phone is when she steps outside.

import { offset } from './geo.js';

/** Example indoor route: apartment 4B to the street door. Seconds are a rough walking estimate. */
export const DEFAULT_ROUTE = [
  {
    say: 'Lock your door behind you, then turn right into the hallway.',
    landmark: 'Your door is the last one on the hallway, so the wall is at your back when you turn.',
    seconds: 20,
  },
  {
    say: 'Walk about 20 steps down the hallway, keeping the wall on your right.',
    landmark: 'Just before the elevator, you pass the fire door. You will hear it hum, and the carpet ends at a metal strip.',
    seconds: 25,
  },
  {
    say: 'The elevator is on your left. The call button is a single button to the right of the doors, at hand height.',
    landmark: 'Inside, the lobby button is the lowest one and has a raised star. The elevator says "Lobby" when it arrives.',
    seconds: 70,
  },
  {
    say: 'Step out of the elevator and turn left. Walk about 15 steps across the tile floor.',
    landmark: 'The mailboxes are on your right. You will feel cooler air from the front door.',
    seconds: 20,
  },
  {
    say: 'The front door is straight ahead. Push the bar, then step out onto the landing, facing the street.',
    landmark: 'There are two steps down with a handrail on your right. Then you are on the sidewalk.',
    seconds: 20,
  },
];

/**
 * Lay out the street around `exit`, with `streetBearing` the compass
 * direction Nadia faces when she steps out toward the street.
 * Cars park with their passenger side to the curb (right-hand traffic), so
 * the car points along the curb with the building on its right.
 */
export function buildScenario(exit, streetBearing = 270) {
  const fwd = streetBearing;
  const along = (streetBearing + 90) % 360; // the way parked cars face on this side
  const at = (forwardM, alongM) => offset(offset(exit, forwardM, fwd), alongM, along);
  return {
    exit,
    streetBearing: fwd,
    carHeadingDeg: along,
    curbM: 5,
    // The pin the rider set. The simulated car stops 3 m past it, on purpose.
    pickup: { pos: at(4.6, 10), note: 'In front of the building, by the tree' },
    carStop: at(5.9, 13),
    hazards: [
      { pos: at(1.6, 4.5), text: 'bike rack', detail: 'a bike rack along the edge of the sidewalk', radiusM: 4 },
      { pos: at(4.7, 8.5), text: 'tree grate', detail: 'a tree in a metal grate at the curb', radiusM: 3.5 },
      { pos: at(4.8, 16), text: 'fire hydrant', detail: 'a fire hydrant at the curb, past the car', radiusM: 3 },
    ],
  };
}

/**
 * Where Nadia should stand to open the rear passenger door: half a car
 * length back from the car's center, on the sidewalk side.
 */
export function doorPoint(carPos, carHeadingDeg) {
  const back = offset(carPos, 0.7, (carHeadingDeg + 180) % 360);
  return offset(back, 1.5, (carHeadingDeg + 90) % 360);
}

export function routeSeconds(route) {
  return (route || []).reduce((s, r) => s + (Number(r.seconds) || 20), 0);
}
