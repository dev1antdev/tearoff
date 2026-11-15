import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import {
  NO_READING,
  axleToeFigure,
  camberFigure,
  chassisAngleDeg,
  formatMillimetres,
  formatSigned,
  isBottoming,
  rakeFigure,
  rideHeightCorners,
  rollAngleShare,
  rollFigure,
  rollShareFigure,
  rowState,
  wheelToeFigure,
} from './chassisDisplay';

const DEFAULTS = getWidgetDefaultConfig('chassis');

describe('formatSigned', () => {
  it('writes the sign in front of the figure', () => {
    expect(formatSigned(0.18, 2)).toBe('+0.18');
    expect(formatSigned(-0.1, 2)).toBe('-0.10');
    expect(formatSigned(-2.04, 1)).toBe('-2.0');
  });

  it('writes no sign in front of a figure that rounds to nothing', () => {
    expect(formatSigned(0, 2)).toBe('0.00');
    expect(formatSigned(-0.004, 2)).toBe('0.00');
    expect(formatSigned(0.04, 1)).toBe('0.0');
  });
});

describe('rake', () => {
  it('is an angle over the wheelbase, with the millimetres behind it', () => {
    expect(rakeFigure(10, 2800)).toEqual({
      angle: '+0.20°',
      millimetres: '10 mm',
      low: false,
    });
  });

  it('is drawn low when the nose is the higher end', () => {
    expect(rakeFigure(-5, 2800)).toEqual({
      angle: '-0.10°',
      millimetres: '-5 mm',
      low: true,
    });
  });

  it('is not low for a rake too small to show', () => {
    expect(rakeFigure(-0.1, 2800)).toEqual({
      angle: '0.00°',
      millimetres: '0 mm',
      low: false,
    });
  });

  it('reads the recorded car at its mean rake with the default wheelbase', () => {
    expect(rakeFigure(8.9, DEFAULTS.wheelbase).angle).toBe('+0.18°');
  });

  it('follows the wheelbase entered', () => {
    expect(chassisAngleDeg(10, 2800)).toBeGreaterThan(
      chassisAngleDeg(10, 3100)
    );
    expect(rakeFigure(10, 3100).angle).toBe('+0.18°');
  });

  it('is a placeholder without a reading', () => {
    expect(rakeFigure(null, 2800)).toEqual({
      angle: NO_READING,
      millimetres: '',
      low: false,
    });
    expect(rakeFigure(undefined, 2800).angle).toBe(NO_READING);
  });
});

describe('roll', () => {
  it('is an angle over the track width, positive with the right side higher', () => {
    expect(rollFigure(4, 1800)).toBe('+0.13');
    expect(rollFigure(-4, 1800)).toBe('-0.13');
    expect(rollFigure(0, 1800)).toBe('0.00');
  });

  it('is a placeholder without a reading', () => {
    expect(rollFigure(null, 1800)).toBe(NO_READING);
    expect(rollFigure(undefined, 1800)).toBe(NO_READING);
  });

  it('shares the angle by the two track widths', () => {
    expect(rollAngleShare(0.75, 1700, 1600)).toBeCloseTo(0.7385, 4);
    expect(rollAngleShare(0.75, 1800, 1800)).toBeCloseTo(0.75, 10);
    expect(rollShareFigure(0.75, 1700, 1600)).toBe('74%');
    expect(rollShareFigure(0.75, 1800, 1800)).toBe('75%');
    expect(rollShareFigure(0.5, 1800, 1800)).toBe('50%');
    expect(rollShareFigure(null, 1800, 1800)).toBe(NO_READING);
  });
});

describe('ride height', () => {
  const settings = {
    rideHeightScale: 100,
    bottomingFront: 0,
    bottomingRear: 0,
  };

  it('gives each corner its millimetres and the fill of its bar', () => {
    expect(rideHeightCorners([51, 50, 60, 59], settings)).toEqual([
      { text: '51', fill: 0.51, bottoming: false },
      { text: '50', fill: 0.5, bottoming: false },
      { text: '60', fill: 0.6, bottoming: false },
      { text: '59', fill: 0.59, bottoming: false },
    ]);
  });

  it('flags only the corner below the threshold', () => {
    const corners = rideHeightCorners([51, -1, 60, 59], settings);

    expect(corners.map((corner) => corner.bottoming)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    // Below the road the bar is empty, not negative.
    expect(corners[1]).toEqual({ text: '-1', fill: 0, bottoming: true });
    expect(isBottoming(51, 0)).toBe(false);
    expect(isBottoming(-1, 0)).toBe(true);
  });

  it('judges each axle by its own threshold', () => {
    const corners = rideHeightCorners([8, 12, 8, 12], {
      rideHeightScale: 100,
      bottomingFront: 10,
      bottomingRear: 5,
    });

    expect(corners.map((corner) => corner.bottoming)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('keeps a bar full above the scale', () => {
    const [corner] = rideHeightCorners([157, 50, 60, 59], settings);

    expect(corner).toEqual({ text: '157', fill: 1, bottoming: false });
  });

  it('follows the scale entered', () => {
    const [corner] = rideHeightCorners([51, 50, 60, 59], {
      ...settings,
      rideHeightScale: 150,
    });

    expect(corner.fill).toBeCloseTo(0.34, 10);
  });

  it('never writes a negative zero', () => {
    expect(formatMillimetres(-0.4)).toBe('0');
    expect(rideHeightCorners([-0.4, 50, 60, 59], settings)[0].text).toBe('0');
  });

  it('gives placeholders without a reading', () => {
    const placeholder = { text: NO_READING, fill: 0, bottoming: false };

    expect(rideHeightCorners(null, settings)).toEqual([
      placeholder,
      placeholder,
      placeholder,
      placeholder,
    ]);
    expect(rideHeightCorners(undefined, settings)).toHaveLength(4);
    expect(formatMillimetres(null)).toBe(NO_READING);
  });

  it('draws an empty bar rather than dividing by a scale of 0', () => {
    const [corner] = rideHeightCorners([51, 50, 60, 59], {
      ...settings,
      rideHeightScale: 0,
    });

    expect(corner.fill).toBe(0);
  });
});

describe('camber', () => {
  it('is signed, to a tenth of a degree', () => {
    expect(camberFigure(-2.01).text).toBe('-2.0');
    expect(camberFigure(-1.61).text).toBe('-1.6');
  });

  it('is flagged at zero or above, and not while the wheel leans in', () => {
    expect(camberFigure(0.3)).toEqual({ text: '+0.3', positive: true });
    expect(camberFigure(-2)).toEqual({ text: '-2.0', positive: false });
    expect(camberFigure(0)).toEqual({ text: '0.0', positive: true });
  });

  it('is judged on the figure drawn', () => {
    // -0.04 is written "0.0", and a zero is flagged.
    expect(camberFigure(-0.04)).toEqual({ text: '0.0', positive: true });
    expect(camberFigure(-0.06)).toEqual({ text: '-0.1', positive: false });
  });

  it('is a placeholder without a reading, and not flagged', () => {
    expect(camberFigure(null)).toEqual({ text: NO_READING, positive: false });
  });
});

describe('toe', () => {
  it('reads an axle as a magnitude and a word', () => {
    expect(axleToeFigure(0.21)).toBe('0.21 in');
    expect(axleToeFigure(-0.1)).toBe('0.10 out');
  });

  it('gives no word to a total that reads 0.00', () => {
    expect(axleToeFigure(0)).toBe('0.00');
    expect(axleToeFigure(-0.004)).toBe('0.00');
  });

  it('reads a wheel as a signed figure, toe-in positive', () => {
    expect(wheelToeFigure(0.1)).toBe('+0.10');
    expect(wheelToeFigure(-0.05)).toBe('-0.05');
    expect(wheelToeFigure(0)).toBe('0.00');
  });

  it('is a placeholder without a reading', () => {
    expect(axleToeFigure(null)).toBe(NO_READING);
    expect(wheelToeFigure(undefined)).toBe(NO_READING);
  });
});

describe('which rows are drawn', () => {
  it('keeps every row in place with placeholders out of the car', () => {
    expect(rowState(false, null)).toBe('placeholders');
    expect(rowState(false, undefined)).toBe('placeholders');
  });

  it('draws a row the sim gives readings for', () => {
    expect(rowState(true, [51, 50, 60, 59])).toBe('values');
    // A rake of exactly 0 is a reading.
    expect(rowState(true, 0)).toBe('values');
  });

  it('leaves out a row the sim gives nothing for', () => {
    // Camber and toe, for a car the sim publishes none for.
    expect(rowState(true, null)).toBe('hidden');
  });
});
