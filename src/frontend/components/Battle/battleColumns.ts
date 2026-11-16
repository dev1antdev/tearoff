import type { BattleConfig } from '@irdashies/types';
import type { ClassRivals } from '@irdashies/domain';

/** The columns of a rivals row, in the order the widget ships them. */
export const BATTLE_COLUMN_KEYS = [
  'position',
  'positionChange',
  'carNumber',
  'driverName',
  'status',
  'compound',
  'stint',
  'pitStops',
  'energy',
  'energyUse',
  'bestTime',
  'lastTime',
  'speed',
  'trackLimits',
  'gap',
  'forecast',
] as const;

export type BattleColumnKey = (typeof BATTLE_COLUMN_KEYS)[number];

const COLUMN_KEYS = new Set<string>(BATTLE_COLUMN_KEYS);

const isColumnKey = (value: string): value is BattleColumnKey =>
  COLUMN_KEYS.has(value);

type Availability = Pick<ClassRivals, 'isRace' | 'available'>;

/**
 * Whether the running sim and session have anything to put in a column.
 *
 * A column of nothing is dropped, not drawn empty: the stops, the energy and
 * the track-limits points exist only where the sim publishes them, and the
 * grid change and the forecast only in a race.
 */
const hasData = (key: BattleColumnKey, rivals: Availability): boolean => {
  switch (key) {
    case 'positionChange':
    case 'forecast':
      return rivals.isRace;
    case 'pitStops':
      return rivals.available.pitStops;
    case 'energy':
    case 'energyUse':
      return rivals.available.energy;
    case 'trackLimits':
      return rivals.available.trackLimits;
    default:
      return true;
  }
};

/**
 * The columns to draw, in the configured order: those switched on that the
 * sim and the session can fill. An order saved by an older build is topped
 * up with the columns it does not name, in their default place at the end;
 * a key this build does not know is skipped.
 */
export const resolveBattleColumns = (
  settings: BattleConfig | undefined,
  rivals: Availability
): BattleColumnKey[] => {
  const configured = (settings?.displayOrder ?? []).filter(isColumnKey);
  const order = [
    ...configured,
    ...BATTLE_COLUMN_KEYS.filter((key) => !configured.includes(key)),
  ];
  return order.filter(
    (key) => settings?.[key]?.enabled === true && hasData(key, rivals)
  );
};
