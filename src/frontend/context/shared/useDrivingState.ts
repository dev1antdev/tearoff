import type { TrackStateSnapshot } from '@irdashies/types';
import { trackStateSelectors, useTrackStateSelector } from '../ChannelStore';
import { useShowWhileWatching } from '../DashboardContext/DashboardContext';

const selectIsDriving = (snapshot: TrackStateSnapshot): boolean => {
  // A frame the sim has stopped writing cannot say the player is driving,
  // whatever it holds. Checked first because the three terms below are ORed:
  // a session that ended with the player in the pits left `onPitRoad` true in
  // the last frame, and that alone kept every widget gated on this on screen
  // after the session was over.
  if (snapshot.dataStale) return false;
  // Nor while the sim says the player is out of the car. A car left in the
  // pit lane or stall keeps the pit terms below true while the player sits at
  // LMU's monitor, and IsOnTrack being false does not stop an OR.
  if (snapshot.outOfCar) return false;

  const focusCarIdx = snapshot.focusCarIdx ?? -1;
  const onPitRoad = snapshot.carIdxOnPitRoad[focusCarIdx] ?? false;
  const isInGarage = snapshot.isInGarage || snapshot.isGarageVisible;
  return (
    (snapshot.isOnTrack || snapshot.playerCarInPitStall || onPitRoad) &&
    !isInGarage &&
    !snapshot.isReplayPlaying
  );
};

/** Watching a car that is not the user's own entry: the camera on a rival. */
const selectIsWatchingOtherCar = (snapshot: TrackStateSnapshot): boolean =>
  snapshot.watching && !snapshot.watchingOwnCar;

/**
 * Where the user is, for the widgets that show only on track.
 *
 * `isDriving` is the user at the wheel, as it has always been. `isWatching`
 * is the other way to be on track: in a session, out of the car, with the car
 * the overlays are about out of its garage -- a team-mate's stint, or a car
 * the camera is on. It is false when the General setting that keeps widgets
 * up while watching is switched off, so a widget never has to read the
 * setting itself.
 *
 * `isWatchingOwnCar` is watching with the car on screen being the user's own
 * entry: the team car with a team-mate at the wheel. The lap, the lap times,
 * the delta and the rest of what describes one car are the own entry's
 * whatever the camera is on, so a widget made of those is shown while
 * watching only when this holds. Subject to the same General setting.
 *
 * `isWatchingOtherCar` is the camera on any other car. The own car's numbers
 * are still true then and are not what is on screen: a widget that stays up
 * regardless of where the user is shows no live figure of the own car while
 * it holds. This one is the sim's fact alone, whatever the setting.
 *
 * A widget that has something true to show for any watched car hides on
 * `!(isDriving || isWatching)`. One about the user's own car hides on
 * `!(isDriving || isWatchingOwnCar)`. One made of the car's pedals, revs or
 * brakes hides on `!(isDriving || useWatchingOwnCarTelemetry())`, below.
 * One that helps the user drive -- the driver's aids -- hides on
 * `!isDriving` alone.
 */
export const useDrivingState = () => {
  const isDriving = useTrackStateSelector(selectIsDriving) ?? false;
  const watching = useTrackStateSelector(trackStateSelectors.watching) ?? false;
  const watchingOwnCar =
    useTrackStateSelector(trackStateSelectors.watchingOwnCar) ?? false;
  const isWatchingOtherCar =
    useTrackStateSelector(selectIsWatchingOtherCar) ?? false;
  const showWhileWatching = useShowWhileWatching();

  return {
    isDriving,
    isWatching: watching && showWhileWatching,
    isWatchingOwnCar: watchingOwnCar && showWhileWatching,
    isWatchingOtherCar,
  };
};

/**
 * Whether the user is watching their own entry with the sim writing its
 * pedals, steering, gear, revs and brake temperatures: the part of a car
 * that exists only in its telemetry block.
 *
 * The widgets made of those -- the inputs, the shift light, the tyres and
 * brakes, the lap trace -- show during a team-mate's stint only while this
 * holds. Watching the own entry is not enough for them: the sim may send no
 * block for a car somebody else is driving, and they would then show a car
 * at rest, in neutral, that is doing 200 km/h on the picture. Never true
 * with the camera on another car, whose pedals these are not. Subject to
 * the General setting that keeps widgets up while watching, like
 * `isWatchingOwnCar`.
 *
 * A hook of its own rather than a fifth field of `useDrivingState`, which
 * every widget reads and few need this from.
 */
export const useWatchingOwnCarTelemetry = (): boolean => {
  const watchingOwnCarTelemetry =
    useTrackStateSelector(trackStateSelectors.watchingOwnCarTelemetry) ?? false;
  const showWhileWatching = useShowWhileWatching();
  return watchingOwnCarTelemetry && showWhileWatching;
};
