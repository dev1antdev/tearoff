import { memo } from 'react';

export interface LoadBarProps {
  /** How full the bar is, 0..1. */
  fill: number;
  /**
   * A warning turns the whole track red, not just the fill: a corner that is
   * bottoming, or a wheel carrying next to nothing, has no fill left to
   * colour.
   */
  warn: boolean;
  /** The side of the car the bar is on: it grows away from the centreline. */
  side: 'left' | 'right';
  /** Where the widget's own tests find the fill. */
  testId?: string;
  /** The widget's own layout around the bar. */
  className?: string;
}

/**
 * A thin bar growing outwards from the car's centreline: a ride height in
 * Chassis, the load on a wheel in Tyres.
 */
export const LoadBar = memo(
  ({ fill, warn, side, testId, className = '' }: LoadBarProps) => (
    <div
      className={`flex h-[0.4em] overflow-hidden rounded-full ${warn ? 'bg-red-500' : 'bg-slate-900/70'} ${side === 'left' ? 'justify-end' : 'justify-start'} ${className}`}
    >
      <div
        data-testid={testId}
        className={`h-full rounded-full ${warn ? 'bg-red-500' : 'bg-slate-300'}`}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </div>
  )
);
LoadBar.displayName = 'LoadBar';
