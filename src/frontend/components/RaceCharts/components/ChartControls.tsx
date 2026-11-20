import { memo } from 'react';
import {
  RACE_CHARTS_LAPS,
  type RaceChartsLaps,
  type RaceChartsTab,
} from '@irdashies/types';

const TAB_LABELS: Record<RaceChartsTab, string> = {
  pace: 'Pace',
  gap: 'Gap',
  usage: 'Usage',
};

const lapsLabel = (laps: RaceChartsLaps): string =>
  laps === 0 ? 'All' : `${laps}`;

const GROUP =
  'flex flex-none overflow-hidden rounded-md border border-slate-600';

const buttonClass = (on: boolean): string =>
  `px-2.5 py-0.5 leading-5 ${
    on
      ? 'bg-slate-600 font-semibold text-white'
      : 'text-slate-300 hover:bg-slate-700/70'
  }`;

export interface ChartControlsProps {
  /** The charts on offer: Usage is left out where nothing is published. */
  tabs: readonly RaceChartsTab[];
  tab: RaceChartsTab;
  laps: RaceChartsLaps;
  onTab: (tab: RaceChartsTab) => void;
  onLaps: (laps: RaceChartsLaps) => void;
  /** What the chart's scale counts. Left out while there is no chart. */
  caption?: string;
  /** Said beside it where laps of ours are not held: "7 laps not recorded". */
  missing?: string;
}

/**
 * The bar over the chart: which chart, what its scale counts, and over how
 * many laps.
 *
 * The caption is in the bar and has no row of its own, which a short panel
 * needs for its plot. Between the two groups of buttons it has whatever
 * room they leave and is cut where that is too little, with the whole of it
 * for whoever points at it; in a bar under 400 pixels wide, where they
 * leave none, it goes under them.
 *
 * The chart and the laps change what is drawn for as long as the widget is
 * on screen and are not saved: it opens as its settings say.
 */
export const ChartControls = memo(
  ({
    tabs,
    tab,
    laps,
    onTab,
    onLaps,
    caption,
    missing,
  }: ChartControlsProps) => (
    <div
      data-testid="race-charts-controls"
      // Asked for its own width by the row inside it. Sized in pixels: the
      // page's own type scale is not the overlay's.
      className="@container flex-none border-b overlay-divider text-sm"
    >
      <div className="flex items-center gap-x-3 gap-y-0.5 px-2 py-1 @max-[399px]:flex-wrap">
        <div role="group" aria-label="Chart" className={GROUP}>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`race-charts-tab-${id}`}
              aria-pressed={tab === id}
              onClick={() => onTab(id)}
              className={buttonClass(tab === id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
        {/* Always there, so that the laps stay at the right of a bar that
            has no caption to say. */}
        <div className="flex min-w-0 flex-1 items-baseline gap-x-3 overflow-hidden text-xs leading-4 text-slate-400 @max-[399px]:order-last @max-[399px]:basis-full @max-[399px]:justify-between">
          {caption && (
            <span
              data-testid="race-charts-caption"
              title={caption}
              className="min-w-0 truncate"
            >
              {caption}
            </span>
          )}
          {missing && (
            // Never cut short while the caption can be: it is the warning.
            <span
              data-testid="race-charts-missing"
              className="flex-none whitespace-nowrap text-amber-400"
            >
              {missing}
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1.5 @max-[399px]:ml-auto">
          <span className="text-xs text-slate-400">Laps</span>
          <div role="group" aria-label="Laps drawn" className={GROUP}>
            {RACE_CHARTS_LAPS.map((count) => (
              <button
                key={count}
                type="button"
                data-testid={`race-charts-laps-${count}`}
                aria-pressed={laps === count}
                aria-label={
                  count === 0 ? 'The whole race' : `Last ${count} laps`
                }
                onClick={() => onLaps(count)}
                className={buttonClass(laps === count)}
              >
                {lapsLabel(count)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
);
ChartControls.displayName = 'ChartControls';
