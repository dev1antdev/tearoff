/**
 * The figures of the ledger as its widgets print them: wear from the four
 * wheels, fuel in the driver's unit, a share as a percentage. Pure.
 */

/** What a cell shows where the sim gave no reading. */
export const NO_READING = '--';

export type WearMode = 'average' | 'highest';
export type FuelUnits = 'L' | 'gal';

const LITRES_PER_GALLON = 3.785411784;

/**
 * One wear figure for the four wheels: their mean, or the worst of them.
 * Wheels without a reading are left out; null when none has one.
 */
export const wheelWear = (
  wheels: readonly (number | null)[],
  mode: WearMode
): number | null => {
  const read = wheels.filter((value): value is number => value !== null);
  if (read.length === 0) return null;
  return mode === 'highest'
    ? Math.max(...read)
    : read.reduce((sum, value) => sum + value, 0) / read.length;
};

/** Litres as they are, or as US gallons. */
export const fuelInUnits = (litres: number, units: FuelUnits): number =>
  units === 'gal' ? litres / LITRES_PER_GALLON : litres;

/** A number to so many decimals, or the placeholder for none. */
export const formatFigure = (
  value: number | null | undefined,
  decimals: number
): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(decimals)
    : NO_READING;

/** A share, 0..1, as a percentage without its sign. */
export const formatShare = (
  share: number | null | undefined,
  decimals: number
): string =>
  formatFigure(typeof share === 'number' ? share * 100 : share, decimals);
