import { describe, expect, it } from 'vitest';
import {
  LOAD_BAR_FULL_SHARE,
  chassisAngleDeg,
  deflectionMillimetres,
  isBottoming,
  isLoadLow,
  isPressureCold,
  isWheelLifted,
  loadBarFill,
  loadSharePercent,
  rollAngleShare,
  toeDirection,
} from './wheelFigures';

describe('chassisAngleDeg', () => {
  it('turns a difference in height over a length into degrees', () => {
    // 10 mm of rake over a 2.8 m wheelbase.
    expect(chassisAngleDeg(10, 2800)).toBeCloseTo(0.2046, 4);
    // 4 mm of roll over a 1.8 m track.
    expect(chassisAngleDeg(4, 1800)).toBeCloseTo(0.1273, 4);
  });

  it('keeps the sign of the difference', () => {
    expect(chassisAngleDeg(-5, 2800)).toBeCloseTo(-0.1023, 4);
    expect(chassisAngleDeg(0, 2800)).toBe(0);
  });

  it('gives a smaller angle over a longer car', () => {
    expect(chassisAngleDeg(10, 3100)).toBeLessThan(chassisAngleDeg(10, 2800));
  });

  it('reads 0 over a length that is not one, rather than dividing by it', () => {
    expect(chassisAngleDeg(10, 0)).toBe(0);
    expect(chassisAngleDeg(10, -2800)).toBe(0);
    expect(chassisAngleDeg(10, Number.NaN)).toBe(0);
  });
});

describe('rollAngleShare', () => {
  it('is the share of the heights when the tracks are equal', () => {
    expect(rollAngleShare(0.75, 1800, 1800)).toBeCloseTo(0.75, 10);
    expect(rollAngleShare(0.5, 1650, 1650)).toBeCloseTo(0.5, 10);
  });

  it('gives the wider axle less, as it leans less for the same difference', () => {
    expect(rollAngleShare(0.75, 1700, 1600)).toBeCloseTo(0.7385, 4);
    expect(rollAngleShare(0.75, 1600, 1700)).toBeCloseTo(0.7612, 4);
  });

  it('keeps the ends where they are', () => {
    expect(rollAngleShare(0, 1700, 1600)).toBe(0);
    expect(rollAngleShare(1, 1700, 1600)).toBe(1);
  });

  it('hands the share back unchanged for a track that is not a length', () => {
    expect(rollAngleShare(0.6, 0, 1600)).toBe(0.6);
    expect(rollAngleShare(0.6, 1700, Number.NaN)).toBe(0.6);
  });
});

describe('isBottoming', () => {
  it('is a ride height below the threshold, not at it', () => {
    expect(isBottoming(51, 0)).toBe(false);
    expect(isBottoming(-1, 0)).toBe(true);
    expect(isBottoming(0, 0)).toBe(false);
    expect(isBottoming(9.9, 10)).toBe(true);
    expect(isBottoming(10, 10)).toBe(false);
  });
});

describe('toeDirection', () => {
  it('reads a positive total as toe-in and a negative one as toe-out', () => {
    expect(toeDirection(0.21)).toBe('in');
    expect(toeDirection(-0.1)).toBe('out');
  });

  it('has no word for a total that reads 0.00', () => {
    expect(toeDirection(0)).toBeNull();
    expect(toeDirection(0.004)).toBeNull();
    expect(toeDirection(-0.004)).toBeNull();
    expect(toeDirection(0.006)).toBe('in');
    expect(toeDirection(-0.006)).toBe('out');
  });
});

describe('load share', () => {
  it('is drawn as a whole percentage', () => {
    expect(loadSharePercent(0.34)).toBe(34);
    expect(loadSharePercent(0.005)).toBe(1);
    expect(loadSharePercent(0.004)).toBe(0);
  });

  it('fills its bar at half the load of the car', () => {
    expect(LOAD_BAR_FULL_SHARE).toBe(0.5);
    expect(loadBarFill(0.34)).toBeCloseTo(0.68, 10);
    expect(loadBarFill(0.5)).toBe(1);
    expect(loadBarFill(0.9)).toBe(1);
    expect(loadBarFill(-0.1)).toBe(0);
  });

  it('is low when the percentage drawn is at or below the threshold', () => {
    expect(isLoadLow(0.005, 1)).toBe(true);
    expect(isLoadLow(0.014, 1)).toBe(true);
    expect(isLoadLow(0.016, 1)).toBe(false);
    expect(isLoadLow(0.04, 5)).toBe(true);
    expect(isLoadLow(0.06, 5)).toBe(false);
  });
});

describe('tyre deflection', () => {
  it('is drawn as whole millimetres', () => {
    expect(deflectionMillimetres(24.3)).toBe(24);
    expect(deflectionMillimetres(0.6)).toBe(1);
  });

  it('means a lifted wheel when the millimetres drawn are at or below the threshold', () => {
    expect(isWheelLifted(0, 1)).toBe(true);
    expect(isWheelLifted(0.6, 1)).toBe(true);
    expect(isWheelLifted(1.6, 1)).toBe(false);
    // A threshold of 0 only catches a wheel that reads nothing.
    expect(isWheelLifted(0.4, 0)).toBe(true);
    expect(isWheelLifted(0.6, 0)).toBe(false);
  });
});

describe('isPressureCold', () => {
  it('is a carcass under the threshold', () => {
    expect(isPressureCold(40, 65)).toBe(true);
    expect(isPressureCold(78, 65)).toBe(false);
    expect(isPressureCold(65, 65)).toBe(false);
  });

  it('is switched off by a threshold of 0', () => {
    expect(isPressureCold(40, 0)).toBe(false);
    expect(isPressureCold(-10, 0)).toBe(false);
  });

  it('is never true of a wheel with no carcass reading', () => {
    expect(isPressureCold(null, 65)).toBe(false);
    expect(isPressureCold(undefined, 65)).toBe(false);
  });
});
