import { describe, expect, it } from 'vitest';
import { lapTimeTone } from './lapTimeTone';

describe('lapTimeTone', () => {
  it('is the session best when the lap equals it', () => {
    expect(
      lapTimeTone({
        time: 104.054,
        sessionBest: 104.054,
        personalBest: 104.054,
      })
    ).toBe('sessionBest');
  });

  it('is a personal best when someone else holds the session best', () => {
    expect(
      lapTimeTone({ time: 104.054, sessionBest: 103.9, personalBest: 104.054 })
    ).toBe('personalBest');
  });

  it('is slower when it matches neither', () => {
    expect(
      lapTimeTone({ time: 105.0, sessionBest: 103.9, personalBest: 104.054 })
    ).toBe('slower');
  });

  it('is invalid whenever the lap did not count, whatever its time', () => {
    expect(
      lapTimeTone({
        time: 104.054,
        invalid: true,
        sessionBest: 104.054,
        personalBest: 104.054,
      })
    ).toBe('invalid');
    expect(lapTimeTone({ time: 131.2, invalid: true })).toBe('invalid');
  });

  it('has no tone without a time', () => {
    expect(lapTimeTone({ time: null, sessionBest: 103.9 })).toBe('none');
    expect(lapTimeTone({ time: 0, personalBest: 104.054 })).toBe('none');
    // LMU's "no time" is -1.
    expect(lapTimeTone({ time: -1, invalid: true })).toBe('none');
  });

  it('treats times within a thousandth as the same lap', () => {
    expect(lapTimeTone({ time: 104.0544, sessionBest: 104.054 })).toBe(
      'sessionBest'
    );
    expect(lapTimeTone({ time: 104.056, sessionBest: 104.054 })).toBe('slower');
  });

  it('does not call a quicker time the best when it is another lap', () => {
    // An all-time best from an earlier day, under everything driven today.
    expect(
      lapTimeTone({ time: 103.7, sessionBest: 103.9, personalBest: 104.054 })
    ).toBe('slower');
  });

  it('ignores a best that does not exist yet', () => {
    expect(
      lapTimeTone({ time: 104.054, sessionBest: null, personalBest: 0 })
    ).toBe('slower');
    expect(lapTimeTone({ time: 104.054 })).toBe('slower');
  });
});
