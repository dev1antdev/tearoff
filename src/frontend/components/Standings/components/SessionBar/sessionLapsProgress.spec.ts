import { describe, expect, it } from 'vitest';
import { SessionState } from '@irdashies/types';
import {
  sessionLapsProgressDisplay,
  type SessionLapsProgressInput,
} from './sessionLapsProgress';

const race = (
  overrides: Partial<SessionLapsProgressInput> = {}
): SessionLapsProgressInput => ({
  sessionType: 'Race',
  state: SessionState.Racing,
  isFixedLapRace: false,
  lapsCompleted: 2,
  lapProgress: 0.72,
  projectedLaps: 10.28,
  projectedLapsExact: false,
  extraLaps: 0,
  timeIsUp: false,
  ...overrides,
});

/** The item as it reads on the bar. */
const text = (
  input: SessionLapsProgressInput,
  showExtraLaps = true
): string => {
  const { done, total, extra } = sessionLapsProgressDisplay(
    input,
    showExtraLaps
  );
  return [done, total === undefined ? undefined : `/ ${total}`, extra]
    .filter((part) => part !== undefined)
    .join(' ');
};

describe('sessionLapsProgressDisplay', () => {
  it('prints a scheduled distance as a whole number', () => {
    expect(
      text(
        race({
          isFixedLapRace: true,
          lapsCompleted: 12,
          lapProgress: 0.4,
          projectedLaps: 25,
          projectedLapsExact: true,
        })
      )
    ).toBe('12.40 / 25');
  });

  it('prints a projection as about, with the laps the flag adds', () => {
    expect(text(race({ extraLaps: 1 }))).toBe('2.72 / ~10.3 +1');
    expect(text(race({ extraLaps: -1 }))).toBe('2.72 / ~10.3 -1');
    expect(text(race())).toBe('2.72 / ~10.3');
  });

  it('leaves the extra laps out when switched off', () => {
    expect(text(race({ extraLaps: 1 }), false)).toBe('2.72 / ~10.3');
  });

  it('prints the laps done alone until there is a pace to project from', () => {
    expect(text(race({ projectedLaps: 0 }))).toBe('2.72');
  });

  it('prints the laps done alone outside a race', () => {
    expect(
      text(
        race({ sessionType: 'Practice', projectedLaps: 0, lapsCompleted: 7 })
      )
    ).toBe('7.72');
    // Whatever a stale projection says.
    expect(text(race({ sessionType: 'Open Qualify' }))).toBe('2.72');
  });

  it('prints the laps completed, whole, once the flag is out', () => {
    expect(
      text(
        race({
          state: SessionState.Checkered,
          lapsCompleted: 11,
          lapProgress: 0.31,
          projectedLaps: 11,
          projectedLapsExact: true,
        })
      )
    ).toBe('11');
  });

  describe('the last lap', () => {
    it('is the scheduled lap of a lap race', () => {
      const lapRace = (lapsCompleted: number) =>
        sessionLapsProgressDisplay(
          race({
            isFixedLapRace: true,
            lapsCompleted,
            projectedLaps: 25,
            projectedLapsExact: true,
          })
        ).finalLap;

      expect(lapRace(23)).toBe(false);
      expect(lapRace(24)).toBe(true);
    });

    it('counts the laps the car is down: 24 of a 25-lap race', () => {
      expect(
        sessionLapsProgressDisplay(
          race({
            isFixedLapRace: true,
            lapsCompleted: 23,
            projectedLaps: 24,
            projectedLapsExact: true,
          })
        ).finalLap
      ).toBe(true);
    });

    it('is the lap the clock runs out on in a timed race', () => {
      expect(sessionLapsProgressDisplay(race()).finalLap).toBe(false);
      expect(
        sessionLapsProgressDisplay(
          race({ timeIsUp: true, projectedLaps: 9.4, lapsCompleted: 9 })
        ).finalLap
      ).toBe(true);
    });

    it('is never before the green flag or after the chequered', () => {
      expect(
        sessionLapsProgressDisplay(
          race({ state: SessionState.ParadeLaps, timeIsUp: true })
        ).finalLap
      ).toBe(false);
      expect(
        sessionLapsProgressDisplay(
          race({ state: SessionState.Checkered, timeIsUp: true })
        ).finalLap
      ).toBe(false);
    });
  });
});
