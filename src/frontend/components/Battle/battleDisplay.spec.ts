import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig, type BattleConfig } from '@irdashies/types';
import type { Rival, RivalCar } from '@irdashies/domain';
import { resolveBattleColumns } from './battleColumns';
import {
  energyUseText,
  forecastDisplay,
  pitStopsText,
  pitTimeText,
  stintText,
  trendDisplay,
} from './battleDisplay';

const car = (overrides: Partial<RivalCar> = {}): RivalCar =>
  ({
    carIdx: 3,
    stintLaps: 7,
    stintEstimate: 24,
    pitStops: 2,
    pitLaneSeconds: undefined,
    usedLastLap: 0.0233,
    ...overrides,
  }) as RivalCar;

const rival = (forecastLaps: number | null): Rival =>
  ({ ...car(), forecastLaps }) as Rival;

describe('stintText', () => {
  it('prints the laps since the stop and the lap the stint can reach', () => {
    expect(stintText(car(), true)).toBe('7/24');
  });

  it('prints the laps alone without an estimate, or with it switched off', () => {
    expect(stintText(car({ stintEstimate: undefined }), true)).toBe('7');
    expect(stintText(car(), false)).toBe('7');
  });

  it('prints a dash where the stint cannot be told', () => {
    expect(stintText(car({ stintLaps: undefined }), true)).toBe('—');
  });

  it('prints a stint that has just begun', () => {
    expect(stintText(car({ stintLaps: 0, stintEstimate: 22 }), true)).toBe(
      '0/22'
    );
  });
});

describe('pit figures', () => {
  it('prints the stops, and a dash at none or where the sim keeps none', () => {
    expect(pitStopsText(car())).toBe('2');
    expect(pitStopsText(car({ pitStops: 0 }))).toBe('—');
    expect(pitStopsText(car({ pitStops: undefined }))).toBe('—');
  });

  it('prints the time in the lane to a tenth, and in minutes from one', () => {
    expect(pitTimeText(car({ pitLaneSeconds: 12.3 }))).toBe('12.3');
    expect(pitTimeText(car({ pitLaneSeconds: 65.4 }))).toBe('1:05');
    expect(pitTimeText(car())).toBeUndefined();
  });

  it('prints the usage as a percentage of a full allocation', () => {
    expect(energyUseText(car())).toBe('2.3');
    expect(energyUseText(car({ usedLastLap: undefined }))).toBe('—');
  });
});

describe('trendDisplay', () => {
  const closing = { perLap: -0.31, laps: 3, closingLaps: 3 };
  const opening = { perLap: 0.24, laps: 3, closingLaps: 0 };

  it('reads a closing gap as good against the car ahead, bad against the car behind', () => {
    expect(trendDisplay(closing, 'ahead', 2)).toEqual({
      text: '0.31',
      direction: 'closing',
      tone: 'good',
    });
    expect(trendDisplay(closing, 'behind', 2)).toEqual({
      text: '0.31',
      direction: 'closing',
      tone: 'bad',
    });
  });

  it('reads an opening gap the other way round', () => {
    expect(trendDisplay(opening, 'ahead', 2).tone).toBe('bad');
    expect(trendDisplay(opening, 'behind', 1)).toEqual({
      text: '0.2',
      direction: 'opening',
      tone: 'good',
    });
  });

  it('reads a gap that holds as flat, and no history as nothing', () => {
    expect(
      trendDisplay({ perLap: 0.004, laps: 3, closingLaps: 1 }, 'ahead', 2)
    ).toEqual({ text: '—', direction: 'flat', tone: 'flat' });
    expect(trendDisplay(null, 'ahead', 2)).toEqual({
      text: '',
      direction: 'none',
      tone: 'none',
    });
  });
});

describe('forecastDisplay', () => {
  it('says about, and which way: catching ahead, caught from behind', () => {
    expect(forecastDisplay(rival(6), 'ahead')).toEqual({
      text: '~6L',
      title: 'Catching in about 6 laps',
      tone: 'good',
    });
    expect(forecastDisplay(rival(4), 'behind')).toEqual({
      text: '~4L',
      title: 'Caught in about 4 laps',
      tone: 'bad',
    });
    expect(forecastDisplay(rival(1), 'ahead').title).toBe(
      'Catching in about 1 lap'
    );
  });

  it('prints a dash, never a figure, where the forecast is withheld', () => {
    expect(forecastDisplay(rival(null), 'ahead')).toEqual({
      text: '—',
      title: 'No forecast',
      tone: 'none',
    });
  });
});

describe('resolveBattleColumns', () => {
  const defaults = getWidgetDefaultConfig('battle');
  const lmuRace = {
    isRace: true,
    available: { pitStops: true, energy: true, trackLimits: true },
  };
  const iracingRace = {
    isRace: true,
    available: { pitStops: false, energy: false, trackLimits: false },
  };

  it('ships the columns a fight is read from, in order', () => {
    expect(resolveBattleColumns(defaults, lmuRace)).toEqual([
      'position',
      'carNumber',
      'driverName',
      'status',
      'compound',
      'stint',
      'pitStops',
      'energy',
      'lastTime',
      'gap',
      'forecast',
    ]);
  });

  it('drops what the running sim does not publish', () => {
    const everything = {
      ...defaults,
      energyUse: { enabled: true },
      trackLimits: { enabled: true },
    };

    expect(resolveBattleColumns(everything, iracingRace)).toEqual([
      'position',
      'carNumber',
      'driverName',
      'status',
      'compound',
      'stint',
      'lastTime',
      'gap',
      'forecast',
    ]);
    expect(resolveBattleColumns(everything, lmuRace)).toContain('energyUse');
    expect(resolveBattleColumns(everything, lmuRace)).toContain('trackLimits');
  });

  it('drops the grid change and the forecast outside a race', () => {
    const withChange = { ...defaults, positionChange: { enabled: true } };
    const practice = { ...lmuRace, isRace: false };

    expect(resolveBattleColumns(withChange, lmuRace)).toContain(
      'positionChange'
    );
    expect(resolveBattleColumns(withChange, practice)).not.toContain(
      'positionChange'
    );
    expect(resolveBattleColumns(withChange, practice)).not.toContain(
      'forecast'
    );
    expect(resolveBattleColumns(withChange, practice)).toContain('gap');
  });

  it('follows a saved order, and adds the columns it does not name', () => {
    // A dashboard saved before the rivals columns existed.
    const saved = {
      ...defaults,
      displayOrder: ['gap', 'driverName', 'position', 'someOldColumn'],
    };

    expect(resolveBattleColumns(saved, lmuRace)).toEqual([
      'gap',
      'driverName',
      'position',
      'carNumber',
      'status',
      'compound',
      'stint',
      'pitStops',
      'energy',
      'lastTime',
      'forecast',
    ]);
  });

  it('draws nothing it has no setting for', () => {
    expect(resolveBattleColumns(undefined, lmuRace)).toEqual([]);
    // A config saved before a column existed has no entry for it.
    const old = { ...defaults } as Partial<BattleConfig>;
    delete old.forecast;
    expect(resolveBattleColumns(old as BattleConfig, lmuRace)).not.toContain(
      'forecast'
    );
  });
});
