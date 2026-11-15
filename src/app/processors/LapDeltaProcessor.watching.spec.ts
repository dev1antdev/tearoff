import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { LapDeltaProcessor } from './LapDeltaProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';

/**
 * The lap delta through a team-mate's stint under Le Mans Ultimate, with
 * the recorder that keeps the session best feeding it, as in the app.
 *
 * The user's own entry is car 0 on a track of one kilometre. The frames are
 * as the mapper writes them: the car's place on the lap goes on through the
 * stint, with `IsOnTrack` false and `LmuWatching` saying the user is
 * watching.
 */
const session = {
  WeekendInfo: {
    SeriesID: 0,
    TrackID: 9,
    TrackLength: '1 km',
    SubSessionID: 1,
    SimMode: 'Le Mans Ultimate',
  },
  DriverInfo: {
    DriverCarIdx: 0,
    PaceCarIdx: -1,
    Drivers: [{ CarIdx: 0, CarClassID: 0, CarModel: 'Ferrari 296 LMGT3' }],
  },
} as unknown as Session;

const frame = (pct: number, sessionTime: number, teamMate: boolean) =>
  ({
    CarIdxLapDistPct: { value: [pct] },
    CarIdxOnPitRoad: { value: [false] },
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [0] },
    IsOnTrack: { value: [!teamMate] },
    LmuWatching: { value: [teamMate] },
  }) as unknown as Telemetry;

const setup = () => {
  const references = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  const delta = new LapDeltaProcessor(references);
  for (const processor of [references, delta]) {
    processor.onLifecycle({ type: 'enter', replay: false });
    processor.init(session);
  }
  const onFrame = (pct: number, sessionTime: number, teamMate: boolean) => {
    const telemetry = frame(pct, sessionTime, teamMate);
    references.onFrame(telemetry);
    delta.onFrame(telemetry);
  };
  /** Up to the line and across it at exactly `at`. */
  const crossLine = (at: number, teamMate: boolean) => {
    onFrame(0.999, at - 0.06, teamMate);
    onFrame(0.001, at + 0.06, teamMate);
  };
  /**
   * From a crossing at `lapStart` round to `toPct` at a steady pace of
   * `lapTime` seconds a lap, a frame in every ten metres.
   */
  const drive = (
    lapStart: number,
    lapTime: number,
    toPct: number,
    teamMate: (pct: number) => boolean
  ) => {
    for (let point = 0; (point + 0.5) / 100 <= toPct; point += 1) {
      const pct = (point + 0.5) / 100;
      onFrame(pct, lapStart + pct * lapTime, teamMate(pct));
    }
  };
  /** A whole lap from a crossing at `lapStart` to the one that ends it. */
  const driveLap = (
    lapStart: number,
    lapTime: number,
    teamMate: (pct: number) => boolean
  ) => {
    drive(lapStart, lapTime, 1, teamMate);
    onFrame(1 - 0.06 / lapTime, lapStart + lapTime - 0.06, teamMate(0.999));
    onFrame(0.06 / lapTime, lapStart + lapTime + 0.06, teamMate(1));
  };
  return { delta, crossLine, drive, driveLap };
};

const user = () => false;
const teamMate = () => true;

describe('the lap delta through a team-mate’s stint', () => {
  it('shows the team-mate’s lap against the user’s own session best', () => {
    const { delta, crossLine, drive, driveLap } = setup();
    crossLine(10, false);
    // The user's lap: 90 s, and the session best.
    driveLap(10, 90, user);
    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(90, 2);

    // The team-mate, two seconds a lap quicker, half-way round.
    drive(100, 88, 0.5, teamMate);

    const reading = delta.snapshot().sessionBest;
    expect(reading.lapTime).toBeCloseTo(90, 2);
    // 43.56 s to a point the reference reached in 44.55 s.
    expect(reading.delta).toBeCloseTo(-0.99, 1);
  });

  it('does not take the team-mate’s lap for the user’s session best', () => {
    const { delta, crossLine, driveLap } = setup();
    crossLine(10, false);
    driveLap(10, 90, user);
    driveLap(100, 88, teamMate);
    driveLap(188, 87, teamMate);

    // Still the lap the user drove, two quicker laps later.
    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(90, 2);
  });

  it('has no session best to show before the user has driven a lap', () => {
    // The team-mate took the start. Their laps are not the user's, so there
    // is nothing of the user's to measure them against yet.
    const { delta, crossLine, drive, driveLap } = setup();
    crossLine(10, true);
    driveLap(10, 88, teamMate);
    drive(98, 88, 0.5, teamMate);

    expect(delta.snapshot().sessionBest).toEqual({
      lapTime: null,
      delta: null,
      trend: null,
    });
  });

  it('takes the user’s own lap again from the first crossing at the wheel', () => {
    const { delta, crossLine, driveLap } = setup();
    crossLine(10, false);
    driveLap(10, 90, user);
    driveLap(100, 88, teamMate);
    // The user gets back in a third of the way round: not their lap.
    driveLap(188, 86, (pct) => pct < 0.33);
    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(90, 2);

    // The lap after it is, and is quicker than their last.
    driveLap(274, 89, user);

    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(89, 2);
  });
});
