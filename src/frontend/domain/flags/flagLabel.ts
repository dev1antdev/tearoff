import type { FlagDetail, FlagKind } from '@irdashies/types';

/**
 * The labels the LED-matrix `flag` widget draws. Its `FlagDisplay` reads the
 * first word, so these are the strings `getFlag` used to hand it.
 */
export type FlagWidgetLabel =
  | 'NO FLAG'
  | 'GREEN'
  | 'YELLOW'
  | 'BLUE FLAG'
  | 'WHITE'
  | 'CHECKERED'
  | 'RED'
  | 'BLACK FLAG'
  | 'MEATBALL'
  | 'DEBRIS'
  | 'DISQUALIFIED';

const LABELS: Record<FlagKind, FlagWidgetLabel> = {
  none: 'NO FLAG',
  // The matrix has no drawing for the grid or the lights.
  start: 'NO FLAG',
  green: 'GREEN',
  yellow: 'YELLOW',
  fullCourseYellow: 'YELLOW',
  blue: 'BLUE FLAG',
  white: 'WHITE',
  chequered: 'CHECKERED',
  red: 'RED',
  penalty: 'BLACK FLAG',
  meatball: 'MEATBALL',
  debris: 'DEBRIS',
  disqualified: 'DISQUALIFIED',
};

/**
 * The label of a resolved flag for the matrix widget.
 *
 * `greenWhenClear` off draws green only while it is announced, after the
 * start and after a yellow, which is how iRacing itself shows it; a clear
 * track is then no flag.
 */
export const flagWidgetLabel = (
  kind: FlagKind,
  detail: FlagDetail,
  greenWhenClear = true
): FlagWidgetLabel =>
  kind === 'green' && !greenWhenClear && detail === 'trackClear'
    ? 'NO FLAG'
    : LABELS[kind];

/** The first word of a label, which is what the flag colour helpers key on. */
export const flagLabelType = (label: FlagWidgetLabel): string =>
  label.split(' ')[0];
