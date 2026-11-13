import { describe, expect, it } from 'vitest';
import type { LapLibraryLap, LapLibrarySession } from '@irdashies/types';
import {
  formatConsumption,
  formatGap,
  formatLapTime,
  lapCountLabel,
  lapFlags,
  simulatorLabel,
  trackLabel,
} from './lapLibraryDisplay';

const lap = (overrides: Partial<LapLibraryLap> = {}): LapLibraryLap => ({
  id: 1,
  sessionId: 1,
  lapNumber: 3,
  lapTime: 90,
  completedAt: 0,
  complete: true,
  pit: false,
  voided: false,
  own: true,
  incidents: 0,
  eligible: true,
  fuelUsed: null,
  energyUsed: null,
  airTemp: null,
  trackTemp: null,
  isReference: false,
  isPinned: false,
  ...overrides,
});

const session = (
  overrides: Partial<LapLibrarySession> = {}
): LapLibrarySession => ({
  id: 1,
  simulator: 'iracing',
  startedAt: 0,
  trackId: 18,
  trackName: 'Road America',
  trackConfig: null,
  trackLengthM: 6413,
  carKey: 'bmwm4gt3',
  carName: 'BMW M4 GT3',
  sessionType: 'Race',
  sessionName: 'RACE',
  lapCount: 3,
  bestLapTime: 129.284,
  ...overrides,
});

describe('simulatorLabel', () => {
  it('names the sims as a person would', () => {
    expect(simulatorLabel('iracing')).toBe('iRacing');
    expect(simulatorLabel('lmu')).toBe('Le Mans Ultimate');
  });

  it('shows an id it does not know as it is', () => {
    expect(simulatorLabel('acc')).toBe('acc');
  });
});

describe('formatLapTime', () => {
  it('writes minutes, seconds and thousandths', () => {
    expect(formatLapTime(86.216)).toBe('1:26.216');
    expect(formatLapTime(129.284)).toBe('2:09.284');
  });

  it('shows dashes when there is no time', () => {
    expect(formatLapTime(null)).toBe('-:--.---');
    expect(formatLapTime(0)).toBe('-:--.---');
  });
});

describe('formatGap', () => {
  it('signs the gap to the best lap', () => {
    expect(formatGap(86.512, 86.216)).toBe('+0.296');
    // Quicker than the best complete lap: a lap that does not count as one.
    expect(formatGap(85.902, 86.216)).toBe('-0.314');
  });

  it('shows a dash for the best lap itself, not a gap of nothing', () => {
    expect(formatGap(86.216, 86.216)).toBe('-');
  });

  it('shows nothing when the session has no best lap', () => {
    expect(formatGap(86.216, null)).toBe('');
  });
});

describe('trackLabel', () => {
  it('adds the layout where the sim names one apart from the track', () => {
    expect(trackLabel(session({ trackConfig: 'Full Course' }))).toBe(
      'Road America - Full Course'
    );
  });

  it('leaves the track alone when there is no layout, or it already says it', () => {
    expect(trackLabel(session())).toBe('Road America');
    expect(
      trackLabel(
        session({
          trackName: 'Daytona Road Course',
          trackConfig: 'Road Course',
        })
      )
    ).toBe('Daytona Road Course');
  });
});

describe('lapFlags', () => {
  it('has nothing to say about a clean lap', () => {
    expect(lapFlags(lap())).toEqual([]);
    // A sim that counts no incidents has none to flag.
    expect(lapFlags(lap({ incidents: null }))).toEqual([]);
  });

  it('says why a lap is not fit to be a reference', () => {
    const labels = (overrides: Partial<LapLibraryLap>) =>
      lapFlags(lap(overrides)).map((flag) => flag.label);

    expect(labels({ pit: true })).toEqual(['Pit']);
    expect(labels({ voided: true })).toEqual(['Voided']);
    expect(labels({ incidents: 2 })).toEqual(['2x']);
    expect(labels({ own: false })).toEqual(['Not driving']);
    expect(labels({ complete: false })).toEqual(['No trace']);
  });

  it('lists every reason when there are several', () => {
    expect(
      lapFlags(lap({ pit: true, incidents: 4, complete: false })).map(
        (flag) => flag.label
      )
    ).toEqual(['Pit', '4x', 'No trace']);
  });

  it('marks a voided lap as the bad one and incidents as a warning', () => {
    expect(lapFlags(lap({ voided: true }))[0].tone).toBe('bad');
    expect(lapFlags(lap({ incidents: 1 }))[0].tone).toBe('warning');
    expect(lapFlags(lap({ pit: true }))[0].tone).toBe('neutral');
  });
});

describe('formatConsumption', () => {
  it('shows virtual energy for a car that runs on it', () => {
    expect(formatConsumption(lap({ energyUsed: 0.0231, fuelUsed: 2.4 }))).toBe(
      '2.3% VE'
    );
  });

  it('shows litres otherwise', () => {
    expect(formatConsumption(lap({ fuelUsed: 3.361 }))).toBe('3.36 L');
  });

  it('shows nothing without a reading', () => {
    expect(formatConsumption(lap())).toBe('');
  });
});

describe('lapCountLabel', () => {
  it('counts in the singular and the plural', () => {
    expect(lapCountLabel(1)).toBe('1 lap');
    expect(lapCountLabel(12)).toBe('12 laps');
    expect(lapCountLabel(0)).toBe('0 laps');
  });
});
