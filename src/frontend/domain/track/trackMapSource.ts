import { useMemo } from 'react';
import { useActiveSimulator, useSessionStore } from '@irdashies/context';
import type { ActiveSimulator } from '@irdashies/types';
import { lmuMapSignature, lmuTrackDrawing } from './lmuTrackOutline';
import type { TrackDrawing } from './trackDrawing';

/**
 * Where a map of the whole circuit takes its track from.
 *
 * - `drawing`: the drawing shipped with the app for the session's track id,
 *   which is how an iRacing track is drawn.
 * - `outline`: the outline the session itself carries, which is how a Le Mans
 *   Ultimate circuit is drawn: bundled for most, otherwise recorded from the
 *   first full lap driven.
 * - `noOutline`: a Le Mans Ultimate circuit that has neither yet.
 */
export type TrackMapSource =
  | { kind: 'drawing' }
  | { kind: 'outline'; drawing: TrackDrawing }
  | { kind: 'noOutline' };

const FROM_DRAWING: TrackMapSource = { kind: 'drawing' };
const NO_OUTLINE: TrackMapSource = { kind: 'noOutline' };

/**
 * The one place that says which of the two a session is drawn from.
 *
 * An outline in the session settles it whatever the simulator is said to be:
 * only a Le Mans Ultimate session carries one, and it is there before the
 * main process has answered which sim is running. Without one the simulator
 * decides, so that a Le Mans Ultimate circuit is never looked up among the
 * iRacing drawings: its track id is a number of its own making and names
 * nothing there.
 */
export const resolveTrackMapSource = (
  simulator: ActiveSimulator | null | undefined,
  outline: TrackDrawing | null
): TrackMapSource => {
  if (outline) return { kind: 'outline', drawing: outline };
  return simulator === 'lmu' ? NO_OUTLINE : FROM_DRAWING;
};

/**
 * The track source of the running session, the same object until the
 * simulator or the outline is another one.
 */
export const useTrackMapSource = (): TrackMapSource => {
  const simulator = useActiveSimulator();
  const signature = useSessionStore((state) =>
    lmuMapSignature(state.session?.LmuTrackMap)
  );

  return useMemo(
    () =>
      resolveTrackMapSource(
        simulator,
        signature === ''
          ? null
          : lmuTrackDrawing(useSessionStore.getState().session?.LmuTrackMap)
      ),
    // The signature stands in for the map: see lmuMapSignature.
    [simulator, signature]
  );
};
