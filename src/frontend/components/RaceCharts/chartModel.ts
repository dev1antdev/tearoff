import {
  chartBands,
  chartSpan,
  driverOrder,
  formatSizeTick,
  formatTimeTick,
  gapAxis,
  gapLine,
  gapReadings,
  lastLapOf,
  paceAxis,
  paceLine,
  paceReadings,
  usageAxis,
  usageBudget,
  usageLine,
  usageReadings,
  type CarRaceRecord,
  type ChartBand,
  type ChartLine,
  type ChartRivalRole,
  type LapReading,
  type LapSpan,
} from '@irdashies/domain/raceHistory';
import type { RaceChartsLaps, RaceChartsTab } from '@irdashies/types';
import type { LinearAxis } from '@irdashies/utils/charts/linearAxis';
import { driverColour } from '../shared/DriverColour/driverColours';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';

/**
 * One of the three charts, ready to draw: what the domain's rules make of
 * the records for the tab and the laps chosen, with the words around it.
 */

/** One car's line on a chart. */
export interface ChartSeries {
  carIdx: number;
  number: string;
  /** Our own car: drawn heavier, in the colours of its drivers. */
  own: boolean;
  /** Which of the three other lines a car that is not ours is drawn with. */
  line: number;
  drawn: ChartLine;
  /** What is said of each lap to whoever points at it. */
  readings: ReadonlyMap<number, LapReading>;
}

/**
 * A line of the legend under a chart. A car's number and a driver's name
 * are apart, so that a legend short of room can write less of them.
 */
export type LegendEntry =
  /** A driver of our car, in the colour of their laps. */
  | {
      kind: 'driver';
      key: string;
      colour: number;
      /** Our car, as "#77". */
      number: string;
      /** Empty where the record does not name them. */
      name: string;
    }
  /** Another car, with who drives it and why it is drawn. */
  | {
      kind: 'car';
      key: string;
      line: number;
      number: string;
      name: string;
      role: string;
    }
  /** What a band behind the lines stands for, or a mark at the edge. */
  | {
      kind: 'stop' | 'missing' | 'mark';
      key: string;
      /** A word before the text that it can be read without. */
      lead?: string;
      text: string;
    };

export interface ChartModel {
  tab: RaceChartsTab;
  span: LapSpan;
  axis: LinearAxis;
  /**
   * The scale's smallest value is at the top: a gap, where a car ahead of
   * us is a negative one and belongs above the line.
   */
  inverted: boolean;
  series: ChartSeries[];
  bands: ChartBand[];
  legend: LegendEntry[];
  /** What the scale counts. */
  caption: string;
  /** Which way is which, written at the top and the bottom of the scale. */
  sides: { top: string; bottom: string } | null;
  /** The text of a tick of the scale. */
  tick: (value: number) => string;
  /** The chart in a sentence, for a reader that cannot see it. */
  summary: string;
}

/** A car drawn beside our own, with what has been read of it so far. */
export interface ChartRivalInput {
  carIdx: number;
  number: string;
  role: ChartRivalRole;
  line: number;
  record: CarRaceRecord | undefined;
}

export interface ChartInput {
  tab: RaceChartsTab;
  laps: RaceChartsLaps;
  own: { carIdx: number; number: string; record: CarRaceRecord };
  rivals: readonly ChartRivalInput[];
  /** Whether other cars are chosen by number: what is said with none. */
  chosen: boolean;
  /** How many gridlines the plot has room for. */
  maxLines: number;
}

/** A driver as the chart names them: an initial and the surname. */
export const shortDriver = (name: string): string =>
  name ? DriverName(extractDriverName(name), 'n.-surname') : '';

const ROLE_TEXT: Record<ChartRivalRole, string> = {
  leader: 'leader',
  ahead: 'ahead',
  behind: 'behind',
  chosen: '',
};

const listed = (numbers: readonly string[]): string =>
  numbers.length < 2
    ? numbers.join('')
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;

/** Who was driving a car on its most recent lap of the span. */
const latestDriver = (record: CarRaceRecord, span: LapSpan): string => {
  for (let index = record.laps.length - 1; index >= 0; index -= 1) {
    const lap = record.laps[index];
    if (lap.lap <= span.to) return lap.lap >= span.from ? lap.driver : '';
  }
  return '';
};

/** The drivers of our car with a lap on the chart, each in their colour. */
const driverEntries = (
  own: ChartInput['own'],
  drawn: ChartLine
): LegendEntry[] => {
  const drivers = driverOrder(own.record.stints);
  const shown = new Set<number>();
  for (const segment of drawn.segments) shown.add(segment.driverIndex);
  for (const mark of drawn.marks) shown.add(mark.driverIndex);
  return [...shown]
    .sort((a, b) => a - b)
    .map((index) => ({
      kind: 'driver' as const,
      key: `driver-${index}`,
      colour: driverColour(index, true),
      number: `#${own.number}`,
      name: shortDriver(drivers[index] ?? ''),
    }));
};

const carEntry = (rival: ChartRivalInput, span: LapSpan): LegendEntry => ({
  kind: 'car',
  key: `car-${rival.carIdx}`,
  line: rival.line,
  number: `#${rival.number}`,
  name: rival.record ? shortDriver(latestDriver(rival.record, span)) : '',
  role: ROLE_TEXT[rival.role],
});

/** What each kind of band stands for, once for each kind on the chart. */
const bandEntries = (bands: readonly ChartBand[]): LegendEntry[] => {
  const entries: LegendEntry[] = [];
  if (bands.some((band) => band.kind === 'stop')) {
    entries.push({
      kind: 'stop',
      key: 'stop',
      lead: 'our',
      text: 'pit stop',
    });
  }
  if (bands.some((band) => band.kind === 'missing')) {
    entries.push({ kind: 'missing', key: 'missing', text: 'not recorded' });
  }
  return entries;
};

const NO_OTHER_CAR = {
  around:
    'No other car to draw yet: the cars around us in class are known once the race is under way.',
  chosen: 'None of the car numbers chosen in the settings is in this session.',
};

/**
 * The chart for a tab, or the one line said in its place while there is
 * nothing to draw.
 */
export const buildChart = ({
  tab,
  laps,
  own,
  rivals,
  chosen,
  maxLines,
}: ChartInput): ChartModel | string => {
  const span = chartSpan(lastLapOf(own.record), laps);
  if (!span) return `No lap of #${own.number} has been recorded yet.`;
  const bands = chartBands(own.record, span);
  const lapsText = `laps ${span.from} to ${Math.min(span.to, lastLapOf(own.record))}`;
  const read = rivals.filter(
    (rival): rival is ChartRivalInput & { record: CarRaceRecord } =>
      rival.record !== undefined
  );

  if (tab === 'usage') {
    const drawn = usageLine(own.record, span);
    const axis = usageAxis(drawn, maxLines);
    const budget = usageBudget(own.record);
    if (!axis || !budget) {
      return `Nothing has been read of what #${own.number} used over these laps.`;
    }
    return {
      tab,
      span,
      axis,
      inverted: false,
      series: [
        {
          carIdx: own.carIdx,
          number: own.number,
          own: true,
          line: 0,
          drawn,
          readings: usageReadings(own.record, span),
        },
      ],
      bands,
      legend: [...driverEntries(own, drawn), ...bandEntries(bands)],
      caption:
        budget === 'energy'
          ? 'Energy a lap, % of a full budget'
          : 'Fuel a lap, % of a full tank',
      sides: null,
      tick: (value) => formatSizeTick(value, axis.step),
      summary: `What each lap of #${own.number} used over ${lapsText}.`,
    };
  }

  if (tab === 'gap') {
    if (rivals.length === 0) {
      return chosen ? NO_OTHER_CAR.chosen : NO_OTHER_CAR.around;
    }
    if (read.length === 0) return 'Reading the race history.';
    const series = read.map((rival) => {
      const drawn = gapLine(own.record.laps, rival.record.laps, span);
      return {
        carIdx: rival.carIdx,
        number: rival.number,
        own: false,
        line: rival.line,
        drawn,
        readings: gapReadings(drawn, rival.record.laps),
      };
    });
    const axis = gapAxis(
      series.map((entry) => entry.drawn),
      maxLines
    );
    if (!axis) {
      return `No lap of these is held for both #${own.number} and another car.`;
    }
    return {
      tab,
      span,
      axis,
      inverted: true,
      series,
      bands,
      legend: [
        ...read.map((rival) => carEntry(rival, span)),
        ...bandEntries(bands),
      ],
      caption: `Gap to #${own.number} at the line, seconds`,
      sides: { top: 'ahead of us', bottom: 'behind us' },
      tick: (value) => formatSizeTick(value, axis.step),
      summary: `The gap at the line between #${own.number} and ${listed(
        read.map((rival) => `#${rival.number}`)
      )} over ${lapsText}.`,
    };
  }

  const axis = paceAxis(
    [own.record.laps, ...read.map((rival) => rival.record.laps)],
    span,
    maxLines
  );
  if (!axis) return `No lap of #${own.number} in these laps has a time yet.`;
  const ownDrawn = paceLine(own.record, span, axis);
  const series: ChartSeries[] = [
    // Ours last, so that it is drawn over the others.
    ...read.map((rival) => ({
      carIdx: rival.carIdx,
      number: rival.number,
      own: false,
      line: rival.line,
      drawn: paceLine(rival.record, span, axis),
      readings: paceReadings(rival.record, span),
    })),
    {
      carIdx: own.carIdx,
      number: own.number,
      own: true,
      line: 0,
      drawn: ownDrawn,
      readings: paceReadings(own.record, span),
    },
  ];
  const marked = series.some((entry) => entry.drawn.marks.length > 0);
  return {
    tab,
    span,
    axis,
    inverted: false,
    series,
    bands,
    legend: [
      ...driverEntries(own, ownDrawn),
      ...read.map((rival) => carEntry(rival, span)),
      ...bandEntries(bands),
      ...(marked
        ? [
            {
              kind: 'mark' as const,
              key: 'mark',
              lead: 'lap',
              text: 'off the scale',
            },
          ]
        : []),
    ],
    caption: 'Lap time',
    sides: { top: 'slower', bottom: 'faster' },
    tick: (value) => formatTimeTick(value, axis.step),
    summary:
      read.length > 0
        ? `Lap times of #${own.number} over ${lapsText}, against ${listed(
            read.map((rival) => `#${rival.number}`)
          )}.`
        : `Lap times of #${own.number} over ${lapsText}.`,
  };
};
