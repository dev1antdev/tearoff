import { useCallback, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import {
  useChannelSelector,
  useDriverCarIdx,
  useSectorTimingSnapshot,
  useSectorTimingStore,
  useSessionDrivers,
} from '@irdashies/context';
import {
  sectorHoldActive,
  sectorTiles,
} from '@irdashies/domain/lapTiming/sectorTiles';
import { sessionBestLapTime } from '@irdashies/domain/lapTiming/sessionBest';
import type {
  LapDeltaReference,
  LapDeltaSnapshot,
  LapLogSnapshot,
  LapTimesSnapshot,
  SessionTimingSnapshot,
  TimingConfig,
} from '@irdashies/types';
import type { TimingReadings } from '../timingReadings';

/** Where a lap is far enough from the line that LMU's void flag is its own. */
const LAP_VOID_START_PCT = 0.05;

const NO_REFERENCE: LapDeltaReference = {
  lapTime: null,
  delta: null,
  trend: null,
};

/** A time in seconds, or null for the sims' ways of saying there is none. */
const timeOrNull = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && seconds > 0 ? seconds : null;

/**
 * One reference of the lap delta channel.
 *
 * The channel carries the session best and the all-time best. `stintBest`
 * and `lastLap` arrive with the extended delta; until then they are absent
 * and read as no reference at all, which the tiles draw as dashes.
 */
const referenceOf = (
  snapshot: LapDeltaSnapshot,
  reference: TimingConfig['deltaReference']
): LapDeltaReference =>
  (
    snapshot as Partial<
      Record<TimingConfig['deltaReference'], LapDeltaReference>
    >
  )[reference] ?? NO_REFERENCE;

const selectCurrentLap = (snapshot: SessionTimingSnapshot): number =>
  snapshot.currentLap;

/**
 * What the panel shows, read from the channels that already carry it.
 *
 * Each channel is read through a selector that keeps only what the tiles
 * draw, at the precision they draw it, so the panel is redrawn when a figure
 * on it changes and not on every snapshot. A channel no tile needs is not
 * subscribed to.
 */
export const useTimingReadings = (
  settings: TimingConfig,
  isDriving: boolean
): TimingReadings => {
  const {
    tiles,
    deltaReference,
    sessionBestScope,
    sectorSource,
    sectorIncidents,
    sectorTilesMax,
  } = settings;
  const playerCarIdx = useDriverCarIdx();
  const drivers = useSessionDrivers();
  const carIdxClass = useMemo(() => {
    const classes: (number | undefined)[] = [];
    for (const driver of drivers ?? []) {
      classes[driver.CarIdx] = driver.CarClassID;
    }
    return classes;
  }, [drivers]);

  // The tiles read the channel themselves and choose the view by their own
  // setting: the store's view is one global, which Sector Delta sets. Its
  // thresholds are shared on purpose, so both widgets colour a sector alike.
  const sectorSnapshot = useSectorTimingSnapshot(tiles.sectors);
  const greenThreshold = useSectorTimingStore((state) => state.greenThreshold);
  const yellowThreshold = useSectorTimingStore(
    (state) => state.yellowThreshold
  );

  const lap = useChannelSelector('session-timing.snapshot', selectCurrentLap, {
    enabled: tiles.lap,
  });

  const showCurrentLap = tiles.currentLap;
  const selectLapLog = useCallback(
    (snapshot: LapLogSnapshot) => ({
      lastLapTime: timeOrNull(snapshot.lastLapTime),
      lastLapInvalid: snapshot.lastLapInvalid === true,
      bestLapTime: timeOrNull(snapshot.bestLapTime),
      sessionBestLapTime: sessionBestLapTime({
        carIdxBestLapTime: snapshot.carIdxBestLapTime,
        carIdxClass,
        playerCarIdx,
        scope: sessionBestScope,
      }),
      // Tenths, cut rather than rounded: a clock does not show a tenth
      // before it has passed.
      currentLapTime: showCurrentLap
        ? Math.floor(snapshot.currentLapTime * 10) / 10
        : null,
      // Ignored just after the line, as the lap log does: there the flag
      // may still be the previous lap's.
      lapVoid:
        snapshot.lapInvalidated === true &&
        snapshot.lapDistPct >= LAP_VOID_START_PCT,
      holding: sectorHoldActive(sectorSnapshot, snapshot.sessionTime),
    }),
    [
      carIdxClass,
      playerCarIdx,
      sessionBestScope,
      showCurrentLap,
      sectorSnapshot,
    ]
  );
  const lapLog = useChannelSelector('lap-log.snapshot', selectLapLog, {
    equality: shallow,
  });

  const selectLapDelta = useCallback(
    (snapshot: LapDeltaSnapshot) => {
      const reference = referenceOf(snapshot, deltaReference);
      return {
        // Thousandths are all a tile can show.
        delta:
          reference.delta === null || !Number.isFinite(reference.delta)
            ? null
            : Math.round(reference.delta * 1000) / 1000,
        referenceLapTime: timeOrNull(reference.lapTime),
        allTimeBestLapTime: timeOrNull(
          referenceOf(snapshot, 'allTime').lapTime
        ),
        stintBestLapTime: timeOrNull(
          referenceOf(snapshot, 'stintBest').lapTime
        ),
      };
    },
    [deltaReference]
  );
  const lapDelta = useChannelSelector('lap-delta.snapshot', selectLapDelta, {
    equality: shallow,
    enabled:
      tiles.delta || tiles.predictedLap || tiles.allTimeBest || tiles.stintBest,
  });

  const selectPace = useCallback(
    (snapshot: LapTimesSnapshot) =>
      playerCarIdx === undefined
        ? null
        : timeOrNull(snapshot.lapTimes[playerCarIdx]),
    [playerCarIdx]
  );
  const pace = useChannelSelector('lap-times.snapshot', selectPace, {
    enabled: tiles.pace,
  });

  const holding = lapLog?.holding ?? false;
  const sectors = useMemo(
    () =>
      sectorTiles(sectorSnapshot, {
        source: sectorSource,
        incidents: sectorIncidents,
        max: sectorTilesMax,
        holding,
        greenThreshold,
        yellowThreshold,
      }),
    [
      sectorSnapshot,
      sectorSource,
      sectorIncidents,
      sectorTilesMax,
      holding,
      greenThreshold,
      yellowThreshold,
    ]
  );

  return {
    lap: lap !== undefined && lap > 0 ? lap : null,
    // Out of the car nothing is being driven against the reference, and the
    // lap clock is not a lap time.
    delta: isDriving ? (lapDelta?.delta ?? null) : null,
    referenceLapTime: lapDelta?.referenceLapTime ?? null,
    lapVoid: isDriving && (lapLog?.lapVoid ?? false),
    lastLapTime: lapLog?.lastLapTime ?? null,
    lastLapInvalid: lapLog?.lastLapInvalid ?? false,
    bestLapTime: lapLog?.bestLapTime ?? null,
    sessionBestLapTime: lapLog?.sessionBestLapTime ?? null,
    allTimeBestLapTime: lapDelta?.allTimeBestLapTime ?? null,
    stintBestLapTime: lapDelta?.stintBestLapTime ?? null,
    paceLapTime: pace ?? null,
    currentLapTime: isDriving ? (lapLog?.currentLapTime ?? null) : null,
    sectors,
    dimmed: !isDriving,
  };
};
