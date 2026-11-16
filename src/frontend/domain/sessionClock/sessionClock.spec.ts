import { describe, expect, it } from 'vitest';
import { SessionState } from '@irdashies/types';
import { sessionClock, type SessionClockInput } from './sessionClock';

const timing = (overrides: Partial<SessionClockInput>): SessionClockInput => ({
  sessionType: 'Race',
  time: 0,
  timeRemaining: 0,
  timeTotal: 0,
  state: SessionState.Racing,
  greenFlagTimestamp: 0,
  isFixedLapRace: false,
  totalRaceTime: 0,
  adjustedRaceTime: 0,
  ...overrides,
});

describe('sessionClock', () => {
  it.each(['Practice', 'Open Qualify', 'Lone Qualify', undefined])(
    'takes the sim’s own figures outside a race (%s)',
    (sessionType) => {
      expect(
        sessionClock(
          timing({
            sessionType,
            time: 600,
            timeRemaining: 1200,
            timeTotal: 1800,
            // Ignored outside a race.
            greenFlagTimestamp: 100,
          })
        )
      ).toEqual({ elapsed: 600, remaining: 1200, total: 1800 });
    }
  );

  it('counts down to the grid while drivers get in their cars', () => {
    expect(
      sessionClock(
        timing({ state: SessionState.GetInCar, time: 30, timeRemaining: 90 })
      )
    ).toEqual({ elapsed: 30, remaining: 90, total: 120 });
  });

  it.each([SessionState.Warmup, SessionState.ParadeLaps])(
    'holds a timed race’s clock until the green flag (state %s)',
    (state) => {
      expect(
        sessionClock(
          timing({ state, time: 95, timeRemaining: 28800, timeTotal: 28800 })
        )
      ).toEqual({ elapsed: 0, remaining: 28800, total: 28800 });
    }
  );

  it('holds the estimate of a race over laps until the green flag', () => {
    expect(
      sessionClock(
        timing({
          state: SessionState.ParadeLaps,
          isFixedLapRace: true,
          adjustedRaceTime: 2400,
          timeRemaining: 604800,
          timeTotal: 604800,
        })
      )
    ).toEqual({ elapsed: 0, remaining: 2400, total: 2400 });
  });

  it.each([SessionState.Racing, SessionState.Checkered])(
    'counts a timed race from the green flag (state %s)',
    (state) => {
      expect(
        sessionClock(
          timing({
            state,
            time: 16524,
            greenFlagTimestamp: 140,
            timeTotal: 28800,
            // Runs from the start of the session, not from the green.
            timeRemaining: 12276,
          })
        )
      ).toEqual({ elapsed: 16384, remaining: 12416, total: 28800 });
    }
  );

  it('counts a race over laps against its estimated length', () => {
    expect(
      sessionClock(
        timing({
          time: 1000,
          greenFlagTimestamp: 100,
          isFixedLapRace: true,
          totalRaceTime: 2500,
          adjustedRaceTime: 2600,
        })
      )
    ).toEqual({ elapsed: 900, remaining: 1600, total: 2500 });
  });

  it('has nothing left of a timed race on the cool-down lap', () => {
    expect(
      sessionClock(
        timing({
          state: SessionState.CoolDown,
          time: 29000,
          greenFlagTimestamp: 140,
          timeTotal: 28800,
        })
      )
    ).toEqual({ elapsed: 28860, remaining: 0, total: 28800 });
  });

  it('measures a finished race over laps against its adjusted length', () => {
    expect(
      sessionClock(
        timing({
          state: SessionState.CoolDown,
          time: 2700,
          greenFlagTimestamp: 100,
          isFixedLapRace: true,
          totalRaceTime: 2500,
          adjustedRaceTime: 2600,
        })
      )
    ).toEqual({ elapsed: 2600, remaining: 0, total: 2600 });
  });

  it('shows nothing for a race state it does not know', () => {
    expect(
      sessionClock(
        timing({ state: SessionState.Invalid, time: 50, timeRemaining: 60 })
      )
    ).toEqual({ elapsed: 0, remaining: 0, total: 0 });
  });
});
