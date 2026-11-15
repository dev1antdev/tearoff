import { useCallback, useMemo } from 'react';
import { useTrackStateSelector } from '@irdashies/context';
import {
  selectCarLapFraction,
  selectCurrentNotes,
  splitNotes,
} from '@irdashies/shared';
import type { TrackNote, TrackStateSnapshot } from '@irdashies/types';

/** The step the distance to the next note is counted down in, metres. */
const NEXT_DISTANCE_STEP_M = 10;
const SEPARATOR = '|';
const NONE = '';

export interface CurrentNotesOptions {
  trackLengthM: number;
  paceLeadMeters: number;
  paceLeadSeconds: number;
  /** On pit road, read the notes written for it. */
  showPitNotes: boolean;
  /** Follow the car the camera is on rather than the player's own. */
  followFocusCar: boolean;
  /** Count the distance to the next note down; off, the widget is not drawn for it. */
  withNextDistance: boolean;
  enabled: boolean;
}

export interface CurrentNotes {
  /** The car is on pit road and the pit notes are the ones read. */
  pit: boolean;
  pace: TrackNote | null;
  track: TrackNote | null;
  /** Metres to the next note of each kind, in steps of ten; null with none. */
  paceNextM: number | null;
  trackNextM: number | null;
  inGarage: boolean;
}

const NOTHING: CurrentNotes = {
  pit: false,
  pace: null,
  track: null,
  paceNextM: null,
  trackNextM: null,
  inGarage: false,
};

const step = (distanceM: number | null): string =>
  distanceM === null
    ? NONE
    : String(
        Math.round(distanceM / NEXT_DISTANCE_STEP_M) * NEXT_DISTANCE_STEP_M
      );

const distanceOf = (field: string): number | null =>
  field === NONE ? null : Number(field);

/**
 * The notes current for where the car is.
 *
 * Read from `track-state.snapshot` through a selector that answers with
 * which notes are current, not with where the car is: the widget is drawn
 * again when a note changes and not twenty-five times a second. With the
 * distance to the next note switched on it is drawn again every ten metres.
 *
 * The position is the lap fraction as that channel carries it: the player's
 * own as the frame has it, and a watched car's to three decimals, so the
 * notes of a watched car can be half a thousandth of a lap early or late
 * (1.8 m at Laguna Seca, 6.8 m at Le Mans).
 */
export const useCurrentNotes = (
  notes: readonly TrackNote[],
  {
    trackLengthM,
    paceLeadMeters,
    paceLeadSeconds,
    showPitNotes,
    followFocusCar,
    withNextDistance,
    enabled,
  }: CurrentNotesOptions
): CurrentNotes => {
  const lists = useMemo(() => splitNotes(notes), [notes]);

  const selector = useCallback(
    (snapshot: TrackStateSnapshot): string => {
      const focus = snapshot.focusCarIdx ?? -1;
      const selection = selectCurrentNotes(
        lists,
        {
          lapFraction: selectCarLapFraction(snapshot, followFocusCar),
          // The speed is the user's own car's. For another car it is not
          // known here, and the lead in seconds adds nothing.
          speedMs:
            !followFocusCar || snapshot.watchingOwnCar ? snapshot.speed : 0,
          onPitRoad: followFocusCar
            ? snapshot.carIdxOnPitRoad[focus] === true
            : snapshot.onPitRoad,
        },
        { trackLengthM, paceLeadMeters, paceLeadSeconds, showPitNotes }
      );
      return [
        selection.pit ? 1 : 0,
        selection.paceIndex,
        selection.trackIndex,
        withNextDistance ? step(selection.paceNextM) : NONE,
        withNextDistance ? step(selection.trackNextM) : NONE,
        snapshot.isInGarage ? 1 : 0,
      ].join(SEPARATOR);
    },
    [
      lists,
      followFocusCar,
      trackLengthM,
      paceLeadMeters,
      paceLeadSeconds,
      showPitNotes,
      withNextDistance,
    ]
  );

  const key = useTrackStateSelector(selector, { enabled });

  return useMemo(() => {
    if (key === undefined) return NOTHING;
    const [pit, paceIndex, trackIndex, paceNext, trackNext, garage] =
      key.split(SEPARATOR);
    const isPit = pit === '1';
    const paceNotes = isPit ? lists.pitPace : lists.pace;
    const trackNotes = isPit ? lists.pitTrack : lists.track;
    return {
      pit: isPit,
      pace: paceNotes[Number(paceIndex)] ?? null,
      track: trackNotes[Number(trackIndex)] ?? null,
      paceNextM: distanceOf(paceNext),
      trackNextM: distanceOf(trackNext),
      inGarage: garage === '1',
    };
  }, [key, lists]);
};
