import { isCleanLap } from '@irdashies/shared';
import type { RaceLap } from '@irdashies/types';
import {
  buildFittedAxis,
  type LinearAxis,
} from '@irdashies/utils/charts/linearAxis';
import { carLapsView } from './carLaps';
import {
  driverOrder,
  isDrivenStint,
  lapEnergyUse,
  lapsAroundStop,
  lapsByStint,
  stopSeen,
  type CarRaceRecord,
} from './carRecord';
import { NO_FIGURE, formatLapTime, formatShare } from './crew';

/**
 * The Race Charts, worked out from the records of a few cars: what is
 * drawn of a car's laps over a run of lap numbers, and the scale it is
 * drawn against.
 *
 * Three charts are made here. Pace is a car's lap times. Gap is another
 * car's line crossing against ours for the same lap number. Usage is what
 * each lap of our car took of what it runs on.
 *
 * Nothing is filled in. A lap that is not held breaks a line; a time that
 * does not fit the scale is a mark at its edge, with the time it really was
 * kept for whoever points at it.
 */

/** The laps a chart is drawn over, by number, both ends drawn. */
export interface LapSpan {
  from: number;
  to: number;
}

/** A chart of the whole race is never drawn narrower than this many laps. */
export const WHOLE_RACE_MIN_LAPS = 20;

/** The number of the last lap a car is known to have completed; 0 with none. */
export const lastLapOf = (record: CarRaceRecord | undefined): number =>
  Math.max(
    0,
    record?.laps[record.laps.length - 1]?.lap ?? 0,
    record?.missingLaps[record.missingLaps.length - 1] ?? 0
  );

/**
 * The laps drawn: the last `laps` our car has completed, or the whole race
 * for 0. Null before it has completed one.
 *
 * Early on the span is as wide as it will be later and fills from the left,
 * so that a chart does not stretch three laps across the panel and then
 * squeeze them again a lap at a time.
 */
export const chartSpan = (lastLap: number, laps: number): LapSpan | null => {
  if (!(lastLap > 0)) return null;
  if (!(laps > 0)) {
    return { from: 1, to: Math.max(lastLap, WHOLE_RACE_MIN_LAPS) };
  }
  const from = Math.max(1, lastLap - laps + 1);
  return { from, to: from + laps - 1 };
};

const inSpan = (lap: number, span: LapSpan): boolean =>
  lap >= span.from && lap <= span.to;

/** One lap of a line: its number, and what is plotted for it. */
export interface ChartPoint {
  lap: number;
  value: number;
}

/** A run of laps one after the other, joined by a line. */
export interface ChartSegment {
  /**
   * The place of who drove it among the car's drivers, in the order they
   * first drove: what a line of our own car is coloured by.
   */
  driverIndex: number;
  points: ChartPoint[];
}

/** A lap whose value does not fit the scale, drawn at the edge it is past. */
export interface ChartMark {
  lap: number;
  /** Past the top of the scale's values, or under the bottom of them. */
  edge: 'high' | 'low';
  driverIndex: number;
}

/** What is drawn of one car. */
export interface ChartLine {
  segments: ChartSegment[];
  marks: ChartMark[];
}

/** What a chart says of one lap of one car to whoever points at it. */
export interface LapReading {
  /** The figure as it is printed: a lap time, a gap, a share. */
  text: string;
  /** Who drove the lap, as the session names them; '' where not known. */
  driver: string;
  /** What happened on the lap, in the words of Car Laps; '' with nothing. */
  note: string;
}

/** Which stint each held lap was driven in, and who drove that stint. */
interface LapStints {
  /** The stint's place in the record, by lap number. */
  stintOf: Map<number, number>;
  /** The driver's place among the car's drivers, by lap number. */
  driverOf: Map<number, number>;
}

const lapStints = (record: CarRaceRecord): LapStints => {
  const drivers = driverOrder(record.stints);
  const stintOf = new Map<number, number>();
  const driverOf = new Map<number, number>();
  lapsByStint(record.stints, record.laps).forEach((ownLaps, at) => {
    const driver = Math.max(0, drivers.indexOf(record.stints[at].driver));
    for (const lap of ownLaps) {
      stintOf.set(lap.lap, at);
      driverOf.set(lap.lap, driver);
    }
  });
  return { stintOf, driverOf };
};

/**
 * Joins the laps that have a value into runs. A run ends where the next
 * lap's number does not follow, where it was driven in another stint, and
 * where a lap between has nothing to plot: a line is never drawn across a
 * stop, a change of driver or a lap that is not there.
 */
const joinLaps = (
  record: CarRaceRecord,
  span: LapSpan,
  valueOf: (lap: RaceLap, before: RaceLap | undefined) => number | null,
  fits: (value: number) => 'high' | 'low' | null = () => null
): ChartLine => {
  const { stintOf, driverOf } = lapStints(record);
  const line: ChartLine = { segments: [], marks: [] };
  let segment: ChartSegment | null = null;
  let lastLap = Number.NaN;
  let lastStint = Number.NaN;
  let before: RaceLap | undefined;
  for (const lap of record.laps) {
    const value = inSpan(lap.lap, span) ? valueOf(lap, before) : null;
    before = lap;
    if (value === null || !Number.isFinite(value)) {
      segment = null;
      continue;
    }
    const driverIndex = driverOf.get(lap.lap) ?? 0;
    const edge = fits(value);
    if (edge) {
      line.marks.push({ lap: lap.lap, edge, driverIndex });
      segment = null;
      continue;
    }
    const stint = stintOf.get(lap.lap) ?? -1;
    if (!segment || lap.lap !== lastLap + 1 || stint !== lastStint) {
      segment = { driverIndex, points: [] };
      line.segments.push(segment);
    }
    segment.points.push({ lap: lap.lap, value });
    lastLap = lap.lap;
    lastStint = stint;
  }
  return line;
};

/** A lap time the sim gave: zero and less are how "no time" is written. */
const timeOf = (lap: RaceLap): number | null =>
  lap.lapTime !== null && Number.isFinite(lap.lapTime) && lap.lapTime > 0
    ? lap.lapTime
    : null;

/**
 * How far past the quartiles of the clean laps the pace scale reaches, in
 * the distance between them. Two is wide enough for a stint's tyres going
 * off and a lap behind slower traffic, and too narrow for a lap that lost
 * several seconds.
 */
export const PACE_FENCE = 2;
/** The room left above and below the laps the scale is fitted to. */
const PACE_MARGIN = 0.06;
const PACE_MARGIN_MIN_S = 0.05;
/** A scale is never finer than this from top to bottom, seconds. */
export const PACE_MIN_SPAN_S = 1;

/** A value part of the way through a sorted list, between two of its entries. */
const quantile = (sorted: readonly number[], share: number): number => {
  const at = (sorted.length - 1) * share;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};

/**
 * The range of lap times a pace scale covers, fitted to the middle of the
 * laps given: from the quickest to the slowest of those within
 * `PACE_FENCE` times the distance between the quartiles of either
 * quartile, with a little room. A lap far from the rest does not move it.
 * Null with no lap.
 */
export const paceRange = (
  times: readonly number[]
): { min: number; max: number } | null => {
  const sorted = times.filter((time) => Number.isFinite(time) && time > 0);
  if (sorted.length === 0) return null;
  sorted.sort((a, b) => a - b);
  const lower = quantile(sorted, 0.25);
  const upper = quantile(sorted, 0.75);
  const reach = (upper - lower) * PACE_FENCE;
  const within = sorted.filter(
    (time) => time >= lower - reach && time <= upper + reach
  );
  let min = within[0] ?? lower;
  let max = within[within.length - 1] ?? upper;
  const margin = Math.max(PACE_MARGIN_MIN_S, (max - min) * PACE_MARGIN);
  min -= margin;
  max += margin;
  if (max - min < PACE_MIN_SPAN_S) {
    const middle = (min + max) / 2;
    min = middle - PACE_MIN_SPAN_S / 2;
    max = middle + PACE_MIN_SPAN_S / 2;
  }
  return { min, max };
};

/**
 * The scale of a pace chart, fitted to the clean laps of the cars drawn: a
 * lap in or out of the pits, the lap from the grid and a lap under a
 * full-course yellow would each flatten every other lap against one edge,
 * and take no part in it. With no clean lap among them it is fitted to the
 * laps there are. Null while none of the cars has a timed lap in the span.
 *
 * @param maxLines How many gridlines the plot has room for.
 */
export const paceAxis = (
  cars: readonly (readonly RaceLap[])[],
  span: LapSpan,
  maxLines: number
): LinearAxis | null => {
  const clean: number[] = [];
  const timed: number[] = [];
  for (const laps of cars) {
    for (const lap of laps) {
      const time = inSpan(lap.lap, span) ? timeOf(lap) : null;
      if (time === null) continue;
      timed.push(time);
      if (isCleanLap(lap.flags)) clean.push(time);
    }
  }
  const range = paceRange(clean.length > 0 ? clean : timed);
  return range ? buildFittedAxis(range.min, range.max, maxLines) : null;
};

/**
 * A car's lap times over the span, against a scale: the laps that fit it
 * joined into lines, and each lap that does not as a mark at the edge it
 * is past. A lap the sim gave no time is neither.
 */
export const paceLine = (
  record: CarRaceRecord,
  span: LapSpan,
  axis: LinearAxis
): ChartLine =>
  joinLaps(record, span, timeOf, (time) =>
    time > axis.max ? 'high' : time < axis.min ? 'low' : null
  );

/**
 * Another car against ours at the line, lap number for lap number: the
 * seconds between our crossing that ended a lap and theirs that ended the
 * lap of the same number. Positive is behind us, negative ahead.
 *
 * A car a lap down is therefore a lap's time behind, and not the few
 * seconds it may be from us on the road. Where either car's lap of a
 * number is not held there is no gap for it, and the line breaks.
 */
export const gapLine = (
  own: readonly RaceLap[],
  rival: readonly RaceLap[],
  span: LapSpan
): ChartLine => {
  const crossed = new Map<number, number>();
  for (const lap of rival) {
    if (inSpan(lap.lap, span) && Number.isFinite(lap.sessionTime)) {
      crossed.set(lap.lap, lap.sessionTime);
    }
  }
  const line: ChartLine = { segments: [], marks: [] };
  let segment: ChartSegment | null = null;
  let lastLap = Number.NaN;
  for (const lap of own) {
    const theirs = crossed.get(lap.lap);
    if (theirs === undefined || !Number.isFinite(lap.sessionTime)) continue;
    if (!segment || lap.lap !== lastLap + 1) {
      segment = { driverIndex: 0, points: [] };
      line.segments.push(segment);
    }
    segment.points.push({ lap: lap.lap, value: theirs - lap.sessionTime });
    lastLap = lap.lap;
  }
  return line;
};

/** Every value plotted, over a few lines; null with none. */
const extentOf = (
  lines: readonly ChartLine[]
): { min: number; max: number } | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (const segment of line.segments) {
      for (const { value } of segment.points) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
};

/** The room a scale leaves above and below the values it is fitted to. */
const SCALE_MARGIN = 0.06;

/** A scale over the values given with that room, never thinner than asked. */
const roomyAxis = (
  low: number,
  high: number,
  minSpan: number,
  maxLines: number
): LinearAxis => {
  const margin = Math.max(
    (high - low) * SCALE_MARGIN,
    (minSpan - (high - low)) / 2
  );
  return buildFittedAxis(low - margin, high + margin, maxLines);
};

/** A gap scale is never finer than this from top to bottom, seconds. */
const GAP_MIN_SPAN_S = 2;

/**
 * The scale of a gap chart: every gap drawn, and our own car's zero. Null
 * while there is no gap to draw.
 */
export const gapAxis = (
  lines: readonly ChartLine[],
  maxLines: number
): LinearAxis | null => {
  const extent = extentOf(lines);
  return extent
    ? roomyAxis(
        Math.min(0, extent.min),
        Math.max(0, extent.max),
        GAP_MIN_SPAN_S,
        maxLines
      )
    : null;
};

/**
 * Which budget the car's laps were recorded in: its virtual energy, or its
 * fuel. Null where the sim published neither for any lap of it, which under
 * iRacing is always, and the Usage chart is then not offered.
 */
export const usageBudget = (
  record: CarRaceRecord | undefined
): 'energy' | 'fuel' | null => {
  const metered = record?.laps.find((lap) => lap.energy !== null);
  if (!metered) return null;
  return metered.energyIsVirtual ? 'energy' : 'fuel';
};

/**
 * What each lap of a car used, in percent of a full budget. A lap the car
 * ended with more than it began is a refill and has no figure, so the line
 * breaks at every stop.
 */
export const usageLine = (record: CarRaceRecord, span: LapSpan): ChartLine =>
  joinLaps(record, span, (lap, before) => {
    const { used } = lapEnergyUse(lap, before);
    return used === null ? null : used * 100;
  });

/** A usage scale is never finer than this from top to bottom, percent. */
const USAGE_MIN_SPAN = 0.5;

/** The scale of a usage chart, fitted to the laps drawn. Null with none. */
export const usageAxis = (
  line: ChartLine,
  maxLines: number
): LinearAxis | null => {
  const extent = extentOf([line]);
  return extent
    ? roomyAxis(extent.min, extent.max, USAGE_MIN_SPAN, maxLines)
    : null;
};

/** A run of laps set off behind the lines of a chart. */
export interface ChartBand {
  /** A lap our car stood still in the pits on; laps that are not held. */
  kind: 'stop' | 'missing';
  /** Lap numbers, both drawn. */
  from: number;
  to: number;
  label: string;
}

/**
 * What is marked behind our car's lines: the lap of each stop, and each run
 * of laps that were driven while nothing was recording.
 *
 * A stop is where the record says one ended a stint, on the lap after that
 * stint's last, whichever side of the line the pit box is on. Its label
 * says a driver change where one is seen, and nothing else of what was
 * done at it.
 */
export const chartBands = (
  record: CarRaceRecord,
  span: LapSpan
): ChartBand[] => {
  const bands: ChartBand[] = [];
  const allLaps = lapsByStint(record.stints, record.laps);
  record.stints.forEach((stint, at) => {
    if (!isDrivenStint(stint) || stint.lastLap === null) return;
    const stop = stopSeen(
      stint,
      record.stints[at + 1],
      ...lapsAroundStop(stint, allLaps[at], allLaps[at + 1] ?? [])
    );
    const lap = stint.lastLap + 1;
    if (!stop || !inSpan(lap, span)) return;
    bands.push({
      kind: 'stop',
      from: lap,
      to: lap,
      label: stop.inPits
        ? 'in the pits'
        : stop.driver
          ? 'stop, driver change'
          : 'stop',
    });
  });

  let run: ChartBand | null = null;
  for (const lap of [...record.missingLaps].sort((a, b) => a - b)) {
    if (!inSpan(lap, span)) continue;
    if (run && lap === run.to + 1) {
      run.to = lap;
      continue;
    }
    run = { kind: 'missing', from: lap, to: lap, label: 'not recorded' };
    bands.push(run);
  }
  return bands.sort((a, b) => a.from - b.from);
};

/** What is said of a lap that was driven while nothing was recording. */
export const NOT_RECORDED = 'not recorded';

/**
 * What a pace chart says of each lap of a car in the span: its time as the
 * sim gave it, who drove it, and the note Car Laps has for it, which is
 * where a lap in the pits or under a full-course yellow says so.
 */
export const paceReadings = (
  record: CarRaceRecord,
  span: LapSpan
): Map<number, LapReading> => {
  const readings = new Map<number, LapReading>();
  const drivers = new Map<number, string>();
  for (const lap of record.laps) drivers.set(lap.lap, lap.driver);
  for (const row of carLapsView(record, null).rows) {
    if (row.kind === 'missing') {
      for (let lap = row.from; lap <= row.to; lap += 1) {
        if (inSpan(lap, span)) {
          readings.set(lap, { text: NOT_RECORDED, driver: '', note: '' });
        }
      }
    } else if (inSpan(row.lap, span)) {
      readings.set(row.lap, {
        text: formatLapTime(row.lapTime),
        driver: drivers.get(row.lap) ?? '',
        note: row.note,
      });
    }
  }
  return readings;
};

/** A gap in words: "4.2 s ahead", "12.8 s behind", "level". */
export const formatGap = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return NO_FIGURE;
  }
  const tenths = Math.round(Math.abs(seconds) * 10) / 10;
  if (tenths === 0) return 'level';
  return `${tenths.toFixed(1)} s ${seconds < 0 ? 'ahead' : 'behind'}`;
};

/**
 * What a gap chart says of each lap of another car: the gap, and who was
 * driving that car. A lap with no gap, because one of the two cars' laps is
 * not held, has no reading.
 */
export const gapReadings = (
  line: ChartLine,
  rival: readonly RaceLap[]
): Map<number, LapReading> => {
  const drivers = new Map<number, string>();
  for (const lap of rival) drivers.set(lap.lap, lap.driver);
  const readings = new Map<number, LapReading>();
  for (const segment of line.segments) {
    for (const point of segment.points) {
      readings.set(point.lap, {
        text: formatGap(point.value),
        driver: drivers.get(point.lap) ?? '',
        note: '',
      });
    }
  }
  return readings;
};

/**
 * What a usage chart says of each lap of our car in the span: what it used
 * in percent of a full budget, "refilled" for the lap of a stop, and --
 * where there is no reading to take it from.
 */
export const usageReadings = (
  record: CarRaceRecord,
  span: LapSpan
): Map<number, LapReading> => {
  const readings = new Map<number, LapReading>();
  let before: RaceLap | undefined;
  for (const lap of record.laps) {
    if (inSpan(lap.lap, span)) {
      const { used, refilled } = lapEnergyUse(lap, before);
      readings.set(lap.lap, {
        text: refilled ? 'refilled' : formatShare(used),
        driver: lap.driver,
        note: '',
      });
    }
    before = lap;
  }
  for (const lap of record.missingLaps) {
    if (inSpan(lap, span)) {
      readings.set(lap, { text: NOT_RECORDED, driver: '', note: '' });
    }
  }
  return readings;
};

/** The fewest decimals a multiple of `step` is written out in full with. */
const decimalsOf = (step: number): number => {
  for (let decimals = 0; decimals < 3; decimals += 1) {
    const scaled = Math.abs(step) * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 3;
};

/**
 * A tick of a pace scale: a lap time to as many decimals as the scale's
 * step has, "1:54.5" on a scale stepping by a half and "1:54" by a second.
 */
export const formatTimeTick = (seconds: number, step: number): string => {
  const decimals = decimalsOf(step);
  const scale = 10 ** decimals;
  const total = Math.round(Math.max(0, seconds) * scale);
  const minutes = Math.floor(total / (60 * scale));
  const rest = (total - minutes * 60 * scale) / scale;
  return `${minutes}:${rest
    .toFixed(decimals)
    .padStart(decimals > 0 ? decimals + 3 : 2, '0')}`;
};

/**
 * A tick of a gap or usage scale: its size, without a sign. Which side of
 * the gap chart's zero is ahead is written on the chart, not on each tick.
 */
export const formatSizeTick = (value: number, step: number): string =>
  Math.abs(value).toFixed(decimalsOf(step));
