import { useMemo } from 'react';
import { useTrackStateSelector } from '@irdashies/context';
import type { TrackStateSnapshot } from '@irdashies/types';
import { shallow } from 'zustand/shallow';

export interface PitRefuelTargetResult {
  /** Litres of fuel, or a virtual energy level in percent. */
  amount: number;
  /** Which of the two `amount` is. */
  isVirtualEnergy: boolean;
}

const EMPTY_REFUEL_STATE: readonly [number | undefined, boolean | undefined] = [
  undefined,
  undefined,
];

const selectRefuelTarget = (snapshot: TrackStateSnapshot) =>
  [snapshot.refuelTarget, snapshot.refuelTargetIsVirtualEnergy] as const;

/**
 * What the next pit stop is set to put in, or undefined when the sim does not
 * say.
 *
 * Only Le Mans Ultimate says, from its pit menu, so under iRacing this is
 * always undefined and the widget shows nothing for it.
 */
export const usePitRefuelTarget = (
  enabled: boolean
): PitRefuelTargetResult | undefined => {
  const [amount, isVirtualEnergy] =
    useTrackStateSelector(selectRefuelTarget, { equality: shallow }) ??
    EMPTY_REFUEL_STATE;

  return useMemo(
    () =>
      !enabled || amount === undefined
        ? undefined
        : { amount, isVirtualEnergy: isVirtualEnergy === true },
    [enabled, amount, isVirtualEnergy]
  );
};
