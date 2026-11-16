import { memo, type CSSProperties } from 'react';
import type { StintPaceTone } from '@irdashies/domain/lapTiming/stintPaceDisplay';
import { driverTextClass, driverTintClass } from '../crewColours';

/** The least the driver's name and the stop are given, rem. */
const DRIVER_MIN_REM = 5;
const STOP_MIN_REM = 9;
/** The space between two columns (`gap-x-1.5`) and beside the row (`px-3`). */
const COLUMN_GAP_REM = 0.375;
const ROW_PADDING_REM = 1.5;

/** The fixed columns in rem: the number, then the figures. */
const fixedColumns = (energy: boolean): number[][] => [
  [1.5],
  [2.25, 2.75, 4, 4.5, ...(energy ? [3.5] : [])],
];

/**
 * The columns as a CSS grid, shared by the captions and every row so they
 * line up: number, driver, laps, time, mean, best, energy a lap, the stop.
 */
export const crewStintGrid = (energy: boolean): CSSProperties => {
  const [before, after] = fixedColumns(energy);
  return {
    gridTemplateColumns: [
      ...before.map((rem) => `${rem}rem`),
      `minmax(${DRIVER_MIN_REM}rem, 1fr)`,
      ...after.map((rem) => `${rem}rem`),
      // The stop says the most, and takes most of what is left over.
      `minmax(${STOP_MIN_REM}rem, 2fr)`,
    ].join(' '),
  };
};

/**
 * The narrowest the list is laid out at. A panel narrower than this scrolls
 * it sideways, with every row the same width.
 */
export const crewStintMinWidth = (energy: boolean): string => {
  const widths = [...fixedColumns(energy).flat(), DRIVER_MIN_REM, STOP_MIN_REM];
  const total =
    widths.reduce((sum, rem) => sum + rem, 0) +
    (widths.length - 1) * COLUMN_GAP_REM +
    ROW_PADDING_REM;
  return `${total}rem`;
};

const ROW = 'grid items-baseline gap-x-1.5 px-3';
const RIGHT = 'text-right';
/** The stop is words after a run of figures: it stands a little off them. */
const STOP = 'pl-2';

const PACE_CLASS: Record<StintPaceTone, string> = {
  faster: 'text-green-400',
  slower: 'text-red-400',
  level: 'text-slate-200',
  none: 'text-slate-400',
};

interface CrewStintCaptionsProps {
  /** Left out, the list has no such column. */
  energyCaption?: string;
}

/** The captions over the stints. */
export const CrewStintCaptions = memo(
  ({ energyCaption }: CrewStintCaptionsProps) => (
    <div
      data-testid="crew-stint-captions"
      className={`${ROW} py-1.5 text-[0.6875rem] leading-none font-medium tracking-wide text-slate-400 uppercase`}
      style={crewStintGrid(energyCaption !== undefined)}
    >
      <span>#</span>
      <span>Driver</span>
      <span className={RIGHT}>Laps</span>
      <span className={RIGHT}>Time</span>
      <span className={RIGHT}>Avg</span>
      <span className={RIGHT}>Best</span>
      {energyCaption !== undefined && (
        <span className={RIGHT}>{energyCaption}</span>
      )}
      <span className={STOP}>Stop after</span>
    </div>
  )
);
CrewStintCaptions.displayName = 'CrewStintCaptions';

export interface CrewStintRowProps {
  ordinal: number;
  name: string;
  /** The driver's colour: see `driverColour`. */
  colour: number;
  laps: number;
  time: string;
  avg: string;
  best: string;
  /** What a lap of it used; left out, the list has no such column. */
  energy?: string;
  /** The stint under way. */
  underWay: boolean;
  /** How it ended, or that it has not: "58 s: energy, driver". */
  end: string;
  /**
   * The stint under way against an earlier one: "+0.29 vs M. Ivanov". Empty
   * with nothing to compare.
   */
  pace: string;
  paceTone: StintPaceTone;
}

/**
 * One stint of the car. Every prop is a string, a number or a flag, so a
 * row whose figures have not moved is not drawn again when the record is.
 */
export const CrewStintRow = memo(
  ({
    ordinal,
    name,
    colour,
    laps,
    time,
    avg,
    best,
    energy,
    underWay,
    end,
    pace,
    paceTone,
  }: CrewStintRowProps) => (
    <div
      data-testid="crew-stint"
      data-stint={ordinal}
      data-under-way={underWay}
      className={`${ROW} py-1 ${underWay ? driverTintClass(colour) : ''}`}
      style={crewStintGrid(energy !== undefined)}
    >
      <span className="text-slate-400">{ordinal}</span>
      <span className={`truncate font-bold ${driverTextClass(colour)}`}>
        {name}
      </span>
      <span className={RIGHT}>{laps}</span>
      <span className={RIGHT}>{time}</span>
      <span className={RIGHT}>{avg}</span>
      <span className={RIGHT}>{best}</span>
      {energy !== undefined && (
        <span data-testid="crew-stint-energy" className={RIGHT}>
          {energy}
        </span>
      )}
      {/* The pace goes under "under way" as one piece where the two do
          not fit side by side. */}
      <span className={`${STOP} flex flex-wrap gap-x-2`}>
        <span
          data-testid="crew-stint-end"
          className={underWay ? 'text-slate-400' : ''}
        >
          {end}
        </span>
        {pace && (
          <span
            data-testid="crew-stint-pace"
            data-tone={paceTone}
            className={`font-bold whitespace-nowrap ${PACE_CLASS[paceTone]}`}
          >
            {pace}
          </span>
        )}
      </span>
    </div>
  )
);
CrewStintRow.displayName = 'CrewStintRow';
