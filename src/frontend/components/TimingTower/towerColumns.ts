import type { TimingTowerConfig } from '@irdashies/types';

/**
 * The columns of the timing tower: which there are, in what order, how wide
 * each is, and which are left out when the panel is too narrow for all of
 * them. Pure: the table that draws them is `TimingTower`.
 */

export type TowerColumnId =
  | 'position'
  | 'carNumber'
  | 'driver'
  | 'gap'
  | 'interval'
  | 'lastTime'
  | 'bestTime'
  | 'avgLast5'
  | 'avgLast10'
  | 'stintPace'
  | 'sectors'
  | 'pitStops'
  | 'stintLaps'
  | 'energy'
  | 'tyres';

export interface TowerColumn {
  id: TowerColumnId;
  /** The header's text. */
  label: string;
  /** What the header says when pointed at. */
  title: string;
  /**
   * CSS pixels at the widget's own scale. The driver column has none: it
   * takes what the others leave, and never less than `DRIVER_MIN_WIDTH`.
   */
  width: number | null;
  align: 'left' | 'right' | 'center';
}

/** The narrowest the driver column is drawn before another column goes. */
export const DRIVER_MIN_WIDTH = 128;

/**
 * Every column, in the order the tower draws them. The widths fit a lap
 * time of the form 3:57.288 at the table's type size.
 */
export const TOWER_COLUMNS: readonly TowerColumn[] = [
  {
    id: 'position',
    label: 'P',
    title: 'Position',
    width: 26,
    align: 'center',
  },
  {
    id: 'carNumber',
    label: '#',
    title: 'Car number',
    width: 44,
    align: 'right',
  },
  {
    id: 'driver',
    label: 'Driver',
    title: 'Driver and team',
    width: null,
    align: 'left',
  },
  {
    id: 'gap',
    label: 'Gap',
    title: 'Gap to the leader',
    width: 52,
    align: 'center',
  },
  {
    id: 'interval',
    label: 'Int',
    title: 'Interval to the car ahead',
    width: 46,
    align: 'center',
  },
  {
    id: 'lastTime',
    label: 'Last',
    title: 'Last lap',
    width: 74,
    align: 'left',
  },
  {
    id: 'bestTime',
    label: 'Best',
    title: 'Best lap',
    width: 62,
    align: 'left',
  },
  {
    id: 'avgLast5',
    label: 'Avg 5',
    title: 'Average of the last 5 laps',
    width: 62,
    align: 'left',
  },
  {
    id: 'avgLast10',
    label: 'Avg 10',
    title: 'Average of the last 10 laps',
    width: 62,
    align: 'left',
  },
  {
    id: 'stintPace',
    label: 'vs stint',
    title: 'Average clean lap of this stint against an earlier stint',
    width: 58,
    align: 'right',
  },
  {
    id: 'sectors',
    label: 'Sect',
    title: 'The most recent first, second and third sector',
    width: 50,
    align: 'center',
  },
  {
    id: 'pitStops',
    label: 'Stops',
    title: 'Pit stops made',
    width: 44,
    align: 'right',
  },
  {
    id: 'stintLaps',
    label: 'Stint',
    title: 'Laps since the last stop',
    width: 42,
    align: 'right',
  },
  {
    id: 'energy',
    label: 'Energy',
    title: 'Virtual energy or fuel left',
    width: 56,
    align: 'right',
  },
  // Wide enough for the compound alone. The laps on the set and the tread
  // left go beside it, to the right, when they are shown: the cell is laid
  // out from its left edge so that they only widen it, by what
  // `TYRES_COLUMN_WIDTH` says.
  {
    id: 'tyres',
    label: 'Tyres',
    title: 'Tyre compound, laps on the set and tread left',
    width: 44,
    align: 'left',
  },
];

/**
 * What the Tyres column carries beside the compound: nothing, the laps on
 * the set, or the laps and the tread left.
 */
export type TowerTyresDetail = 'compound' | 'laps' | 'tread';

/**
 * The width of the Tyres column for each: the compound, then room for
 * "136+", then for "<100%" as well.
 */
export const TYRES_COLUMN_WIDTH: Readonly<Record<TowerTyresDetail, number>> = {
  compound: 44,
  laps: 64,
  tread: 108,
};

const COLUMN_BY_ID = new Map(
  TOWER_COLUMNS.map((column) => [column.id, column])
);

export const towerColumn = (id: TowerColumnId): TowerColumn =>
  COLUMN_BY_ID.get(id) as TowerColumn;

/**
 * The width a column is drawn at: its own, but for Tyres, which is as wide
 * as what it carries. Null for the driver's, which takes what is left.
 */
export const towerColumnWidth = (
  id: TowerColumnId,
  tyres: TowerTyresDetail = 'compound'
): number | null =>
  id === 'tyres' ? TYRES_COLUMN_WIDTH[tyres] : towerColumn(id).width;

/**
 * The order columns are left out in when the panel is too narrow, the
 * first to go first. What is kept longest is what the tower is for: who is
 * where, how far apart, and how each car's pace is moving. The place, the
 * number and the driver are never left out.
 */
export const TOWER_DROP_ORDER: readonly TowerColumnId[] = [
  'pitStops',
  'interval',
  'bestTime',
  'sectors',
  'tyres',
  'energy',
  'stintLaps',
  'avgLast10',
  'lastTime',
  'gap',
  'avgLast5',
  'stintPace',
];

/** What the sim can fill, where a column depends on it. */
export interface TowerColumnAvailability {
  /** The sim times every car's sectors. */
  sectors: boolean;
  /** At least one car publishes what it has left to run on. */
  energy: boolean;
}

/**
 * The columns that are switched on and have something to show, in drawing
 * order. A stored config is not trusted to hold every entry: a column
 * without one is on, as a new tower has it.
 */
export const enabledTowerColumns = (
  config: Partial<TimingTowerConfig> | undefined,
  available: TowerColumnAvailability
): TowerColumnId[] =>
  TOWER_COLUMNS.map((column) => column.id).filter((id) => {
    if (id === 'sectors' && !available.sectors) return false;
    if (id === 'energy' && !available.energy) return false;
    return config?.[id]?.enabled ?? true;
  });

/** The width the columns need, with the driver's at its narrowest. */
export const towerColumnsWidth = (
  columns: readonly TowerColumnId[],
  tyres: TowerTyresDetail = 'compound'
): number =>
  columns.reduce(
    (sum, id) => sum + (towerColumnWidth(id, tyres) ?? DRIVER_MIN_WIDTH),
    0
  );

/**
 * The columns that fit a panel `availableWidth` pixels wide: all of them
 * where they fit, otherwise with the least important left out one by one
 * until the rest do. A width of nothing is a panel not measured yet, and
 * leaves nothing out.
 *
 * The tower never scrolls sideways: a column that cannot be seen without
 * reaching for it is a column that is not read during a race.
 */
export const fitTowerColumns = (
  columns: readonly TowerColumnId[],
  availableWidth: number,
  tyres: TowerTyresDetail = 'compound'
): TowerColumnId[] => {
  const kept = [...columns];
  if (!(availableWidth > 0)) return kept;
  let needed = towerColumnsWidth(kept, tyres);
  for (const id of TOWER_DROP_ORDER) {
    if (needed <= availableWidth) break;
    const at = kept.indexOf(id);
    if (at < 0) continue;
    kept.splice(at, 1);
    needed -= towerColumnWidth(id, tyres) ?? 0;
  }
  return kept;
};
