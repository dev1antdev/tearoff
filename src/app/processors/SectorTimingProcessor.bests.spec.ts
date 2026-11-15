import { describe, expect, it, vi } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { sectorSum, type SectorBests } from '../../shared/sectorBests';
import {
  SectorTimingProcessor,
  type SectorBestsStore,
} from './SectorTimingProcessor';

/**
 * The sectors of the best lap, and the all-time best sectors kept between
 * sessions: which sectors and laps feed them, and what the store is asked.
 */
type Times = [number | null, number | null, number | null];
const NONE: Times = [null, null, null];

const TRACK_ID = 4321;
const CAR = 'Ferrari 296 LMGT3 Evo';
const LMU_KEY = `lmu|${TRACK_ID}|${CAR}|sim3`;

const lmuSession = (carModel = CAR, trackId = TRACK_ID) =>
  ({
    WeekendInfo: { TrackID: trackId, SimMode: 'Le Mans Ultimate' },
    DriverInfo: {
      DriverCarIdx: 0,
      Drivers: [{ CarIdx: 0, CarModel: carModel, CarPath: '74_26_KESS' }],
    },
    SplitTimeInfo: {
      Sectors: [
        { SectorNum: 0, SectorStartPct: 0 },
        { SectorNum: 1, SectorStartPct: 1 / 3 },
        { SectorNum: 2, SectorStartPct: 2 / 3 },
      ],
    },
  }) as unknown as Session;

interface SimOptions {
  voided?: boolean;
  onPitRoad?: boolean;
  /** A team-mate at the wheel: the user is out of the car, watching it. */
  teamMate?: boolean;
  sessionNum?: number;
}

/** A frame as the Le Mans Ultimate mapping writes it. */
const sim = (
  sessionTime: number,
  lapDistPct: number,
  sectorIdx: number,
  lapClock: number,
  current: Times,
  last: Times,
  {
    voided = false,
    onPitRoad = false,
    teamMate = false,
    sessionNum = 1,
  }: SimOptions = {}
) =>
  ({
    LapDistPct: { value: [lapDistPct] },
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    IsOnTrack: { value: [!teamMate] },
    LmuWatching: { value: [teamMate] },
    CarIdxOnPitRoad: { value: [onPitRoad] },
    LmuSectorIdx: { value: [sectorIdx] },
    LmuCurrentSectorTimes: { value: current },
    LmuLastSectorTimes: { value: last },
    LmuLapInvalidated: { value: [voided] },
    LapCurrentLapTime: { value: [lapClock] },
  }) as unknown as Telemetry;

/** A stand-in for the store of values kept per track and car. */
const stubStore = (
  initial: Record<string, unknown> = {},
  { answered = true } = {}
) => {
  const values = new Map(Object.entries(initial));
  let ready = answered;
  let revision = 1;
  const saves: { key: string; bests: SectorBests }[] = [];
  const store: SectorBestsStore = {
    load: vi.fn((key: string) =>
      ready ? (values.get(key) ?? null) : undefined
    ),
    save: (key, bests) => {
      const kept = structuredClone(bests);
      values.set(key, kept);
      saves.push({ key, bests: kept });
      revision += 1;
    },
    revision: () => revision,
  };
  return {
    store,
    saves,
    /** The file has been read. */
    answer() {
      ready = true;
      revision += 1;
    },
    /** A change made from outside the processor. */
    set(key: string, value: unknown) {
      if (value === null) values.delete(key);
      else values.set(key, value);
      revision += 1;
    },
  };
};

const lmu = (stub?: ReturnType<typeof stubStore>) => {
  const processor = new SectorTimingProcessor(
    stub ? { store: stub.store, simulator: 'lmu' } : undefined
  );
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(lmuSession());
  return processor;
};

/**
 * One lap as the sim times it, from a line crossed at `start`: its sector
 * index and times arrive a tenth of a second after the car, as from a block
 * written five times a second. `before` is what the last-lap block holds
 * until the line rewrites it.
 */
const driveLap = (
  processor: SectorTimingProcessor,
  start: number,
  [first, second, third]: [number, number, number],
  before: Times,
  options: (sectorIdx: number) => SimOptions = () => ({})
): number => {
  const afterFirst = start + first;
  const afterSecond = afterFirst + second;
  const end = afterSecond + third;
  const one: Times = [first, null, null];
  const two: Times = [first, second, null];
  processor.onFrame(
    sim(afterFirst - 0.1, 0.389, 0, first - 0.1, NONE, before, options(0))
  );
  processor.onFrame(
    sim(afterFirst + 0.1, 0.3905, 1, first + 0.1, one, before, options(0))
  );
  processor.onFrame(
    sim(afterSecond - 0.1, 0.79, 1, first + second - 0.1, one, before, {
      ...options(1),
    })
  );
  processor.onFrame(
    sim(afterSecond + 0.1, 0.7925, 2, first + second + 0.1, two, before, {
      ...options(1),
    })
  );
  processor.onFrame(
    sim(end - 0.1, 0.999, 2, end - start - 0.1, two, before, options(2))
  );
  processor.onFrame(
    sim(end + 0.1, 0.001, 0, 0.1, NONE, [first, second, third], options(2))
  );
  return end;
};

// The recorded race at Laguna Seca, as the sim timed it: the lap from the
// rolling start, the flying lap after it, and the first sector of a third.
const FROM_START: [number, number, number] = [43.459, 35.357, 19.007];
const FLYING: [number, number, number] = [32.739, 35.07, 18.851];
const THIRD_LAP_FIRST_SECTOR = 32.461;

/**
 * Those laps as hand-built frames. The recording opens with the car rolling
 * up to the start in the first sector, its lap fraction held at 0.
 */
const driveRecordedRace = (
  processor: SectorTimingProcessor,
  options: SimOptions = {}
): void => {
  for (let tick = 0; tick < 5; tick += 1) {
    processor.onFrame(
      sim(139.9 + tick * 0.2, 0, 0, 4.9 + tick * 0.2, NONE, NONE, options)
    );
  }
  processor.onFrame(sim(141, 0.004, 0, 6, NONE, NONE, options));
  const firstLine = driveLap(processor, 135, FROM_START, NONE, () => options);
  const secondLine = driveLap(
    processor,
    firstLine,
    FLYING,
    FROM_START,
    () => options
  );
  const first = THIRD_LAP_FIRST_SECTOR;
  processor.onFrame(
    sim(secondLine + first - 0.1, 0.389, 0, first - 0.1, NONE, FLYING, options)
  );
  processor.onFrame(
    sim(
      secondLine + first + 0.1,
      0.3905,
      1,
      first + 0.1,
      [first, null, null],
      FLYING,
      options
    )
  );
};

describe('the sectors of the best lap of the session', () => {
  it('are those of the first whole lap, not of the one from the start', () => {
    const processor = lmu();
    for (let tick = 0; tick < 5; tick += 1) {
      processor.onFrame(sim(139.9 + tick * 0.2, 0, 0, 4.9, NONE, NONE));
    }
    processor.onFrame(sim(141, 0.004, 0, 6, NONE, NONE));
    const firstLine = driveLap(processor, 135, FROM_START, NONE);

    // The lap from the rolling start has no first sector, and is no lap.
    let { clean } = processor.snapshot();
    expect(clean.finishedLapSectorTimes).toEqual([null, 35.357, 19.007]);
    expect(clean.sessionBestLapSectorTimes).toEqual(NONE);

    driveLap(processor, firstLine, FLYING, FROM_START);
    ({ clean } = processor.snapshot());
    expect(clean.sessionBestLapSectorTimes).toEqual([32.739, 35.07, 18.851]);
    expect(clean.finishedLapSectorTimes).toEqual([32.739, 35.07, 18.851]);
    expect(sectorSum(clean.sessionBestLapSectorTimes)).toBeCloseTo(86.66, 3);
    expect(processor.snapshot().inclusive.sessionBestLapSectorTimes).toEqual(
      clean.sessionBestLapSectorTimes
    );
  });

  it('stand while a quicker sector makes the theoretical best quicker', () => {
    const processor = lmu();
    driveRecordedRace(processor);

    const { clean } = processor.snapshot();
    expect(clean.sessionBestSectorTimes[0]).toBe(32.461);
    // The best of each sector: 32.461, 35.070 and 18.851.
    expect(sectorSum(clean.sessionBestSectorTimes)).toBeCloseTo(86.382, 3);
    // The best lap is still the one that was driven whole.
    expect(clean.sessionBestLapSectorTimes).toEqual([32.739, 35.07, 18.851]);
  });

  it('are replaced by a quicker lap, not by a quicker sector in a slower one', () => {
    const processor = lmu();
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    let line = driveLap(processor, 100, [40, 30, 20], NONE);
    // A better first sector, and a second off the track's pace.
    line = driveLap(processor, line, [39, 33, 20], [40, 30, 20]);
    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual([
      40, 30, 20,
    ]);

    driveLap(processor, line, [39.5, 30, 20], [39, 33, 20]);
    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual([
      39.5, 30, 20,
    ]);
  });

  it('are not those of a lap missing a sector', () => {
    const processor = lmu();
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    const line = driveLap(processor, 100, [40, 30, 20], NONE);

    // The sim gives the next lap no time: the last-lap block stays as it
    // was, so its third sector has none.
    processor.onFrame(sim(line + 37.9, 0.389, 0, 37.9, NONE, [40, 30, 20]));
    processor.onFrame(
      sim(line + 38.1, 0.3905, 1, 38.1, [38, null, null], [40, 30, 20])
    );
    processor.onFrame(
      sim(line + 66.9, 0.79, 1, 66.9, [38, null, null], [40, 30, 20])
    );
    processor.onFrame(
      sim(line + 67.1, 0.7925, 2, 67.1, [38, 29, null], [40, 30, 20])
    );
    processor.onFrame(
      sim(line + 85.9, 0.999, 2, 85.9, [38, 29, null], [40, 30, 20])
    );
    processor.onFrame(sim(line + 86.1, 0.001, 0, 0.1, NONE, [40, 30, 20]));

    const { clean } = processor.snapshot();
    expect(clean.finishedLapSectorTimes).toEqual([38, 29, null]);
    expect(clean.sessionBestLapSectorTimes).toEqual([40, 30, 20]);
  });

  it('are not those of a lap with a voided sector, in the clean view', () => {
    const processor = lmu();
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    // A track cut in the second sector; the flag stays up to the line.
    driveLap(processor, 100, [40, 28, 20], NONE, (sector) => ({
      voided: sector >= 1,
    }));

    const { clean, inclusive } = processor.snapshot();
    expect(clean.finishedLapSectorTimes).toEqual([40, null, null]);
    expect(clean.sessionBestLapSectorTimes).toEqual(NONE);
    // The view that keeps sectors with an incident keeps the lap of them.
    expect(inclusive.sessionBestLapSectorTimes).toEqual([40, 28, 20]);
  });

  it('are never those of a lap that touched pit road', () => {
    const processor = lmu();
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    // The in-lap: into the pit lane in the third sector.
    const line = driveLap(processor, 100, [40, 30, 25], NONE, (sector) => ({
      onPitRoad: sector === 2,
    }));

    let { clean, inclusive } = processor.snapshot();
    // The session's own sector bests take it as they always have.
    expect(clean.sessionBestSectorTimes).toEqual([40, 30, 25]);
    expect(clean.sessionBestLapSectorTimes).toEqual(NONE);
    expect(inclusive.sessionBestLapSectorTimes).toEqual(NONE);

    // The out-lap: the line was crossed in the pit lane.
    const outLap = driveLap(
      processor,
      line,
      [50, 30, 20],
      [40, 30, 25],
      () => ({
        onPitRoad: false,
      })
    );
    ({ clean, inclusive } = processor.snapshot());
    expect(clean.sessionBestLapSectorTimes).toEqual(NONE);
    expect(inclusive.sessionBestLapSectorTimes).toEqual(NONE);

    driveLap(processor, outLap, [41, 31, 21], [50, 30, 20]);
    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual([
      41, 31, 21,
    ]);
  });

  it('are not those of a lap the car was put back into part-way round', () => {
    const processor = lmu();
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    const line = driveLap(processor, 100, [40, 30, 20], NONE);
    // First sector done, then back to the pits, which are in it.
    processor.onFrame(sim(line + 37.9, 0.389, 0, 37.9, NONE, [40, 30, 20]));
    processor.onFrame(
      sim(line + 38.1, 0.3905, 1, 38.1, [38, null, null], [40, 30, 20])
    );
    processor.onFrame(sim(line + 50, 0.02, 0, 50, NONE, [40, 30, 20]));
    expect(processor.snapshot().sectorEntryValid).toBe(false);
    // Out again and round to the line: sectors of two different runs.
    driveLap(processor, line + 60, [39, 29, 19], [40, 30, 20]);

    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual([
      40, 30, 20,
    ]);
  });

  it('go with the session, on a new session number and a lifecycle event', () => {
    const processor = lmu();
    driveRecordedRace(processor);
    processor.onFrame(sim(5, 0.5, 1, 5, NONE, NONE, { sessionNum: 2 }));
    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual(NONE);
    expect(processor.snapshot().clean.finishedLapSectorTimes).toEqual(NONE);

    const other = lmu();
    driveRecordedRace(other);
    other.onLifecycle({ type: 'sessionNumChange' });
    expect(other.snapshot().clean.sessionBestLapSectorTimes).toEqual(NONE);
  });
});

describe('the lap that opens a race from the grid', () => {
  /**
   * A standing start with the grid slot short of the line, in the sim's
   * third sector: held at 0 through the countdown, then let go and over the
   * line into the first.
   */
  const startFromGrid = (processor: SectorTimingProcessor) => {
    for (let tick = 0; tick < 10; tick += 1) {
      processor.onFrame(sim(90 + tick, 0, 2, 0, NONE, NONE));
    }
    processor.onFrame(sim(100.2, 0.002, 0, 0.2, NONE, NONE));
  };

  it('is not a best lap, and its first sector no all-time best', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    startFromGrid(processor);
    expect(processor.snapshot().sectorEntryValid).toBe(true);
    // Every sector of it has a time from the sim, the launch included.
    const line = driveLap(processor, 100, [45, 30, 20], NONE);

    const snapshot = processor.snapshot();
    expect(snapshot.clean.finishedLapSectorTimes).toEqual([45, 30, 20]);
    expect(snapshot.clean.sessionBestLapSectorTimes).toEqual(NONE);
    expect(snapshot.inclusive.sessionBestLapSectorTimes).toEqual(NONE);
    // The two sectors driven at speed are sectors like any other.
    expect(snapshot.allTime?.bestSectorTimes).toEqual([null, 30, 20]);
    expect(snapshot.allTime?.bestLapSectorTimes).toEqual(NONE);

    // The lap after it began at the line at speed.
    driveLap(processor, line, [40, 31, 21], [45, 30, 20]);
    expect(processor.snapshot().clean.sessionBestLapSectorTimes).toEqual([
      40, 31, 21,
    ]);
    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual([40, 30, 20]);
    expect(processor.snapshot().allTime?.bestLapSectorTimes).toEqual([
      40, 31, 21,
    ]);
  });
});

describe('the all-time best sectors', () => {
  it('are null until the store has answered, and with no store at all', () => {
    expect(lmu().snapshot().allTime).toBeNull();

    const stub = stubStore({}, { answered: false });
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    expect(processor.snapshot().allTime).toBeNull();
  });

  it('start empty for a track and car driven for the first time', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));

    expect(stub.store.load).toHaveBeenCalledWith(LMU_KEY);
    expect(processor.snapshot().allTime).toEqual({
      bestSectorTimes: NONE,
      previousBestSectorTimes: NONE,
      bestLapSectorTimes: NONE,
    });
    expect(stub.saves).toHaveLength(0);
  });

  it('are gathered from the recorded race and written to the store', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);

    expect(processor.snapshot().allTime).toEqual({
      bestSectorTimes: [32.461, 35.07, 18.851],
      // What each best replaced: the flying lap's first sector, and the
      // second and third of the lap from the start.
      previousBestSectorTimes: [32.739, 35.357, 19.007],
      bestLapSectorTimes: [32.739, 35.07, 18.851],
    });
    expect(stub.saves.at(-1)).toEqual({
      key: LMU_KEY,
      bests: {
        bestSectorTimes: [32.461, 35.07, 18.851],
        bestLapSectorTimes: [32.739, 35.07, 18.851],
      },
    });
  });

  it('improve on what was kept, sector by sector', () => {
    const stub = stubStore({
      [LMU_KEY]: {
        bestSectorTimes: [32, 36, 18],
        bestLapSectorTimes: [null, null, null],
      },
    });
    const processor = lmu(stub);
    driveRecordedRace(processor);

    const allTime = processor.snapshot().allTime;
    expect(allTime?.bestSectorTimes).toEqual([32, 35.07, 18]);
    // The second sector of the lap from the start, which had itself
    // replaced the 36.000 that was kept.
    expect(allTime?.previousBestSectorTimes).toEqual([null, 35.357, null]);
    expect(allTime?.bestLapSectorTimes).toEqual([32.739, 35.07, 18.851]);
    expect(stub.saves.at(-1)?.bests).toEqual({
      bestSectorTimes: [32, 35.07, 18],
      bestLapSectorTimes: [32.739, 35.07, 18.851],
    });
  });

  it('are written only when one of them improves', () => {
    const stub = stubStore({
      [LMU_KEY]: {
        bestSectorTimes: [30, 30, 15],
        bestLapSectorTimes: [30.5, 30.5, 15.5],
      },
    });
    const processor = lmu(stub);
    const version = () => processor.snapshot().version;
    driveRecordedRace(processor);

    expect(stub.saves).toHaveLength(0);
    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual([30, 30, 15]);

    // And nothing is published for a store that has not changed.
    const before = version();
    processor.onFrame(sim(360, 0.5, 1, 40, [32.461, null, null], FLYING));
    expect(version()).toBe(before);
  });

  it('take no sector of a lap the sim voided', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    driveLap(processor, 100, [40, 28, 19], NONE, (sector) => ({
      voided: sector >= 1,
    }));

    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual([
      40,
      null,
      null,
    ]);
    expect(processor.snapshot().allTime?.bestLapSectorTimes).toEqual(NONE);
  });

  it('take no sector driven on pit road, and no lap that touched it', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    // A drive-through: the pit lane covers the end of the third sector and
    // the start of the first of the lap after.
    const line = driveLap(processor, 100, [40, 30, 18], NONE, (sector) => ({
      onPitRoad: sector === 2,
    }));
    driveLap(processor, line, [35, 30.5, 20], [40, 30, 18], (sector) => ({
      onPitRoad: sector === 0,
    }));

    const snapshot = processor.snapshot();
    // The session's clean view keeps both, as it did before.
    expect(snapshot.clean.sessionBestSectorTimes).toEqual([35, 30, 18]);
    expect(snapshot.allTime?.bestSectorTimes).toEqual([40, 30, 20]);
    expect(snapshot.allTime?.bestLapSectorTimes).toEqual(NONE);
    expect(stub.saves.at(-1)?.bests.bestSectorTimes).toEqual([40, 30, 20]);
  });

  it('take nothing a team-mate drives', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    // The team car laps on with the user out of it, quicker than they were.
    driveRecordedRace(processor, { teamMate: true });

    const snapshot = processor.snapshot();
    expect(snapshot.allTime?.bestSectorTimes).toEqual(NONE);
    expect(snapshot.allTime?.bestLapSectorTimes).toEqual(NONE);
    expect(snapshot.clean.sessionBestSectorTimes).toEqual(NONE);
    expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(NONE);
    expect(snapshot.inclusive.sessionBestLapSectorTimes).toEqual(NONE);
    expect(stub.saves).toHaveLength(0);
  });

  it('keep the user’s bests through a team-mate’s quicker stint', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));
    processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, NONE));
    let line = driveLap(processor, 100, [40, 30, 20], NONE);
    const saved = stub.saves.length;

    for (let lap = 0; lap < 3; lap += 1) {
      line = driveLap(processor, line, [36, 27, 18], [40, 30, 20], () => ({
        teamMate: true,
      }));
    }

    const snapshot = processor.snapshot();
    expect(snapshot.allTime?.bestSectorTimes).toEqual([40, 30, 20]);
    expect(snapshot.allTime?.bestLapSectorTimes).toEqual([40, 30, 20]);
    expect(snapshot.clean.sessionBestSectorTimes).toEqual([40, 30, 20]);
    expect(snapshot.clean.sessionBestLapSectorTimes).toEqual([40, 30, 20]);
    expect(stub.saves).toHaveLength(saved);
  });

  it('outlast the session', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);
    const allTime = processor.snapshot().allTime;

    processor.onLifecycle({ type: 'sessionNumChange' });

    expect(processor.snapshot().clean.sessionBestSectorTimes).toEqual(NONE);
    expect(processor.snapshot().allTime).toEqual(allTime);
  });

  it('are those of the car being driven', () => {
    const other = `lmu|${TRACK_ID}|BMW M4 LMGT3|sim3`;
    const stub = stubStore({
      [other]: {
        bestSectorTimes: [33, 36, 19],
        bestLapSectorTimes: [33.5, 36.5, 19.5],
      },
    });
    const processor = lmu(stub);
    driveRecordedRace(processor);
    expect(processor.snapshot().allTime?.bestSectorTimes[0]).toBe(32.461);

    processor.init(lmuSession('BMW M4 LMGT3'));
    // The mapping rebuilds the session often; nothing more comes of it.
    processor.init(lmuSession('BMW M4 LMGT3'));

    expect(stub.store.load).toHaveBeenLastCalledWith(other);
    expect(processor.snapshot().allTime).toEqual({
      bestSectorTimes: [33, 36, 19],
      previousBestSectorTimes: NONE,
      bestLapSectorTimes: [33.5, 36.5, 19.5],
    });
    // And the Ferrari's are still where they were left.
    expect(stub.saves.every((save) => save.key === LMU_KEY)).toBe(true);
  });

  it('are those of the track being driven', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);

    processor.init(lmuSession(CAR, 99));

    expect(stub.store.load).toHaveBeenLastCalledWith(`lmu|99|${CAR}|sim3`);
    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual(NONE);
  });

  it('stand through a session that for a moment names no car for the player', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);
    const allTime = processor.snapshot().allTime;
    const version = processor.snapshot().version;

    // A roster being rebuilt: the player's entry is missing from one
    // snapshot of the session and back in the next.
    processor.init({
      ...lmuSession(),
      DriverInfo: { DriverCarIdx: -1, Drivers: [] },
    } as unknown as Session);
    processor.init(lmuSession());

    expect(processor.snapshot().allTime).toEqual(allTime);
    expect(processor.snapshot().version).toBe(version);
  });

  it('set what was driven before the store answered against what it kept', () => {
    const stub = stubStore(
      {
        [LMU_KEY]: {
          bestSectorTimes: [32, 36, 18],
          bestLapSectorTimes: [33, 36, 19],
        },
      },
      { answered: false }
    );
    const processor = lmu(stub);
    driveRecordedRace(processor);
    expect(processor.snapshot().allTime).toBeNull();
    // Nothing is written over a file that has not been read.
    expect(stub.saves).toHaveLength(0);

    stub.answer();
    processor.onFrame(sim(360, 0.5, 1, 40, [32.461, null, null], FLYING));

    expect(processor.snapshot().allTime).toEqual({
      bestSectorTimes: [32, 35.07, 18],
      previousBestSectorTimes: [null, 35.357, null],
      // 86.660 s against the 88 s that was kept.
      bestLapSectorTimes: [32.739, 35.07, 18.851],
    });
    expect(stub.saves).toHaveLength(1);
    expect(stub.saves[0].bests.bestSectorTimes).toEqual([32, 35.07, 18]);
  });

  it('follow a change made to the store from outside', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);

    // The bests are cleared from a settings page.
    stub.set(LMU_KEY, null);
    processor.onFrame(sim(360, 0.5, 1, 40, [32.461, null, null], FLYING));

    expect(processor.snapshot().allTime).toEqual({
      bestSectorTimes: NONE,
      previousBestSectorTimes: NONE,
      bestLapSectorTimes: NONE,
    });
  });

  it('read a stored value that is not sector bests as none', () => {
    const stub = stubStore({ [LMU_KEY]: { bestSectorTimes: [32, 36] } });
    const processor = lmu(stub);
    processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, NONE));

    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual(NONE);
  });

  it('are neither read nor written in a replay', () => {
    const stub = stubStore({
      [LMU_KEY]: {
        bestSectorTimes: [32, 36, 18],
        bestLapSectorTimes: [33, 36, 19],
      },
    });
    const processor = new SectorTimingProcessor({
      store: stub.store,
      simulator: 'lmu',
    });
    processor.onLifecycle({ type: 'enter', replay: true });
    processor.init(lmuSession());
    driveRecordedRace(processor);

    expect(processor.snapshot().allTime).toBeNull();
    expect(stub.store.load).not.toHaveBeenCalled();
    expect(stub.saves).toHaveLength(0);
  });

  it('are forgotten on disconnect, with the track and car they belonged to', () => {
    const stub = stubStore();
    const processor = lmu(stub);
    driveRecordedRace(processor);

    processor.onLifecycle({ type: 'disconnect' });

    expect(processor.snapshot().allTime).toBeNull();
  });
});

describe('best sectors where the session places five of them', () => {
  // iRacing: the session says where the sectors start, and the timing is
  // done here from the car's position.
  const STARTS = [0, 0.2, 0.4, 0.6, 0.8];
  const KEY = 'iracing|77|porsche992rgt3|5@0.0000,0.2000,0.4000,0.6000,0.8000';
  const session = {
    WeekendInfo: { TrackID: 77 },
    DriverInfo: {
      DriverCarIdx: 3,
      Drivers: [{ CarIdx: 3, CarPath: 'porsche992rgt3' }],
    },
    SplitTimeInfo: {
      Sectors: STARTS.map((SectorStartPct, SectorNum) => ({
        SectorNum,
        SectorStartPct,
      })),
    },
  } as unknown as Session;

  const frame = (lapDistPct: number, sessionTime: number) =>
    ({
      LapDistPct: { value: [lapDistPct] },
      SessionTime: { value: [sessionTime] },
      SessionNum: { value: [1] },
      IsOnTrack: { value: [true] },
      OnPitRoad: { value: [false] },
    }) as unknown as Telemetry;

  /** One lap from a line crossed at `start`, each sector at its own pace. */
  const driveSectors = (
    processor: SectorTimingProcessor,
    start: number,
    times: number[]
  ): number => {
    let time = start;
    times.forEach((duration, index) => {
      for (const share of [0.001, 0.5, 0.999]) {
        processor.onFrame(
          frame(STARTS[index] + share * 0.2, time + share * duration)
        );
      }
      time += duration;
    });
    return time;
  };

  it('sums the best lap and the theoretical best over all five', () => {
    const stub = stubStore();
    const processor = new SectorTimingProcessor({
      store: stub.store,
      simulator: 'iracing',
    });
    processor.onLifecycle({ type: 'enter', replay: false });
    processor.init(session);
    processor.onFrame(frame(0.9998, 99.98));
    let line = driveSectors(processor, 100, [20, 21, 22, 23, 24]);
    line = driveSectors(processor, line, [21, 20, 23, 22, 23]);
    // Over the line, so the second lap is closed.
    processor.onFrame(frame(0.0002, line + 0.004));

    const { clean, allTime } = processor.snapshot();
    expect(clean.sessionBestLapSectorTimes).toHaveLength(5);
    // The second lap, 109 s, against the first at 110.
    expect(sectorSum(clean.sessionBestLapSectorTimes)).toBeCloseTo(109, 1);
    // 20, 20, 22, 22 and 23: the best of each of the five.
    expect(sectorSum(clean.sessionBestSectorTimes)).toBeCloseTo(107, 1);
    expect(allTime?.bestSectorTimes).toHaveLength(5);
    expect(sectorSum(allTime?.bestSectorTimes ?? [])).toBeCloseTo(107, 1);
    expect(sectorSum(allTime?.bestLapSectorTimes ?? [])).toBeCloseTo(109, 1);
    expect(stub.saves.at(-1)?.key).toBe(KEY);
  });

  it('keeps the bests of one sector layout apart from another', () => {
    const stub = stubStore();
    const processor = new SectorTimingProcessor({
      store: stub.store,
      simulator: 'iracing',
    });
    processor.onLifecycle({ type: 'enter', replay: false });
    processor.init(session);
    processor.init({
      ...session,
      SplitTimeInfo: {
        Sectors: [
          { SectorNum: 0, SectorStartPct: 0 },
          { SectorNum: 1, SectorStartPct: 0.5 },
        ],
      },
    } as unknown as Session);

    expect(stub.store.load).toHaveBeenLastCalledWith(
      'iracing|77|porsche992rgt3|2@0.0000,0.5000'
    );
    expect(processor.snapshot().allTime?.bestSectorTimes).toEqual([null, null]);
  });
});
