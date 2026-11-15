import { describe, expect, it } from 'vitest';
import { TIMED_SESSION_LAPS } from '@irdashies/types';
import { sessionLapLimit } from './sessionLapLimit';

describe('sessionLapLimit', () => {
  it('reads a lap count however the session wrote it', () => {
    expect(sessionLapLimit(20)).toBe(20);
    expect(sessionLapLimit('20')).toBe(20);
    expect(sessionLapLimit('20 laps')).toBe(20);
  });

  it.each([
    ['iRacing in the session', 'unlimited'],
    ['iRacing in telemetry', TIMED_SESSION_LAPS],
    ['rFactor 2', 2147483647],
    ['rFactor 2 as text', '2147483647'],
    ['a number that is not one', Number.NaN],
    ['an endless one', Number.POSITIVE_INFINITY],
    ['none', 0],
    ['a negative one', -1],
    ['nothing', undefined],
    ['null', null],
  ])('has no limit for a timed session: %s', (_producer, sessionLaps) => {
    expect(sessionLapLimit(sessionLaps)).toBe(0);
  });

  it('takes the longest race there could be as a lap count', () => {
    expect(sessionLapLimit(TIMED_SESSION_LAPS - 1)).toBe(
      TIMED_SESSION_LAPS - 1
    );
  });
});
