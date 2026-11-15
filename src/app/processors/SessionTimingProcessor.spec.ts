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
