import { describe, expect, it, vi } from 'vitest';
import type { ReferenceLap, Session, Telemetry } from '@irdashies/types';
import {
  ReferenceLapProcessor,
  type PlayerReferenceLapSource,
} from './ReferenceLapProcessor';

/**
 * The line crossing laps are timed from, and the player's all-time reference
 * lap, which the recorder reads from the lap library rather than decides.
 *
 * One kilometre of track, so a lap is 100 points and a point is 1% of it.
 */
const TRACK_ID = 9;
const PLAYER_CAR = 'ferrari296gt3';

const session = ({
  trackId = TRACK_ID,
  trackLength = '1 km',
  playerCarIdx = 0,
  playerCar = { CarPath: PLAYER_CAR } as Record<string, unknown>,
  subSessionId = 1,
} = {}) =>
  ({
    WeekendInfo: {
      SeriesID: 7,
      TrackID: trackId,
      TrackLength: trackLength,
      SubSessionID: subSessionId,
    },
    DriverInfo: {
      DriverCarIdx: playerCarIdx,
      PaceCarIdx: -1,
      Drivers: [
        { CarIdx: 0, CarClassID: 12, ...playerCar },
        { CarIdx: 1, CarClassID: 12, CarPath: 'bmwm4gt3' },
      ],
    },
  }) as unknown as Session;

interface FrameOptions {
  onTrack?: boolean;
  incidents?: number;
  sessionNum?: number;
  /** Where car 1 is; it laps in step with the player by default. */
  otherPct?: number;
}

const frame = (
  playerPct: number,
  sessionTime: number,
  { onTrack = true, incidents = 0, sessionNum = 1, otherPct }: FrameOptions = {}
) =>
  ({
    CarIdxLapDistPct: { value: [playerPct, otherPct ?? playerPct] },
    CarIdxOnPitRoad: { value: [false, false] },
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    IsOnTrack: { value: [onTrack] },
    PlayerCarMyIncidentCount: { value: [incidents] },
  }) as unknown as Telemetry;

/**
 * Brings the car up to the line and across it, so the lap that follows is
 * timed from an observed crossing at exactly `at`.
 */
const crossLine = (
  processor: ReferenceLapProcessor,
  at: number,
  options: FrameOptions = {}
) => {
  processor.onFrame(frame(0.999, at - 0.06, options));
  processor.onFrame(frame(0.001, at + 0.06, options));
};

/**
 * One lap of `lapTime` seconds at a steady pace, from a crossing at `start`
 * to the crossing that ends it. `options` may vary along the lap.
 */
const driveLap = (
  processor: ReferenceLapProcessor,
  start: number,
  lapTime: number,
  options: (pct: number) => FrameOptions = () => ({})
) => {
  const edge = 0.06 / lapTime;
  // A frame in every ten-metre stretch, the first included: the recorder
  // rejects a lap with a stretch it never sampled.
  for (let point = 0; point < 100; point += 1) {
    const pct = (point + 0.5) / 100;
    processor.onFrame(frame(pct, start + pct * lapTime, options(pct)));
  }
  processor.onFrame(frame(1 - edge, start + lapTime - 0.06, options(0.999)));
  // The frame past the line still belongs to this lap for what it reports.
  processor.onFrame(frame(edge, start + lapTime + 0.06, options(1)));
};

const lapTimeOf = (lap: ReferenceLap | null | undefined) =>
  lap ? lap.finishTime - lap.startTime : null;

const stored = (lapTime: number, pointsCount = 100): ReferenceLap => {
  const pointPos = new Float32Array(pointsCount);
  const times = new Float32Array(pointsCount);
  for (let index = 0; index < pointsCount; index += 1) {
    pointPos[index] = (index + 0.1) / pointsCount;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    // As the store hands them back: left for the recorder to derive.
    tangents: new Float32Array(pointsCount),
    interval: 1 / pointsCount,
    pointsCount,
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 0,
    isCleanLap: true,
  };
};

const noClassLaps = { load: () => null, save: () => undefined };

/** A stand-in for the lap library: one lap, swappable, with a revision. */
const library = (initial: ReferenceLap | null = null) => {
  let held = initial;
  let revision = 1;
  return {
    load: vi.fn<PlayerReferenceLapSource['load']>(() => held),
    revision: () => revision,
    /** What the library does when a lap is recorded, deleted or pinned. */
    set(lap: ReferenceLap | null) {
      held = lap;
      revision += 1;
    },
  };
};

const setup = (held: ReferenceLap | null = null, start = session()) => {
  const playerLaps = library(held);
  const processor = new ReferenceLapProcessor(noClassLaps, playerLaps);
  processor.init(start);
  return { processor, playerLaps };
};

describe('ReferenceLapProcessor line crossing', () => {
  it('times a lap between the crossings, not between the frames after them', () => {
    const { processor } = setup();

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    // Each crossing sits 60 ms before the frame that reveals it. Timed from
    // those frames the lap would still be 60 s, but shifted; timed from one
    // of each it would be 60.06 or 59.94.
    const best = processor.snapshot().bestLaps[0][1];
    expect(best.startTime).toBeCloseTo(100, 6);
    expect(best.finishTime).toBeCloseTo(160, 6);
  });

  it('places the crossing by distance when the frames straddle it unevenly', () => {
    const { processor } = setup();
    crossLine(processor, 100);
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      processor.onFrame(frame(pct, 100 + pct * 60));
    }

    // 90 ms short of the line, then 30 ms past it, at one speed.
    processor.onFrame(frame(0.9985, 159.91));
    processor.onFrame(frame(0.0005, 160.03));

    expect(processor.snapshot().bestLaps[0][1].finishTime).toBeCloseTo(160, 6);
  });

  it('measures a lap consistently whatever the frame phase at each end', () => {
    // Two identical laps whose crossings fall at different points between
    // frames must come out the same length.
    const { processor } = setup();
    crossLine(processor, 100);
    driveLap(processor, 100, 60);
    const first = lapTimeOf(processor.snapshot().bestLaps[0][1]);

    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      processor.onFrame(frame(pct, 160 + pct * 59.9));
    }
    // 59.9 s lap, ending 10 ms before a frame rather than 60.
    processor.onFrame(frame(0.9985, 219.9 - 0.08985));
    processor.onFrame(frame(0.000167, 219.91));

    expect(first).toBeCloseTo(60, 5);
    expect(lapTimeOf(processor.snapshot().bestLaps[0][1])).toBeCloseTo(59.9, 4);
  });
});

describe("ReferenceLapProcessor player's all-time reference", () => {
  it('asks the library for the lap of this track, car and track length', () => {
    const { playerLaps } = setup();

    expect(playerLaps.load).toHaveBeenCalledWith(TRACK_ID, PLAYER_CAR, 100);
  });

  it('asks by the car model where the sim names one', () => {
    // Le Mans Ultimate: CarPath is the livery file, which differs between
    // two entries of the same car.
    const { playerLaps } = setup(
      null,
      session({
        playerCar: { CarPath: '74_26_KESS', CarModel: 'Ferrari 296 LMGT3 Evo' },
      })
    );

    expect(playerLaps.load).toHaveBeenCalledWith(
      TRACK_ID,
      'Ferrari 296 LMGT3 Evo',
      100
    );
  });

  it('publishes the lap the library holds', () => {
    const { processor } = setup(stored(58));

    const allTime = processor.snapshot().playerAllTimeLap;
    expect(lapTimeOf(allTime)).toBe(58);
    // The library keeps no tangents; a lap without them reads as a flat line.
    expect(allTime?.tangents.every((value) => value > 0)).toBe(true);
  });

  it('ignores a lap recorded against a different track length', () => {
    const { processor } = setup(stored(58, 120));

    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it("does not make a lap the reference itself: that is the library's call", () => {
    // The recorder sees a clean lap quicker than anything held. Whether it
    // is the player's own, and free of incidents, it does not know.
    const { processor } = setup(stored(62));

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    expect(lapTimeOf(processor.snapshot().bestLaps[0][1])).toBeCloseTo(60, 5);
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(62);
  });

  it('takes the new lap when the library says the reference has changed', () => {
    const { processor, playerLaps } = setup(stored(62));
    crossLine(processor, 100);
    const version = processor.snapshot().version;

    // A lap was recorded: the library has a quicker reference now.
    playerLaps.set(stored(60));
    processor.onFrame(frame(0.02, 101.2));

    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(60);
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });

  it('first learns of a lap the library was still reading at the start', () => {
    // The library answers from memory and reads the database in the
    // background, so the first answer for a track and car is "none yet".
    const { processor, playerLaps } = setup(null);
    expect(processor.snapshot().playerAllTimeLap).toBeNull();

    playerLaps.set(stored(58));
    processor.onFrame(frame(0.5, 10));

    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);
  });

  it('drops the lap when the library no longer has one', () => {
    const { processor, playerLaps } = setup(stored(58));

    // Deleted from the settings page.
    playerLaps.set(null);
    processor.onFrame(frame(0.5, 10));

    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('publishes nothing while the library hands back the same lap', () => {
    const { processor, playerLaps } = setup(stored(58));
    const version = processor.snapshot().version;

    // LMU rebuilds the session twice a second; every frame checks too.
    for (let tick = 0; tick < 20; tick += 1) {
      processor.init(session());
      processor.onFrame(frame(0.5 + tick / 1000, 10 + tick / 60));
    }

    expect(processor.snapshot().version).toBe(version);
    expect(playerLaps.load.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not time a lap from a car held at the line', () => {
    // Le Mans Ultimate holds the lap fraction at exactly 0 until a car on
    // the grid, or rolling up to the start, reaches the line. A lap timed
    // from the first such frame would include the wait.
    const { processor } = setup();

    for (let tick = 0; tick < 50; tick += 1) {
      processor.onFrame(frame(0, 70 + tick * 0.5));
    }
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.1) / 100;
      processor.onFrame(frame(pct, 100 + pct * 60));
    }
    processor.onFrame(frame(0.999, 159.94));
    processor.onFrame(frame(0.001, 160.06));

    expect(processor.snapshot().bestLaps).toHaveLength(0);

    // The lap after it starts at a crossing that was seen.
    driveLap(processor, 160, 60);
    expect(lapTimeOf(processor.snapshot().bestLaps[0][1])).toBeCloseTo(60, 5);
  });

  it('holds the all-time lap across a change of session', () => {
    const { processor } = setup(stored(58));
    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    // Practice to qualifying: the session bests go, the all-time lap stays.
    processor.onFrame(frame(0.3, 5, { sessionNum: 2 }));

    expect(processor.snapshot().bestLaps).toHaveLength(0);
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);
  });

  it('asks for the new car when the player changes car', () => {
    const { processor, playerLaps } = setup(stored(58));
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);

    playerLaps.set(null);
    processor.init(session({ playerCar: { CarPath: 'porsche992rgt3' } }));

    expect(playerLaps.load).toHaveBeenLastCalledWith(
      TRACK_ID,
      'porsche992rgt3',
      100
    );
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('asks for the new track on a different track', () => {
    const { processor, playerLaps } = setup(stored(58));

    playerLaps.set(null);
    processor.init(
      session({ trackId: 10, subSessionId: 2, trackLength: '2 km' })
    );

    expect(playerLaps.load).toHaveBeenLastCalledWith(10, PLAYER_CAR, 200);
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('has no reference when the player has no car in the session', () => {
    const { processor, playerLaps } = setup(
      stored(58),
      session({ playerCarIdx: -1 })
    );

    expect(playerLaps.load).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('has no reference without a library at all', () => {
    // The mock and preview runtimes pass none.
    const processor = new ReferenceLapProcessor(noClassLaps);
    processor.init(session());

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    // Both cars lapped, so both have a session best. Neither is all-time.
    expect(processor.snapshot().bestLaps).toHaveLength(2);
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });
});
