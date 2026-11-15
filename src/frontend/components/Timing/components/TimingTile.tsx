import { memo } from 'react';
import { CrownSimpleIcon, WarningIcon } from '@phosphor-icons/react';

export interface TimingTileProps {
  /** Names the tile for the specs, e.g. `timing-delta`. */
  testId: string;
  label: string;
  /** The figure as drawn, dashes included. */
  value: string;
  /** The tile's share of its row, and its tint if it has one. */
  boxClassName: string;
  labelClassName?: string;
  /** Size and colour of the figure. */
  valueClassName: string;
  /**
   * A mark beside the label: a crown for the best lap that is also the
   * session's, or the warning below where the figure has no room for it.
   */
  labelIcon?: 'crown' | 'warning';
  /** A mark beside the figure: a lap or a sector that did not count. */
  valueIcon?: 'warning';
}

/**
 * One tile of the panel: a small label over a large figure.
 *
 * Strings in and nothing else, so a tile is redrawn only when what it shows
 * has changed: a delta moving fifteen times a second redraws one tile.
 */
export const TimingTile = memo(
  ({
    testId,
    label,
    value,
    boxClassName,
    labelClassName = 'text-slate-400',
    valueClassName,
    labelIcon,
    valueIcon,
  }: TimingTileProps) => (
    <div
      data-testid={testId}
      className={`flex min-w-0 flex-col justify-center gap-[0.3em] rounded ${boxClassName}`}
    >
      <span
        data-testid={`${testId}-label`}
        className={`flex items-center gap-[0.4em] whitespace-nowrap text-[0.65em] font-semibold uppercase leading-none tracking-wider ${labelClassName}`}
      >
        {label}
        {/*
          The marks are a little taller than the label and give that height
          back in margin, so a tile with one keeps its figure level with
          its neighbours'.
        */}
        {labelIcon === 'crown' && (
          <CrownSimpleIcon
            aria-label="Session best"
            weight="fill"
            size="1.2em"
            className="-my-[0.1em] flex-none text-purple-300"
          />
        )}
        {labelIcon === 'warning' && (
          <WarningIcon
            aria-label="Did not count"
            weight="fill"
            size="1.2em"
            className="-my-[0.1em] flex-none text-amber-300"
          />
        )}
      </span>
      <span
        className={`flex items-center gap-[0.25em] whitespace-nowrap font-bold leading-none tabular-nums ${valueClassName}`}
      >
        <span data-testid={`${testId}-value`}>{value}</span>
        {valueIcon === 'warning' && (
          <WarningIcon
            aria-label="Did not count"
            weight="fill"
            size="0.6em"
            className="flex-none text-amber-300"
          />
        )}
      </span>
    </div>
  )
);
TimingTile.displayName = 'TimingTile';
