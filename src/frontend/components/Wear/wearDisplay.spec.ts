import { describe, expect, it } from 'vitest';
import {
  areLapsFew,
  formatFigure,
  formatLaps,
  formatMinutes,
  formatPerLap,
  isBrakeEstimate,
  isTreadEstimate,
  isWearHigh,
  levelTone,
  minutesLeft,
} from './wearDisplay';

describe('wearDisplay', () => {
  describe('how a level is drawn against its warning', () => {
    it('is a caution at or below it and a problem at or below half of it', () => {
      expect(levelTone(31, 30)).toBe('plain');
      expect(levelTone(30, 30)).toBe('caution');
      expect(levelTone(15.1, 30)).toBe('caution');
      expect(levelTone(15, 30)).toBe('bad');
      expect(levelTone(0, 30)).toBe('bad');
    });

    it('is plain without a reading, and with the warning switched off', () => {
      expect(levelTone(null, 30)).toBe('plain');
      expect(levelTone(undefined, 30)).toBe('plain');
      expect(levelTone(2, 0)).toBe('plain');
    });
  });

  describe('the other two warnings', () => {
    it('calls laps few at or below the warning', () => {
      expect(areLapsFew(6, 5)).toBe(false);
      expect(areLapsFew(5, 5)).toBe(true);
      expect(areLapsFew(0, 5)).toBe(true);
      expect(areLapsFew(null, 5)).toBe(false);
      expect(areLapsFew(3, 0)).toBe(false);
    });

    it('calls wear high above the warning, not at it', () => {
      expect(isWearHigh(3, 3)).toBe(false);
      expect(isWearHigh(3.01, 3)).toBe(true);
      expect(isWearHigh(null, 3)).toBe(false);
      expect(isWearHigh(9, 0)).toBe(false);
    });
  });

  describe('what counts as an estimate', () => {
    it('is any tread rate that rests on no lap of the tyre now fitted', () => {
      expect(isTreadEstimate('tyre')).toBe(false);
      expect(isTreadEstimate('session')).toBe(true);
      expect(isTreadEstimate('baseline')).toBe(true);
      expect(isTreadEstimate('projected')).toBe(true);
      expect(isTreadEstimate(null)).toBe(false);
    });

    it('is a disc rate from earlier sessions or from the lap under way', () => {
      // The session's laps were driven on these same discs.
      expect(isBrakeEstimate('stint')).toBe(false);
      expect(isBrakeEstimate('session')).toBe(false);
      expect(isBrakeEstimate('baseline')).toBe(true);
      expect(isBrakeEstimate('projected')).toBe(true);
      expect(isBrakeEstimate(null)).toBe(false);
    });
  });

  describe('figures', () => {
    it('writes a figure to a fixed number of decimals, or the placeholder', () => {
      expect(formatFigure(97.4, 1)).toBe('97.4');
      expect(formatFigure(36, 2)).toBe('36.00');
      expect(formatFigure(null, 1)).toBe('--');
      expect(formatFigure(undefined, 2)).toBe('--');
    });

    it('writes wear per lap with its unit, placeholder or not', () => {
      expect(formatPerLap(0.49, 2)).toBe('0.49/lap');
      expect(formatPerLap(0.0018, 3)).toBe('0.002/lap');
      expect(formatPerLap(null, 2)).toBe('--/lap');
    });

    it('writes laps left, with a plus at the cap and nothing when unknown', () => {
      expect(formatLaps(198)).toBe('198 laps');
      expect(formatLaps(1)).toBe('1 lap');
      expect(formatLaps(0)).toBe('0 laps');
      expect(formatLaps(999)).toBe('999+');
      expect(formatLaps(null)).toBe('');
    });
  });

  describe('minutes left', () => {
    it('are the laps at the pace, in whole minutes', () => {
      // 124 laps of 90 s.
      expect(minutesLeft(124, 90)).toBe(186);
      expect(minutesLeft(197, 86.7)).toBe(284);
      expect(formatMinutes(186)).toBe('186 min');
    });

    it('are capped at 999, and unknown without laps or a pace', () => {
      expect(minutesLeft(600, 212.4)).toBe(999);
      expect(formatMinutes(999)).toBe('999+ min');
      expect(minutesLeft(null, 90)).toBeNull();
      expect(minutesLeft(124, null)).toBeNull();
      expect(minutesLeft(124, 0)).toBeNull();
      expect(formatMinutes(null)).toBe('');
    });

    it('are not given for laps at their cap', () => {
      expect(minutesLeft(999, 90)).toBeNull();
    });
  });
});
