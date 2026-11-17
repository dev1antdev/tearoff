import { describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import { TrackLocation } from '@irdashies/types';
import {
  drive,
  driveLaps,
  enterPits,
  Field,
  leaveBox,
  leavePits,
  recorded,
  standInBox,
  type FrameSink,
} from '../app/processors/raceHistoryFixture';
import {
  carLapsView,
  type CarLapRow,
} from '../frontend/domain/raceHistory/carLaps';
import type { CarRaceRecord } from '../frontend/domain/raceHistory/carRecord';
import {
  chartBands,
  gapLine,
  paceAxis,
  paceLine,
  usageBudget,
  usageLine,
  type ChartLine,
} from '../frontend/domain/raceHistory/chartSeries';
import { crewView, stintEndText } from '../frontend/domain/raceHistory/crew';

/**
 * Crew and Stints, Car Laps and the Race Charts on records made by the real
 * race history recorder, which is why this spec lives here and not beside
 * any of the panels: a panel may not import the recorder.
 *
 * The frames are STAGED, every one: a small field lapping a circuit, with a
 * stop, a drive-through, a garage visit and an outage written into them. It
 * checks that the panels read the records the recorder really makes, for
 * the three places a circuit can have its pit boxes. What either sim writes
 * through a real stop or a real driver change is not in here: no recording
 * has one.
 */

interface Stage {
  field: Field;
  run: ReturnType<typeof recorded>;
  /** The recorder, behind whatever the stage writes into each frame. */
  sink: FrameSink;
  /** The compound the car is on, as LMU says it for each wheel. */
  tyres: { compound: number };
}

/** One car of Le Mans Ultimate that runs on virtual energy, lapping in 100 s. */
const stage = (): Stage => {
  const field = new Field({ lmu: true });
  const run = recorded({ simulator: () => 'lmu' });
  run.recorder.onSession(field.session());
  const tyres = { compound: 0 };
  const sink: FrameSink = {
    onFrame: (frame: Telemetry) => {
      // The fixture's cars never change tyres: car 0's are written here.
      const cells = frame as unknown as Record<string, { value: number[] }>;
      cells.LmuCarIdxWheelCompounds.value.fill(tyres.compound, 0, 4);
      run.recorder.onFrame(frame);
    },
  };
  return { field, run, sink, tyres };
};

/** Laps of car 0, each using 3 % of its energy by the time it ends. */
const laps = ({ field, sink }: Stage, count: number): void => {
  for (let lap = 0; lap < count; lap += 1) {
    driveLaps(field, sink, 0, 1);
    field.energy[0] -= 0.03;
    // Past the second after the line at which the record reads the car.
    drive(field, sink, 2);
  }
};

/** What the panels are handed of a car: car 0, unless another is asked for. */
const recordOf = ({ run }: Stage, carIdx = 0): CarRaceRecord => ({
  laps: run.recorder.carLaps(carIdx),
  missingLaps: run.recorder.missingLaps(carIdx),
  stints: run.recorder.carStints(carIdx),
});

/**
 * The note on each lap, but for which lap is the best of its stint: the
 * fixture's cars lap to within a nanosecond of each other, and which of
 * them is quickest says nothing here.
 */
const notes = (record: CarRaceRecord): Record<number, string> =>
  Object.fromEntries(
    carLapsView(record, null)
      .rows.filter((row): row is CarLapRow => row.kind === 'lap')
      .map((row) => [row.lap, row.note.replace('best of the stint', '')])
  );

const stintEnds = (record: CarRaceRecord, nowS: number): string[] =>
  crewView(record, nowS).stints.map((stint) => stintEndText(stint.end));

/** The service a stop does while the car stands: energy, tyres, a driver. */
const service = (staged: Stage): void => {
  staged.field.energy[0] = 1;
  staged.tyres.compound = 2;
  staged.field.cars[0].name = 'Team-Mate';
  staged.run.recorder.onSession(staged.field.session());
};

describe('the panels on the recorder’s own records (staged frames)', () => {
  it('read a stop where the boxes are before the line, in and out on one lap', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 3);

    // In at half distance of the fourth lap, thirty seconds standing.
    drive(field, sink, 48);
    enterPits(car);
    drive(field, sink, 10);
    standInBox(car);
    drive(field, sink, 15);
    service(staged);
    drive(field, sink, 15);
    leaveBox(car);
    drive(field, sink, 5);
    leavePits(car);
    laps(staged, 3);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual([
      'under way',
      '30 s: energy, tyres, driver',
    ]);
    expect(notes(record)).toMatchObject({
      3: '',
      // The lap the car stood still on says the stop, and nothing else.
      4: 'stop 30 s: energy, tyres, driver change',
      5: '',
    });
    const [underWay, first] = crewView(record, field.time).stints;
    expect(first).toMatchObject({ driver: 'Driver 0', laps: 3 });
    expect(underWay).toMatchObject({ driver: 'Team-Mate', laps: 3 });
    // The lap of the stop is the stint's first, and no clean one.
    expect(underWay.avgLap).toBeCloseTo(100, 3);
  });

  it('read a stop where the line is between the box and the pit exit', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 3);

    // In at 90 % of the fourth lap, the box before the line, out after it.
    drive(field, sink, 88);
    enterPits(car);
    drive(field, sink, 4);
    standInBox(car);
    drive(field, sink, 15);
    service(staged);
    drive(field, sink, 15);
    leaveBox(car);
    driveLaps(field, sink, 0, 1);
    drive(field, sink, 4);
    leavePits(car);
    field.energy[0] -= 0.03;
    laps(staged, 3);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual([
      'under way',
      '30 s: energy, tyres, driver',
    ]);
    expect(notes(record)).toMatchObject({
      3: '',
      4: 'stop 30 s: energy, tyres, driver change',
      5: 'out lap',
      6: '',
    });
  });

  it('read a stop where the boxes are after the line', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 3);

    // In at 95 % of the fourth lap, over the line in the lane, into the
    // box two seconds into the fifth.
    drive(field, sink, 93);
    enterPits(car);
    driveLaps(field, sink, 0, 1);
    field.energy[0] -= 0.03;
    drive(field, sink, 2);
    standInBox(car);
    drive(field, sink, 15);
    service(staged);
    drive(field, sink, 15);
    leaveBox(car);
    drive(field, sink, 3);
    leavePits(car);
    laps(staged, 3);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual([
      'under way',
      '30 s: energy, tyres, driver',
    ]);
    expect(notes(record)).toMatchObject({
      3: '',
      // The lap that ended in the lane is the last of the stint.
      4: 'in lap',
      // The car stood still on the lap it left the lane on.
      5: 'stop 30 s: energy, tyres, driver change',
      6: '',
    });
    expect(crewView(record, field.time).stints[1].laps).toBe(4);
  });

  it('say the car is in the pits while it stands', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 2);
    drive(field, sink, 48);
    enterPits(car);
    drive(field, sink, 10);
    standInBox(car);
    drive(field, sink, 6);

    expect(stintEnds(recordOf(staged), field.time)).toEqual([
      'under way',
      'in the pits',
    ]);
  });

  it('claim nothing for a stop that changed nothing that can be seen', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 2);
    drive(field, sink, 48);
    enterPits(car);
    drive(field, sink, 10);
    standInBox(car);
    // A stop-and-go: nothing aboard, the same tyres, the same driver.
    drive(field, sink, 12);
    leaveBox(car);
    drive(field, sink, 5);
    leavePits(car);
    laps(staged, 2);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual(['under way', '12 s']);
    expect(notes(record)[3]).toBe('stop 12 s');
  });

  it('read a drive-through as a pass through the pit lane, and no stop', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 2);
    drive(field, sink, 48);
    enterPits(car);
    drive(field, sink, 20);
    leavePits(car);
    laps(staged, 2);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual(['under way']);
    expect(notes(record)).toMatchObject({
      2: '',
      3: 'through the pit lane',
      4: '',
    });
  });

  it('count none of a spell in the garage as time at the wheel', () => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 2);
    drive(field, sink, 20);
    const goneAt = field.time;
    car.halted = true;
    car.surface = TrackLocation.NotInWorld;
    // Ten minutes in the garage.
    drive(field, sink, 600);

    const parked = recordOf(staged);
    expect(stintEnds(parked, field.time)).toEqual(['to the garage']);
    const [driver] = crewView(parked, field.time).drivers;
    expect(driver).toMatchObject({ stints: 1, driving: false });
    expect(driver.seconds).toBeCloseTo(goneAt - parked.stints[0].startTime, 0);

    // Back out, and two laps on.
    leavePits(car);
    laps(staged, 2);
    const back = recordOf(staged);
    expect(stintEnds(back, field.time)).toEqual(['under way', 'to the garage']);
    const [again] = crewView(back, field.time).drivers;
    expect(again).toMatchObject({ stints: 2, driving: true });
    // The stint since counts from its first line crossing: less than the
    // two laps and a bit it has really been out, and none of the garage.
    const since = again.seconds - driver.seconds;
    expect(since).toBeGreaterThan(100);
    expect(since).toBeLessThan(210);
  });

  it('say which laps were not recorded, and where a stint’s laps stop', () => {
    const staged = stage();
    const { field, run } = staged;
    laps(staged, 2);
    // Nothing asked for the record for two and a half laps.
    for (let frame = 0; frame < 2500; frame += 1) field.step();
    run.recorder.rebaseline();
    laps(staged, 2);

    const record = recordOf(staged);
    expect(stintEnds(record, field.time)).toEqual([
      'under way',
      'laps after it not recorded',
    ]);
    expect(
      carLapsView(record, null).rows.map((row) =>
        row.kind === 'missing' ? `${row.from}-${row.to}` : row.lap
      )
    ).toEqual([6, 5, '3-4', 2, 1]);
  });

  it('mean what a lap used over the laps of a stint', () => {
    const staged = stage();
    laps(staged, 5);
    const [stint] = crewView(recordOf(staged), staged.field.time).stints;
    expect(stint.energy?.perLap).toBeCloseTo(0.03, 6);
    expect(stint.energy?.virtual).toBe(true);
    const rows = carLapsView(recordOf(staged), null).rows.filter(
      (row): row is CarLapRow => row.kind === 'lap'
    );
    expect(rows[0].energyUsed).toBeCloseTo(0.03, 6);
    // The lap that began on the grid is the first held: nothing to take
    // it from.
    expect(rows[rows.length - 1]).toMatchObject({
      energyUsed: null,
      note: 'from the grid',
    });
  });
});

describe('the Race Charts on the recorder’s own records (staged frames)', () => {
  /** The lap numbers of each run of a line. */
  const runsOf = (line: ChartLine): number[][] =>
    line.segments.map((segment) => segment.points.map((point) => point.lap));

  /**
   * Three laps, then a stop of thirty seconds with a service on the fourth,
   * and two laps after it.
   */
  const withStop = (): Stage => {
    const staged = stage();
    const { field, sink } = staged;
    const car = field.cars[0];
    laps(staged, 3);
    drive(field, sink, 48);
    enterPits(car);
    drive(field, sink, 10);
    standInBox(car);
    drive(field, sink, 15);
    service(staged);
    drive(field, sink, 15);
    leaveBox(car);
    drive(field, sink, 5);
    leavePits(car);
    laps(staged, 3);
    return staged;
  };

  const SPAN = { from: 1, to: 40 };

  it('keep the lap of a stop off the pace scale, and break the line at it', () => {
    const record = recordOf(withStop());
    const axis = paceAxis([record.laps], SPAN, 5);
    if (!axis) throw new Error('no scale');
    // The car laps in 100 s; the lap of its stop took a minute more.
    expect(axis.min).toBeGreaterThan(99);
    expect(axis.max).toBeLessThan(101);

    const line = paceLine(record, SPAN, axis);
    expect(runsOf(line)).toEqual([
      [2, 3],
      [5, 6],
    ]);
    // Who drove each run: the driver before the stop, and the one after.
    expect(line.segments.map((segment) => segment.driverIndex)).toEqual([0, 1]);
    expect(line.marks).toEqual([
      // The lap from the grid began a tenth of the way round, and is
      // quicker than any lap from line to line.
      { lap: 1, edge: 'low', driverIndex: 0 },
      { lap: 4, edge: 'high', driverIndex: 1 },
    ]);
  });

  it('band the lap the car stood on, and say the driver change', () => {
    expect(chartBands(recordOf(withStop()), SPAN)).toEqual([
      { kind: 'stop', from: 4, to: 4, label: 'stop, driver change' },
    ]);
  });

  it('draw what each lap used, with no figure for the lap of the refill', () => {
    const record = recordOf(withStop());
    expect(usageBudget(record)).toBe('energy');
    const line = usageLine(record, SPAN);
    expect(runsOf(line)).toEqual([
      [2, 3],
      [5, 6],
    ]);
    for (const segment of line.segments) {
      for (const point of segment.points) expect(point.value).toBeCloseTo(3, 4);
    }
  });

  it('band the laps that were not recorded, and break the line there', () => {
    const staged = stage();
    const { field, run } = staged;
    laps(staged, 2);
    // Nothing asked for the record for two and a half laps.
    for (let frame = 0; frame < 2500; frame += 1) field.step();
    run.recorder.rebaseline();
    laps(staged, 2);

    const record = recordOf(staged);
    expect(chartBands(record, SPAN)).toEqual([
      { kind: 'missing', from: 3, to: 4, label: 'not recorded' },
    ]);
    const axis = paceAxis([record.laps], SPAN, 5);
    if (!axis) throw new Error('no scale');
    expect(runsOf(paceLine(record, SPAN, axis))).toEqual([[2], [5, 6]]);
  });

  it('count the gap to another car lap number for lap number', () => {
    const staged = stage();
    laps(staged, 5);
    // Car 1 began two hundredths of a lap behind car 0 and laps a second
    // slower: it crosses the line later by a second more every lap.
    const line = gapLine(recordOf(staged).laps, recordOf(staged, 1).laps, SPAN);
    expect(runsOf(line)).toEqual([[1, 2, 3, 4]]);
    const gaps = line.segments[0].points.map((point) => point.value);
    expect(gaps[0]).toBeGreaterThan(2);
    expect(gaps[0]).toBeLessThan(3.5);
    for (let index = 1; index < gaps.length; index += 1) {
      expect(gaps[index] - gaps[index - 1]).toBeCloseTo(1, 1);
    }
  });
});
