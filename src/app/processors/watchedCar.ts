import type { Telemetry } from '@irdashies/types';

/**
 * Which car the user is watching, for the widgets and processors that are
 * about the user's own car.
 *
 * Watching is being in a session, out of the car, with the car the overlays
 * are about out of its garage (`LmuWatching`, which the LMU mapper decides).
 * That car is `CamCarIdx`: the car the sim's camera is on, or with nothing
 * focused the user's own entry. The own entry is `PlayerCarIdx`, which
 * through a team-mate's stint stays on the team car.
 *
 * The keys that describe one car -- the lap, the lap times, the sectors, the
 * speed, the energy -- always describe the own entry, never the camera's
 * car. So they are what is on screen only while the two are the same car.
 * With the camera on a rival they are still true of the team car, and shown
 * then they would put the team car's delta over a picture of another car.
 *
 * iRacing frames carry no `LmuWatching`, so under iRacing both of these are
 * false for now.
 */

const scalar = (frame: Telemetry, key: keyof Telemetry): unknown =>
  (frame[key] as { value?: unknown[] } | undefined)?.value?.[0];

/**
 * Whether the user is watching their own entry: a team-mate's stint with the
 * camera left on the team car, or their own car handed to the AI.
 */
export const isWatchingOwnCar = (frame: Telemetry): boolean => {
  if (scalar(frame, 'LmuWatching') !== true) return false;
  const own = scalar(frame, 'PlayerCarIdx');
  return (
    typeof own === 'number' && own >= 0 && scalar(frame, 'CamCarIdx') === own
  );
};

/**
 * Whether the user is watching a car that is not their own entry: the camera
 * moved to a rival, or a session joined as a spectator.
 */
export const isWatchingAnotherCar = (frame: Telemetry): boolean =>
  scalar(frame, 'LmuWatching') === true && !isWatchingOwnCar(frame);

/**
 * Whether the frame says the user is not at the wheel, so that whatever the
 * car does on it is not the user's own driving: a lap it completes is not
 * one of theirs to keep.
 *
 * `IsOnTrack` false on a Le Mans Ultimate frame, where it is the user in the
 * car and nothing else, and where the single-car keys go on describing the
 * team car with a team-mate in it. iRacing's `IsOnTrack` has not been looked
 * at through a team-mate's stint, and its frames read as at the wheel here
 * until the phase that brings watching to iRacing.
 */
export const isAwayFromWheel = (frame: Telemetry): boolean =>
  frame.LmuWatching !== undefined && scalar(frame, 'IsOnTrack') !== true;
