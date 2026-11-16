import { beforeEach, describe, expect, it } from 'vitest';
import type {
  SectorTimingResultSnapshot,
  SectorTimingSnapshot,
} from '@irdashies/types';
import { computeSectorColor, useSectorTimingStore } from './SectorTimingStore';

const result = (time: number, unclean: boolean) => ({
  currentLapSectorTimes: [time],
  previousLapSectorTimes: [time],
  currentLapSectorUnclean: [unclean],
  previousLapSectorUnclean: [unclean],
  sessionBestSectorTimes: [time],
  previousSessionBestSectorTimes: [null],
  sessionBestLapSectorTimes: [time],
  finishedLapSectorTimes: [time],
});

const snapshot = {
  sectors: [{ SectorNum: 0, SectorStartPct: 0 }],
  currentSectorIdx: 0,
  sectorEntryTime: 10,
  sectorEntryValid: true,
  inclusive: result(12, true),
  clean: result(13, false),
  allTime: null,
  sessionNum: 1,
  version: 1,
} satisfies SectorTimingSnapshot;

beforeEach(() => {
  useSectorTimingStore.setState({ trackIncidentSectors: true });
  useSectorTimingStore.getState().reset();
});

describe('computeSectorColor', () => {
  it('applies racing timing thresholds', () => {
    expect(computeSectorColor(25, null)).toBe('default');
    expect(computeSectorColor(25, 25)).toBe('purple');
    expect(computeSectorColor(25.1, 25)).toBe('green');
    expect(computeSectorColor(25.2, 25)).toBe('yellow');
    expect(computeSectorColor(25.3, 25)).toBe('red');
  });
});

describe('SectorTimingStore.applySnapshot', () => {
  it('selects the incident-inclusive view by default', () => {
    useSectorTimingStore.getState().applySnapshot(snapshot);
    expect(useSectorTimingStore.getState().currentLapSectorTimes).toEqual([12]);
    expect(useSectorTimingStore.getState().currentLapSectorUnclean).toEqual([
      true,
    ]);
  });

  it('selects the clean-only view when incident sectors are disabled', () => {
    useSectorTimingStore.getState().setTrackIncidentSectors(false);
    useSectorTimingStore.getState().applySnapshot(snapshot);
    expect(useSectorTimingStore.getState().currentLapSectorTimes).toEqual([13]);
    expect(useSectorTimingStore.getState().currentLapSectorUnclean).toEqual([
      false,
    ]);
    expect(useSectorTimingStore.getState().sessionBestLapSectorTimes).toEqual([
      13,
    ]);
  });

  it('recomputes colors when thresholds change', () => {
    useSectorTimingStore.getState().applySnapshot({
      ...snapshot,
      inclusive: {
        ...snapshot.inclusive,
        currentLapSectorTimes: [25.2],
        previousLapSectorTimes: [25.2],
        sessionBestSectorTimes: [25],
      },
    });
    expect(useSectorTimingStore.getState().sectorColors).toEqual(['yellow']);
    useSectorTimingStore.getState().setThresholds(0.001, 0.005);
    expect(useSectorTimingStore.getState().sectorColors).toEqual(['red']);
  });
});

describe('SectorTimingStore through a lap of three sectors', () => {
  const sectors = [
    { SectorNum: 0, SectorStartPct: 0 },
    { SectorNum: 1, SectorStartPct: 0.4 },
    { SectorNum: 2, SectorStartPct: 0.8 },
  ];
  const NONE = [null, null, null];

  const view = (
    overrides: Partial<SectorTimingResultSnapshot> = {}
  ): SectorTimingResultSnapshot => ({
    currentLapSectorTimes: NONE,
    previousLapSectorTimes: NONE,
    currentLapSectorUnclean: [false, false, false],
    previousLapSectorUnclean: [false, false, false],
    sessionBestSectorTimes: NONE,
    previousSessionBestSectorTimes: NONE,
    sessionBestLapSectorTimes: NONE,
    finishedLapSectorTimes: NONE,
    ...overrides,
  });

  const lap = (
    overrides: Partial<SectorTimingSnapshot> = {},
    timing: Partial<SectorTimingResultSnapshot> = {}
  ): SectorTimingSnapshot => ({
    sectors,
    currentSectorIdx: 0,
    sectorEntryTime: 100,
    sectorEntryValid: true,
    inclusive: view(timing),
    clean: view(timing),
    allTime: null,
    sessionNum: 1,
    version: 1,
    ...overrides,
  });

  const apply = (snapshot: SectorTimingSnapshot) =>
    useSectorTimingStore.getState().applySnapshot(snapshot);
  const state = () => useSectorTimingStore.getState();

  it('knows when the lap under way began', () => {
    // Over the line at 100 s: the lap began there.
    apply(lap());
    expect(state().lapStartTime).toBe(100);

    // Into the second sector 40 s later, and the third 30 s after that.
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140 },
        { currentLapSectorTimes: [40, null, null] }
      )
    );
    expect(state().lapStartTime).toBe(100);
    apply(
      lap(
        { currentSectorIdx: 2, sectorEntryTime: 170 },
        { currentLapSectorTimes: [40, 30, null] }
      )
    );
    expect(state().lapStartTime).toBe(100);
  });

  it('does not know it for a lap that was not followed from the line', () => {
    // Joined in the second sector: the first has no time.
    apply(lap({ currentSectorIdx: 2, sectorEntryTime: 170 }));
    expect(state().lapStartTime).toBeNull();

    // Put back in the pits: where the sector began is not known.
    apply(lap({ sectorEntryValid: false }));
    expect(state().lapStartTime).toBeNull();
  });

  it('runs the lap clock through a sector the clean view leaves out', () => {
    state().setTrackIncidentSectors(false);
    apply({
      ...lap({ currentSectorIdx: 1, sectorEntryTime: 140 }),
      inclusive: view({ currentLapSectorTimes: [40, null, null] }),
      clean: view(),
    });

    expect(state().currentLapSectorTimes).toEqual(NONE);
    expect(state().lapStartTime).toBe(100);
  });

  it('keeps what a sector that has just ended is to be compared with', () => {
    const allTime = {
      bestSectorTimes: [39, 29, 19],
      previousBestSectorTimes: NONE,
      bestLapSectorTimes: [40, 30, 20],
    };
    apply(lap({ allTime }, { sessionBestSectorTimes: [40.5, 30.5, 20.5] }));
    expect(state().sectorEvent).toBeNull();

    // The first sector ends with a new session best.
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140, allTime },
        {
          currentLapSectorTimes: [40, null, null],
          sessionBestSectorTimes: [40, 30.5, 20.5],
          previousSessionBestSectorTimes: [40.5, null, null],
        }
      )
    );

    expect(state().sectorEvent).toEqual({
      sectorIdx: 0,
      at: 140,
      lapSectorTimes: [40, null, null],
      before: {
        // As they stood while the sector was being driven.
        sessionBestSectorTimes: [40.5, 30.5, 20.5],
        sessionBestLapSectorTimes: NONE,
        allTime,
      },
    });
  });

  it('holds the whole lap when the sector that ended was the last', () => {
    apply(
      lap(
        { currentSectorIdx: 2, sectorEntryTime: 170 },
        {
          currentLapSectorTimes: [40, 30, null],
          sessionBestLapSectorTimes: [41, 31, 21],
        }
      )
    );
    // The line: the current lap is cleared and the lap is the best yet.
    apply(
      lap(
        { currentSectorIdx: 0, sectorEntryTime: 190 },
        {
          finishedLapSectorTimes: [40, 30, 20],
          sessionBestLapSectorTimes: [40, 30, 20],
        }
      )
    );

    const event = state().sectorEvent;
    expect(event?.sectorIdx).toBe(2);
    expect(event?.lapSectorTimes).toEqual([40, 30, 20]);
    // Against the best lap before this one, not against itself.
    expect(event?.before.sessionBestLapSectorTimes).toEqual([41, 31, 21]);
  });

  it('keeps the event while the sector it opened is being driven', () => {
    apply(lap());
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140 },
        { currentLapSectorTimes: [40, null, null] }
      )
    );
    const event = state().sectorEvent;

    // The same sector, republished: the all-time bests arrived, say.
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140, version: 2 },
        { currentLapSectorTimes: [40, null, null] }
      )
    );

    expect(state().sectorEvent).toBe(event);
  });

  it('has no event for a sector the car did not drive into', () => {
    apply(lap());
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140 },
        { currentLapSectorTimes: [40, null, null] }
      )
    );
    expect(state().sectorEvent).not.toBeNull();

    // Back to the pits: the entry is not one that was driven.
    apply(lap({ currentSectorIdx: 0, sectorEntryValid: false }));
    expect(state().sectorEvent).toBeNull();

    // Nor one a sector was skipped to reach.
    apply(lap({ currentSectorIdx: 0, sectorEntryTime: 300 }));
    apply(lap({ currentSectorIdx: 2, sectorEntryTime: 370 }));
    expect(state().sectorEvent).toBeNull();
  });

  it('carries the all-time bests, and none before the store has answered', () => {
    apply(lap());
    expect(state().allTime).toBeNull();

    const allTime = {
      bestSectorTimes: [39, 29, 19],
      previousBestSectorTimes: NONE,
      bestLapSectorTimes: [40, 30, 20],
    };
    apply(lap({ allTime, version: 2 }));
    expect(state().allTime).toEqual(allTime);
  });

  it('forgets all of it on reset', () => {
    apply(lap());
    apply(
      lap(
        { currentSectorIdx: 1, sectorEntryTime: 140 },
        { currentLapSectorTimes: [40, null, null] }
      )
    );

    state().reset();

    expect(state().sectorEvent).toBeNull();
    expect(state().lapStartTime).toBeNull();
    expect(state().allTime).toBeNull();
    expect(state().sessionBestLapSectorTimes).toEqual([]);
  });
});
