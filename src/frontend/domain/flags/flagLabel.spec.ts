import { describe, expect, it } from 'vitest';
import type { FlagDetail, FlagKind } from '@irdashies/types';
import {
  flagLabelType,
  flagWidgetLabel,
  type FlagWidgetLabel,
} from './flagLabel';

describe('flagWidgetLabel', () => {
  it.each<[FlagKind, FlagDetail, FlagWidgetLabel]>([
    ['green', 'trackClear', 'GREEN'],
    ['green', 'greenStart', 'GREEN'],
    ['yellow', 'yellowAhead', 'YELLOW'],
    ['yellow', 'yellowElsewhere', 'YELLOW'],
    ['fullCourseYellow', 'fcy', 'YELLOW'],
    ['blue', 'blueLapping', 'BLUE FLAG'],
    ['white', 'lastLap', 'WHITE'],
    ['chequered', 'finished', 'CHECKERED'],
    ['red', 'sessionStopped', 'RED'],
    ['penalty', 'driveThrough', 'BLACK FLAG'],
    ['penalty', 'slowDown', 'BLACK FLAG'],
    ['meatball', 'repairRequired', 'MEATBALL'],
    ['debris', 'debris', 'DEBRIS'],
    ['disqualified', 'disqualified', 'DISQUALIFIED'],
    // The matrix has no drawing for the grid or the lights.
    ['start', 'lights', 'NO FLAG'],
    ['none', 'noSession', 'NO FLAG'],
  ])('draws %s / %s as %s', (kind, detail, label) => {
    expect(flagWidgetLabel(kind, detail)).toBe(label);
  });

  it('draws a clear track green unless told to wait for the announcement', () => {
    expect(flagWidgetLabel('green', 'trackClear', true)).toBe('GREEN');
    expect(flagWidgetLabel('green', 'trackClear', false)).toBe('NO FLAG');
  });

  it('still draws the announced green with the setting off', () => {
    expect(flagWidgetLabel('green', 'greenStart', false)).toBe('GREEN');
    expect(flagWidgetLabel('green', 'greenRestart', false)).toBe('GREEN');
  });

  it('leaves every other flag alone with the setting off', () => {
    expect(flagWidgetLabel('blue', 'blueLapping', false)).toBe('BLUE FLAG');
    expect(flagWidgetLabel('yellow', 'yellowElsewhere', false)).toBe('YELLOW');
  });
});

describe('flagLabelType', () => {
  it('is the first word, which the flag colours are keyed on', () => {
    expect(flagLabelType('BLUE FLAG')).toBe('BLUE');
    expect(flagLabelType('BLACK FLAG')).toBe('BLACK');
    expect(flagLabelType('NO FLAG')).toBe('NO');
    expect(flagLabelType('CHECKERED')).toBe('CHECKERED');
  });
});
