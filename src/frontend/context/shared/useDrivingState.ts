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
 * `!(isDriving || isWatchingOwnCar)`. One that describes the user's own
 * driving -- the pedals, the driver's aids -- hides on `!isDriving` alone.
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
