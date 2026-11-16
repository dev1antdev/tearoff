import { memo, useMemo, type CSSProperties, type Ref } from 'react';
import type { ForecastTone } from '@irdashies/domain/raceForecast';
import { ClassLabel } from '../../shared/ClassLabel/ClassLabel';
import { Compound } from '../../shared/Compound/Compound';

const TONE_CLASS: Record<ForecastTone, string> = {
  good: 'text-green-400',
  bad: 'text-red-400',
  plain: 'text-slate-200',
  quiet: 'text-slate-400',
};

/** Which groups of columns the table has. */
export interface ClassRivalColumns {
  stops: boolean;
  /** The compound and the laps on the set. */
  tyres: boolean;
  /** The tread left as well, where the sim gives one to work from. */
  tread: boolean;
  nextStop: boolean;
  netGap: boolean;
  pace: boolean;
}

/**
 * The Tyres column in rem: the compound and room for "136+", and with the
 * tread room for "<100%" as well.
 */
const TYRES_REM = 3.25;
const TYRES_WITH_TREAD_REM = 5.75;

/** The least the driver's name is given, rem; it takes what is left over. */
const DRIVER_MIN_REM = 5.5;
/** The space between two columns (`gap-x-1.5`) and beside the row (`px-3`). */
const COLUMN_GAP_REM = 0.375;
const ROW_PADDING_REM = 1.5;

/** The fixed columns in rem: place and number, then gap and the groups on. */
const fixedColumns = (columns: ClassRivalColumns): number[][] => [
  [1.25, 2.75],
  [
    3.25,
    ...(columns.stops ? [2.5, 6.5, 2.5] : []),
    ...(columns.tyres
      ? [columns.tread ? TYRES_WITH_TREAD_REM : TYRES_REM]
      : []),
    ...(columns.nextStop ? [5.75] : []),
    ...(columns.netGap ? [3.75] : []),
    ...(columns.pace ? [4] : []),
  ],
];

/**
 * The columns as a CSS grid, shared by the captions and every row so they
 * line up: place, number, driver, gap, then the groups switched on, the
 * tyres after the stops they are counted from.
 */
export const classRivalGrid = (columns: ClassRivalColumns): CSSProperties => {
  const [before, after] = fixedColumns(columns);
  return {
    gridTemplateColumns: [
      ...before.map((rem) => `${rem}rem`),
      `minmax(${DRIVER_MIN_REM}rem, 1fr)`,
      ...after.map((rem) => `${rem}rem`),
    ].join(' '),
  };
};

/**
 * The narrowest the table is laid out at: every column at its least. A
 * panel narrower than this scrolls sideways, with every row the same
 * width, so the columns still line up.
 */
export const classRivalMinWidth = (columns: ClassRivalColumns): string => {
  const widths = [...fixedColumns(columns).flat(), DRIVER_MIN_REM];
  const total =
    widths.reduce((sum, rem) => sum + rem, 0) +
    (widths.length - 1) * COLUMN_GAP_REM +
    ROW_PADDING_REM;
  return `${total}rem`;
};

const ROW = 'grid items-center gap-x-1.5 px-3';
const RIGHT = 'text-right';

/** The captions over the columns. */
export const ClassRivalCaptions = memo(
  ({ columns }: { columns: ClassRivalColumns }) => (
    <div
      data-testid="class-rivals-captions"
      // Stays put while the cars scroll under it, so it is opaque.
      className={`${ROW} sticky top-0 z-10 border-b border-slate-600 bg-slate-800 py-1.5 text-[0.6875rem] font-medium uppercase leading-none tracking-wide text-slate-400`}
      style={classRivalGrid(columns)}
    >
      <span>P</span>
      <span>#</span>
      <span>Driver</span>
      <span className={RIGHT}>Gap</span>
      {columns.stops && (
        <>
          <span className={RIGHT}>Stops</span>
          <span className={RIGHT}>Last stop</span>
          <span className={RIGHT}>Since</span>
        </>
      )}
      {columns.tyres && <span className={RIGHT}>Tyres</span>}
      {columns.nextStop && <span className={RIGHT}>Next</span>}
      {columns.netGap && <span className={RIGHT}>Net gap</span>}
      {columns.pace && <span className={RIGHT}>Pace 5</span>}
    </div>
  )
);
ClassRivalCaptions.displayName = 'ClassRivalCaptions';

export interface ClassRivalRowProps {
  carIdx: number;
  own: boolean;
  classPosition: number;
  number: string;
  name: string;
  classColor: number | undefined;
  highlightColor: number;
  isMultiClass: boolean;
  gap: string;
  stops: string;
  lastStop: string;
  since: string;
  nextStop: string;
  /** The stops it owes are assumed: its forecast cells are drawn fainter. */
  assumed: boolean;
  netGap: string;
  netGapTone: ForecastTone;
  pace: string;
  paceTone: ForecastTone;
  /**
   * The four compounds on the car, LF RF LR RR, as indices of the session's
   * tyre list joined by commas; '' where they are not known.
   */
  tyreCompounds: string;
  /** The laps on the set, as written: "17", "17?" or "17+". */
  tyreLaps: string;
  /** The tread left, as written: "86%", "~86%", "<86%" or "--". */
  tyreTread: string;
  /** Both in a sentence, for whoever points at the cell. */
  tyreTitle: string;
  showStops: boolean;
  showTyres: boolean;
  showTread: boolean;
  showNextStop: boolean;
  showNetGap: boolean;
  showPace: boolean;
  /** Set on the own row, which the list brings into view. */
  rowRef?: Ref<HTMLDivElement>;
}

/**
 * One car of the class. Every prop is a string, a number or a flag, so a
 * row whose figures have not moved is not drawn again when the forecast is.
 */
export const ClassRivalRow = memo(
  ({
    carIdx,
    own,
    classPosition,
    number,
    name,
    classColor,
    highlightColor,
    isMultiClass,
    gap,
    stops,
    lastStop,
    since,
    nextStop,
    assumed,
    netGap,
    netGapTone,
    pace,
    paceTone,
    tyreCompounds,
    tyreLaps,
    tyreTread,
    tyreTitle,
    showStops,
    showTyres,
    showTread,
    showNextStop,
    showNetGap,
    showPace,
    rowRef,
  }: ClassRivalRowProps) => {
    const faint = assumed ? 'opacity-60' : '';
    const wheels = useMemo(
      () => (tyreCompounds ? tyreCompounds.split(',').map(Number) : undefined),
      [tyreCompounds]
    );
    return (
      <div
        ref={rowRef}
        data-testid="class-rival"
        data-car={carIdx}
        data-own={own}
        data-assumed={assumed}
        className={`${ROW} border-b border-slate-700/60 py-1.5 leading-none ${
          own ? 'bg-amber-300/10 text-amber-300' : 'text-slate-200'
        }`}
        style={classRivalGrid({
          stops: showStops,
          tyres: showTyres,
          tread: showTread,
          nextStop: showNextStop,
          netGap: showNetGap,
          pace: showPace,
        })}
      >
        <span className={own ? 'font-bold' : 'text-slate-400'}>
          {classPosition > 0 ? classPosition : ''}
        </span>
        <ClassLabel
          name={number ? `#${number}` : '#'}
          color={classColor}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
          className="justify-self-start rounded-sm px-1.5 py-0.5 text-xs leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]"
        />
        <span className={`min-w-0 truncate ${own ? 'font-bold' : ''}`}>
          {name}
        </span>
        <span data-testid="class-rival-gap" className={RIGHT}>
          {gap}
        </span>
        {showStops && (
          <>
            <span data-testid="class-rival-stops" className={RIGHT}>
              {stops}
            </span>
            <span
              data-testid="class-rival-last-stop"
              className={`${RIGHT} truncate`}
            >
              {lastStop}
            </span>
            <span data-testid="class-rival-since" className={RIGHT}>
              {since}
            </span>
          </>
        )}
        {showTyres && (
          <span
            data-testid="class-rival-tyres"
            title={tyreTitle || undefined}
            // Each figure in a place of its own, so that they line up down
            // the column whatever the row holds.
            className="flex items-center justify-end gap-1"
          >
            <span className="flex w-[1.2em] shrink-0 items-center">
              {wheels && (
                <Compound tireCompound={wheels[0]} wheelCompounds={wheels} />
              )}
            </span>
            <span
              data-testid="class-rival-tyre-laps"
              className="w-7 shrink-0 text-right"
            >
              {tyreLaps}
            </span>
            {showTread && (
              <span
                data-testid="class-rival-tyre-tread"
                className={`w-[2.4rem] shrink-0 text-right ${own ? 'text-amber-300/70' : 'text-slate-400'}`}
              >
                {tyreTread}
              </span>
            )}
          </span>
        )}
        {showNextStop && (
          <span
            data-testid="class-rival-next"
            className={`${RIGHT} truncate ${faint}`}
          >
            {nextStop}
          </span>
        )}
        {showNetGap && (
          <span
            data-testid="class-rival-net-gap"
            data-tone={netGapTone}
            className={`${RIGHT} ${own ? '' : TONE_CLASS[netGapTone]} ${faint}`}
          >
            {netGap}
          </span>
        )}
        {showPace && (
          <span
            data-testid="class-rival-pace"
            data-tone={paceTone}
            className={`${RIGHT} ${own ? '' : TONE_CLASS[paceTone]}`}
          >
            {pace}
          </span>
        )}
      </div>
    );
  }
);
ClassRivalRow.displayName = 'ClassRivalRow';
