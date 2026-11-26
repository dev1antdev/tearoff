/**
 * The row of buttons over a widget's table or chart, and one button of it.
 *
 * Two widgets share it (the Race Charts' charts and laps, the Race Log's
 * scopes), so a change to the look lands in both at once. The size is the
 * caller's: each bar sizes its buttons to its own type step.
 */
export const buttonGroupClass =
  'flex overflow-hidden rounded-md border border-slate-600';

/** One button of a button group: how it reads on and off. */
export const buttonGroupButtonClass = (on: boolean, size: string): string =>
  `${size} ${
    on
      ? 'bg-slate-600 font-semibold text-white'
      : 'text-slate-300 hover:bg-slate-700/70'
  }`;
