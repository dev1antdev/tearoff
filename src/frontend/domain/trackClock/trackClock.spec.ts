import { describe, expect, it } from 'vitest';
import {
  formatSunCountdown,
  formatTrackClock,
  nextSunPhase,
  sunPhaseTimes,
  sunTimeFieldMinutes,
  sunTimeFieldValue,
  timeScaleLabel,
} from './trackClock';

const at = (hours: number, minutes = 0, seconds = 0) =>
  hours * 3600 + minutes * 60 + seconds;

describe('formatTrackClock', () => {
  it('writes the recorded race clock on both clocks', () => {
    // The first frame of the curated Le Mans Ultimate recording.
    expect(formatTrackClock(54_739.8, '24h')).toBe('15:12');
    expect(formatTrackClock(54_739.8, '12h')).toBe('3:12 PM');
  });

  it.each([
    [0, '00:00', '12:00 AM'],
    [at(0, 5), '00:05', '12:05 AM'],
    [at(9, 7, 59), '09:07', '9:07 AM'],
    [at(12), '12:00', '12:00 PM'],
    [at(12, 30), '12:30', '12:30 PM'],
    [at(23, 59, 59.9), '23:59', '11:59 PM'],
    // A clock a sim lets run past the day wraps.
    [at(24, 1), '00:01', '12:01 AM'],
  ])('writes %s s as %s and %s', (seconds, twentyFour, twelve) => {
    expect(formatTrackClock(seconds, '24h')).toBe(twentyFour);
    expect(formatTrackClock(seconds, '12h')).toBe(twelve);
  });

  it('follows the system for the locale format, as before', () => {
    const expected = new Date(2026, 0, 1, 15, 12).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatTrackClock(54_739.8, 'locale')).toBe(expected);
    expect(formatTrackClock(54_739.8)).toBe(expected);
  });

  it.each([[undefined], [null], [Number.NaN], [-1]])(
    'writes nothing for %s',
    (seconds) => {
      expect(formatTrackClock(seconds, '24h')).toBe('');
      expect(formatTrackClock(seconds, 'locale')).toBe('');
    }
  );
});

describe('timeScaleLabel', () => {
  it('shows a scaled day by default and leaves real time out', () => {
    expect(timeScaleLabel(2)).toEqual({ text: 'x2', scaled: true });
    expect(timeScaleLabel(60, 'whenScaled')).toEqual({
      text: 'x60',
      scaled: true,
    });
    expect(timeScaleLabel(1, 'whenScaled')).toBeNull();
  });

  it('marks a time of day that stands still', () => {
    expect(timeScaleLabel(0)).toEqual({ text: 'x0', scaled: true });
  });

  it('shows real time too when always asked for', () => {
    expect(timeScaleLabel(1, 'always')).toEqual({ text: 'x1', scaled: false });
    expect(timeScaleLabel(4, 'always')).toEqual({ text: 'x4', scaled: true });
  });

  it('shows nothing when switched off or not yet measured', () => {
    expect(timeScaleLabel(2, 'never')).toBeNull();
    expect(timeScaleLabel(undefined, 'always')).toBeNull();
    expect(timeScaleLabel(null, 'always')).toBeNull();
  });
});

describe('sunPhaseTimes', () => {
  it('puts midday and midnight halfway round the clock', () => {
    expect(sunPhaseTimes(6 * 60, 20 * 60)).toEqual({
      sunrise: at(6),
      midday: at(13),
      sunset: at(20),
      midnight: at(1),
    });
  });

  it('copes with a night that does not cross midnight', () => {
    // Sunrise 12:00, sunset 02:00 on some other clock: the day is 14 hours.
    expect(sunPhaseTimes(12 * 60, 2 * 60)).toEqual({
      sunrise: at(12),
      midday: at(19),
      sunset: at(2),
      midnight: at(7),
    });
  });
});

describe('nextSunPhase', () => {
  const track = { sunriseMinutes: 6 * 60, sunsetMinutes: 20 * 60 };

  it('counts down to sunset in the afternoon, in real time', () => {
    expect(
      nextSunPhase({ ...track, timeOfDay: at(15, 12, 20), timeScale: 1 })
    ).toEqual({ phase: 'sunset', seconds: at(4, 47, 40) });
  });

  it('halves the wait when the day runs twice as fast', () => {
    const next = nextSunPhase({
      ...track,
      timeOfDay: at(15, 12, 20),
      timeScale: 2,
    });
    expect(next).toEqual({ phase: 'sunset', seconds: at(2, 23, 50) });
    expect(formatSunCountdown(next?.seconds ?? 0)).toBe('2:23:50');
  });

  it('counts in in-game time when asked, whatever the scale', () => {
    expect(
      nextSunPhase({
        ...track,
        timeOfDay: at(15, 12, 20),
        timeScale: 2,
        inGameTime: true,
      })
    ).toEqual({ phase: 'sunset', seconds: at(4, 47, 40) });
    expect(
      nextSunPhase({
        ...track,
        timeOfDay: at(15, 12, 20),
        timeScale: undefined,
        inGameTime: true,
      })
    ).toEqual({ phase: 'sunset', seconds: at(4, 47, 40) });
  });

  it('wraps to tomorrow: midnight is next at half past eleven', () => {
    expect(
      nextSunPhase({ ...track, timeOfDay: at(23, 30), timeScale: 1 })
    ).toEqual({ phase: 'midnight', seconds: at(1, 30) });
  });

  it.each([
    [at(1, 0, 1), 'sunrise'],
    [at(6), 'midday'],
    [at(13), 'sunset'],
    [at(20), 'midnight'],
  ] as const)('at %s s the next is %s', (timeOfDay, phase) => {
    expect(nextSunPhase({ ...track, timeOfDay, timeScale: 1 })?.phase).toBe(
      phase
    );
  });

  it('has no countdown without the track’s own times', () => {
    expect(
      nextSunPhase({
        timeOfDay: at(15),
        timeScale: 1,
        sunriseMinutes: undefined,
        sunsetMinutes: 20 * 60,
      })
    ).toBeNull();
    expect(
      nextSunPhase({
        timeOfDay: at(15),
        timeScale: 1,
        sunriseMinutes: 6 * 60,
        sunsetMinutes: null,
      })
    ).toBeNull();
  });

  it('has no real-time countdown while the day stands still or is unmeasured', () => {
    expect(
      nextSunPhase({ ...track, timeOfDay: at(15), timeScale: 0 })
    ).toBeNull();
    expect(
      nextSunPhase({ ...track, timeOfDay: at(15), timeScale: undefined })
    ).toBeNull();
    expect(
      nextSunPhase({ ...track, timeOfDay: undefined, timeScale: 1 })
    ).toBeNull();
  });
});

describe('a sunrise or a sunset in a time field', () => {
  it.each([
    [0, '00:00'],
    [6 * 60 + 12, '06:12'],
    [20 * 60, '20:00'],
    [1439, '23:59'],
  ])('writes %s minutes as %s and reads it back', (minutes, text) => {
    expect(sunTimeFieldValue(minutes)).toBe(text);
    expect(sunTimeFieldMinutes(text)).toBe(minutes);
  });

  it.each([[undefined], [null], [-1], [1440], [6.5], [Number.NaN]])(
    'leaves the field empty for %s',
    (minutes) => {
      expect(sunTimeFieldValue(minutes)).toBe('');
    }
  );

  it('reads a field with seconds in it to the minute', () => {
    expect(sunTimeFieldMinutes('06:12:30')).toBe(6 * 60 + 12);
  });

  it.each([[''], ['6'], ['06:'], ['24:00'], ['12:60'], ['noon']])(
    'reads %j as no time',
    (text) => {
      expect(sunTimeFieldMinutes(text)).toBeNull();
    }
  );
});

describe('formatSunCountdown', () => {
  it.each([
    [at(4, 47, 40), '4:47:40'],
    [at(1, 30), '1:30:00'],
    [59.9, '0:00:59'],
    [at(12, 5, 9), '12:05:09'],
    [-3, '0:00:00'],
  ])('writes %s s as %s', (seconds, text) => {
    expect(formatSunCountdown(seconds)).toBe(text);
  });
});
