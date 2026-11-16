import { memo, useRef } from 'react';
import { useElementSize } from '@irdashies/context';
import type {
  TimelineAxis,
  TimelineBar,
  TimelineRow,
} from '@irdashies/domain/raceForecast';

/** A bar's height and the space under it, CSS pixels. */
export const TIMELINE_BAR_PX = 22;
export const TIMELINE_ROW_GAP_PX = 8;
/** The width the chart is laid out at before it has been measured. */
const FALLBACK_WIDTH_PX = 600;
/** Kept clear between two bars that touch, so a stop shows as a break. */
const BAR_GAP_PX = 2;
/** Roughly what a letter of a bar's label takes, and the room around it. */
const LETTER_PX = 6.4;
const LABEL_PADDING_PX = 8;
/** A tick this near an end of the scale would run into its caption. */
const TICK_CLEARANCE = 0.06;

/** The own car's drivers, in the order they first drove. */
const DRIVER_FILL = [
  'fill-amber-400',
  'fill-teal-400',
  'fill-purple-400',
  'fill-sky-400',
  'fill-rose-400',
  'fill-lime-400',
];
const DRIVER_STROKE = [
  'stroke-amber-400',
  'stroke-teal-400',
  'stroke-purple-400',
  'stroke-sky-400',
  'stroke-rose-400',
  'stroke-lime-400',
];
const DRIVER_TEXT = [
  'fill-amber-300',
  'fill-teal-300',
  'fill-purple-300',
  'fill-sky-300',
  'fill-rose-300',
  'fill-lime-300',
];
/** A rival's bars: one shade, and the other after each driver change. */
const RIVAL_FILL = ['fill-slate-500', 'fill-slate-400'];

const at = (classes: readonly string[], index: number): string =>
  classes[index % classes.length];

/** The last word of a name: what fits on a bar. */
const shortName = (driver: string): string => {
  const parts = driver.trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
};

interface BarProps {
  x: number;
  y: number;
  width: number;
  own: boolean;
  forecast: boolean;
  driverIndex: number;
  driverChanges: number;
  /** The name to write on it, already known to fit; '' for none. */
  label: string;
}

const Bar = memo(
  ({
    x,
    y,
    width,
    own,
    forecast,
    driverIndex,
    driverChanges,
    label,
  }: BarProps) => (
    <g data-testid="stint-bar" data-kind={forecast ? 'forecast' : 'driven'}>
      <rect
        // A dashed outline is drawn inside its box, like the filled bars.
        x={forecast ? x + 0.5 : x}
        y={forecast ? y + 0.5 : y}
        width={Math.max(1, forecast ? width - 1 : width)}
        height={forecast ? TIMELINE_BAR_PX - 1 : TIMELINE_BAR_PX}
        rx={3}
        strokeDasharray={forecast ? '4 3' : undefined}
        className={
          forecast
            ? `fill-none ${own ? at(DRIVER_STROKE, driverIndex) : 'stroke-slate-500'}`
            : own
              ? at(DRIVER_FILL, driverIndex)
              : at(RIVAL_FILL, driverChanges)
        }
      />
      {label && (
        <text
          x={x + width / 2}
          y={y + TIMELINE_BAR_PX / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={`pointer-events-none text-[11px] ${
            forecast ? at(DRIVER_TEXT, driverIndex) : 'fill-slate-900 font-bold'
          }`}
        >
          {label}
        </text>
      )}
    </g>
  )
);
Bar.displayName = 'TimelineBar';

export interface TimelineChartProps {
  axis: TimelineAxis;
  rows: readonly TimelineRow[];
  /** Write who drove each stint of the own car on its bar. */
  showDrivers: boolean;
}

/**
 * The bars and the scale under them, drawn in SVG at the width the chart
 * has: stints driven filled, stints to come dashed, and a line for now.
 */
export const TimelineChart = memo(
  ({ axis, rows, showDrivers }: TimelineChartProps) => {
    const box = useRef<HTMLDivElement>(null);
    const measured = useElementSize(box).width;
    const width = measured > 0 ? measured : FALLBACK_WIDTH_PX;
    const height =
      rows.length * (TIMELINE_BAR_PX + TIMELINE_ROW_GAP_PX) -
      TIMELINE_ROW_GAP_PX;
    const x = (value: number): number =>
      (Math.min(Math.max(value, 0), axis.end) / axis.end) * width;

    const bar = (
      row: TimelineRow,
      rowIndex: number,
      entry: TimelineBar,
      index: number
    ) => {
      const from = x(entry.from);
      const to = x(entry.to);
      // The filled part of the stint under way runs straight into its
      // dashed rest; every other pair of bars is kept apart.
      const next = row.bars[index + 1];
      const joined =
        entry.kind === 'driven' &&
        entry.current &&
        next?.kind === 'forecast' &&
        next.current;
      const barWidth = Math.max(1, to - from - (joined ? 0 : BAR_GAP_PX));
      const name = row.own && showDrivers ? shortName(entry.driver) : '';
      return (
        <Bar
          key={`${entry.kind}:${index}`}
          x={from}
          y={rowIndex * (TIMELINE_BAR_PX + TIMELINE_ROW_GAP_PX)}
          width={barWidth}
          own={row.own}
          forecast={entry.kind === 'forecast'}
          driverIndex={entry.driverIndex}
          driverChanges={entry.driverChanges}
          label={
            name.length * LETTER_PX + LABEL_PADDING_PX <= barWidth ? name : ''
          }
        />
      );
    };

    const nowX = x(axis.now);
    return (
      <div ref={box} className="min-w-0">
        <svg
          data-testid="stint-timeline-chart"
          role="img"
          aria-label="Stints driven and stints forecast, from the start of the race to the flag"
          width={width}
          height={height + 8}
          viewBox={`0 -4 ${width} ${height + 8}`}
          className="block"
        >
          {rows.map((row, rowIndex) => (
            <g key={row.carIdx} data-testid="stint-row" data-car={row.carIdx}>
              {row.bars.map((entry, index) => bar(row, rowIndex, entry, index))}
            </g>
          ))}
          <line
            data-testid="stint-timeline-now"
            x1={nowX}
            x2={nowX}
            y1={-4}
            y2={height + 4}
            strokeWidth={2}
            className="stroke-white"
          />
        </svg>
        <div className="relative mt-1 h-3.5 text-[0.6875rem] leading-none text-slate-400">
          <span className="absolute left-0">start</span>
          {axis.ticks
            .filter(
              (tick) =>
                tick.at / axis.end > TICK_CLEARANCE &&
                tick.at / axis.end < 1 - TICK_CLEARANCE
            )
            .map((tick) => (
              <span
                key={tick.at}
                data-testid="stint-timeline-tick"
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${(tick.at / axis.end) * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          <span className="absolute right-0">flag</span>
        </div>
      </div>
    );
  }
);
TimelineChart.displayName = 'TimelineChart';
