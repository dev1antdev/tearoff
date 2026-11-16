import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig, type LapDeltaConfig } from '@irdashies/types';
import {
  lapDeltaFigures,
  REFERENCE_KEYS,
  REFERENCE_LABELS,
  REFERENCE_LETTERS,
  trendFill,
  type LapDeltaReadings,
} from './lapDeltaDisplay';

// The delta text and tone, the predicted lap and the lap time format moved to
// the domain with their cases: src/frontend/domain/lapTiming/deltaDisplay.spec.ts

describe('trendFill', () => {
  it('fills toward faster while gaining and slower while losing', () => {
    expect(trendFill(-0.15, 0.3)).toEqual({ side: 'faster', fraction: 0.5 });
    expect(trendFill(0.075, 0.3)).toEqual({ side: 'slower', fraction: 0.25 });
  });

  it('is full at the range and stays full beyond it', () => {
    expect(trendFill(-0.3, 0.3).fraction).toBe(1);
    expect(trendFill(2, 0.3)).toEqual({ side: 'slower', fraction: 1 });
  });

  it('follows the range setting', () => {
    expect(trendFill(-0.15, 0.6).fraction).toBe(0.25);
    expect(trendFill(-0.15, 0.15).fraction).toBe(1);
  });

  it('stays empty for a trend too small to mean anything', () => {
    // A lap matching its reference measures a few thousandths either way.
    expect(trendFill(0.003, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(-0.004, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(0, 0.3)).toEqual({ side: 'none', fraction: 0 });
  });

  it('stays empty without a trend or with a range that cannot fill', () => {
    expect(trendFill(null, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(Number.NaN, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(-0.2, 0)).toEqual({ side: 'none', fraction: 0 });
  });
});

describe('the references', () => {
  it('have a name each', () => {
    expect(REFERENCE_LABELS).toEqual({
      sessionBest: 'Session best',
      allTime: 'All-time best',
      stintBest: 'Stint best',
      lastLap: 'Last lap',
    });
  });

  it('have a letter each, for the strip', () => {
    expect(REFERENCE_KEYS.map((key) => REFERENCE_LETTERS[key])).toEqual([
      'S',
      'A',
      'T',
      'L',
    ]);
  });
});

describe('lapDeltaFigures', () => {
  const none = { lapTime: null, delta: null, trend: null };

  // Three laps into a stint, a third of a second up on the session best.
  const readings: LapDeltaReadings = {
    sessionBest: { lapTime: 98.556, delta: -0.342, trend: -0.11 },
    allTime: { lapTime: 97.91, delta: 0.304, trend: -0.1 },
    stintBest: { lapTime: 98.802, delta: -0.588, trend: -0.12 },
    lastLap: { lapTime: 99.137, delta: -0.923, trend: -0.13 },
    // How the lap before this one ended.
    lastLapFinal: {
      lapTime: 99.137,
      completedAt: 1090,
      sessionBest: 0.581,
      allTime: 1.227,
      stintBest: 0.335,
      lastLap: -0.214,
    },
  };

  const settings = (
    reference: LapDeltaConfig['reference'] = 'sessionBest',
    secondary: Partial<LapDeltaConfig['secondary']> = {}
  ) => ({
    reference,
    secondary: {
      ...getWidgetDefaultConfig('lapdelta').secondary,
      ...secondary,
    },
  });

  const all = {
    sessionBest: true,
    allTime: true,
    stintBest: true,
    lastLap: true,
  };

  it('are the lap against the chosen reference, live', () => {
    expect(lapDeltaFigures(readings, settings('stintBest'), false)).toEqual({
      delta: -0.588,
      trend: -0.12,
      predictedLapTime: 98.802 - 0.588,
      lapLabel: 'Stint best',
      lapTime: 98.802,
      cells: [],
    });
    expect(lapDeltaFigures(readings, settings('lastLap'), false)).toMatchObject(
      {
        delta: -0.923,
        lapLabel: 'Last lap',
        lapTime: 99.137,
      }
    );
  });

  it('list the other references in the strip, never the chosen one', () => {
    const { cells } = lapDeltaFigures(
      readings,
      settings('sessionBest', all),
      false
    );

    expect(cells).toEqual([
      { key: 'allTime', letter: 'A', delta: 0.304 },
      { key: 'stintBest', letter: 'T', delta: -0.588 },
      { key: 'lastLap', letter: 'L', delta: -0.923 },
    ]);

    const againstLastLap = lapDeltaFigures(
      readings,
      settings('lastLap', all),
      false
    );
    expect(againstLastLap.cells.map((cell) => cell.letter)).toEqual([
      'S',
      'A',
      'T',
    ]);
  });

  it('list only the references that are switched on', () => {
    const { cells } = lapDeltaFigures(
      readings,
      settings('sessionBest', { lastLap: true }),
      false
    );

    expect(cells).toEqual([{ key: 'lastLap', letter: 'L', delta: -0.923 }]);
    expect(lapDeltaFigures(readings, settings(), false).cells).toEqual([]);
  });

  it('keep the cell of a reference that does not exist, with no delta in it', () => {
    const { cells } = lapDeltaFigures(
      { ...readings, stintBest: none },
      settings('sessionBest', all),
      false
    );

    expect(cells.map((cell) => cell.delta)).toEqual([0.304, null, -0.923]);
  });

  it('are the result of the lap just finished while it is held', () => {
    expect(
      lapDeltaFigures(readings, settings('sessionBest', all), true)
    ).toEqual({
      delta: 0.581,
      // The bar and the prediction are the new lap's.
      trend: -0.11,
      predictedLapTime: 98.556 - 0.342,
      lapLabel: 'Last lap',
      lapTime: 99.137,
      cells: [
        { key: 'allTime', letter: 'A', delta: 1.227 },
        { key: 'stintBest', letter: 'T', delta: 0.335 },
        { key: 'lastLap', letter: 'L', delta: -0.214 },
      ],
    });
  });

  it('have no result to hold for a reference that did not exist at the line', () => {
    const figures = lapDeltaFigures(
      {
        ...readings,
        lastLapFinal: {
          lapTime: 99.137,
          completedAt: 1090,
          sessionBest: 0.581,
          allTime: null,
          stintBest: null,
          lastLap: -0.214,
        },
      },
      settings('stintBest', all),
      true
    );

    expect(figures.delta).toBeNull();
    expect(figures.lapTime).toBe(99.137);
    expect(figures.cells.map((cell) => cell.delta)).toEqual([
      0.581,
      null,
      -0.214,
    ]);
  });

  it('stay live when there is no result to hold', () => {
    const figures = lapDeltaFigures(
      { ...readings, lastLapFinal: null },
      settings(),
      true
    );

    expect(figures.delta).toBe(-0.342);
    expect(figures.lapLabel).toBe('Session best');
  });
});
