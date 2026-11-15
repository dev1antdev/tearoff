import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { SessionState } from '@irdashies/types';
import { SessionTimingProcessor } from './SessionTimingProcessor';

const session = {
  DriverInfo: {
    DriverCarIdx: 1,
    Drivers: [{ CarIdx: 0, CarClassEstLapTime: 60 }, { CarIdx: 1 }],
  },
  SessionInfo: {
    Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionLaps: 10 }],
  },
} as unknown as Session;

const frame = (overrides: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries({
      SessionTime: 20,
      SessionNum: 0,
      SessionState: SessionState.Racing,
      SessionTimeTotal: 600,
      SessionTimeRemain: 604800,
      CamCarIdx: 1,
      LapDistPct: 0.25,
      CarIdxLap: [2, 2],
      CarIdxPosition: [1, 2],
      CarIdxLapDistPct: [0.5, 0.25],
      CarIdxBestLapTime: [60, 61],
      CarIdxLapCompleted: [1, 1],
      CarIdxLastLapTime: [60, 61],
      ...overrides,
    }).map(([key, value]) => [
      key,
      { value: Array.isArray(value) ? value : [value] },
    ])
  ) as unknown as Telemetry;

describe('SessionTimingProcessor', () => {
  it('projects fixed-lap timing for the focused car', () => {
    const processor = new SessionTimingProcessor(() => [60, 61]);
    processor.init(session);
    processor.onFrame(frame());
    expect(processor.snapshot()).toMatchObject({
      sessionType: 'Race',
      state: SessionState.Racing,
      currentLap: 2,
      totalLaps: 10,
      isFixedLapRace: true,
      totalRaceLaps: 10,
      totalRaceTime: 600,
      adjustedRaceTime: 600,
      sessionNum: 0,
    });
  });

  it('captures the green transition and freezes the lap at checkered', () => {
    const processor = new SessionTimingProcessor();
    processor.init(session);
    processor.onFrame(
      frame({ SessionTime: 10, SessionState: SessionState.Warmup })
    );
    processor.onFrame(
      frame({ SessionTime: 11, SessionState: SessionState.Racing })
    );
    expect(processor.snapshot().greenFlagTimestamp).toBe(11);
    processor.onFrame(
      frame({
        SessionTime: 12,
        SessionState: SessionState.Checkered,
        CarIdxLap: [3, 3],
      })
    );
    processor.onFrame(
      frame({
        SessionTime: 13,
        SessionState: SessionState.Checkered,
        CarIdxLap: [4, 4],
      })
    );
    expect(processor.snapshot().currentLap).toBe(3);
    expect(processor.snapshot().totalRaceLaps).toBe(3);
  });

  it('works out the green flag of a race joined after its start', () => {
    // Seen first with the race already on, the leader on lap three at a
    // minute a lap. When the leader starts lap four the race is three laps
    // old, not four: counted with the lap just begun, the green flag was
    // put a lap too early and the race clock ran a lap ahead.
    const processor = new SessionTimingProcessor(() => [60, 61]);
    processor.init(session);
    processor.onFrame(frame({ SessionTime: 500, CarIdxLap: [3, 3] }));
    expect(processor.snapshot().greenFlagTimestamp).toBe(0);
    processor.onFrame(frame({ SessionTime: 520, CarIdxLap: [4, 3] }));
    expect(processor.snapshot().greenFlagTimestamp).toBe(520 - 3 * 60);
  });

  describe('a timed race under Le Mans Ultimate', () => {
    // Four hours, green 150 s into the session. The sim counts the race
    // down itself: its time remaining is the race's.
    const GREEN = 150;
    const LENGTH = 4 * 3600;
    const lmuSession = {
      ...session,
      WeekendInfo: { SimMode: 'Le Mans Ultimate' },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session;
    const raceFrame = (
      sessionTime: number,
      overrides: Record<string, unknown> = {}
    ) =>
      frame({
        SessionTime: sessionTime,
        SessionTimeTotal: LENGTH,
        SessionTimeRemain: LENGTH - (sessionTime - GREEN),
        ...overrides,
      });
    /** What the header shows: the length less the time since the flag. */
    const remaining = (processor: SessionTimingProcessor) => {
      const { timeTotal, time, greenFlagTimestamp } = processor.snapshot();
      return timeTotal - (time - greenFlagTimestamp);
    };

    it('has the sim’s own time remaining from its first frame of a race under way', () => {
      // Two hours in, with nothing seen of the start: after a pause used to
      // destroy the processor, or a trip out of the car reset it. The guess
      // it then made put the flag laps back at an assumed lap time, and the
      // overlay's clock ran out many minutes before the race.
      const processor = new SessionTimingProcessor(() => [117, 118]);
      processor.init(lmuSession);
      const now = GREEN + 2 * 3600;
      processor.onFrame(raceFrame(now, { CarIdxLap: [66, 60] }));
      expect(processor.snapshot().greenFlagTimestamp).toBeCloseTo(GREEN, 6);
      expect(remaining(processor)).toBeCloseTo(2 * 3600, 6);

      // And a lap later it is still the sim's figure, not a new guess.
      processor.onFrame(raceFrame(now + 110, { CarIdxLap: [67, 60] }));
      expect(remaining(processor)).toBeCloseTo(2 * 3600 - 110, 6);
    });

    it('follows the sim when the length it is given changes', () => {
      // The bridge knows the race's length only if it saw the green flag;
      // after a restart of the app it gives the end time instead. Either
      // way what is left is what the sim says is left.
      const processor = new SessionTimingProcessor();
      processor.init(lmuSession);
      const now = GREEN + 3600;
      processor.onFrame(raceFrame(now));
      expect(remaining(processor)).toBeCloseTo(3 * 3600, 6);
      processor.onFrame(
        raceFrame(now + 1, { SessionTimeTotal: LENGTH + GREEN })
      );
      expect(remaining(processor)).toBeCloseTo(3 * 3600 - 1, 6);
    });

    it('keeps the flag it had once the time has run out', () => {
      const processor = new SessionTimingProcessor();
      processor.init(lmuSession);
      processor.onFrame(raceFrame(GREEN + LENGTH - 1));
      processor.onFrame(
        raceFrame(GREEN + LENGTH + 30, { SessionTimeRemain: 0 })
      );
      expect(processor.snapshot().greenFlagTimestamp).toBeCloseTo(GREEN, 6);
    });

    it('leaves iRacing to work its green flag out as before', () => {
      const processor = new SessionTimingProcessor(() => [60, 61]);
      processor.init(session);
      processor.onFrame(
        frame({
          SessionTime: 500,
          SessionTimeTotal: LENGTH,
          SessionTimeRemain: LENGTH - 350,
          CarIdxLap: [3, 3],
        })
      );
      // Seen first with the race on: no flag until the leader starts a lap.
      expect(processor.snapshot().greenFlagTimestamp).toBe(0);
    });
  });

  describe('the focus car’s race as a distance', () => {
    // Car 1 is the focus car, car 0 leads. A race on the clock: no lap
    // limit, time remaining as given.
    const timedSession = {
      DriverInfo: { DriverCarIdx: 1, Drivers: [{ CarIdx: 0 }, { CarIdx: 1 }] },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session;
    const timedFrame = (
      remaining: number,
      focus: { completed: number; fraction: number },
      leader: { completed: number; fraction: number },
      overrides: Record<string, unknown> = {}
    ) =>
      frame({
        SessionTimeTotal: 1035,
        SessionTimeRemain: remaining,
        CarIdxLap: [leader.completed + 1, focus.completed + 1],
        CarIdxLapCompleted: [leader.completed, focus.completed],
        CarIdxLapDistPct: [leader.fraction, focus.fraction],
        LapDistPct: focus.fraction,
        ...overrides,
      });
    const projection = (processor: SessionTimingProcessor) => {
      const {
        lapsCompleted,
        lapProgress,
        projectedLaps,
        projectedLapsExact,
        extraLaps,
      } = processor.snapshot();
      return {
        lapsCompleted,
        lapProgress,
        projectedLaps,
        projectedLapsExact,
        extraLaps,
      };
    };

    it('projects a timed race from the car’s own pace, and says it is a projection', () => {
      // 2.721 laps done, 655.4 s left at 86.66 a lap: 7.56 more.
      const processor = new SessionTimingProcessor(() => [76.56, 86.66]);
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          655.4,
          { completed: 2, fraction: 0.721 },
          { completed: 3, fraction: 0.155 }
        )
      );

      // The leader is at 11.72 laps when the clock stops and needs 21.8 s
      // to finish that lap: 8.28 laps to go become 8.54, nine either way.
      expect(projection(processor)).toEqual({
        lapsCompleted: 2,
        lapProgress: 0.72,
        projectedLaps: 10.28,
        projectedLapsExact: false,
        extraLaps: 0,
      });
    });

    it('adds a lap when the leader’s last lap carries the car over the line again', () => {
      // 100 s left at 90 a lap from 0.80 of a lap: 1.91 laps, two to finish.
      // The leader, at 6.625 laps when the clock stops, runs 30 s on: 2.24
      // laps, three to finish.
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          100,
          { completed: 4, fraction: 0.8 },
          { completed: 5, fraction: 0.375 }
        )
      );

      expect(projection(processor)).toMatchObject({
        projectedLaps: 5.91,
        projectedLapsExact: false,
        extraLaps: 1,
      });
    });

    it('takes a lap off for a last stop, only with exactly one stop to go', () => {
      // 100 s left at 90 a lap from 0.95 of a lap: 2.06 laps, three to
      // finish. The leader overruns by under a second, which adds nothing;
      // a 60 s stop leaves 40 s: 1.39 laps, two to finish.
      const frameAtTheEnd = () =>
        timedFrame(
          100,
          { completed: 4, fraction: 0.95 },
          { completed: 5, fraction: 0.74 }
        );
      const withStop = new SessionTimingProcessor(
        () => [80, 90],
        () => ({ stopsToGo: 1, seconds: 60 })
      );
      withStop.init(timedSession);
      withStop.onFrame(frameAtTheEnd());
      expect(withStop.snapshot().extraLaps).toBe(-1);

      const noStop = new SessionTimingProcessor(
        () => [80, 90],
        () => ({ stopsToGo: 0, seconds: 60 })
      );
      noStop.init(timedSession);
      noStop.onFrame(frameAtTheEnd());
      expect(noStop.snapshot().extraLaps).toBe(0);

      // Two stops to go is not a last stop either, and no source is none.
      const twoStops = new SessionTimingProcessor(
        () => [80, 90],
        () => ({ stopsToGo: 2, seconds: 60 })
      );
      twoStops.init(timedSession);
      twoStops.onFrame(frameAtTheEnd());
      expect(twoStops.snapshot().extraLaps).toBe(0);

      const noSource = new SessionTimingProcessor(() => [80, 90]);
      noSource.init(timedSession);
      noSource.onFrame(frameAtTheEnd());
      expect(noSource.snapshot().extraLaps).toBe(0);
    });

    it('adds nothing for the leader, who ends the race himself', () => {
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          100,
          { completed: 4, fraction: 0.8 },
          { completed: 5, fraction: 0.375 },
          // The camera on the leader: he is the focus car.
          { CamCarIdx: 0 }
        )
      );

      expect(projection(processor)).toMatchObject({
        lapsCompleted: 5,
        lapProgress: 0.37,
        projectedLaps: 6.63,
        extraLaps: 0,
      });
    });

    it('adds nothing once the leader has finished, or has no pace', () => {
      const finished = new SessionTimingProcessor(() => [80, 90]);
      finished.init(timedSession);
      finished.onFrame(
        timedFrame(
          100,
          { completed: 4, fraction: 0.8 },
          { completed: 5, fraction: 0.375 },
          { LmuCarIdxFinishStatus: [1, 0] }
        )
      );
      expect(finished.snapshot().extraLaps).toBe(0);

      const leaderUnknown = new SessionTimingProcessor(() => [0, 90]);
      leaderUnknown.init(timedSession);
      leaderUnknown.onFrame(
        timedFrame(
          100,
          { completed: 4, fraction: 0.8 },
          { completed: 5, fraction: 0.375 },
          { CarIdxBestLapTime: [0, 90] }
        )
      );
      expect(leaderUnknown.snapshot()).toMatchObject({
        projectedLaps: 5.91,
        extraLaps: 0,
      });
    });

    it('projects nothing without a pace, and still says where the car is', () => {
      // No lap times, no class estimate, no best lap.
      const processor = new SessionTimingProcessor();
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          655.4,
          { completed: 0, fraction: 0.4 },
          { completed: 0, fraction: 0.6 },
          { CarIdxBestLapTime: [0, 0] }
        )
      );

      expect(projection(processor)).toEqual({
        lapsCompleted: 0,
        lapProgress: 0.4,
        projectedLaps: 0,
        projectedLapsExact: false,
        extraLaps: 0,
      });
    });

    it('falls back to the car’s best lap for a pace', () => {
      const processor = new SessionTimingProcessor();
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          180,
          { completed: 1, fraction: 0.5 },
          { completed: 1, fraction: 0.6 },
          { CarIdxBestLapTime: [88, 90] }
        )
      );

      expect(processor.snapshot().projectedLaps).toBe(3.5);
    });

    it('ends a lap race on its scheduled lap, less the laps the car is down', () => {
      const lapRace = {
        ...timedSession,
        SessionInfo: {
          Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionLaps: 25 }],
        },
      } as unknown as Session;
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(lapRace);
      // The leader is 1.25 laps up the road.
      processor.onFrame(
        frame({
          CarIdxLap: [5, 4],
          CarIdxLapCompleted: [4, 3],
          CarIdxLapDistPct: [0.5, 0.25],
        })
      );

      expect(projection(processor)).toEqual({
        lapsCompleted: 3,
        lapProgress: 0.25,
        projectedLaps: 24,
        projectedLapsExact: true,
        extraLaps: 0,
      });
    });

    it('ends on the lap limit when a race with both limits will reach it first', () => {
      const bothLimits = {
        ...timedSession,
        SessionInfo: {
          Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionLaps: 8 }],
        },
      } as unknown as Session;
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(bothLimits);
      processor.onFrame(
        timedFrame(
          655.4,
          { completed: 2, fraction: 0.721 },
          { completed: 3, fraction: 0.155 }
        )
      );

      // The clock would allow 10.28 laps; the race is eight.
      expect(projection(processor)).toMatchObject({
        projectedLaps: 8,
        projectedLapsExact: false,
        extraLaps: 0,
      });
    });

    it('is the laps completed once the flag is out', () => {
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          0,
          { completed: 11, fraction: 0.1 },
          { completed: 12, fraction: 0.3 },
          { SessionState: SessionState.Checkered }
        )
      );

      expect(projection(processor)).toEqual({
        lapsCompleted: 11,
        lapProgress: 0.1,
        projectedLaps: 11,
        projectedLapsExact: true,
        extraLaps: 0,
      });
    });

    it('projects nothing before the green flag and outside a race', () => {
      const beforeGreen = new SessionTimingProcessor(() => [80, 90]);
      beforeGreen.init(timedSession);
      beforeGreen.onFrame(
        timedFrame(
          1035,
          { completed: 0, fraction: 0.97 },
          { completed: 0, fraction: 0.99 },
          { SessionState: SessionState.ParadeLaps }
        )
      );
      expect(projection(beforeGreen)).toMatchObject({
        lapProgress: 0.97,
        projectedLaps: 0,
        extraLaps: 0,
      });

      const practice = new SessionTimingProcessor(() => [80, 90]);
      practice.init({
        ...timedSession,
        SessionInfo: {
          Sessions: [{ SessionNum: 0, SessionType: 'Practice' }],
        },
      } as unknown as Session);
      practice.onFrame(
        timedFrame(
          900,
          { completed: 3, fraction: 0.5 },
          { completed: 6, fraction: 0.2 }
        )
      );
      // The laps done are the car's own in any session.
      expect(projection(practice)).toEqual({
        lapsCompleted: 3,
        lapProgress: 0.5,
        projectedLaps: 0,
        projectedLapsExact: false,
        extraLaps: 0,
      });
    });

    it('never prints a full lap before the line', () => {
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(timedSession);
      processor.onFrame(
        timedFrame(
          500,
          { completed: 2, fraction: 0.9996 },
          { completed: 3, fraction: 0.2 }
        )
      );

      expect(processor.snapshot().lapProgress).toBe(0.99);
    });

    it('goes back to nothing on a new session and on a clock that runs backwards', () => {
      const none = {
        lapsCompleted: 0,
        lapProgress: 0,
        projectedLaps: 0,
        projectedLapsExact: false,
        extraLaps: 0,
      };
      const racing = () =>
        timedFrame(
          100,
          { completed: 4, fraction: 0.8 },
          { completed: 5, fraction: 0.375 }
        );
      const processor = new SessionTimingProcessor(() => [80, 90]);
      processor.init(timedSession);
      processor.onFrame(racing());
      expect(processor.snapshot().extraLaps).toBe(1);

      processor.onLifecycle({ type: 'sessionNumChange' });
      expect(projection(processor)).toEqual(none);

      processor.onFrame(racing());
      expect(processor.snapshot().projectedLaps).toBe(5.91);
      processor.onLifecycle({ type: 'disconnect' });
      expect(projection(processor)).toEqual(none);

      // The race restarted: the clock is back before the green flag, the
      // cars on the grid. Nothing of the first start is left.
      processor.onFrame(racing());
      processor.onFrame(
        timedFrame(
          1035,
          { completed: 0, fraction: 0 },
          { completed: 0, fraction: 0 },
          { SessionTime: 5, SessionState: SessionState.GetInCar }
        )
      );
      expect(projection(processor)).toEqual(none);
    });
  });

  it('resets on session changes and ignores replay scrubbing', () => {
    const processor = new SessionTimingProcessor();
    processor.init(session);
    processor.onFrame(frame());
    processor.onLifecycle({ type: 'sessionNumChange' });
    expect(processor.snapshot()).toMatchObject({
      sessionNum: null,
      currentLap: 0,
    });
    processor.onLifecycle({ type: 'enter', replay: true });
    processor.onFrame(frame({ SessionTime: 30 }));
    expect(processor.snapshot().currentLap).toBe(0);
  });
});
