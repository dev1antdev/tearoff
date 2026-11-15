import { create, useStore } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import type {
  Sector,
  SectorAllTimeBestsSnapshot,
  SectorTimingSnapshot,
} from '@irdashies/types';
import { sectorSum } from '@irdashies/shared';

export type SectorColor = 'purple' | 'green' | 'yellow' | 'red' | 'default';

/**
 * What the last sector to end left behind: the lap up to there, and what it
 * could be compared with as that stood while the sector was being driven. A
 * sector that sets a best is then shown against the best it replaced, and a
 * lap that becomes the best lap against the one before it.
 */
export interface SectorEndEvent {
  /** The sector that ended. */
  sectorIdx: number;
  /** SessionTime at which it ended and the next began, s. */
  at: number;
  /**
   * The sector times of the lap up to and including it, in the view in use;
   * the whole lap where the sector ended at the line.
   */
  lapSectorTimes: readonly (number | null)[];
  before: {
    sessionBestSectorTimes: readonly (number | null)[];
    sessionBestLapSectorTimes: readonly (number | null)[];
    allTime: SectorAllTimeBestsSnapshot | null;
  };
}

export const DEFAULT_GREEN_THRESHOLD = 0.005;
export const DEFAULT_YELLOW_THRESHOLD = 0.01;

export const computeSectorColor = (
  time: number,
  sessionBest: number | null,
  greenThreshold = DEFAULT_GREEN_THRESHOLD,
  yellowThreshold = DEFAULT_YELLOW_THRESHOLD
): SectorColor => {
  if (sessionBest === null) return 'default';
  if (time <= sessionBest) return 'purple';
  const ratio = (time - sessionBest) / sessionBest;
  if (ratio <= greenThreshold) return 'green';
  if (ratio <= yellowThreshold) return 'yellow';
  return 'red';
};

interface SectorTimingState {
  sectors: Sector[];
  currentSectorIdx: number;
  sectorEntryTime: number;
  sectorEntryValid: boolean;
  currentLapSectorTimes: (number | null)[];
  previousLapSectorTimes: (number | null)[];
  sessionBestSectorTimes: (number | null)[];
  previousSessionBestSectorTimes: (number | null)[];
  /** The sectors of the quickest whole lap of the session, in the view. */
  sessionBestLapSectorTimes: (number | null)[];
  /**
   * The player's best sectors on this track in this car, kept between
   * sessions; null until the store that keeps them has answered.
   */
  allTime: SectorAllTimeBestsSnapshot | null;
  /**
   * SessionTime at which the lap under way began, s; null where the lap was
   * not followed from the line.
   */
  lapStartTime: number | null;
  sectorEvent: SectorEndEvent | null;
  currentLapSectorUnclean: boolean[];
  previousLapSectorUnclean: boolean[];
  sectorColors: SectorColor[];
  greenThreshold: number;
  yellowThreshold: number;
  trackIncidentSectors: boolean;
  applySnapshot: (snapshot: SectorTimingSnapshot) => void;
  setThresholds: (green: number, yellow: number) => void;
  setTrackIncidentSectors: (value: boolean) => void;
  reset: () => void;
}

const emptyState = () => ({
  sectors: [] as Sector[],
  currentSectorIdx: 0,
  sectorEntryTime: 0,
  sectorEntryValid: false,
  currentLapSectorTimes: [] as (number | null)[],
  previousLapSectorTimes: [] as (number | null)[],
  sessionBestSectorTimes: [] as (number | null)[],
  previousSessionBestSectorTimes: [] as (number | null)[],
  sessionBestLapSectorTimes: [] as (number | null)[],
  allTime: null as SectorAllTimeBestsSnapshot | null,
  lapStartTime: null as number | null,
  sectorEvent: null as SectorEndEvent | null,
  currentLapSectorUnclean: [] as boolean[],
  previousLapSectorUnclean: [] as boolean[],
  sectorColors: [] as SectorColor[],
});

/**
 * When the lap under way began: the entry to the sector being driven, less
 * the sectors of the lap before it. From the view that keeps every sector,
 * so a sector with an incident in it does not stop the lap's clock.
 */
const lapStartTimeOf = (snapshot: SectorTimingSnapshot): number | null => {
  if (!snapshot.sectorEntryValid) return null;
  if (snapshot.currentSectorIdx === 0) return snapshot.sectorEntryTime;
  const elapsed = sectorSum(
    snapshot.inclusive.currentLapSectorTimes,
    snapshot.currentSectorIdx - 1
  );
  return elapsed === null ? null : snapshot.sectorEntryTime - elapsed;
};

const colorsFor = (
  current: readonly (number | null)[],
  previous: readonly (number | null)[],
  bests: readonly (number | null)[],
  green: number,
  yellow: number
): SectorColor[] =>
  previous.map((previousTime, index) => {
    const time = current[index] ?? previousTime;
    return time === null
      ? 'default'
      : computeSectorColor(time, bests[index] ?? null, green, yellow);
  });

export const useSectorTimingStore = create<SectorTimingState>((set, get) => ({
  ...emptyState(),
  greenThreshold: DEFAULT_GREEN_THRESHOLD,
  yellowThreshold: DEFAULT_YELLOW_THRESHOLD,
  trackIncidentSectors: true,

  applySnapshot: (snapshot) => {
    const state = get();
    const timing = state.trackIncidentSectors
      ? snapshot.inclusive
      : snapshot.clean;
    const sectorCount = snapshot.sectors.length;
    // The car has driven out of one sector and into the next, on the same
    // lap layout as before: an event to hold on screen for a moment.
    const sectorEnded =
      sectorCount > 0 &&
      state.sectors.length === sectorCount &&
      snapshot.sectorEntryValid &&
      snapshot.sectorEntryTime !== state.sectorEntryTime &&
      snapshot.currentSectorIdx === (state.currentSectorIdx + 1) % sectorCount;
    const sectorEvent: SectorEndEvent | null = sectorEnded
      ? {
          sectorIdx: state.currentSectorIdx,
          at: snapshot.sectorEntryTime,
          lapSectorTimes:
            snapshot.currentSectorIdx === 0
              ? [...timing.finishedLapSectorTimes]
              : [...timing.currentLapSectorTimes],
          before: {
            sessionBestSectorTimes: state.sessionBestSectorTimes,
            sessionBestLapSectorTimes: state.sessionBestLapSectorTimes,
            allTime: state.allTime,
          },
        }
      : // Kept for as long as the sector it opened is the one being driven.
        snapshot.sectorEntryValid &&
          state.sectorEvent?.at === snapshot.sectorEntryTime
        ? state.sectorEvent
        : null;
    set({
      sectors: [...snapshot.sectors],
      currentSectorIdx: snapshot.currentSectorIdx,
      sectorEntryTime: snapshot.sectorEntryTime,
      sectorEntryValid: snapshot.sectorEntryValid,
      currentLapSectorTimes: [...timing.currentLapSectorTimes],
      previousLapSectorTimes: [...timing.previousLapSectorTimes],
      currentLapSectorUnclean: [...timing.currentLapSectorUnclean],
      previousLapSectorUnclean: [...timing.previousLapSectorUnclean],
      sessionBestSectorTimes: [...timing.sessionBestSectorTimes],
      previousSessionBestSectorTimes: [
        ...timing.previousSessionBestSectorTimes,
      ],
      sessionBestLapSectorTimes: [...timing.sessionBestLapSectorTimes],
      allTime: snapshot.allTime,
      lapStartTime: lapStartTimeOf(snapshot),
      sectorEvent,
      sectorColors: colorsFor(
        timing.currentLapSectorTimes,
        timing.previousLapSectorTimes,
        timing.sessionBestSectorTimes,
        state.greenThreshold,
        state.yellowThreshold
      ),
    });
  },

  setThresholds: (greenThreshold, yellowThreshold) => {
    const state = get();
    if (
      state.greenThreshold === greenThreshold &&
      state.yellowThreshold === yellowThreshold
    ) {
      return;
    }
    set({
      greenThreshold,
      yellowThreshold,
      sectorColors: colorsFor(
        state.currentLapSectorTimes,
        state.previousLapSectorTimes,
        state.sessionBestSectorTimes,
        greenThreshold,
        yellowThreshold
      ),
    });
  },

  setTrackIncidentSectors: (trackIncidentSectors) => {
    if (get().trackIncidentSectors !== trackIncidentSectors) {
      set({ trackIncidentSectors });
    }
  },

  reset: () => set(emptyState()),
}));

export const useSectorColors = () =>
  useStore(useSectorTimingStore, (state) => state.sectorColors);

export const useSectorDeltas = () =>
  useStoreWithEqualityFn(
    useSectorTimingStore,
    (state) => ({
      sectors: state.sectors,
      sectorColors: state.sectorColors,
      currentLapSectorTimes: state.currentLapSectorTimes,
      previousLapSectorTimes: state.previousLapSectorTimes,
      currentLapSectorUnclean: state.currentLapSectorUnclean,
      previousLapSectorUnclean: state.previousLapSectorUnclean,
      sessionBestSectorTimes: state.sessionBestSectorTimes,
      previousSessionBestSectorTimes: state.previousSessionBestSectorTimes,
      sessionBestLapSectorTimes: state.sessionBestLapSectorTimes,
      allTime: state.allTime,
      lapStartTime: state.lapStartTime,
      sectorEvent: state.sectorEvent,
      currentSectorIdx: state.currentSectorIdx,
    }),
    shallow
  );
