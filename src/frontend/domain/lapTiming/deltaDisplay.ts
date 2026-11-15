/**
 * How a lap delta and a lap time are written and coloured, for every widget
 * that prints one in a tile. Pure, so the rules can be tested without
 * rendering anything.
 */

export type DeltaTone = 'faster' | 'slower' | 'level' | 'none';

/** Decimal places a lap time can be written to. */
export type LapTimeDecimals = 1 | 2 | 3;

/** The largest delta drawn in full. Past it the figure pins rather than grow. */
const DELTA_CAP_SECONDS = 99.99;

/**
 * The delta with its sign, or dashes when there is none.
 *
 * Rounded before the sign is chosen, so a delta of two thousandths at two
 * decimals reads 0.00 and not -0.00.
 */
export const formatDelta = (delta: number | null, decimals: 2 | 3): string => {
  if (delta === null || !Number.isFinite(delta)) {
    return `-.${'-'.repeat(decimals)}`;
  }
  const capped = Math.max(
    -DELTA_CAP_SECONDS,
    Math.min(DELTA_CAP_SECONDS, delta)
  );
  const text = Math.abs(capped).toFixed(decimals);
  if (Number(text) === 0) return text;
  return `${capped < 0 ? '-' : '+'}${text}`;
};

/** Whether the lap is up, down or level on its reference, as it is drawn. */
export const deltaTone = (delta: number | null, decimals: 2 | 3): DeltaTone => {
  if (delta === null || !Number.isFinite(delta)) return 'none';
  const shown = Number(Math.abs(delta).toFixed(decimals));
  if (shown === 0) return 'level';
  return delta < 0 ? 'faster' : 'slower';
};

/**
 * The lap time this lap is heading for: the reference's time plus what has
 * been gained or lost on it so far. Null without both.
 */
export const predictedLapTime = (
  lapTime: number | null,
  delta: number | null
): number | null => {
  if (lapTime === null || delta === null) return null;
  const predicted = lapTime + delta;
  return predicted > 0 ? predicted : null;
};

/**
 * A lap time as m:ss.mmm, or dashes of the same shape when there is none.
 *
 * Rounded once, to the precision asked for, so 59.9996 s reads 1:00.000 and
 * never 0:60.000.
 */
export const formatLapTime = (
  seconds: number | null,
  decimals: LapTimeDecimals = 3
): string => {
  if (seconds === null || !(seconds > 0) || !Number.isFinite(seconds)) {
    return `-:--.${'-'.repeat(decimals)}`;
  }
  const scale = 10 ** decimals;
  const total = Math.round(seconds * scale);
  const whole = Math.floor(total / scale);
  const minutes = Math.floor(whole / 60);
  const fraction = String(total % scale).padStart(decimals, '0');
  return `${minutes}:${String(whole % 60).padStart(2, '0')}.${fraction}`;
};

/**
 * A sector time: seconds alone under a minute (32.739), minutes with them
 * from there on (1:12.480), and two dashes when there is none.
 */
export const formatSectorTime = (
  seconds: number | null,
  decimals: LapTimeDecimals = 3
): string => {
  if (seconds === null || !(seconds > 0) || !Number.isFinite(seconds)) {
    return '--';
  }
  const scale = 10 ** decimals;
  const total = Math.round(seconds * scale);
  if (total >= 60 * scale) return formatLapTime(seconds, decimals);
  const fraction = String(total % scale).padStart(decimals, '0');
  return `${Math.floor(total / scale)}.${fraction}`;
};
