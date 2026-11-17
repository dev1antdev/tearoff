import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { NO_FIGURE, type ChartBand } from '@irdashies/domain/raceHistory';
import {
  lapLabelCapacity,
  roundLapTicks,
  valueToY,
} from '@irdashies/utils/charts/linearAxis';
import { linePath } from '@irdashies/utils/charts/linePath';
import {
  anchorInsideBounds,
  type EdgeAnchor,
} from '@irdashies/utils/charts/readoutAnchor';
import {
  driverColour,
  driverMarkClass,
  driverStrokeClass,
} from '../../shared/DriverColour/driverColours';
import { OWN_LINE_PX, RIVAL_LINE_PX, rivalLook } from '../chartLook';
import { shortDriver, type ChartModel, type ChartSeries } from '../chartModel';
import { LineKey } from './ChartLegend';

/** The room around the plot, CSS pixels: the scale, and the lap numbers. */
const AXIS_PX = 46;
const RIGHT_PX = 10;
const TOP_PX = 6;
const BOTTOM_PX = 18;
/** What one mark takes in the pile of marks at a lap. */
const MARK_ROW_PX = 8;
/** Half the width of such a mark. */
const MARK_HALF_PX = 3.5;
/** Roughly what a lap number takes along the bottom, and a letter of a label. */
const LAP_LABEL_PX = 38;
const LETTER_PX = 5.4;
/** The height of a line of such letters. */
const LINE_PX = 12;
/** Kept clear around words written in the plot. */
const WORD_GAP_PX = 4;
/** How far the readout stands off the lap pointed at, and off the top. */
const READOUT_OFFSET_PX = 12;
const READOUT_TOP_PX = 2;

interface BandLabel {
  x: number;
  y: number;
  text: string;
  /** Written up the band, which is too narrow to hold it across. */
  turned: boolean;
}

interface Geometry {
  x0: number;
  x1: number;
  /**
   * The plot's box. The values are drawn over the whole of it: the marks
   * and the words of a band are inside it and take no room from it.
   */
  y0: number;
  y1: number;
  lapWidth: number;
  piles: MarkPiles;
  bandLabels: BandLabel[];
  /** Where the words for the two ends of the scale stand. */
  sides: { x: number; top: number; bottom: number; onRight: boolean };
}

/** Our own car first: in a readout, and nearest the edge in a pile of marks. */
const ownFirst = (series: readonly ChartSeries[]): ChartSeries[] =>
  [...series].sort((a, b) => Number(b.own) - Number(a.own));

interface MarkPiles {
  /** A mark's place in the pile at its lap and edge, by car and lap. */
  place: Map<string, number>;
  /** The marks piled at each lap: at the top of the plot, and at the bottom. */
  top: Map<number, number>;
  bottom: Map<number, number>;
}

const pileKey = (carIdx: number, lap: number): string => `${carIdx}:${lap}`;

/**
 * Where each mark for a lap off the scale goes. Cars that are off it on the
 * same lap, as all are under a full-course yellow, are piled from the edge
 * inwards, so that none hides another.
 *
 * @param atTop Whether a mark past this end of the scale is at the top.
 */
const pilesOf = (
  series: readonly ChartSeries[],
  atTop: (edge: 'high' | 'low') => boolean
): MarkPiles => {
  const piles: MarkPiles = {
    place: new Map(),
    top: new Map(),
    bottom: new Map(),
  };
  for (const entry of ownFirst(series)) {
    for (const mark of entry.drawn.marks) {
      const pile = atTop(mark.edge) ? piles.top : piles.bottom;
      const place = pile.get(mark.lap) ?? 0;
      pile.set(mark.lap, place + 1);
      piles.place.set(pileKey(entry.carIdx, mark.lap), place);
    }
  }
  return piles;
};

/** What a pile of so many marks covers of the plot, from its edge inwards. */
const pileDepth = (marks: number): number =>
  marks > 0 ? marks * MARK_ROW_PX + 2 : 0;

/** The tallest pile over a run of laps. */
const tallestPile = (
  pile: ReadonlyMap<number, number>,
  from: number,
  to: number
): number => {
  let tallest = 0;
  for (const [lap, marks] of pile) {
    if (lap >= from && lap <= to) tallest = Math.max(tallest, marks);
  }
  return tallest;
};

/** A band's box, and the words that must be kept clear of in the corners. */
interface BandRoom {
  left: number;
  width: number;
  /** The plot's box. */
  y0: number;
  y1: number;
  /**
   * For a band under the corners' words: how far down the upper ones
   * reach, and how far up the lower ones. Left out for a band that is not.
   */
  corner?: { top: number; bottom: number };
}

/**
 * The words in a band, where it has room for them: its own, or just "stop"
 * for a stop whose longer label does not fit. They are written across a
 * band wide enough to hold them and up one that is not, as a stop of one
 * lap is, under the marks piled at the band's laps.
 */
const labelOf = (
  band: ChartBand,
  piles: MarkPiles,
  { left, width, y0, y1, corner }: BandRoom
): BandLabel | null => {
  const from = Math.max(
    y0 + pileDepth(tallestPile(piles.top, band.from, band.to)),
    corner?.top ?? y0
  );
  const to = Math.min(
    y1 - pileDepth(tallestPile(piles.bottom, band.from, band.to)),
    corner?.bottom ?? y1
  );
  const room = to - from - 2 * WORD_GAP_PX;
  const x = left + width / 2;
  const texts =
    band.kind === 'stop' && band.label !== 'stop'
      ? [band.label, 'stop']
      : [band.label];
  for (const text of texts) {
    const length = text.length * LETTER_PX;
    if (width >= length + 2 * WORD_GAP_PX && room >= LINE_PX) {
      return { x, y: from + WORD_GAP_PX + 9, text, turned: false };
    }
    if (room >= length) {
      return { x, y: from + WORD_GAP_PX, text, turned: true };
    }
  }
  return null;
};

interface ReadoutProps {
  model: ChartModel;
  lap: number;
  anchor: EdgeAnchor;
}

/** What every car did on the lap pointed at. */
const Readout = ({ model, lap, anchor }: ReadoutProps) => {
  const band =
    model.tab === 'pace'
      ? undefined
      : model.bands.find((entry) => lap >= entry.from && lap <= entry.to);
  return (
    <div
      data-testid="race-charts-readout"
      className="pointer-events-none absolute z-10 max-w-[17rem] rounded-sm border border-slate-600 bg-slate-900/95 px-2 py-1.5 text-[11px] leading-snug shadow-lg"
      style={anchor}
    >
      <div className="mb-0.5 font-bold tracking-wide text-slate-400">
        Lap {lap}
        {band && <span className="font-normal"> · {band.label}</span>}
      </div>
      {ownFirst(model.series).map((entry) => {
        const reading = entry.readings.get(lap);
        const driver = shortDriver(reading?.driver ?? '');
        return (
          <div key={entry.carIdx} data-testid="race-charts-reading">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <LineKey
                own={entry.own}
                // The colour of whoever drove this lap of ours.
                colour={driverColourAt(entry, lap)}
                line={entry.line}
              />
              <span className="text-slate-400">#{entry.number}</span>
              <span
                className={
                  reading ? 'font-bold text-white' : 'font-bold text-slate-500'
                }
              >
                {reading?.text ?? NO_FIGURE}
              </span>
              {driver && <span className="text-slate-400">{driver}</span>}
            </div>
            {reading?.note && (
              <div className="pl-[22px] text-[10px] text-slate-400">
                {reading.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** Who drove a lap of our car, as the place their colour is found by. */
const driverColourAt = (series: ChartSeries, lap: number): number => {
  for (const segment of series.drawn.segments) {
    const last = segment.points[segment.points.length - 1];
    if (lap >= segment.points[0].lap && lap <= last.lap) {
      return driverColour(segment.driverIndex, true);
    }
  }
  const mark = series.drawn.marks.find((entry) => entry.lap === lap);
  return driverColour(mark?.driverIndex ?? 0, true);
};

export interface ChartPlotProps {
  model: ChartModel;
  /** The box the chart is drawn in, CSS pixels. */
  width: number;
  height: number;
}

/**
 * A chart drawn in SVG at the size of its box: the scale up the side, lap
 * numbers along the bottom, a band behind the lines for each stop of ours
 * and each run of laps that were not recorded, the lines, and a mark at
 * the edge for each lap that does not fit the scale.
 *
 * The lines have the whole height of the plot. What a band is is written
 * inside it, and the marks stand inside the plot's edge, over the lines:
 * neither has a row of its own, which a short panel cannot spare.
 *
 * Pointing at it, with a mouse, a finger or the arrow keys, picks the
 * nearest lap and says what every car did on it.
 */
export const ChartPlot = memo(({ model, width, height }: ChartPlotProps) => {
  const box = useRef<HTMLDivElement>(null);
  const hatch = useId();
  const [hoverLap, setHoverLap] = useState<number | null>(null);
  const { span, axis, inverted, series, bands, sides } = model;
  const laps = span.to - span.from + 1;

  const geometry = useMemo<Geometry>(() => {
    const x0 = AXIS_PX;
    const x1 = Math.max(x0 + 40, width - RIGHT_PX);
    const lapWidth = (x1 - x0) / laps;
    const y0 = TOP_PX;
    const y1 = Math.max(y0 + 40, height - BOTTOM_PX);
    // The scale's largest values are at the top unless it is turned over.
    const piles = pilesOf(series, (edge) => (edge === 'high') !== inverted);

    // The words that say which way the scale runs stand in the corners of
    // one side: the left, unless fewer marks are piled at the laps under
    // the right. Under what is piled there they stand clear of it.
    const cornerWidth = sides
      ? Math.max(sides.top.length, sides.bottom.length) * LETTER_PX +
        2 * WORD_GAP_PX
      : 0;
    // The laps at an end whose marks reach under those words.
    const cornerLaps = Math.min(
      laps,
      Math.max(1, Math.ceil((cornerWidth + MARK_HALF_PX) / lapWidth - 0.5))
    );
    const depths = (from: number, to: number) => ({
      top: pileDepth(tallestPile(piles.top, from, to)),
      bottom: pileDepth(tallestPile(piles.bottom, from, to)),
    });
    const atLeft = depths(span.from, span.from + cornerLaps - 1);
    const atRight = depths(span.to - cornerLaps + 1, span.to);
    const onRight = atRight.top + atRight.bottom < atLeft.top + atLeft.bottom;
    const under = onRight ? atRight : atLeft;
    const sideTop = y0 + under.top + 10;
    const sideBottom = y1 - under.bottom - 4;
    const cornerFrom = onRight ? x1 - cornerWidth : x0;

    const bandLabels = bands.flatMap((band) => {
      const left = x0 + (band.from - span.from) * lapWidth;
      const bandWidth = (band.to - band.from + 1) * lapWidth;
      const label = labelOf(band, piles, {
        left,
        width: bandWidth,
        y0,
        y1,
        corner:
          left < cornerFrom + cornerWidth && left + bandWidth > cornerFrom
            ? { top: sideTop + 2, bottom: sideBottom - 8 }
            : undefined,
      });
      return label ? [label] : [];
    });
    return {
      x0,
      x1,
      y0,
      y1,
      lapWidth,
      piles,
      bandLabels,
      sides: {
        x: onRight ? x1 - WORD_GAP_PX : x0 + WORD_GAP_PX,
        top: sideTop,
        bottom: sideBottom,
        onRight,
      },
    };
  }, [width, height, laps, span.from, span.to, bands, series, inverted, sides]);
  const { x0, x1, y0, y1, lapWidth } = geometry;

  const lapX = useCallback(
    (lap: number): number => x0 + (lap - span.from + 0.5) * lapWidth,
    [x0, span.from, lapWidth]
  );
  const valueY = useCallback(
    (value: number): number => y0 + valueToY(value, axis, y1 - y0, inverted),
    [y0, y1, axis, inverted]
  );

  const lapTicks = useMemo(
    () =>
      roundLapTicks(
        span.from,
        span.to,
        lapLabelCapacity(x1 - x0, LAP_LABEL_PX)
      ),
    [span.from, span.to, x0, x1]
  );

  /** Points at the lap under a pointer, whatever scale the widget is at. */
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const x = ((event.clientX - rect.left) * width) / rect.width;
    const lap = span.from + Math.floor((x - x0) / lapWidth);
    setHoverLap(Math.min(Math.max(lap, span.from), span.to));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setHoverLap(null);
      return;
    }
    const step =
      event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setHoverLap((now) =>
      // From the newest lap, which is where a reader starts.
      Math.min(Math.max((now ?? span.to + 1) + step, span.from), span.to)
    );
  };

  // A chart of other laps has nothing at the lap pointed at before.
  const hovered =
    hoverLap !== null && hoverLap >= span.from && hoverLap <= span.to
      ? hoverLap
      : null;

  return (
    <div
      ref={box}
      data-testid="race-charts-plot"
      role="group"
      tabIndex={0}
      aria-label={`${model.summary} Point at a lap, or step through the laps with the arrow keys.`}
      className="relative h-full w-full cursor-crosshair touch-none rounded-sm select-none focus-visible:outline-1 focus-visible:outline-slate-500"
      onPointerDown={point}
      onPointerMove={point}
      // A finger that has been lifted leaves the lap it pointed at up.
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHoverLap(null);
      }}
      onBlur={() => setHoverLap(null)}
      onKeyDown={onKeyDown}
    >
      <svg
        role="img"
        aria-label={model.summary}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block tabular-nums"
      >
        <defs>
          <pattern
            id={hatch}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={6}
              className="stroke-slate-500/60"
              strokeWidth={2}
            />
          </pattern>
        </defs>

        {bands.map((band) => (
          <rect
            key={`${band.kind}-${band.from}`}
            data-testid="race-charts-band"
            data-kind={band.kind}
            data-from={band.from}
            data-to={band.to}
            x={lapX(band.from) - lapWidth / 2}
            y={y0}
            width={(band.to - band.from + 1) * lapWidth}
            height={y1 - y0}
            fill={band.kind === 'missing' ? `url(#${hatch})` : undefined}
            className={band.kind === 'stop' ? 'fill-slate-500/25' : undefined}
          />
        ))}

        {axis.values.map((value) => {
          const y = valueY(value);
          return (
            <g key={value} data-testid="race-charts-tick">
              <line
                x1={x0}
                x2={x1}
                y1={y}
                y2={y}
                // A gap's zero is our own car: the line the others are read
                // against.
                className={
                  model.tab === 'gap' && value === 0
                    ? 'stroke-slate-400'
                    : 'stroke-slate-700'
                }
                strokeWidth={1}
              />
              <text
                x={x0 - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-slate-400 text-[10px]"
              >
                {model.tick(value)}
              </text>
            </g>
          );
        })}
        <line
          x1={x0}
          x2={x1}
          y1={y1}
          y2={y1}
          className="stroke-slate-600"
          strokeWidth={1}
        />
        {lapTicks.map((lap) => (
          <g key={lap}>
            <line
              x1={lapX(lap)}
              x2={lapX(lap)}
              y1={y1}
              y2={y1 + 3}
              className="stroke-slate-600"
              strokeWidth={1}
            />
            <text
              x={lapX(lap)}
              y={y1 + 13}
              textAnchor="middle"
              className="fill-slate-400 text-[10px]"
            >
              {lap}
            </text>
          </g>
        ))}
        {/* The words written in the plot, outlined in the panel's own
            colour, so that a gridline behind a word does not strike it
            through. */}
        <g
          strokeWidth={3}
          strokeLinejoin="round"
          className="fill-slate-400 stroke-slate-800 text-[10px] [paint-order:stroke]"
        >
          {geometry.bandLabels.map((label) => (
            <text
              key={label.x}
              data-testid="race-charts-band-label"
              data-turned={label.turned || undefined}
              x={label.x}
              y={label.y}
              // Turned, it reads upwards and ends where it is anchored.
              textAnchor={label.turned ? 'end' : 'middle'}
              dominantBaseline={label.turned ? 'central' : undefined}
              transform={
                label.turned ? `rotate(-90 ${label.x} ${label.y})` : undefined
              }
            >
              {label.text}
            </text>
          ))}
          {sides && (
            <g textAnchor={geometry.sides.onRight ? 'end' : 'start'}>
              <text
                data-testid="race-charts-side"
                x={geometry.sides.x}
                y={geometry.sides.top}
              >
                {sides.top}
              </text>
              <text
                data-testid="race-charts-side"
                x={geometry.sides.x}
                y={geometry.sides.bottom}
              >
                {sides.bottom}
              </text>
            </g>
          )}
        </g>

        {series.map((entry) => {
          const look = rivalLook(entry.line);
          return (
            <g
              key={entry.carIdx}
              data-testid="race-charts-series"
              data-car={entry.carIdx}
            >
              {entry.drawn.segments.map((segment) => (
                <path
                  key={segment.points[0].lap}
                  data-testid="race-charts-line"
                  data-from={segment.points[0].lap}
                  data-to={segment.points[segment.points.length - 1].lap}
                  data-driver={entry.own ? segment.driverIndex : undefined}
                  d={linePath(
                    segment.points.map(({ lap, value }) => ({
                      x: lapX(lap),
                      y: valueY(value),
                    }))
                  )}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={
                    entry.own
                      ? OWN_LINE_PX
                      : model.tab === 'gap'
                        ? RIVAL_LINE_PX + 0.5
                        : RIVAL_LINE_PX
                  }
                  strokeDasharray={entry.own ? undefined : look.dash}
                  // Beside our own line the others stand back a little.
                  strokeOpacity={entry.own || model.tab === 'gap' ? 1 : 0.85}
                  className={
                    entry.own
                      ? driverStrokeClass(
                          driverColour(segment.driverIndex, true)
                        )
                      : look.stroke
                  }
                />
              ))}
              {entry.drawn.marks.map((mark) => {
                // The edge a lap is past: slower laps at the top of a pace
                // chart, whichever way the scale runs.
                const atTop = (mark.edge === 'high') !== inverted;
                const row =
                  geometry.piles.place.get(pileKey(entry.carIdx, mark.lap)) ??
                  0;
                const x = lapX(mark.lap);
                const tip = atTop
                  ? y0 + row * MARK_ROW_PX + 1
                  : y1 - row * MARK_ROW_PX - 1;
                const base = atTop ? tip + 6 : tip - 6;
                return (
                  <path
                    key={mark.lap}
                    data-testid="race-charts-mark"
                    data-lap={mark.lap}
                    data-edge={mark.edge}
                    d={`M${x - MARK_HALF_PX} ${base}L${x + MARK_HALF_PX} ${base}L${x} ${tip}Z`}
                    className={
                      entry.own
                        ? driverMarkClass(driverColour(mark.driverIndex, true))
                        : look.fill
                    }
                  />
                );
              })}
            </g>
          );
        })}

        {hovered !== null && (
          <g data-testid="race-charts-crosshair" data-lap={hovered}>
            <line
              x1={lapX(hovered)}
              x2={lapX(hovered)}
              y1={y0}
              y2={y1}
              className="stroke-slate-400"
              strokeWidth={1}
            />
            {series.map((entry) =>
              entry.drawn.segments.map((segment) => {
                const at = segment.points.find(
                  (candidate) => candidate.lap === hovered
                );
                if (!at) return null;
                return (
                  <circle
                    key={`${entry.carIdx}-${segment.points[0].lap}`}
                    cx={lapX(at.lap)}
                    cy={valueY(at.value)}
                    r={4}
                    // A ring of the panel's own colour, so that a dot is
                    // told from the line it sits on and from its neighbour.
                    strokeWidth={2}
                    className={`stroke-slate-800 ${
                      entry.own
                        ? driverMarkClass(
                            driverColour(segment.driverIndex, true)
                          )
                        : rivalLook(entry.line).fill
                    }`}
                  />
                );
              })
            )}
          </g>
        )}
      </svg>

      {hovered !== null && (
        <Readout
          model={model}
          lap={hovered}
          // Beside the lap, on the side with more room, and from the top of
          // the chart down: a readout of four cars is as tall as the plot.
          anchor={{
            ...anchorInsideBounds(
              { x: lapX(hovered), y: 0 },
              { width, height },
              READOUT_OFFSET_PX
            ),
            top: READOUT_TOP_PX,
          }}
        />
      )}
    </div>
  );
});
ChartPlot.displayName = 'ChartPlot';
