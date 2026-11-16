import { describe, expect, it } from 'vitest';
import {
  carPlace,
  flagPill,
  formatTimeLeft,
  sessionLabel,
} from './pitWallHeaderFormat';

describe('formatTimeLeft', () => {
  it.each([
    [12416, '3:26:56'],
    [3600, '1:00:00'],
    [3599.9, '59:59'],
    [1616, '26:56'],
    [65, '1:05'],
    [9, '0:09'],
    [0, '0:00'],
    [86400, '24:00:00'],
  ])('writes %s seconds as %s', (seconds, expected) => {
    expect(formatTimeLeft(seconds)).toBe(expected);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'has nothing to show for %s',
    (seconds) => {
      expect(formatTimeLeft(seconds)).toBe('--');
    }
  );
});

describe('sessionLabel', () => {
  it('names the session once when its name is its type', () => {
    expect(
      sessionLabel({
        sessionName: 'RACE',
        sessionType: 'Race',
        trackName: 'Circuit de la Sarthe',
      })
    ).toBe('Race · Circuit de la Sarthe');
  });

  it('adds the type to a name that does not say it', () => {
    expect(sessionLabel({ sessionName: 'FEATURE', sessionType: 'Race' })).toBe(
      'Feature, Race'
    );
    expect(sessionLabel({ sessionName: 'Heat 1', sessionType: 'Race' })).toBe(
      'Heat 1, Race'
    );
  });

  it('keeps a name that already holds the type', () => {
    expect(
      sessionLabel({ sessionName: 'Lone Qualify', sessionType: 'Qualify' })
    ).toBe('Lone Qualify');
  });

  it('falls back to whichever it has', () => {
    expect(sessionLabel({ sessionType: 'Practice' })).toBe('Practice');
    expect(sessionLabel({ sessionName: 'WARMUP' })).toBe('Warmup');
    expect(sessionLabel({ trackName: 'Sebring' })).toBe('Sebring');
    expect(sessionLabel({ sessionName: ' ', trackName: ' ' })).toBe('');
    expect(sessionLabel({})).toBe('');
  });
});

describe('carPlace', () => {
  const place = {
    classified: true,
    classPosition: 4,
    classSize: 14,
    overallPosition: 12,
    className: 'LMGT3',
  };

  it('writes the place in class and overall', () => {
    expect(carPlace(place)).toEqual({
      position: 'P4',
      field: 'of 14 in LMGT3',
      overall: 'P12 overall',
    });
  });

  it('leaves the class name out when the session has none', () => {
    expect(carPlace({ ...place, className: undefined })).toMatchObject({
      field: 'of 14',
    });
  });

  it('shows a placeholder, not a place of nothing, for an unranked car', () => {
    expect(carPlace({ ...place, classified: false })).toEqual({
      position: '--',
      field: 'LMGT3',
      overall: '',
    });
    expect(
      carPlace({ ...place, classPosition: 0, overallPosition: 0 })
    ).toEqual({ position: '--', field: 'LMGT3', overall: '' });
    expect(
      carPlace({
        classified: false,
        classPosition: 0,
        classSize: 0,
        overallPosition: 0,
      })
    ).toEqual({ position: '--', field: '', overall: '' });
  });

  it('keeps the place when only the size of the class is unknown', () => {
    expect(carPlace({ ...place, classSize: 0 })).toEqual({
      position: 'P4',
      field: 'LMGT3',
      overall: 'P12 overall',
    });
  });

  it('does not print a number that is not one', () => {
    expect(
      carPlace({ ...place, classPosition: Number.NaN, classSize: Number.NaN })
    ).toMatchObject({ position: '--' });
  });
});

describe('flagPill', () => {
  it('has no pill without a flag', () => {
    expect(flagPill(undefined, undefined)).toBeNull();
    expect(flagPill('none', 'noSession')).toBeNull();
  });

  it('drops the word FLAG where the colour says it', () => {
    expect(flagPill('green', 'trackClear')).toEqual({
      label: 'GREEN',
      tone: 'green',
    });
    expect(flagPill('yellow', 'yellowAhead')).toEqual({
      label: 'YELLOW',
      tone: 'yellow',
    });
    expect(flagPill('blue', 'blueLapping')).toEqual({
      label: 'BLUE',
      tone: 'blue',
    });
    expect(flagPill('red', 'sessionStopped')).toEqual({
      label: 'RED',
      tone: 'red',
    });
    expect(flagPill('chequered', 'finished')).toEqual({
      label: 'CHEQUERED',
      tone: 'white',
    });
  });

  it('keeps the names that are not colours', () => {
    expect(flagPill('fullCourseYellow', 'fcy')).toEqual({
      label: 'FULL COURSE YELLOW',
      tone: 'yellow',
    });
    expect(flagPill('fullCourseYellow', 'fcy', true)).toEqual({
      label: 'CAUTION',
      tone: 'yellow',
    });
    expect(flagPill('white', 'lastLap')).toEqual({
      label: 'LAST LAP',
      tone: 'white',
    });
    expect(flagPill('penalty', 'driveThrough')).toEqual({
      label: 'DRIVE-THROUGH',
      tone: 'neutral',
    });
    expect(flagPill('penalty', 'blackFlag')).toEqual({
      label: 'BLACK',
      tone: 'neutral',
    });
    expect(flagPill('start', 'formationLap')).toEqual({
      label: 'FORMATION LAP',
      tone: 'neutral',
    });
    expect(flagPill('meatball', 'repairRequired')).toEqual({
      label: 'MEATBALL',
      tone: 'orange',
    });
  });

  it('names a flag whose detail it was not given', () => {
    expect(flagPill('green', undefined)).toEqual({
      label: 'GREEN',
      tone: 'green',
    });
  });
});
