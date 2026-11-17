import { describe, expect, it } from 'vitest';
import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  type RaceLap,
  type RaceStint,
} from '@irdashies/types';
import {
  RACE_HISTORY_STAGE_FOR_CHARTS,
  RACE_HISTORY_STAGE_OWN_CAR,
  raceHistoryStage,
} from '../../../../.storybook/raceHistoryStage';
import { driverOrder, type CarRaceRecord } from './carRecord';
import {
  PACE_MIN_SPAN_S,
  WHOLE_RACE_MIN_LAPS,
  chartBands,
  chartSpan,
  formatGap,
  formatSizeTick,
  formatTimeTick,
  gapAxis,
  gapLine,
  gapReadings,
  lastLapOf,
  paceAxis,
  paceLine,
  paceRange,
  paceReadings,
  usageAxis,
  usageBudget,
  usageLine,
  usageReadings,
  type ChartLine,
} from './chartSeries';
import { crewView } from './crew';
import { lapOf, stintOf, stoppedStint } from './recordFixture';

/** A stint under way over a run of laps. */
const openStint = (
  ordinal: number,
  firstLap: number,
  lastLap: number,
  values: Partial<RaceStint> = {}
): RaceStint =>
  stintOf(ordinal, {
    firstLap,
    lastLap,
    laps: lastLap - firstLap + 1,
    ...values,
  });

const recordOf = (
  laps: RaceLap[],
  stints: RaceStint[] = laps.length
    ? [openStint(1, laps[0].lap, laps[laps.length - 1].lap)]
    : [stintOf(1)],
  missingLaps: number[] = []
): CarRaceRecord => ({ laps, stints, missingLaps });

/** Laps one after the other, each a little off 100 s by its number. */
const run = (
  from: number,
  to: number,
  values: (lap: number) => Partial<RaceLap> = () => ({})
): RaceLap[] =>
  Array.from({ length: to - from + 1 }, (_, index) => {
    const lap = from + index;
    return lapOf(lap, { lapTime: 100 + (lap % 5) * 0.1, ...values(lap) });
  });

/** The lap numbers of each run of a line. */
const runsOf = (line: ChartLine): number[][] =>
  line.segments.map((segment) => segment.points.map((point) => point.lap));

const WHOLE = { from: 1, to: 60 };

describe('chartSpan', () => {
  it('is the last laps asked for, both ends drawn', () => {
    expect(chartSpan(162, 40)).toEqual({ from: 123, to: 162 });
    expect(chartSpan(162, 20)).toEqual({ from: 143, to: 162 });
  });

  it('is the whole race for 0', () => {
    expect(chartSpan(162, 0)).toEqual({ from: 1, to: 162 });
  });

  it('is as wide early on as later, and fills from the left', () => {
    expect(chartSpan(3, 40)).toEqual({ from: 1, to: 40 });
    expect(chartSpan(3, 0)).toEqual({ from: 1, to: WHOLE_RACE_MIN_LAPS });
  });

  it('is nothing before a lap has been completed', () => {
    expect(chartSpan(0, 40)).toBeNull();
    expect(chartSpan(0, 0)).toBeNull();
  });
});

describe('lastLapOf', () => {
  it('is the last lap held', () => {
    expect(lastLapOf(recordOf(run(1, 7)))).toBe(7);
  });

  it('is 0 for a car with nothing held, and for no record', () => {
    expect(lastLapOf(recordOf([]))).toBe(0);
    expect(lastLapOf(undefined)).toBe(0);
  });

  it('counts a lap that is known to be missing', () => {
    expect(lastLapOf(recordOf(run(1, 4), undefined, [5, 6]))).toBe(6);
  });
});

describe('the pace scale', () => {
  /**
   * Two stints of ten laps with a stop between: the lap of the stop and the
   * out-lap, the lap from the grid, and two laps under a full-course yellow.
   */
  const laps = run(1, 20, (lap) => {
    if (lap === 1) return { lapTime: 104.6, flags: LEDGER_LAP_FROM_START };
    if (lap === 6 || lap === 7) {
      return { lapTime: 138, flags: LEDGER_LAP_CAUTION };
    }
    if (lap === 11) return { lapTime: 160, flags: LEDGER_LAP_IN_LAP };
    if (lap === 12) return { lapTime: 112.5, flags: LEDGER_LAP_OUT_LAP };
    return {};
  });
  const record = recordOf(laps, [stoppedStint(1, 1, 10), openStint(2, 11, 20)]);
  const span = { from: 1, to: 20 };

  it('is fitted to the clean laps: a pit lap does not stretch it', () => {
    const axis = paceAxis([laps], span, 5);
    if (!axis) throw new Error('no scale');
    // The clean laps run from 100.0 to 100.4.
    expect(axis.min).toBeLessThanOrEqual(100);
    expect(axis.min).toBeGreaterThan(99);
    expect(axis.max).toBeGreaterThanOrEqual(100.4);
    expect(axis.max).toBeLessThan(101.5);
  });

  it('draws each lap that does not fit as a mark at the edge it is past', () => {
    const axis = paceAxis([laps], span, 5);
    if (!axis) throw new Error('no scale');
    const line = paceLine(record, span, axis);
    expect(line.marks.map((mark) => [mark.lap, mark.edge])).toEqual([
      [1, 'high'],
      [6, 'high'],
      [7, 'high'],
      [11, 'high'],
      [12, 'high'],
    ]);
    // Never a spike: no lap that is off the scale is on a line.
    expect(runsOf(line)).toEqual([
      [2, 3, 4, 5],
      [8, 9, 10],
      [13, 14, 15, 16, 17, 18, 19, 20],
    ]);
  });

  it('is not moved by a clean lap far from the rest either', () => {
    const traffic = laps.map((lap) =>
      lap.lap === 16 ? { ...lap, lapTime: 109 } : lap
    );
    const axis = paceAxis([traffic], span, 5);
    expect(axis?.max).toBeLessThan(101.5);
  });

  it('marks a lap far quicker than the rest at the other edge', () => {
    const cut = laps.map((lap) =>
      lap.lap === 16 ? { ...lap, lapTime: 91 } : lap
    );
    const axis = paceAxis([cut], span, 5);
    if (!axis) throw new Error('no scale');
    expect(axis.min).toBeGreaterThan(99);
    expect(
      paceLine({ ...record, laps: cut }, span, axis).marks.find(
        (mark) => mark.lap === 16
      )
    ).toEqual({ lap: 16, edge: 'low', driverIndex: 0 });
  });

  it('counts a lap under a local yellow as the clean lap it is', () => {
    const yellow = run(1, 10, (lap) =>
      lap === 4 ? { lapTime: 100.2, flags: LEDGER_LAP_YELLOW } : {}
    );
    const axis = paceAxis([yellow], { from: 1, to: 10 }, 5);
    if (!axis) throw new Error('no scale');
    expect(
      runsOf(paceLine(recordOf(yellow), { from: 1, to: 10 }, axis))
    ).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
  });

  it('takes in every car drawn', () => {
    const slower = run(1, 20, () => ({ carIdx: 1 })).map((lap) => ({
      ...lap,
      lapTime: (lap.lapTime ?? 0) + 2,
    }));
    const axis = paceAxis([laps, slower], span, 5);
    expect(axis?.min).toBeLessThanOrEqual(100);
    expect(axis?.max).toBeGreaterThanOrEqual(102.4);
  });

  it('reads only the laps of the span', () => {
    const slowStart = run(1, 20, (lap) => (lap <= 10 ? { lapTime: 120 } : {}));
    const axis = paceAxis([slowStart], { from: 11, to: 20 }, 5);
    expect(axis?.max).toBeLessThan(101.5);
  });

  it('is fitted to the laps there are while none of them is clean', () => {
    const first = [lapOf(1, { lapTime: 104.6, flags: LEDGER_LAP_FROM_START })];
    const axis = paceAxis([first], { from: 1, to: 40 }, 5);
    if (!axis) throw new Error('no scale');
    expect(axis.min).toBeLessThan(104.6);
    expect(axis.max).toBeGreaterThan(104.6);
    expect(axis.max - axis.min).toBeCloseTo(PACE_MIN_SPAN_S, 6);
  });

  it('is nothing while no lap of the span has a time', () => {
    const untimed = [lapOf(1, { lapTime: null, flags: LEDGER_LAP_VOIDED })];
    expect(paceAxis([untimed], { from: 1, to: 40 }, 5)).toBeNull();
    expect(paceAxis([[]], { from: 1, to: 40 }, 5)).toBeNull();
    expect(paceRange([])).toBeNull();
  });

  it('gives round gridlines inside the range', () => {
    const axis = paceAxis([laps], span, 5);
    if (!axis) throw new Error('no scale');
    expect(axis.values.length).toBeGreaterThan(0);
    for (const value of axis.values) {
      expect(value).toBeGreaterThanOrEqual(axis.min);
      expect(value).toBeLessThanOrEqual(axis.max);
    }
  });
});

describe('paceLine', () => {
  const axis = { min: 99, max: 102, step: 1, values: [99, 100, 101, 102] };

  it('breaks at a stop, though the laps follow each other on the scale', () => {
    // A stop so short that the lap of it fits the scale.
    const record = recordOf(run(1, 12), [
      stoppedStint(1, 1, 6),
      openStint(2, 7, 12),
    ]);
    expect(runsOf(paceLine(record, { from: 1, to: 12 }, axis))).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
    ]);
  });

  it('colours each run by who drove it, in the order they first drove', () => {
    const record = recordOf(run(1, 16), [
      stoppedStint(1, 1, 4, { driver: 'Ada' }),
      stoppedStint(2, 5, 8, { driver: 'Ben' }),
      stoppedStint(3, 9, 12, { driver: 'Ada' }),
      openStint(4, 13, 16, { driver: 'Cy' }),
    ]);
    const line = paceLine(record, { from: 1, to: 16 }, axis);
    expect(line.segments.map((segment) => segment.driverIndex)).toEqual([
      0, 1, 0, 2,
    ]);
    expect(driverOrder(record.stints)).toEqual(['Ada', 'Ben', 'Cy']);
  });

  it('colours by the stint, not by the name on the lap', () => {
    // The session named the new driver a lap late.
    const laps = run(1, 8, (lap) => ({ driver: lap <= 5 ? 'Ada' : 'Ben' }));
    const record = recordOf(laps, [
      stoppedStint(1, 1, 4, { driver: 'Ada' }),
      openStint(2, 5, 8, { driver: 'Ben' }),
    ]);
    expect(
      paceLine(record, { from: 1, to: 8 }, axis).segments.map((segment) => [
        segment.driverIndex,
        segment.points[0].lap,
      ])
    ).toEqual([
      [0, 1],
      [1, 5],
    ]);
  });

  it('breaks at a driver change with no stop seen', () => {
    const record = recordOf(run(1, 8), [
      openStint(1, 1, 4, { closedBy: 'driver', driver: 'Ada' }),
      openStint(2, 5, 8, { openedBy: 'driver', driver: 'Ben' }),
    ]);
    expect(runsOf(paceLine(record, { from: 1, to: 8 }, axis))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('breaks at a lap that is not held, and at one with no time', () => {
    const laps = [...run(1, 3), ...run(6, 10)].map((lap) =>
      lap.lap === 8 ? { ...lap, lapTime: null, flags: LEDGER_LAP_VOIDED } : lap
    );
    const record = recordOf(laps, undefined, [4, 5]);
    const line = paceLine(record, { from: 1, to: 10 }, axis);
    expect(runsOf(line)).toEqual([
      [1, 2, 3],
      [6, 7],
      [9, 10],
    ]);
    // A lap with no time is not a slow lap.
    expect(line.marks).toEqual([]);
  });

  it('draws a lap on its own between two breaks', () => {
    const laps = run(1, 5, (lap) =>
      lap === 2 || lap === 4 ? { lapTime: 130 } : {}
    );
    expect(runsOf(paceLine(recordOf(laps), { from: 1, to: 5 }, axis))).toEqual([
      [1],
      [3],
      [5],
    ]);
  });

  it('draws nothing of the laps outside the span', () => {
    const line = paceLine(recordOf(run(1, 30)), { from: 21, to: 30 }, axis);
    expect(runsOf(line)).toEqual([[21, 22, 23, 24, 25, 26, 27, 28, 29, 30]]);
  });
});

describe('gapLine', () => {
  /** Laps a car completed at these moments of the session clock. */
  const crossings = (times: Record<number, number>): RaceLap[] =>
    Object.entries(times).map(([lap, sessionTime]) =>
      lapOf(Number(lap), { sessionTime })
    );

  it('is their crossing less ours, for the same lap number', () => {
    const own = crossings({ 1: 300, 2: 400, 3: 500 });
    const ahead = crossings({ 1: 296, 2: 395.5, 3: 494 });
    const behind = crossings({ 1: 302, 2: 403, 3: 501.5 });
    expect(gapLine(own, ahead, WHOLE).segments[0].points).toEqual([
      { lap: 1, value: -4 },
      { lap: 2, value: -4.5 },
      { lap: 3, value: -6 },
    ]);
    expect(
      gapLine(own, behind, WHOLE).segments[0].points.map((point) => point.value)
    ).toEqual([2, 3, 1.5]);
  });

  it('breaks where the other car’s lap is not held', () => {
    const own = crossings({ 1: 300, 2: 400, 3: 500, 4: 600, 5: 700 });
    const rival = crossings({ 1: 302, 2: 402, 4: 603, 5: 704 });
    const line = gapLine(own, rival, WHOLE);
    expect(runsOf(line)).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(line.segments[1].points[0]).toEqual({ lap: 4, value: 3 });
  });

  it('breaks where our own lap is not held', () => {
    const own = crossings({ 1: 300, 2: 400, 5: 700 });
    const rival = crossings({ 1: 302, 2: 402, 3: 502, 4: 603, 5: 704 });
    expect(runsOf(gapLine(own, rival, WHOLE))).toEqual([[1, 2], [5]]);
  });

  it('compares a car a lap down lap number for lap number', () => {
    // On the road it is a few seconds behind us; lap for lap, a lap's time.
    const own = crossings({ 10: 1200, 11: 1300 });
    const lapped = crossings({ 9: 1203, 10: 1304 });
    expect(gapLine(own, lapped, WHOLE).segments[0].points).toEqual([
      { lap: 10, value: 104 },
    ]);
  });

  it('draws only the laps of the span', () => {
    const own = crossings({ 1: 300, 2: 400, 3: 500 });
    const rival = crossings({ 1: 302, 2: 402, 3: 502 });
    expect(runsOf(gapLine(own, rival, { from: 2, to: 3 }))).toEqual([[2, 3]]);
  });

  it('has nothing to draw with no lap in common', () => {
    const line = gapLine(crossings({ 1: 300 }), crossings({ 2: 400 }), WHOLE);
    expect(line.segments).toEqual([]);
    expect(gapAxis([line], 5)).toBeNull();
  });
});

describe('gapAxis', () => {
  const lineOf = (...values: number[]): ChartLine => ({
    segments: [
      {
        driverIndex: 0,
        points: values.map((value, index) => ({ lap: index + 1, value })),
      },
    ],
    marks: [],
  });

  it('covers every gap drawn, and our own car’s zero', () => {
    const axis = gapAxis([lineOf(-41, -77), lineOf(12, 88)], 5);
    expect(axis?.min).toBeLessThan(-77);
    expect(axis?.max).toBeGreaterThan(88);
    expect(axis?.values).toContain(0);
  });

  it('keeps the zero for cars that are all on one side', () => {
    const axis = gapAxis([lineOf(20, 30)], 5);
    expect(axis?.min).toBeLessThanOrEqual(0);
    expect(axis?.values).toContain(0);
  });

  it('is never so fine that a tenth looks like a gulf', () => {
    const axis = gapAxis([lineOf(0.1, 0.2)], 5);
    if (!axis) throw new Error('no scale');
    expect(axis.max - axis.min).toBeGreaterThanOrEqual(2);
  });
});

describe('usage', () => {
  /** A car that uses 2.5 % a lap, and is refilled on lap 6. */
  const laps = run(1, 10, (lap) => ({
    energyIsVirtual: true,
    energy: lap < 6 ? 1 - lap * 0.025 : 0.98 - (lap - 6) * 0.025,
  }));
  const record = recordOf(laps, [stoppedStint(1, 1, 5), openStint(2, 6, 10)]);
  const span = { from: 1, to: 10 };

  it('says which budget the laps were recorded in, or that there is none', () => {
    expect(usageBudget(record)).toBe('energy');
    expect(
      usageBudget(
        recordOf(run(1, 3, () => ({ energy: 0.5, energyIsVirtual: false })))
      )
    ).toBe('fuel');
    // iRacing publishes neither.
    expect(usageBudget(recordOf(run(1, 3)))).toBeNull();
    expect(usageBudget(undefined)).toBeNull();
  });

  it('is what each lap used in percent, with a break at the refill', () => {
    const line = usageLine(record, span);
    expect(runsOf(line)).toEqual([
      [2, 3, 4, 5],
      [7, 8, 9, 10],
    ]);
    for (const segment of line.segments) {
      for (const point of segment.points) expect(point.value).toBeCloseTo(2.5);
    }
  });

  it('takes the first lap of the span from the lap before it', () => {
    expect(runsOf(usageLine(record, { from: 3, to: 5 }))).toEqual([[3, 4, 5]]);
  });

  it('has a scale around the laps drawn, and none with nothing to draw', () => {
    const axis = usageAxis(usageLine(record, span), 5);
    expect(axis?.min).toBeLessThan(2.5);
    expect(axis?.max).toBeGreaterThan(2.5);
    expect(usageAxis(usageLine(recordOf(run(1, 3)), span), 5)).toBeNull();
  });

  it('says what each lap used, and that a lap was a refill', () => {
    const readings = usageReadings(record, span);
    expect(readings.get(3)).toEqual({ text: '2.5 %', driver: 'Ada', note: '' });
    expect(readings.get(6)?.text).toBe('refilled');
    // Nothing to take the first lap's use from.
    expect(readings.get(1)?.text).toBe('--');
  });
});

describe('chartBands', () => {
  const laps = run(1, 30).filter((lap) => lap.lap < 21 || lap.lap > 24);
  const record = recordOf(
    laps,
    [
      stoppedStint(1, 1, 8, { driver: 'Ada' }),
      stoppedStint(2, 9, 16, {
        driver: 'Ada',
        stop: { laneTime: 70, standingTime: 50, driverChanged: true },
      }),
      openStint(3, 17, 30, { driver: 'Ben' }),
    ],
    [21, 22, 23, 24]
  );

  it('marks the lap of each stop, and says a driver change', () => {
    expect(
      chartBands(record, WHOLE).filter((band) => band.kind === 'stop')
    ).toEqual([
      { kind: 'stop', from: 9, to: 9, label: 'stop' },
      { kind: 'stop', from: 17, to: 17, label: 'stop, driver change' },
    ]);
  });

  it('marks each run of laps that were not recorded', () => {
    expect(
      chartBands(record, WHOLE).filter((band) => band.kind === 'missing')
    ).toEqual([{ kind: 'missing', from: 21, to: 24, label: 'not recorded' }]);
  });

  it('keeps to the span', () => {
    expect(chartBands(record, { from: 10, to: 22 })).toEqual([
      { kind: 'stop', from: 17, to: 17, label: 'stop, driver change' },
      { kind: 'missing', from: 21, to: 22, label: 'not recorded' },
    ]);
  });

  it('says a car that has not left the pit lane is in the pits', () => {
    const stopped = recordOf(run(1, 8), [
      stoppedStint(1, 1, 8, {
        stop: { laneTime: null, standingTime: 12, driverChanged: false },
      }),
      stintOf(2),
    ]);
    expect(chartBands(stopped, WHOLE)).toEqual([
      { kind: 'stop', from: 9, to: 9, label: 'in the pits' },
    ]);
  });

  it('marks nothing for a stint that no stop ended', () => {
    const changed = recordOf(run(1, 8), [
      openStint(1, 1, 4, { closedBy: 'driver' }),
      openStint(2, 5, 8, { openedBy: 'driver', driver: 'Ben' }),
    ]);
    expect(chartBands(changed, WHOLE)).toEqual([]);
  });
});

describe('what a chart says of a lap', () => {
  it('gives a lap’s time, who drove it and the note Car Laps has for it', () => {
    const laps = run(1, 12, (lap) => {
      if (lap === 7)
        return { lapTime: 160, flags: LEDGER_LAP_IN_LAP, driver: 'Ben' };
      if (lap === 8)
        return { lapTime: 112, flags: LEDGER_LAP_OUT_LAP, driver: 'Ben' };
      return { driver: lap <= 6 ? 'Ada' : 'Ben' };
    });
    const record = recordOf(
      laps,
      [
        stoppedStint(1, 1, 6, {
          driver: 'Ada',
          stop: { laneTime: 60, standingTime: 41, driverChanged: true },
        }),
        openStint(2, 7, 12, { driver: 'Ben' }),
      ],
      [13]
    );
    const readings = paceReadings(record, { from: 5, to: 13 });
    expect(readings.get(6)).toEqual({
      text: '1:40.100',
      driver: 'Ada',
      note: '',
    });
    expect(readings.get(5)).toEqual({
      text: '1:40.000',
      driver: 'Ada',
      note: 'best of the stint',
    });
    expect(readings.get(7)).toEqual({
      text: '2:40.000',
      driver: 'Ben',
      note: 'stop 41 s: driver change',
    });
    expect(readings.get(8)?.note).toBe('out lap');
    expect(readings.get(13)).toEqual({
      text: 'not recorded',
      driver: '',
      note: '',
    });
    // Outside the span.
    expect(readings.has(4)).toBe(false);
  });

  it('says a gap in words', () => {
    expect(formatGap(-4.24)).toBe('4.2 s ahead');
    expect(formatGap(12.75)).toBe('12.8 s behind');
    expect(formatGap(0.04)).toBe('level');
    expect(formatGap(104)).toBe('104.0 s behind');
    expect(formatGap(null)).toBe('--');
    expect(formatGap(Number.NaN)).toBe('--');
  });

  it('gives each gap with who was driving the other car', () => {
    const own = [
      lapOf(1, { sessionTime: 300 }),
      lapOf(2, { sessionTime: 400 }),
    ];
    const rival = [
      lapOf(1, { sessionTime: 297, driver: 'Cy' }),
      lapOf(2, { sessionTime: 402.5, driver: 'Dee' }),
    ];
    const readings = gapReadings(gapLine(own, rival, WHOLE), rival);
    expect(readings.get(1)).toEqual({
      text: '3.0 s ahead',
      driver: 'Cy',
      note: '',
    });
    expect(readings.get(2)?.text).toBe('2.5 s behind');
    expect(readings.get(2)?.driver).toBe('Dee');
    expect(readings.has(3)).toBe(false);
  });
});

describe('the text of a tick', () => {
  it('writes a lap time to the decimals of the scale’s step', () => {
    expect(formatTimeTick(114, 1)).toBe('1:54');
    expect(formatTimeTick(114.5, 0.5)).toBe('1:54.5');
    expect(formatTimeTick(114, 0.5)).toBe('1:54.0');
    expect(formatTimeTick(114.25, 0.25)).toBe('1:54.25');
    expect(formatTimeTick(120, 10)).toBe('2:00');
    expect(formatTimeTick(45.2, 0.2)).toBe('0:45.2');
  });

  it('does not write 60 seconds', () => {
    expect(formatTimeTick(119.96, 0.1)).toBe('2:00.0');
  });

  it('writes a size without its sign', () => {
    expect(formatSizeTick(-50, 50)).toBe('50');
    expect(formatSizeTick(2.5, 0.5)).toBe('2.5');
    expect(formatSizeTick(2, 0.5)).toBe('2.0');
    expect(formatSizeTick(-0.25, 0.25)).toBe('0.25');
  });
});

/**
 * The STAGED eight-hour race the stories are told with: nothing in it was
 * recorded, because no recording has a pit stop or a driver change.
 */
describe('on the staged race', () => {
  const stage = raceHistoryStage(RACE_HISTORY_STAGE_FOR_CHARTS);
  const own = stage.records.get(stage.slotOf(RACE_HISTORY_STAGE_OWN_CAR));
  if (!own) throw new Error('the stage has no car of ours');
  const span = chartSpan(lastLapOf(own), 0);
  if (!span) throw new Error('the stage has no lap of ours');

  it('colours our drivers as Crew and Stints does', () => {
    expect(driverOrder(own.stints)).toEqual(
      crewView(own, null).drivers.map((driver) => driver.name)
    );
    expect(driverOrder(own.stints)).toEqual([
      'Mikhail Ivanov',
      'Andrei Petrov',
      'Dmitri Sokolov',
    ]);
  });

  it('keeps every stop, the lap from the grid and the full-course yellow off the scale', () => {
    const axis = paceAxis([own.laps], span, 5);
    if (!axis) throw new Error('no scale');
    // A clean lap of ours is a little under 1:55.
    expect(axis.min).toBeGreaterThan(113);
    expect(axis.max).toBeLessThan(117);
    const marked = new Set(
      paceLine(own, span, axis).marks.map((mark) => mark.lap)
    );
    // From the grid; the laps of the five stops and their out-laps; the
    // three laps under the full-course yellow; a lap lost to traffic.
    for (const lap of [1, 32, 33, 63, 64, 68, 69, 70, 94, 95, 125, 126]) {
      expect(marked.has(lap)).toBe(true);
    }
    expect(marked.has(132)).toBe(true);
    // The lap that lost seven tenths to traffic is still on the scale.
    expect(marked.has(131)).toBe(false);
  });

  it('draws one run of each stint’s driver between two stops', () => {
    const axis = paceAxis([own.laps], span, 5);
    if (!axis) throw new Error('no scale');
    const line = paceLine(own, span, axis);
    const driversByStint = [0, 0, 1, 1, 2, 0];
    own.stints.forEach((stint, at) => {
      const within = line.segments.filter(
        (segment) =>
          stint.firstLap !== null &&
          stint.lastLap !== null &&
          segment.points[0].lap >= stint.firstLap &&
          segment.points[segment.points.length - 1].lap <= stint.lastLap
      );
      expect(within.length).toBeGreaterThan(0);
      for (const segment of within) {
        expect(segment.driverIndex).toBe(driversByStint[at]);
      }
    });
    // No run crosses from one stint into the next.
    for (const segment of line.segments) {
      const first = segment.points[0].lap;
      const last = segment.points[segment.points.length - 1].lap;
      const stint = own.stints.find(
        (entry) =>
          entry.firstLap !== null &&
          entry.lastLap !== null &&
          first >= entry.firstLap &&
          first <= entry.lastLap
      );
      expect(last).toBeLessThanOrEqual(stint?.lastLap ?? -1);
    }
  });

  it('shows the car behind closing between its stops', () => {
    const rival = stage.records.get(stage.slotOf('23'));
    if (!rival) throw new Error('the stage has no #23');
    const gaps = new Map(
      gapLine(own.laps, rival.laps, span)
        .segments.flatMap((segment) => segment.points)
        .map((point) => [point.lap, point.value])
    );
    // Behind us, and nearer at the end of each run without a stop.
    expect(gaps.get(140)).toBeGreaterThan(0);
    expect(gaps.get(149)).toBeLessThan(gaps.get(140) ?? 0);
    expect(gaps.get(162)).toBeGreaterThan(0);
    expect(gaps.get(162)).toBeLessThan(gaps.get(158) ?? 0);
  });

  it('breaks every line at the laps a restart lost', () => {
    const restarted = raceHistoryStage({
      ownLaps: 60,
      outage: { afterOwnLap: 40, untilOwnLap: 47 },
    });
    const car = restarted.records.get(
      restarted.slotOf(RACE_HISTORY_STAGE_OWN_CAR)
    );
    const rival = restarted.records.get(restarted.slotOf('33'));
    if (!car || !rival) throw new Error('the stage has no such car');
    const window = { from: 21, to: 60 };
    expect(chartBands(car, window)).toContainEqual({
      kind: 'missing',
      from: 41,
      to: 47,
      label: 'not recorded',
    });
    const gap = gapLine(car.laps, rival.laps, window);
    for (const segment of gap.segments) {
      for (const point of segment.points) {
        expect(point.lap < 41 || point.lap > 47).toBe(true);
      }
    }
    expect(gap.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('offers no usage under iRacing', () => {
    const iracing = raceHistoryStage({ iracing: true });
    expect(
      usageBudget(
        iracing.records.get(iracing.slotOf(RACE_HISTORY_STAGE_OWN_CAR))
      )
    ).toBeNull();
    expect(usageBudget(own)).toBe('energy');
  });
});
