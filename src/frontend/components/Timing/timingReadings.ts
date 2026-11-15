import type { SectorTile } from '@irdashies/domain/lapTiming/sectorTiles';

/**
 * Everything the panel draws, as numbers: what the channels say once the
 * settings have chosen the reference, the scope and the sector view. Kept
 * apart from the hooks that read the channels so a story or a spec can show
 * any state without a running session.
 *
 * Times are seconds; null is "no reading", never 0.
 */
export interface TimingReadings {
  /** The lap being driven. */
  lap: number | null;
  /** Seconds against the chosen reference lap; negative is faster. */
  delta: number | null;
  /** The chosen reference lap's own time. */
  referenceLapTime: number | null;
  /** The lap in progress has been voided by the sim. */
  lapVoid: boolean;
  lastLapTime: number | null;
  /** The sim gave the last lap no time: it did not count. */
  lastLapInvalid: boolean;
  /** The player's best lap of the session. */
  bestLapTime: number | null;
  /** The fastest lap of the session among the cars in scope. */
  sessionBestLapTime: number | null;
  allTimeBestLapTime: number | null;
  stintBestLapTime: number | null;
  /** The player's recent pace. */
  paceLapTime: number | null;
  /** The running time of the lap in progress. */
  currentLapTime: number | null;
  sectors: readonly SectorTile[];
  /**
   * Out of the car with the widget still shown: the figures are the last
   * ones driven, and are drawn dimmed.
   */
  dimmed: boolean;
}

const emptySector = (index: number): SectorTile => ({
  index,
  label: `S${index + 1}`,
  time: null,
  state: 'none',
  color: 'default',
  unclean: false,
});

/** Before any channel has answered: every tile a placeholder. */
export const NO_TIMING_READINGS: TimingReadings = {
  lap: null,
  delta: null,
  referenceLapTime: null,
  lapVoid: false,
  lastLapTime: null,
  lastLapInvalid: false,
  bestLapTime: null,
  sessionBestLapTime: null,
  allTimeBestLapTime: null,
  stintBestLapTime: null,
  paceLapTime: null,
  currentLapTime: null,
  sectors: [emptySector(0), emptySector(1), emptySector(2)],
  dimmed: false,
};

/**
 * What demo mode shows: the fourth lap, a touch down on the session best
 * after a first sector that matched it.
 */
export const DEMO_TIMING_READINGS: TimingReadings = {
  lap: 4,
  delta: 0.084,
  referenceLapTime: 104.054,
  lapVoid: false,
  lastLapTime: 104.53,
  lastLapInvalid: false,
  bestLapTime: 104.054,
  sessionBestLapTime: 103.611,
  allTimeBestLapTime: 103.87,
  stintBestLapTime: 104.054,
  paceLapTime: 104.41,
  currentLapTime: 52.3,
  sectors: [
    {
      ...emptySector(0),
      time: 31.204,
      state: 'fresh',
      color: 'purple',
    },
    {
      ...emptySector(1),
      time: 40.112,
      state: 'stale',
      color: 'green',
    },
    {
      ...emptySector(2),
      time: 32.738,
      state: 'stale',
      color: 'purple',
    },
  ],
  dimmed: false,
};
