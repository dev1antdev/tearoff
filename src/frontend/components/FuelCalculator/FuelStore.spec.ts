import { beforeEach, describe, expect, it } from 'vitest';
import type { FuelLapData } from '@irdashies/types';
import { useFuelStore } from './FuelStore';

const lap = (
  lapNumber: number,
  sessionNum: number,
  timestamp: number
): FuelLapData => ({
  lapNumber,
  fuelUsed: 3,
  lapTime: 90,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp,
  sessionNum,
});

describe('FuelStore stored laps', () => {
  beforeEach(() => {
    useFuelStore.getState().clearAllData();
  });

  it('keeps every stored lap, in the order storage gave them', () => {
    // Two sessions, each with a lap 1 and a lap 2, the later session first.
    // The lap-number map has room for one of each number; the list keeps
    // them all, and does not put them in the order of their clocks.
    const stored = [
      lap(2, 1, 190_000),
      lap(1, 1, 100_000),
      lap(2, 0, 3_500_000),
      lap(1, 0, 3_410_000),
    ];

    useFuelStore.getState().setLapHistory(stored);

    expect(useFuelStore.getState().lapHistory.size).toBe(2);
    expect(useFuelStore.getState().storedLaps).toEqual(
      stored.map((each) => ({ ...each, isHistorical: true }))
    );
  });

  it('keeps one of a lap that was stored twice', () => {
    // The calculator saves its laps again when it is mounted afresh while
    // they are still live. Twice in storage, a lap weighed twice in every
    // average.
    const stored = [
      lap(2, 1, 190_000),
      lap(1, 1, 100_000),
      lap(2, 1, 190_000),
      lap(1, 1, 100_000),
      lap(1, 0, 100_000),
    ];

    useFuelStore.getState().setLapHistory(stored);

    // The last is another session's lap of the same number and clock: a
    // different lap, and kept.
    expect(useFuelStore.getState().storedLaps).toEqual([
      { ...lap(2, 1, 190_000), isHistorical: true },
      { ...lap(1, 1, 100_000), isHistorical: true },
      { ...lap(1, 0, 100_000), isHistorical: true },
    ]);
  });

  it('is not changed by the laps of the session under way', () => {
    useFuelStore.getState().setLapHistory([lap(1, 0, 100_000)]);

    useFuelStore.getState().setProjectionLaps([lap(1, 1, 95_000)]);

    expect(useFuelStore.getState().storedLaps).toEqual([
      { ...lap(1, 0, 100_000), isHistorical: true },
    ]);
  });

  it('forgets them with the rest', () => {
    useFuelStore.getState().setLapHistory([lap(1, 0, 100_000)]);

    useFuelStore.getState().clearAllData();

    expect(useFuelStore.getState().storedLaps).toEqual([]);
  });
});
