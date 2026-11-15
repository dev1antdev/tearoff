import { describe, expect, it } from 'vitest';
import type { BrakingSnapshot, BrakingZone } from '@irdashies/types';
import {
  NO_READING,
  bestFor,
  formatDelta,
  formatDistance,
  formatG,
  formatSeconds,
  formatSpeed,
  lockTone,
  zoneAgainstBest,
} from './brakePerformanceDisplay';

const zone = (extra: Partial<BrakingZone> = {}): BrakingZone => ({
  peakG: 2.39,
  averageG: 1.48,
  distanceM: 81,
  durationS: 1.88,
  entrySpeed: 59.5,
  exitSpeed: 32.3,
  absS: 0.5,
  deltaG: 0.1,
  endedAt: 267.69,
  ...extra,
});

const snapshot = (extra: Partial<BrakingSnapshot> = {}): BrakingSnapshot => ({
  available: true,
  live: null,
  last: zone(),
  referenceG: 2.39,
  sessionBestG: 2.5,
  zoneCount: 15,
  lockS: [0, 0],
  sessionNum: 0,
  version: 1,
  ...extra,
});

describe('formatting', () => {
  it('prints a deceleration to two decimals', () => {
    expect(formatG(2.39)).toBe('2.39');
    expect(formatG(2)).toBe('2.00');
    expect(formatG(undefined)).toBe(NO_READING);
    expect(formatG(null)).toBe(NO_READING);
  });

  it('prints a time to the decimals asked for', () => {
    expect(formatSeconds(1.88, 2)).toBe('1.88');
    expect(formatSeconds(0.9, 1)).toBe('0.9');
    expect(formatSeconds(undefined, 1)).toBe(NO_READING);
  });

  it('prints a speed as a whole number of the unit', () => {
    // 59.5 m/s is 214 km/h and 133 mph.
    expect(formatSpeed(59.5, 'km/h')).toBe('214');
    expect(formatSpeed(59.5, 'mph')).toBe('133');
    expect(formatSpeed(undefined, 'km/h')).toBe(NO_READING);
  });

  it('prints a distance as a whole number of the unit', () => {
    expect(formatDistance(81, 'm')).toBe('81');
    expect(formatDistance(81, 'ft')).toBe('266');
    expect(formatDistance(null, 'm')).toBe(NO_READING);
  });
});

describe('bestFor', () => {
  it('is the rolling best or the best of the session', () => {
    expect(bestFor(snapshot(), 'rolling')).toBe(2.39);
    expect(bestFor(snapshot(), 'session')).toBe(2.5);
  });
});

describe('zoneAgainstBest', () => {
  it('reads the rolling comparison off the zone itself', () => {
    // The zone was 0.10 g up on a best of 2.29 g, which it has since
    // replaced in the snapshot.
    expect(zoneAgainstBest(zone(), snapshot(), 'rolling')).toEqual({
      deltaG: 0.1,
      bestG: 2.29,
    });
  });

  it('has no rolling best for the first zone of a stint', () => {
    const first = zone({ peakG: 1.6, deltaG: 1.6 });

    expect(
      zoneAgainstBest(first, snapshot({ referenceG: 1.6 }), 'rolling')
    ).toEqual({ deltaG: 1.6, bestG: 0 });
  });

  it('measures against the best of the session', () => {
    expect(zoneAgainstBest(zone(), snapshot(), 'session')).toEqual({
      deltaG: -0.11,
      bestG: 2.5,
    });
  });

  it('reads zero for the zone that set the session best', () => {
    expect(
      zoneAgainstBest(zone(), snapshot({ sessionBestG: 2.39 }), 'session')
    ).toEqual({ deltaG: 0, bestG: 2.39 });
  });
});

describe('formatDelta', () => {
  it('prints a share of the best', () => {
    expect(formatDelta(0.1, 2.29, 'percent')).toEqual({
      text: '+4%',
      tone: 'gained',
    });
    expect(formatDelta(-0.53, 2.29, 'percent')).toEqual({
      text: '-23%',
      tone: 'lost',
    });
  });

  it('prints the difference in g', () => {
    expect(formatDelta(0.09, 2.3, 'g')).toEqual({
      text: '+0.09 g',
      tone: 'gained',
    });
    expect(formatDelta(-0.1, 2.3, 'g')).toEqual({
      text: '-0.10 g',
      tone: 'lost',
    });
  });

  it('has no colour for a difference that prints as zero', () => {
    expect(formatDelta(0, 2.39, 'percent')).toEqual({
      text: '0%',
      tone: 'level',
    });
    // A hundredth of a g on 2.39 is less than half a percent.
    expect(formatDelta(0.01, 2.39, 'percent')).toEqual({
      text: '0%',
      tone: 'level',
    });
    expect(formatDelta(-0.01, 2.39, 'percent')).toEqual({
      text: '0%',
      tone: 'level',
    });
    expect(formatDelta(0, 2.39, 'g')).toEqual({
      text: '0.00 g',
      tone: 'level',
    });
  });

  it('prints no share when there was nothing to measure against', () => {
    expect(formatDelta(1.6, 0, 'percent')).toEqual({
      text: NO_READING,
      tone: 'level',
    });
  });

  it('prints the whole peak in g, uncoloured, with nothing to measure against', () => {
    expect(formatDelta(1.6, 0, 'g')).toEqual({
      text: '+1.60 g',
      tone: 'level',
    });
  });
});

describe('lockTone', () => {
  it('has no colour at zero', () => {
    expect(lockTone(0)).toBe('none');
    expect(lockTone(undefined)).toBe('none');
    expect(lockTone(null)).toBe('none');
  });

  it('is amber above zero and red from a second', () => {
    expect(lockTone(0.1)).toBe('some');
    expect(lockTone(0.9)).toBe('some');
    expect(lockTone(1)).toBe('long');
    expect(lockTone(3.4)).toBe('long');
  });
});
