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

const GROUP = 'flex overflow-hidden rounded border border-slate-600';

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
}

/**
 * The bar over the chart: which chart, and over how many laps.
 *
 * Both change what is drawn for as long as the widget is on screen and are
 * not saved: it opens as its settings say.
 */
export const ChartControls = memo(
  ({ tabs, tab, laps, onTab, onLaps }: ChartControlsProps) => (
    <div
      data-testid="race-charts-controls"
      // Sized in pixels: the page's own type scale is not the overlay's.
      className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-700 px-2 py-1.5 text-[12px]"
    >
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
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-400">Laps</span>
        <div role="group" aria-label="Laps drawn" className={GROUP}>
          {RACE_CHARTS_LAPS.map((count) => (
            <button
              key={count}
              type="button"
              data-testid={`race-charts-laps-${count}`}
              aria-pressed={laps === count}
              aria-label={count === 0 ? 'The whole race' : `Last ${count} laps`}
              onClick={() => onLaps(count)}
              className={buttonClass(laps === count)}
            >
              {lapsLabel(count)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
);
ChartControls.displayName = 'ChartControls';
