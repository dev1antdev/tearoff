import { describe, expect, it } from 'vitest';
import type { ReferenceLap, Session, Telemetry } from '@irdashies/types';
import {
  ReferenceLapProcessor,
  type PlayerStintSource,
} from './ReferenceLapProcessor';

/**
 * The player's last lap and the best lap of their stint: which laps become
 * them, and what drops them.
 *
 * One kilometre of track, so a lap is 100 points and a point is 1% of it.
 * The player is car 0.
 */
const session = ({
  playerCar = 'Ferrari 296 LMGT3 Evo',
  playerCarIdx = 0,
  subSessionId = 1,
} = {}) =>
  ({
    WeekendInfo: {
      SeriesID: 0,
      TrackID: 9,
      TrackLength: '1 km',
      SubSessionID: subSessionId,
    },
    DriverInfo: {
      DriverCarIdx: playerCarIdx,
      PaceCarIdx: -1,
      Drivers: [
        { CarIdx: 0, CarClassID: 0, CarModel: playerCar },
        { CarIdx: 1, CarClassID: 0, CarModel: 'Porsche 911 GT3 R' },
      ],
    },
  }) as unknown as Session;

interface FrameOptions {
  onPitRoad?: boolean;
  /** Metres per second. */
  speed?: number;
  /** Le Mans Ultimate's void flag for the lap being driven. */
  voided?: boolean;
  sessionNum?: number;
  /** True with a team-mate at the wheel of the player's car. */
  watching?: boolean;
}

const frame = (
  playerPct: number,
  sessionTime: number,
  {
    onPitRoad = false,
    speed = 50,
    voided,
    sessionNum = 1,
    watching,
  }: FrameOptions = {}
) =>
  ({
    CarIdxLapDistPct: { value: [playerPct, 0.5] },
    CarIdxOnPitRoad: { value: [onPitRoad, false] },
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    Speed: { value: [speed] },
    IsOnTrack: { value: [watching !== true] },
    ...(voided === undefined ? {} : { LmuLapInvalidated: { value: [voided] } }),
    ...(watching === undefined ? {} : { LmuWatching: { value: [watching] } }),
  }) as unknown as Telemetry;

const noClassLaps = { load: () => null, save: () => undefined };

/** A stand-in for the player's ledger: one stint, replaceable. */
const ledger = () => {
  let ordinal = 0;
  const source: PlayerStintSource = {
    stintId: () => (ordinal === 0 ? '' : `session:${ordinal}`),
    stintOrdinal: () => ordinal,
  };
  return {
    source,
    open(next: number) {
      ordinal = next;
    },
    close() {
      ordinal = 0;
    },
  };
};

const setup = (stints?: PlayerStintSource) => {
  const processor = new ReferenceLapProcessor(noClassLaps, undefined, stints);
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session());

  /** Up to the line and across it at exactly `at`. */
  const crossLine = (at: number, options: FrameOptions = {}) => {
    processor.onFrame(frame(0.999, at - 0.06, options));
    processor.onFrame(frame(0.001, at + 0.06, options));
  };
  /**
   * One lap of `lapTime` seconds at a steady pace, from a crossing at
   * `start` to the crossing that ends it. `options` may vary along the lap.
   */
  const driveLap = (
    start: number,
    lapTime: number,
    options: (pct: number) => FrameOptions = () => ({})
  ) => {
    const edge = 0.06 / lapTime;
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      processor.onFrame(frame(pct, start + pct * lapTime, options(pct)));
    }
    processor.onFrame(frame(1 - edge, start + lapTime - 0.06, options(0.999)));
    processor.onFrame(frame(edge, start + lapTime + 0.06, options(1)));
  };
  return { processor, crossLine, driveLap };
};

const lapTimeOf = (lap: ReferenceLap | null | undefined) =>
  lap ? lap.finishTime - lap.startTime : null;

const sessionBestOf = (processor: ReferenceLapProcessor) =>
  processor.snapshot().bestLaps.find(([carIdx]) => carIdx === 0)?.[1];

describe("the player's last lap and stint best", () => {
  it('keeps the lap just driven and the best of the stint', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    driveLap(100, 88);
    driveLap(188, 89);

    const snapshot = processor.snapshot();
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(89, 5);
    expect(lapTimeOf(snapshot.playerStintBestLap)).toBeCloseTo(88, 5);
    expect(lapTimeOf(sessionBestOf(processor))).toBeCloseTo(88, 5);
    // Where two of them are the same lap they are the same object, so the
    // curve crosses to a window once.
    expect(snapshot.playerStintBestLap).toBe(sessionBestOf(processor));
    expect(snapshot.playerLastLap).not.toBe(snapshot.playerStintBestLap);
  });

  it('publishes once for all that a crossing changes', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    const version = processor.snapshot().version;

    // The first lap is the session best, the stint best and the last lap.
    driveLap(10, 90);

    expect(processor.snapshot().version).toBe(version + 1);
  });

  it('gives the last lap a curve to be read from and no speeds to send', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 88);
    driveLap(98, 90);

    const last = processor.snapshot().playerLastLap;
    expect(lapTimeOf(last)).toBeCloseTo(90, 5);
    expect(last?.pointPos.includes(-1)).toBe(false);
    expect(last?.tangents.every((value) => value > 0)).toBe(true);
    // Only the session best feeds the speed delta.
    expect(last?.speedsKph).toBeUndefined();
    expect(sessionBestOf(processor)?.speedsKph).toBeDefined();
  });

  it('takes a voided lap as the last lap and as no best', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    // A track cut a third of the way round: the sim voids the lap and keeps
    // the flag up to the line. It was still the lap just driven.
    driveLap(100, 86, (pct) => ({ voided: pct > 0.3 }));

    const snapshot = processor.snapshot();
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(86, 5);
    expect(snapshot.playerLastLap?.isCleanLap).toBe(false);
    expect(snapshot.playerLastLap?.pointPos.includes(-1)).toBe(false);
    expect(lapTimeOf(snapshot.playerStintBestLap)).toBeCloseTo(90, 5);
    expect(lapTimeOf(sessionBestOf(processor))).toBeCloseTo(90, 5);
  });

  it('replaces nothing with a lap that touched pit road', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    // The in-lap, and the out-lap after it.
    driveLap(100, 95, (pct) => ({ onPitRoad: pct > 0.9, speed: 16 }));
    driveLap(195, 99, (pct) => ({ onPitRoad: pct < 0.1, speed: 16 }));

    const snapshot = processor.snapshot();
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(90, 5);
    expect(lapTimeOf(snapshot.playerStintBestLap)).toBeCloseTo(90, 5);
  });

  it('does not take the lap that opens a race, begun by being let go', () => {
    // Le Mans Ultimate holds the lap fraction at exactly 0 until the car
    // reaches the line. The lap that follows has no start to time it from.
    const { processor, driveLap } = setup();
    for (let tick = 0; tick < 20; tick += 1) {
      processor.onFrame(frame(0, 5 + tick * 0.25));
    }
    driveLap(10, 97);

    expect(processor.snapshot().playerLastLap).toBeNull();
    expect(processor.snapshot().playerStintBestLap).toBeNull();
    expect(sessionBestOf(processor)).toBeUndefined();

    // The lap after it starts at a crossing that was seen.
    driveLap(107, 87);
    expect(lapTimeOf(processor.snapshot().playerLastLap)).toBeCloseTo(87, 5);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      87,
      5
    );
  });

  it('does not take a lap it did not see from the line', () => {
    const { processor, driveLap } = setup();
    // Joined a metre into the lap.
    processor.onFrame(frame(0.001, 10.09));
    driveLap(10, 90);

    expect(processor.snapshot().playerLastLap).toBeNull();
  });

  it('drops both when the session changes', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    expect(processor.snapshot().playerLastLap).not.toBeNull();

    processor.onFrame(frame(0.3, 5, { sessionNum: 2 }));

    const snapshot = processor.snapshot();
    expect(snapshot.playerLastLap).toBeNull();
    expect(snapshot.playerStintBestLap).toBeNull();
    expect(snapshot.playerStintId).toBe(0);
  });

  it('drops both on a session lifecycle event and on disconnect', () => {
    for (const event of [
      { type: 'sessionNumChange' } as const,
      { type: 'enter', replay: false } as const,
      { type: 'disconnect' } as const,
    ]) {
      const { processor, crossLine, driveLap } = setup();
      crossLine(10);
      driveLap(10, 90);

      processor.onLifecycle(event);

      expect(processor.snapshot().playerLastLap).toBeNull();
      expect(processor.snapshot().playerStintBestLap).toBeNull();
      expect(processor.snapshot().playerStintId).toBe(0);
    }
  });

  it('drops both when the player is in a different car', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    const version = processor.snapshot().version;

    processor.init(session({ playerCar: 'BMW M4 LMGT3' }));

    expect(processor.snapshot().playerLastLap).toBeNull();
    expect(processor.snapshot().playerStintBestLap).toBeNull();
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });

  it('keeps both when the session for a moment names no player', () => {
    // A roster being rebuilt: no car for the player in one snapshot, and
    // the same one again in the next.
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);

    processor.init(session({ playerCarIdx: -1 }));
    processor.init(session());

    expect(lapTimeOf(processor.snapshot().playerLastLap)).toBeCloseTo(90, 5);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );
  });

  it('drops both when the player is in another slot of the grid', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);

    processor.init(session({ playerCarIdx: 1 }));

    expect(processor.snapshot().playerLastLap).toBeNull();
    expect(processor.snapshot().playerStintBestLap).toBeNull();
  });

  it('keeps both while the session is republished unchanged', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    const version = processor.snapshot().version;

    // Le Mans Ultimate rebuilds the session twice a second.
    for (let tick = 0; tick < 5; tick += 1) processor.init(session());

    expect(lapTimeOf(processor.snapshot().playerLastLap)).toBeCloseTo(90, 5);
    expect(processor.snapshot().version).toBe(version);
  });
});

describe('where a stint ends without a ledger', () => {
  it('starts a new stint when the car stops in the pits', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    expect(processor.snapshot().playerStintId).toBe(0);

    // Into the pit lane, down to a standstill in the box.
    processor.onFrame(frame(0.02, 101, { onPitRoad: true, speed: 16 }));
    expect(processor.snapshot().playerStintId).toBe(0);
    processor.onFrame(frame(0.03, 103, { onPitRoad: true, speed: 0.05 }));

    const snapshot = processor.snapshot();
    expect(snapshot.playerStintId).toBe(1);
    expect(snapshot.playerStintBestLap).toBeNull();
    // What was last driven is kept across the stop.
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(90, 5);
  });

  it('counts one stint for one stop, however long the car stands', () => {
    const { processor, crossLine } = setup();
    crossLine(10);
    for (let tick = 0; tick < 50; tick += 1) {
      // Standing, with a creep forward in the box half-way through.
      processor.onFrame(
        frame(0.03, 20 + tick, {
          onPitRoad: true,
          speed: tick === 25 ? 0.4 : 0,
        })
      );
    }
    expect(processor.snapshot().playerStintId).toBe(1);

    // Out, round and in again: the next stop is the next stint.
    processor.onFrame(frame(0.05, 80, { speed: 30 }));
    processor.onFrame(frame(0.06, 81, { onPitRoad: true, speed: 0 }));
    expect(processor.snapshot().playerStintId).toBe(2);
  });

  it('does not end a stint for a drive-through', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10);
    driveLap(10, 90);
    const version = processor.snapshot().version;

    // Through the pit lane at the limiter, never stopping.
    driveLap(100, 110, (pct) => ({ onPitRoad: pct < 0.2, speed: 16 }));

    const snapshot = processor.snapshot();
    expect(snapshot.playerStintId).toBe(0);
    expect(lapTimeOf(snapshot.playerStintBestLap)).toBeCloseTo(90, 5);
    // And the lap through it replaced nothing, so nothing was published.
    expect(snapshot.version).toBe(version);
  });
});

describe("where a stint ends by the player's ledger", () => {
  it('publishes the stint the ledger has under way', () => {
    const stints = ledger();
    stints.open(1);
    const { processor, crossLine } = setup(stints.source);

    crossLine(10);

    expect(processor.snapshot().playerStintId).toBe(1);
  });

  it('drops the stint best when the ledger opens another stint', () => {
    const stints = ledger();
    stints.open(1);
    const { processor, crossLine, driveLap } = setup(stints.source);
    crossLine(10);
    driveLap(10, 90);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );

    // A stop with service: the ledger closes the stint and opens the next
    // as the car leaves the pit lane.
    stints.open(2);
    processor.onFrame(frame(0.05, 140));

    const snapshot = processor.snapshot();
    expect(snapshot.playerStintId).toBe(2);
    expect(snapshot.playerStintBestLap).toBeNull();
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(90, 5);
    // The session best is the session's, whatever the stint.
    expect(lapTimeOf(sessionBestOf(processor))).toBeCloseTo(90, 5);
  });

  it('keeps the stint best on show between two stints', () => {
    const stints = ledger();
    stints.open(1);
    const { processor, crossLine, driveLap } = setup(stints.source);
    crossLine(10);
    driveLap(10, 90);
    const version = processor.snapshot().version;

    // Back in the garage: the stint is over and no other has begun.
    stints.close();
    processor.onFrame(frame(0.05, 140, { onPitRoad: true, speed: 0 }));

    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );
    expect(processor.snapshot().playerStintId).toBe(1);
    expect(processor.snapshot().version).toBe(version);
  });

  it('leaves a stop to the ledger: standing in the pits ends nothing', () => {
    // A stop-and-go penalty: the ledger notes a pass and keeps the stint.
    const stints = ledger();
    stints.open(1);
    const { processor, crossLine, driveLap } = setup(stints.source);
    crossLine(10);
    driveLap(10, 90);

    processor.onFrame(frame(0.03, 103, { onPitRoad: true, speed: 0 }));

    expect(processor.snapshot().playerStintId).toBe(1);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );
  });
});

describe("the player's last lap and stint best through a team-mate's stint", () => {
  const atWheel = () => ({ watching: false });
  const teamMate = () => ({ watching: true });

  it('takes none of a team-mate’s laps, however quick', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10, atWheel());
    driveLap(10, 90, atWheel);
    driveLap(100, 86, teamMate);
    driveLap(186, 85, teamMate);

    const snapshot = processor.snapshot();
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(90, 5);
    expect(lapTimeOf(snapshot.playerStintBestLap)).toBeCloseTo(90, 5);
    expect(lapTimeOf(sessionBestOf(processor))).toBeCloseTo(90, 5);
  });

  it('has neither before the user has driven a lap', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10, teamMate());
    driveLap(10, 88, teamMate);

    expect(processor.snapshot().playerLastLap).toBeNull();
    expect(processor.snapshot().playerStintBestLap).toBeNull();
  });

  it('does not take a lap the user took over part-way round, or left', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10, teamMate());
    driveLap(10, 88, (pct) => ({ watching: pct < 0.4 }));
    expect(processor.snapshot().playerLastLap).toBeNull();

    driveLap(98, 87, (pct) => ({ watching: pct > 0.9 }));
    expect(processor.snapshot().playerLastLap).toBeNull();
  });

  it('takes the user’s own lap again from the next crossing at the wheel', () => {
    const { processor, crossLine, driveLap } = setup();
    crossLine(10, teamMate());
    driveLap(10, 88, (pct) => ({ watching: pct < 0.5 }));
    driveLap(98, 91, atWheel);

    expect(lapTimeOf(processor.snapshot().playerLastLap)).toBeCloseTo(91, 5);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      91,
      5
    );
  });
});
