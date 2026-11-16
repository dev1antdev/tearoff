import { create } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

interface SessionTimingData {
  sessionType?: string;
  state: number;
  currentLap: number;
  totalLaps: number;
  time: number;
  timeTotal: number;
  timeRemaining: number;
  greenFlagTimestamp: number;
  isFixedLapRace: boolean;
  totalRaceLaps: number;
  totalRaceTime: number;
  adjustedRaceTime: number;
  /** Laps the focus car has completed. */
  lapsCompleted: number;
  /** Share of the lap it is on, 0..1, 2 decimals. */
  lapProgress: number;
  /** Its own distance at the flag, in laps; 0 where nothing projects one. */
  projectedLaps: number;
  projectedLapsExact: boolean;
  /** Whole laps to add to the projection rounded up. */
  extraLaps: number;
}

interface SessionTimingState extends SessionTimingData {
  update: (data: SessionTimingData) => void;
}

export const useSessionTimingStore = create<SessionTimingState>((set) => ({
  sessionType: undefined,
  state: 0,
  currentLap: 0,
  totalLaps: 0,
  time: 0,
  timeTotal: 0,
  timeRemaining: 0,
  greenFlagTimestamp: 0,
  isFixedLapRace: true,
  totalRaceLaps: 0,
  totalRaceTime: 0,
  adjustedRaceTime: 0,
  lapsCompleted: 0,
  lapProgress: 0,
  projectedLaps: 0,
  projectedLapsExact: false,
  extraLaps: 0,

  update: (data) => set(data),
}));

// Composite selectors — one per SessionBar item consumer, shallow-compared so
// a tick that doesn't change any field this item cares about doesn't force a
// re-render.
export const useSessionTimeTiming = () =>
  useStoreWithEqualityFn(
    useSessionTimingStore,
    (s) => ({
      sessionType: s.sessionType,
      time: s.time,
      timeRemaining: s.timeRemaining,
      timeTotal: s.timeTotal,
      state: s.state,
      greenFlagTimestamp: s.greenFlagTimestamp,
      isFixedLapRace: s.isFixedLapRace,
      totalRaceTime: s.totalRaceTime,
      adjustedRaceTime: s.adjustedRaceTime,
    }),
    shallow
  );

export const useSessionLapsTiming = () =>
  useStoreWithEqualityFn(
    useSessionTimingStore,
    (s) => ({
      sessionType: s.sessionType,
      currentLap: s.currentLap,
      totalLaps: s.totalLaps,
      state: s.state,
      totalRaceLaps: s.totalRaceLaps,
      isFixedLapRace: s.isFixedLapRace,
    }),
    shallow
  );

/**
 * The focus car's race as a distance: the laps it has done with the share of
 * the lap it is on, and where it will be at the flag.
 *
 * Its own selector, apart from `useSessionLapsTiming`: the share of the lap
 * moves a hundred times a lap, and only the item that prints it should
 * render that often. The clock is reduced to whether it has run out, which
 * is all the item reads of it.
 */
export const useSessionLapsProgress = () =>
  useStoreWithEqualityFn(
    useSessionTimingStore,
    (s) => ({
      sessionType: s.sessionType,
      state: s.state,
      isFixedLapRace: s.isFixedLapRace,
      lapsCompleted: s.lapsCompleted,
      lapProgress: s.lapProgress,
      projectedLaps: s.projectedLaps,
      projectedLapsExact: s.projectedLapsExact,
      extraLaps: s.extraLaps,
      timeIsUp: s.timeRemaining <= 0,
    }),
    shallow
  );
