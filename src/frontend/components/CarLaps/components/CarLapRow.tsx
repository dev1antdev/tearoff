import { memo, type CSSProperties } from 'react';
import type { LapTone } from '@irdashies/domain/raceHistory/carLaps';

/** Which of the columns that need the sim to publish something are drawn. */
export interface CarLapColumns {
  sectors: boolean;
  energy: boolean;
}

/** The least the note is given, rem; it takes what is left over. */
const NOTE_MIN_REM = 6;
/** The space between two columns (`gap-x-2`) and beside the row (`px-3`). */
const COLUMN_GAP_REM = 0.5;
const ROW_PADDING_REM = 1.5;

/** The fixed columns in rem: lap, time, the sectors, the energy. */
const fixedColumns = ({ sectors, energy }: CarLapColumns): number[] => [
  2.5,
  4.75,
  ...(sectors ? [3.75, 3.75, 3.75] : []),
  ...(energy ? [4] : []),
];

/** The columns as a CSS grid, shared by the captions and every row. */
export const carLapGrid = (columns: CarLapColumns): CSSProperties => ({
  gridTemplateColumns: [
    ...fixedColumns(columns).map((rem) => `${rem}rem`),
    `minmax(${NOTE_MIN_REM}rem, 1fr)`,
  ].join(' '),
});

/**
 * The narrowest the table is laid out at. A panel narrower than this
 * scrolls it sideways, with every row the same width.
 */
export const carLapMinWidth = (columns: CarLapColumns): string => {
  const widths = [...fixedColumns(columns), NOTE_MIN_REM];
  const total =
    widths.reduce((sum, rem) => sum + rem, 0) +
    (widths.length - 1) * COLUMN_GAP_REM +
    ROW_PADDING_REM;
  return `${total}rem`;
};

const ROW = 'grid items-baseline gap-x-2 px-3';
const RIGHT = 'text-right';

const TIME_CLASS: Record<LapTone, string> = {
  classBest: 'text-purple-400',
  stintBest: 'text-green-400',
  plain: 'text-white',
  quiet: 'text-slate-400',
};

interface CarLapCaptionsProps extends CarLapColumns {
  /** "Energy" or "Fuel": what the car runs on. */
  energyCaption: string;
}

/** The captions over the laps. */
export const CarLapCaptions = memo(
  ({ sectors, energy, energyCaption }: CarLapCaptionsProps) => (
    <div
      data-testid="car-laps-captions"
      // Stays put while the laps scroll under it, so it is opaque.
      className={`${ROW} sticky top-0 z-10 border-b overlay-divider bg-slate-900 py-1.5 text-xs leading-none font-semibold tracking-wider text-slate-400 uppercase`}
      style={carLapGrid({ sectors, energy })}
    >
      <span>Lap</span>
      <span className={RIGHT}>Time</span>
      {sectors && (
        <>
          <span className={RIGHT}>S1</span>
          <span className={RIGHT}>S2</span>
          <span className={RIGHT}>S3</span>
        </>
      )}
      {energy && <span className={RIGHT}>{energyCaption}</span>}
      <span>Note</span>
    </div>
  )
);
CarLapCaptions.displayName = 'CarLapCaptions';

export interface CarLapRowProps extends CarLapColumns {
  lap: number;
  time: string;
  tone: LapTone;
  sector1: string;
  sector2: string;
  sector3: string;
  /** The sector is the best of the lap's stint. */
  sector1Best: boolean;
  sector2Best: boolean;
  sector3Best: boolean;
  /** What the lap used: "2.4 %", "refilled" or "--". */
  energyUsed: string;
  note: string;
}

/**
 * One lap of the car. Every prop is a string, a number or a flag, so a lap
 * that has not changed is not drawn again when a new one is added.
 */
export const CarLapRow = memo(
  ({
    sectors,
    energy,
    lap,
    time,
    tone,
    sector1,
    sector2,
    sector3,
    sector1Best,
    sector2Best,
    sector3Best,
    energyUsed,
    note,
  }: CarLapRowProps) => {
    // A lap that is not a clean one is written quieter throughout.
    const figure = tone === 'quiet' ? 'text-slate-400' : '';
    const sector = (text: string, best: boolean) => (
      <span
        data-best={best}
        className={`${RIGHT} ${best ? 'text-green-400' : figure}`}
      >
        {text}
      </span>
    );
    return (
      <div
        data-testid="car-lap"
        data-lap={lap}
        data-tone={tone}
        className={`${ROW} border-b overlay-divider py-1`}
        style={carLapGrid({ sectors, energy })}
      >
        <span className="text-slate-400">{lap}</span>
        <span
          data-testid="car-lap-time"
          className={`${RIGHT} font-bold ${TIME_CLASS[tone]}`}
        >
          {time}
        </span>
        {sectors && (
          <>
            {sector(sector1, sector1Best)}
            {sector(sector2, sector2Best)}
            {sector(sector3, sector3Best)}
          </>
        )}
        {energy && (
          <span data-testid="car-lap-energy" className={`${RIGHT} ${figure}`}>
            {energyUsed}
          </span>
        )}
        <span data-testid="car-lap-note" className="text-slate-400">
          {note}
        </span>
      </div>
    );
  }
);
CarLapRow.displayName = 'CarLapRow';

/** A run of laps that were not recorded, in one quiet line. */
export const MissingLapsLine = memo(({ text }: { text: string }) => (
  <div
    data-testid="car-laps-missing"
    className="border-b border-slate-700/60 px-3 py-1 text-sm text-slate-500 italic"
  >
    {text}
  </div>
));
MissingLapsLine.displayName = 'MissingLapsLine';
