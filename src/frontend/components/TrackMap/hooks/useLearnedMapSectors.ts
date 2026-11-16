import { useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import {
  useChannelSelector,
  useTrackProfileSelector,
} from '@irdashies/context';
import {
  learnedSectorStarts,
  sectorLapSpans,
  sectorsFromStarts,
  type LapSpan,
} from '@irdashies/domain/track';
import type {
  FlagStateSnapshot,
  Sector,
  TrackProfileSnapshot,
} from '@irdashies/types';

const NO_FLAGS: readonly boolean[] = [];
const NO_SPANS: readonly LapSpan[] = [];

const selectLearnedStarts = (snapshot: TrackProfileSnapshot) =>
  learnedSectorStarts(snapshot);
const selectYellowSectors = (snapshot: FlagStateSnapshot) =>
  snapshot.yellowSectors;

export interface LearnedMapSectors {
  /**
   * The sectors with their real starts, or undefined until the car has been
   * seen crossing into them on this circuit.
   */
  sectors: Sector[] | undefined;
  /** The stretches of the lap in a sector under a yellow flag. */
  yellowSpans: readonly LapSpan[];
}

/**
 * The sectors of a circuit whose sim times them without saying where they
 * start, for a map that draws them on the road: Le Mans Ultimate.
 *
 * Where they start comes from the track profile, which keeps what the car's
 * own laps have shown, and which sector is under yellow from the flag state.
 * Until the starts are known there are no sectors and no yellow stretch: a
 * flag painted on the wrong third of the circuit is worse than none, and the
 * flag widgets show it either way.
 *
 * Both lists keep their identity while nothing in them moves, so the map's
 * static layer is redrawn when a flag comes out or goes in and not ten times
 * a second in between.
 */
export const useLearnedMapSectors = (enabled = true): LearnedMapSectors => {
  const starts =
    useTrackProfileSelector(selectLearnedStarts, {
      equality: shallow,
      enabled,
    }) ?? null;
  const yellowSectors =
    useChannelSelector('flag-state.snapshot', selectYellowSectors, {
      equality: shallow,
      enabled,
    }) ?? NO_FLAGS;

  return useMemo(
    () => ({
      sectors: starts ? sectorsFromStarts(starts) : undefined,
      yellowSpans: starts ? sectorLapSpans(starts, yellowSectors) : NO_SPANS,
    }),
    [starts, yellowSectors]
  );
};
