import type { LapEntry, LiveLapEntry } from '@irdashies/domain/ledger';

// The history's rows are the ledger's: see `lapEntries`.
export type { LapEntry };

export interface LapTimeLogDemoData {
  current: number;
  lastlap: number;
  bestlap: number;
  alltimelap: number | undefined;
  reference: number;
  delta: number;
  overall: number;
  dirty: boolean;
  history: LapEntry[];
  currentRow: LiveLapEntry;
}

/** Lap times of a demo race: a stop at the end of the tenth lap. */
const DEMO_LAPS: readonly Pick<LapEntry, 'time' | 'delta' | 'dirty'>[] = [
  { time: 82.902, delta: 0.0 },
  { time: 83.15, delta: 0.248 },
  { time: 84.254, delta: 1.104 },
  { time: 82.301, delta: -1.953 },
  { time: 84.211, delta: 1.91 },
  { time: 85.001, delta: 0.79 },
  { time: 84.999, delta: -0.002, dirty: true },
  { time: 84.0, delta: -0.999, dirty: true },
  { time: 82.401, delta: -1.599 },
  { time: 91.457, delta: 9.056 },
  { time: 97.902, delta: 6.445 },
  { time: 83.15, delta: -14.752, dirty: true },
  { time: 84.254, delta: 1.104 },
  { time: 82.301, delta: -1.953 },
  { time: 84.211, delta: 1.91 },
  { time: 85.001, delta: 0.79, dirty: true },
  { time: 84.999, delta: -0.002, dirty: true },
  { time: 84.0, delta: -0.999, dirty: true },
  { time: 82.401, delta: -1.599 },
  { time: 83.457, delta: 1.056 },
];
const DEMO_STINT_LAPS = 10;

// Demo data for the lap timer
export const getDemoLapTimeLogData = (): LapTimeLogDemoData => {
  return {
    current: 84.39,
    lastlap: 83.457,
    bestlap: 82.301,
    alltimelap: 81.2,
    reference: 83.457,
    delta: 0.933,
    overall: 82.251,
    dirty: false,
    history: DEMO_LAPS.map((lap, index) => {
      const stintLap = (index % DEMO_STINT_LAPS) + 1;
      const pitted = index === DEMO_STINT_LAPS - 1 || index === DEMO_STINT_LAPS;
      return {
        ...lap,
        lap: index + 1,
        pitted,
        stintId: `demo:${Math.floor(index / DEMO_STINT_LAPS) + 1}`,
        stintLap,
        fuelUsed: 2.31 + (index % 4) * 0.03,
        energyUsed: 0.0233 + (index % 4) * 0.0003,
        // Worn a little faster as the stint goes on.
        wear: 0.0046 + stintLap * 0.00012,
      };
    }),
    currentRow: {
      lap: DEMO_LAPS.length + 1,
      stintId: 'demo:2',
      stintLap: DEMO_STINT_LAPS + 1,
      fuelUsed: 1.42,
      energyUsed: 0.0143,
      wear: 0.003,
    },
  };
};
