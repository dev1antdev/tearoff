import { useState, useEffect } from 'react';
import { useGarageCoverSettings } from './hooks/useGarageCoverSettings';
import { useGarageCoverImage } from './hooks/useGarageCoverImage';
import logoSvg from '../../assets/icons/logo.svg';
import type { TrackStateSnapshot } from '@irdashies/types';
import { shallow } from 'zustand/shallow';
import { useTrackStateSelector } from '@irdashies/context';

const EMPTY_GARAGE_STATE: readonly [boolean, boolean, boolean, boolean] = [
  false,
  false,
  false,
  false,
];

/**
 * The garage flags, the on-track flag, and whether any of it is current.
 *
 * Le Mans Ultimate leaves its last frame readable when a session ends, and a
 * session left from the garage ends with the garage flags set: the cover
 * stayed up over the main menu until the next session began. Out of a
 * session, or with a frame the sim has stopped writing, there is no garage
 * to cover. Both are always false under iRacing.
 */
const selectGarageState = (snapshot: TrackStateSnapshot) =>
  [
    snapshot.isInGarage,
    snapshot.isGarageVisible,
    snapshot.isOnTrack,
    snapshot.notInSession || snapshot.dataStale,
  ] as const;

export const GarageCover = () => {
  const [isInGarageDirect, isGarageVisible, isOnTrack, noSession] =
    useTrackStateSelector(selectGarageState, { equality: shallow }) ??
    EMPTY_GARAGE_STATE;

  // Combining both garage-specific flags ensures the fastest possible
  // detection of the garage screen without false positives from other
  // UI screens (like Standings).
  const finalShow = !noSession && (isInGarageDirect || isGarageVisible);

  // Hysteresis/Debounce logic to prevent "flashing" during exit
  // Initialize with the current calculated state
  const [actuallyShow, setActuallyShow] = useState(
    () => finalShow && !isOnTrack
  );

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isOnTrack) {
      // Force-hide immediately (deferred to next tick to satisfy ESLint)
      timer = setTimeout(() => setActuallyShow(false), 0);
    } else if (finalShow) {
      // Show immediately (deferred to next tick to satisfy ESLint)
      timer = setTimeout(() => setActuallyShow(true), 0);
    } else {
      // Delayed hide to bridge telemetry flickers
      timer = setTimeout(() => setActuallyShow(false), 500);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [finalShow, isOnTrack]);

  const settings = useGarageCoverSettings();
  const imageUrl = useGarageCoverImage(settings.imageFilename);

  if (!actuallyShow) {
    return <></>;
  }

  return (
    <div className="w-full h-full flex items-center justify-center rounded-sm bg-slate-800">
      <img
        src={imageUrl || logoSvg}
        alt="Garage Cover"
        className="w-full h-full object-contain"
      />
    </div>
  );
};
