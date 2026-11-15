import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';

/**
 * The `race` block of `fuel.projection`: what the race-distance projection
 * is worked out from, published for anything else that projects the end of
 * the race. Nothing reads it yet; these cases hold it to the figures the
 * projection itself uses.
 */

const LEADER = 0;
const PLAYER = 1;

const session = (raceLaps: string): Session =>
  ({
    WeekendInfo: { TrackName: 'laguna seca' },
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: [
        { CarIdx: LEADER, CarClassID: 1, CarClassEstLapTime: 80 },
        {
          CarIdx: PLAYER,
          CarClassID: 2,
          CarClassEstLapTime: 90,
          CarPath: 'gt3',
        },
      ],
    },
    SessionInfo: {
      Sessions: [
        { SessionNum: 0, SessionType: 'Race', SessionLaps: raceLaps },
        { SessionNum: 1, SessionType: 'Practice', SessionLaps: 'unlimited' },
      ],
    },
  }) as unknown as Session;

const frame = (values: Record<string, unknown[]>): Telemetry =>
  Object.fromEntries(
    Object.entries({
      SessionTime: [600],
      SessionNum: [0],
      SessionState: [4],
      SessionTimeRemain: [1800],
      Lap: [5],
      LapCompleted: [4],
      LapDistPct: [0.25],
      FuelLevel: [40],
      IsOnTrack: [true],
      // The leader half way round its sixth lap, the player a quarter of
      // the way round its fifth.
      CarIdxLap: [6, 5],
      CarIdxLapCompleted: [5, 4],
      CarIdxLapDistPct: [0.5, 0.25],
      CarIdxPosition: [1, 2],
      ...values,
    }).map(([key, value]) => [key, { value }])
  ) as unknown as Telemetry;

const run = (raceLaps: string, values: Record<string, unknown[]> = {}) => {
  const processor = new FuelProjectionProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session(raceLaps));
  processor.onFrame(frame(values));
  return processor.snapshot();
};

describe('the race block of the fuel projection', () => {
  it('carries the pace and the progress a timed race is projected from', () => {
    const snapshot = run('unlimited');

    expect(snapshot.race).toEqual({
      leaderCarIdx: LEADER,
      // No lap timed yet: each class's estimate.
      leaderPaceS: 80,
      playerPaceS: 90,
      leaderProgress: 5.5,
      playerProgress: 4.25,
      timeRemainingS: 1800,
      lapLimit: 0,
    });
  });

  it('is what the laps to go are made of', () => {
    const { race, estimatedLapsRemaining, hasValidRaceEstimate } =
      run('unlimited');
    expect(hasValidRaceEstimate).toBe(true);
    if (!race) throw new Error('no race block');

    // The leader runs out the clock and finishes the lap it is on; the
    // player finishes the lap it is on when the leader does.
    const leaderFinish = Math.ceil(
      race.leaderProgress + race.timeRemainingS / race.leaderPaceS
    );
    const untilTheFlag =
      (leaderFinish - race.leaderProgress) * race.leaderPaceS;
    const playerFinish = Math.ceil(
      race.playerProgress + untilTheFlag / race.playerPaceS
    );
    expect(playerFinish - race.playerProgress).toBe(20.75);
    expect(estimatedLapsRemaining).toBe(20.75);
  });

  it('carries the lap limit of a race run to laps, and no clock', () => {
    const snapshot = run('30', { SessionTimeRemain: [604800] });

    expect(snapshot.isFixedLapRace).toBe(true);
    expect(snapshot.race).toMatchObject({
      leaderCarIdx: LEADER,
      leaderProgress: 5.5,
      playerProgress: 4.25,
      timeRemainingS: 0,
      lapLimit: 30,
    });
  });

  it('names no leader where the sim has none in first place', () => {
    const snapshot = run('unlimited', { CarIdxPosition: [0, 0] });
    expect(snapshot.race).toMatchObject({
      leaderCarIdx: -1,
      // The pace and the progress fall back to the player's own.
      leaderPaceS: 90,
      leaderProgress: 4.25,
    });
  });

  it('is still there when the paces are not known, with the estimate withheld', () => {
    const processor = new FuelProjectionProcessor();
    processor.onLifecycle({ type: 'enter', replay: false });
    const unknown = session('unlimited');
    for (const driver of unknown.DriverInfo.Drivers) {
      driver.CarClassEstLapTime = 0;
    }
    processor.init(unknown);
    processor.onFrame(frame({}));

    expect(processor.snapshot().hasValidRaceEstimate).toBe(false);
    expect(processor.snapshot().race).toMatchObject({
      leaderPaceS: 0,
      playerPaceS: 0,
      timeRemainingS: 1800,
    });
  });

  it('is absent outside a race', () => {
    expect(run('unlimited', { SessionNum: [1] }).race).toBeUndefined();
  });
});
