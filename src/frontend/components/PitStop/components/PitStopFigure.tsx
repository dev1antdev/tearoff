import { memo } from 'react';

export type FigureTone = 'normal' | 'good' | 'caution' | 'bad' | 'none';

const TONE_CLASS: Record<FigureTone, string> = {
  normal: 'text-white',
  good: 'text-green-400',
  caution: 'text-amber-300',
  bad: 'text-red-400',
  none: 'text-slate-500',
};

interface PitStopFigureProps {
  name: string;
  label: string;
  /** The figure as written; a dash where there is none. */
  value: string;
  unit?: string;
  /** A figure that is reckoned, not measured or stated: written with a "~". */
  approximate?: boolean;
  tone?: FigureTone;
  /** The one figure the widget is read for. */
  large?: boolean;
}

/** A labelled figure: a small caption over a number. */
export const PitStopFigure = memo(
  ({
    name,
    label,
    value,
    unit = '',
    approximate = false,
    tone = 'normal',
    large = false,
  }: PitStopFigureProps) => {
    const missing = value === '--';
    return (
      <div
        data-testid={`pit-stop-${name}`}
        data-tone={missing ? 'none' : tone}
        data-approximate={approximate && !missing}
        className="flex min-w-0 flex-col gap-1"
      >
        <span className="overlay-label leading-none">{label}</span>
        <span
          className={`whitespace-nowrap font-bold leading-none ${
            large ? 'text-4xl' : 'text-base'
          } ${TONE_CLASS[missing ? 'none' : tone]}`}
        >
          {approximate && !missing && (
            <span className="font-medium text-slate-400">~</span>
          )}
          {value}
          {unit && !missing && (
            <span className="text-[0.5em] font-semibold text-slate-400">
              {' '}
              {unit}
            </span>
          )}
        </span>
      </div>
    );
  }
);
PitStopFigure.displayName = 'PitStopFigure';
