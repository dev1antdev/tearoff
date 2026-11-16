import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import {
  DRIVER_MIN_WIDTH,
  enabledTowerColumns,
  fitTowerColumns,
  TOWER_COLUMNS,
  TOWER_DROP_ORDER,
  towerColumnsWidth,
  towerColumnWidth,
  TYRES_COLUMN_WIDTH,
  type TowerColumnId,
} from './towerColumns';

const DEFAULTS = getWidgetDefaultConfig('timingtower');
const ALL: TowerColumnId[] = TOWER_COLUMNS.map((column) => column.id);
const EVERYTHING = { sectors: true, energy: true };

describe('the columns of the tower', () => {
  it('are these fifteen, in this order', () => {
    expect(ALL).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'interval',
      'lastTime',
      'bestTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'sectors',
      'pitStops',
      'stintLaps',
      'energy',
      'tyres',
    ]);
  });

  it('are all on in a new tower', () => {
    expect(enabledTowerColumns(DEFAULTS, EVERYTHING)).toEqual(ALL);
  });

  it('are each switched off by their own setting', () => {
    for (const id of ALL) {
      const config = {
        ...DEFAULTS,
        [id]: { ...DEFAULTS[id], enabled: false },
      };
      expect(enabledTowerColumns(config, EVERYTHING), id).toEqual(
        ALL.filter((column) => column !== id)
      );
    }
  });

  it('leave the sector marks out where the sim times no sectors for the field', () => {
    expect(
      enabledTowerColumns(DEFAULTS, { sectors: false, energy: true })
    ).toEqual(ALL.filter((id) => id !== 'sectors'));
  });

  it('leave the energy out where no car publishes any', () => {
    expect(
      enabledTowerColumns(DEFAULTS, { sectors: true, energy: false })
    ).toEqual(ALL.filter((id) => id !== 'energy'));
  });

  it('take a column a stored config says nothing of as on', () => {
    expect(enabledTowerColumns(undefined, EVERYTHING)).toEqual(ALL);
    expect(
      enabledTowerColumns({ gap: { enabled: false } }, EVERYTHING)
    ).toEqual(ALL.filter((id) => id !== 'gap'));
    expect(
      enabledTowerColumns(
        { gap: null } as unknown as Partial<typeof DEFAULTS>,
        EVERYTHING
      )
    ).toEqual(ALL);
  });
});

describe('fitting the columns to a panel', () => {
  const needed = towerColumnsWidth(ALL);

  it('keeps every column where they fit', () => {
    expect(fitTowerColumns(ALL, needed)).toEqual(ALL);
    expect(fitTowerColumns(ALL, 1920)).toEqual(ALL);
  });

  it('fits every column in a panel of 900', () => {
    // What a Pit Wall panel 900 wide has for the table: the page's gap
    // either side of the panel, its border and the place of the scrollbar
    // come off it.
    expect(needed).toBeLessThanOrEqual(864);
    expect(needed).toBeGreaterThan(DRIVER_MIN_WIDTH);
  });

  it('makes the Tyres column as wide as what it carries', () => {
    expect(towerColumnWidth('tyres')).toBe(TYRES_COLUMN_WIDTH.compound);
    expect(towerColumnWidth('tyres', 'laps')).toBe(TYRES_COLUMN_WIDTH.laps);
    expect(towerColumnWidth('tyres', 'tread')).toBe(TYRES_COLUMN_WIDTH.tread);
    expect(TYRES_COLUMN_WIDTH.compound).toBeLessThan(TYRES_COLUMN_WIDTH.laps);
    expect(TYRES_COLUMN_WIDTH.laps).toBeLessThan(TYRES_COLUMN_WIDTH.tread);
    // No other column's width depends on it, and the driver's has none.
    expect(towerColumnWidth('energy', 'tread')).toBe(
      towerColumnWidth('energy')
    );
    expect(towerColumnWidth('driver', 'tread')).toBeNull();
    expect(towerColumnsWidth(ALL, 'tread') - needed).toBe(
      TYRES_COLUMN_WIDTH.tread - TYRES_COLUMN_WIDTH.compound
    );
  });

  it('fits every column with the laps and the tread in the default window', () => {
    // 960 wide, less the place of the scrollbar.
    expect(towerColumnsWidth(ALL, 'tread')).toBeLessThanOrEqual(940);
    expect(fitTowerColumns(ALL, 940, 'tread')).toEqual(ALL);
  });

  it('leaves Stops out first where the wider Tyres column no longer fits', () => {
    // Every column fits 864 with the compound alone, and not with the
    // laps and the tread beside it.
    expect(fitTowerColumns(ALL, 864)).toEqual(ALL);
    expect(fitTowerColumns(ALL, 864, 'tread')).toEqual(
      ALL.filter((id) => id !== 'pitStops' && id !== 'interval')
    );
    // What goes with the Tyres column is its width as drawn.
    const without = fitTowerColumns(ALL, 600, 'tread');
    expect(without).not.toContain('tyres');
    expect(towerColumnsWidth(without, 'tread')).toBeLessThanOrEqual(600);
  });

  it('leaves nothing out of a panel that has not been measured', () => {
    expect(fitTowerColumns(ALL, 0)).toEqual(ALL);
    expect(fitTowerColumns(ALL, -1)).toEqual(ALL);
    expect(fitTowerColumns(ALL, Number.NaN)).toEqual(ALL);
  });

  it('leaves out the least important first, one at a time', () => {
    expect(fitTowerColumns(ALL, needed - 1)).toEqual(
      ALL.filter((id) => id !== 'pitStops')
    );
    const withoutStops = towerColumnsWidth(
      ALL.filter((id) => id !== 'pitStops')
    );
    expect(fitTowerColumns(ALL, withoutStops - 1)).toEqual(
      ALL.filter((id) => id !== 'pitStops' && id !== 'interval')
    );
  });

  it('keeps the columns in their order whatever is left out', () => {
    for (let width = 200; width <= needed; width += 20) {
      const fitted = fitTowerColumns(ALL, width);
      expect(fitted, `${width}`).toEqual(
        ALL.filter((id) => fitted.includes(id))
      );
    }
  });

  it('shows the pace columns longest', () => {
    // What a Pit Wall panel 560 wide has for the table, as on the Compact
    // page.
    expect(fitTowerColumns(ALL, 524)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'lastTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
    ]);
    // A little wider, the laps of the stint come back first.
    expect(fitTowerColumns(ALL, 550)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'lastTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'stintLaps',
    ]);
  });

  it('never leaves out the place, the number or the driver', () => {
    expect(fitTowerColumns(ALL, 1)).toEqual([
      'position',
      'carNumber',
      'driver',
    ]);
    expect(TOWER_DROP_ORDER).not.toContain('position');
    expect(TOWER_DROP_ORDER).not.toContain('carNumber');
    expect(TOWER_DROP_ORDER).not.toContain('driver');
    // Every other column can go.
    expect([...TOWER_DROP_ORDER].sort()).toEqual(
      ALL.filter(
        (id) => id !== 'position' && id !== 'carNumber' && id !== 'driver'
      ).sort()
    );
  });

  it('fits what is switched on, so a shorter list loses less', () => {
    const few: TowerColumnId[] = [
      'position',
      'driver',
      'gap',
      'pitStops',
      'stintPace',
    ];
    expect(fitTowerColumns(few, towerColumnsWidth(few))).toEqual(few);
    expect(fitTowerColumns(few, towerColumnsWidth(few) - 1)).toEqual([
      'position',
      'driver',
      'gap',
      'stintPace',
    ]);
  });
});
