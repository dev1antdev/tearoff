import { describe, expect, it, vi } from 'vitest';
import type { ReferenceLap, Session, Telemetry } from '@irdashies/types';
import {
  ReferenceLapProcessor,
  type PlayerReferenceLapPersistence,
} from './ReferenceLapProcessor';

/**
 * The player's all-time best lap, and the line crossing it is timed from.
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

const setup = (held: ReferenceLap | null = null, start = session()) => {
  const playerLaps = {
    load: vi.fn<PlayerReferenceLapPersistence['load']>(() => held),
    save: vi.fn<PlayerReferenceLapPersistence['save']>(),
  };
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

describe("ReferenceLapProcessor player's all-time best", () => {
  it('keeps a clean lap and saves it under the track and car', () => {
    const { processor, playerLaps } = setup();

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    expect(playerLaps.save).toHaveBeenCalledOnce();
    const [trackId, carKey, lap] = playerLaps.save.mock.calls[0];
    expect(trackId).toBe(TRACK_ID);
    expect(carKey).toBe(PLAYER_CAR);
    expect(lapTimeOf(lap)).toBeCloseTo(60, 5);
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(60, 5);
  });

  it('keys the lap by the car model where the sim names one', () => {
    // Le Mans Ultimate: CarPath is the livery file, which differs between
    // two entries of the same car.
    const { processor, playerLaps } = setup(
      null,
      session({
        playerCar: { CarPath: '74_26_KESS', CarModel: 'Ferrari 296 LMGT3 Evo' },
      })
    );

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    expect(playerLaps.load).toHaveBeenCalledWith(
      TRACK_ID,
      'Ferrari 296 LMGT3 Evo'
    );
    expect(playerLaps.save.mock.calls[0][1]).toBe('Ferrari 296 LMGT3 Evo');
  });

  it('loads the lap held from earlier sessions and publishes it', () => {
    const { processor, playerLaps } = setup(stored(58));

    expect(playerLaps.load).toHaveBeenCalledWith(TRACK_ID, PLAYER_CAR);
    const allTime = processor.snapshot().playerAllTimeLap;
    expect(lapTimeOf(allTime)).toBe(58);
    // The store keeps no tangents; a lap without them reads as a flat line.
    expect(allTime?.tangents.every((value) => value > 0)).toBe(true);
  });

  it('ignores a held lap recorded against a different track length', () => {
    const { processor } = setup(stored(58, 120));

    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('replaces the held lap only with a faster one', () => {
    const { processor, playerLaps } = setup(stored(58));

    crossLine(processor, 100);
    driveLap(processor, 100, 60);
    // A session best, but two seconds off the all-time lap.
    expect(processor.snapshot().bestLaps).toHaveLength(2);
    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);

    driveLap(processor, 160, 57);
    expect(playerLaps.save).toHaveBeenCalledOnce();
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(57, 5);
  });

  it('keeps a clean lap that beats it even when it is not the session best', () => {
    // The session best has an incident on it, so it cannot be the all-time
    // lap. The clean lap after it is slower than that and still quicker than
    // anything held.
    const { processor, playerLaps } = setup(stored(60));
    crossLine(processor, 100);
    driveLap(processor, 100, 58, (pct) => ({ incidents: pct < 0.5 ? 0 : 1 }));
    expect(playerLaps.save).not.toHaveBeenCalled();
    const version = processor.snapshot().version;

    driveLap(processor, 158, 59, () => ({ incidents: 1 }));

    expect(playerLaps.save).toHaveBeenCalledOnce();
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(59, 5);
    expect(processor.snapshot().version).toBeGreaterThan(version);
    // The session best is untouched: still the quicker lap.
    const best = processor
      .snapshot()
      .bestLaps.find(([carIdx]) => carIdx === 0)?.[1];
    expect(lapTimeOf(best)).toBeCloseTo(58, 5);
    // And the lap held has tangents, or the delta against it would be flat.
    expect(
      processor.snapshot().playerAllTimeLap?.tangents.every((v) => v > 0)
    ).toBe(true);
  });

  it("does not keep another car's lap", () => {
    const { processor, playerLaps } = setup();

    // Car 1 laps; the player is parked half way round.
    processor.onFrame(frame(0.5, 99.9, { otherPct: 0.999 }));
    processor.onFrame(frame(0.5, 100.1, { otherPct: 0.001 }));
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      processor.onFrame(frame(0.5, 100 + pct * 60, { otherPct: pct }));
    }
    processor.onFrame(frame(0.5, 159.94, { otherPct: 0.999 }));
    processor.onFrame(frame(0.5, 160.06, { otherPct: 0.001 }));

    expect(processor.snapshot().bestLaps.map(([carIdx]) => carIdx)).toEqual([
      1,
    ]);
    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('does not keep a lap the player was not driving throughout', () => {
    // A team-mate's stint, or the car handed to the AI: a lap in the
    // player's car that is not the player's.
    const { processor, playerLaps } = setup();

    crossLine(processor, 100);
    driveLap(processor, 100, 60, (pct) => ({
      onTrack: pct < 0.4 || pct > 0.45,
    }));

    // Still the car's best lap this session, as it always was.
    expect(processor.snapshot().bestLaps).toHaveLength(2);
    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('does not keep a lap with an incident on it', () => {
    // iRacing counts one for the off-track that makes a lap quick.
    const { processor, playerLaps } = setup();

    crossLine(processor, 100, { incidents: 3 });
    driveLap(processor, 100, 60, (pct) => ({ incidents: pct < 0.7 ? 3 : 4 }));
    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
    // It is still the best lap of the session, as it always was.
    expect(processor.snapshot().bestLaps).toHaveLength(2);

    // The next lap starts with the count at 4 and ends with it at 4: clean,
    // and the first lap there is to hold, though a second off the session
    // best.
    driveLap(processor, 160, 61, () => ({ incidents: 4 }));
    expect(playerLaps.save).toHaveBeenCalledOnce();
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(61, 5);
  });

  it('does not time a lap from a car held at the line', () => {
    // Le Mans Ultimate holds the lap fraction at exactly 0 until a car on
    // the grid, or rolling up to the start, reaches the line. A lap timed
    // from the first such frame would include the wait.
    const { processor, playerLaps } = setup();

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
    expect(playerLaps.save).not.toHaveBeenCalled();

    // The lap after it starts at a crossing that was seen.
    driveLap(processor, 160, 60);
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(60, 5);
  });

  it('holds the all-time lap across a change of session', () => {
    const { processor } = setup();
    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    // Practice to qualifying: the session bests go, the all-time lap stays.
    processor.onFrame(frame(0.3, 5, { sessionNum: 2 }));

    expect(processor.snapshot().bestLaps).toHaveLength(0);
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(60, 5);
  });

  it('neither records nor saves while replaying', () => {
    const { processor, playerLaps } = setup();
    processor.onLifecycle({ type: 'enter', replay: true });

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('loads the lap for the new car when the player changes car', () => {
    const { processor, playerLaps } = setup(stored(58));
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);

    playerLaps.load.mockReturnValue(null);
    processor.init(session({ playerCar: { CarPath: 'porsche992rgt3' } }));

    expect(playerLaps.load).toHaveBeenLastCalledWith(
      TRACK_ID,
      'porsche992rgt3'
    );
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('drops the held lap on a different track', () => {
    const { processor, playerLaps } = setup(stored(58));

    playerLaps.load.mockReturnValue(null);
    processor.init(session({ trackId: 10, subSessionId: 2 }));

    expect(playerLaps.load).toHaveBeenLastCalledWith(10, PLAYER_CAR);
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('looks again on a later session update when no lap was found', () => {
    // The store loads its file in the background at startup, and LMU
    // rebuilds the session twice a second.
    const { processor, playerLaps } = setup(null);
    expect(processor.snapshot().playerAllTimeLap).toBeNull();

    playerLaps.load.mockReturnValue(stored(58));
    processor.init(session());

    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBe(58);
  });

  it('keeps nothing when the player has no car in the session', () => {
    const { processor, playerLaps } = setup(
      stored(58),
      session({ playerCarIdx: -1 })
    );

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    expect(playerLaps.load).not.toHaveBeenCalled();
    expect(playerLaps.save).not.toHaveBeenCalled();
    expect(processor.snapshot().playerAllTimeLap).toBeNull();
  });

  it('works without a player lap store at all', () => {
    // The mock and preview runtimes pass none.
    const processor = new ReferenceLapProcessor(noClassLaps);
    processor.init(session());

    crossLine(processor, 100);
    driveLap(processor, 100, 60);

    // Still held for the session, so the all-time delta has something to
    // measure against until the app is restarted.
    expect(lapTimeOf(processor.snapshot().playerAllTimeLap)).toBeCloseTo(60, 5);
  });
});
