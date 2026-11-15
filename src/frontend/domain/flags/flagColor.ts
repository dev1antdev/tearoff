import type { FlagKind } from '@irdashies/types';

/**
 * The colour of each flag as a CSS value, for a glow or an outline. These are
 * the theme's own palette entries, the ones `getFlagColor` resolves, written
 * as variables so that they can be used in a style without reading the
 * computed document.
 */
const FLAG_COLOR: Record<FlagKind, string> = {
  none: 'var(--color-gray-400)',
  green: 'var(--color-green-500)',
  yellow: 'var(--color-yellow-400)',
  fullCourseYellow: 'var(--color-yellow-400)',
  debris: 'var(--color-yellow-400)',
  blue: 'var(--color-blue-500)',
  white: '#ffffff',
  chequered: '#ffffff',
  red: 'var(--color-red-500)',
  penalty: 'var(--color-slate-400)',
  disqualified: 'var(--color-red-500)',
  meatball: 'var(--color-orange-500)',
  start: 'var(--color-slate-500)',
};

export const flagColor = (kind: FlagKind): string => FLAG_COLOR[kind];
