import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type {
  RaceLap,
  RaceRecords,
  RaceStint,
  Telemetry,
} from '@irdashies/types';
import {
  GlobalFlags,
  LEDGER_LAP_BLUE,
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  RACE_HISTORY_MAX_LAPS_PER_CAR,
  TrackLocation,
} from '@irdashies/types';
import {
  drive,
  driveLaps,
  enterPits,
  Field,
  leaveBox,
  leavePits,
  recorded,
  standInBox,
} from './raceHistoryFixture';
import { LAP_TIME_WAIT_SECONDS } from './RaceHistoryRecorder';

/**
 * The race history's own rules, on staged frames: a small field lapping a
 * circuit, written in the shape a sim's frames have. What either sim really
 * writes through a stop or a driver change is not in here; the recorded
 * race is in RaceHistoryRecorder.tape.spec.ts.
 */

const PIT_FLAGS = LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP;

const start = (field: Field, options?: Parameters<typeof recorded>[0]) => {
  const run = recorded(options);
  run.recorder.onSession(field.session());
  return run;
};

/** A copy of everything a recorder holds, as the file would hand it back. */
const stored = (
  recorder: ReturnType<typeof recorded>['recorder'],
  cars: number
): RaceRecords =>
  structuredClone({
    laps: Array.from({ length: cars }, (_, carIdx) =>
      recorder.carLaps(carIdx)
    ).flat(),
    // Only a stint with a lap is ever stored.
    stints: Array.from({ length: cars }, (_, carIdx) =>
      recorder.carStints(carIdx).filter((stint) => stint.laps > 0)
    ).flat(),
    driverChanges: [...recorder.driverChanges()],
  }) as RaceRecords;

const lapNumbers = (laps: readonly RaceLap[]) => laps.map((lap) => lap.lap);

describe('a race as it begins', () => {
  it('waits for the session, then says what the race is', () => {
    const field = new Field();
    const run = recorded();

    drive(field, run.recorder, 1);
    expect(run.starts).toEqual([]);

    run.recorder.onSession(field.session());
    drive(field, run.recorder, 1);

    expect(run.starts).toHaveLength(1);
    expect(run.starts[0]).toMatchObject({
      token: 'boot:1',
      lapsCompleted: [0, 0, 0],
      info: {
        id: null,
        simulator: 'iracing',
        sessionKey: '4242:0',
        sessionNum: 0,
        sessionType: 'Race',
        sessionName: 'RACE',
        trackId: 18,
        trackName: 'Road America',
        trackConfig: 'Full Course',
        trackLengthM: 6500,
        tyres: [
          { index: 0, name: 'Medium' },
          { index: 1, name: 'Hard' },
        ],
      },
    });
    expect(run.starts[0].info.entries).toEqual([
      {
        carIdx: 0,
        carNumber: '10',
        car: 'gt3',
        classId: 7,
        className: 'Class 7',
        teamName: 'Team 0',
      },
      expect.objectContaining({ carIdx: 1, carNumber: '11' }),
      expect.objectContaining({ carIdx: 2, carNumber: '12' }),
    ]);
    expect(run.recorder.currentRace()).toBe(run.starts[0]);
  });

  it('has no session key where the sim’s id does not name one event', () => {
    const field = new Field();
    const run = start(field, {
      simulator: () => 'lmu',
      sessionIdsAreUnique: () => false,
    });

    drive(field, run.recorder, 1);

    expect(run.starts[0].info).toMatchObject({
      simulator: 'lmu',
      sessionKey: '',
    });
  });

  it('says where every car stands, for a race picked up part-way', () => {
    const field = new Field();
    field.cars[0].lap = 12;
    field.cars[1].lap = 11;
    field.cars[2].lap = -1;
    const run = start(field);

    drive(field, run.recorder, 1);

    expect(run.starts[0].lapsCompleted).toEqual([11, 10, -1]);
    expect(run.starts[0].info.entries.map((entry) => entry.carIdx)).toEqual([
      0, 1,
    ]);
  });
});

describe('a lap', () => {
  it('is kept with its number, its line time, its place and the sim’s time', () => {
    // iRacing's shape: the time comes two and a half seconds after the line.
    const field = new Field({ timeLag: 2.5 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 5);

    const laps = run.recorder.carLaps(0);
    expect(lapNumbers(laps)).toEqual([1, 2, 3]);
    // It started a tenth of the way round, at 100 s a lap.
    expect(laps[0].sessionTime).toBeCloseTo(190, 6);
    expect(laps[1].sessionTime).toBeCloseTo(290, 6);
    expect(laps[2].sessionTime).toBeCloseTo(390, 6);
    expect(laps[0].lapTime).toBeCloseTo(90, 6);
    expect(laps[1].lapTime).toBeCloseTo(100, 6);
    expect(laps[2].lapTime).toBeCloseTo(100, 6);
    expect(laps[1]).toMatchObject({
      carIdx: 0,
      position: 1,
      classPosition: 1,
      classGap: 0,
      flags: 0,
      driver: 'Driver 0',
      // iRacing gives no sectors and no fuel for another car.
      sectors: [null, null, null],
      energy: null,
      energyIsVirtual: false,
      compounds: [1, 1, 1, 1],
    });
    // The first lap of a race begins on the grid.
    expect(laps[0].flags).toBe(LEDGER_LAP_FROM_START);
  });

  it('is placed between the two frames either side of the line', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 1, 1);

    // 101 s a lap from 0.08 round it: the line at 192.92, between the
    // frames at 192.9 and 193.0.
    expect(run.recorder.carLaps(1)[0].sessionTime).toBeCloseTo(192.92, 6);
  });

  it('is handed on at the line without a time, and again when its time comes', () => {
    const field = new Field({ timeLag: 2.5 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 5);

    const second = run.recorder.carLaps(0)[1];
    const calls = run.lapCalls.filter((call) => call.lap === second);
    expect(calls).toEqual([
      { lap: second, settled: false, lapTime: null },
      { lap: second, settled: true, lapTime: second.lapTime },
    ]);
    expect(second.lapTime).toBeCloseTo(100, 6);
  });

  it('takes a time that moves a moment before the lap count as that lap’s', () => {
    // Le Mans Ultimate's shape: scoring's time can lead the app's count.
    const field = new Field({ timeLag: -0.3, lmu: true });
    const run = start(field, { simulator: () => 'lmu' });
    // A different pace each lap, so a time put to the wrong lap shows.
    const paces = [100, 108, 96, 103];

    driveLaps(field, run.recorder, 0, 4, () => {
      field.cars[0].pace = paces[field.cars[0].lap - 1] ?? 100;
    });
    drive(field, run.recorder, 3);

    const laps = run.recorder.carLaps(0);
    expect(lapNumbers(laps)).toEqual([1, 2, 3, 4]);
    for (let index = 1; index < laps.length; index += 1) {
      expect(laps[index].lapTime).toBeCloseTo(
        laps[index].sessionTime - laps[index - 1].sessionTime,
        6
      );
      expect(laps[index].lapTime).toBeCloseTo(paces[index], 0);
    }
  });

  it('reads the sectors, the energy and the wheels’ compounds where the sim gives them', () => {
    const field = new Field({ lmu: true });
    const run = start(field, { simulator: () => 'lmu' });
    field.energy = [0.61, 0.47, 0.33];

    driveLaps(field, run.recorder, 2, 2);
    drive(field, run.recorder, 2);

    const [, virtual] = run.recorder.carLaps(0);
    expect(virtual.sectors[0]).toBeCloseTo(30, 6);
    expect(virtual.sectors[1]).toBeCloseTo(30, 6);
    expect(virtual.sectors[2]).toBeCloseTo(40, 6);
    expect(virtual).toMatchObject({
      energy: 0.61,
      energyIsVirtual: true,
      compounds: [0, 0, 1, 1],
    });
    // A car that runs on fuel: the same figure, said to be fuel.
    expect(run.recorder.carLaps(1)[1]).toMatchObject({
      energy: 0.47,
      energyIsVirtual: false,
    });
  });

  it('takes the energy a second after the line, not at it', () => {
    const field = new Field({ lmu: true });
    const run = start(field, { simulator: () => 'lmu' });
    field.energy = [0.5, 0.5, 0.5];

    driveLaps(field, run.recorder, 0, 1);
    const crossedAt = field.time;
    // The sim's fuel byte reads a full tank for a moment as a car crosses.
    field.energy[0] = 1;
    drive(field, run.recorder, 0.5);
    field.energy[0] = 0.48;
    drive(field, run.recorder, 2);

    expect(field.time - crossedAt).toBeGreaterThan(1);
    expect(run.recorder.carLaps(0)[0].energy).toBe(0.48);
  });

  it('is kept without a time when none comes in ten seconds, and given one that comes late', () => {
    const field = new Field();
    const run = start(field);
    field.timeFor = (_carIdx, lap, driven) => (lap === 2 ? undefined : driven);

    driveLaps(field, run.recorder, 0, 2);
    const second = run.recorder.carLaps(0)[1];
    drive(field, run.recorder, LAP_TIME_WAIT_SECONDS - 0.5);
    expect(run.lapCalls.filter((call) => call.lap === second)).toHaveLength(1);

    drive(field, run.recorder, 1);
    // Handed on to be kept, with no time and nothing said against it.
    expect(run.lapCalls.filter((call) => call.lap === second)).toEqual([
      { lap: second, settled: false, lapTime: null },
      { lap: second, settled: true, lapTime: null },
    ]);
    expect(second.flags & LEDGER_LAP_VOIDED).toBe(0);

    field.cars[0].lastLapTime = 100.25;
    drive(field, run.recorder, 1);

    expect(second.lapTime).toBe(100.25);
    expect(run.lapCalls.filter((call) => call.lap === second)).toHaveLength(3);
    expect(run.lapCalls.at(-1)).toEqual({
      lap: second,
      settled: true,
      lapTime: 100.25,
    });
  });

  it('does not take a time that moves at the end of the next lap', () => {
    const field = new Field();
    const run = start(field);
    field.timeFor = (_carIdx, lap, driven) => (lap === 2 ? undefined : driven);

    driveLaps(field, run.recorder, 0, 2);
    const second = run.recorder.carLaps(0)[1];
    // Round to 95 % of the third lap: a time that moves here is the third
    // lap's own, a moment early.
    drive(field, run.recorder, 95);
    field.cars[0].lastLapTime = 99.5;
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);

    expect(second.lapTime).toBeNull();
    expect(run.recorder.carLaps(0)[2].lapTime).toBeCloseTo(100, 6);
  });

  it.each([
    ['after the line, as iRacing’s does', 2.5],
    ['with the lap count, as Le Mans Ultimate’s does', 0],
    ['a moment before the lap count', -0.3],
  ])(
    'reads a time the sim repeats through the whole next lap as that lap’s too, when the time comes %s',
    (_name, timeLag) => {
      // The lap-time history reads an unchanged time the same way.
      const field = new Field({ timeLag });
      const run = start(field);
      field.timeFor = (_carIdx, lap, driven) =>
        lap === 2 ? undefined : driven;

      driveLaps(field, run.recorder, 0, 3);
      drive(field, run.recorder, 5);

      const laps = run.recorder.carLaps(0);
      expect(laps[0].lapTime).toBeCloseTo(90, 6);
      expect(laps[1].lapTime).toBe(laps[0].lapTime);
      expect(laps[2].lapTime).toBeCloseTo(100, 6);
      // Both are clean laps of the stint, the first being from the grid.
      expect(run.recorder.carStints(0)[0]).toMatchObject({ cleanLaps: 2 });
    }
  );

  it('is marked as not counted when the sim gives it no time', () => {
    const field = new Field({ timeLag: 2.5 });
    const run = start(field);
    field.timeFor = (_carIdx, lap, driven) => (lap === 2 ? -1 : driven);

    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 5);

    const laps = run.recorder.carLaps(0);
    expect(laps[1].lapTime).toBeNull();
    expect(laps[1].flags & LEDGER_LAP_VOIDED).toBe(LEDGER_LAP_VOIDED);
    expect(laps[2].lapTime).toBeCloseTo(100, 6);
    expect(laps[2].flags & LEDGER_LAP_VOIDED).toBe(0);
  });

  it('is marked as not counted when LMU says so, whatever time stands in for it', () => {
    const field = new Field({ lmu: true });
    const run = start(field, { simulator: () => 'lmu' });
    // The frame carries the lap timed from its two starts; the sim's own
    // word is that it did not count.
    field.notCounted.add('0:2');

    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 3);

    const laps = run.recorder.carLaps(0);
    expect(laps[1].lapTime).toBeNull();
    expect(laps[1].flags & LEDGER_LAP_VOIDED).toBe(LEDGER_LAP_VOIDED);
    expect(laps[2].lapTime).toBeCloseTo(100, 6);
    // A lap that did not count is not in its stint's pace.
    expect(run.recorder.carStints(0)[0]).toMatchObject({
      laps: 3,
      cleanLaps: 1,
    });
  });

  it('carries the flags shown during it, the car’s own and the field’s', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    // A yellow for car 0 alone, then a full-course yellow for everybody.
    field.cars[0].flags = GlobalFlags.Yellow | GlobalFlags.Blue;
    drive(field, run.recorder, 5);
    field.cars[0].flags = 0;
    driveLaps(field, run.recorder, 0, 1);
    field.sessionFlags = GlobalFlags.Caution;
    drive(field, run.recorder, 5);
    field.sessionFlags = 0;
    driveLaps(field, run.recorder, 1, 2);

    const laps = run.recorder.carLaps(0);
    expect(laps[1].flags).toBe(LEDGER_LAP_YELLOW | LEDGER_LAP_BLUE);
    expect(laps[2].flags).toBe(LEDGER_LAP_CAUTION);
    expect(laps[3].flags).toBe(0);
    // Car 1 was shown no yellow of its own. The caution was its too: it
    // came as car 1 was ending its second lap, and stood into its third.
    const others = run.recorder.carLaps(1);
    expect(others[0].flags).toBe(LEDGER_LAP_FROM_START);
    expect(others[1].flags).toBe(LEDGER_LAP_CAUTION);
    expect(others[2].flags).toBe(LEDGER_LAP_CAUTION);
    expect(others[3].flags).toBe(0);
    // A lap under a local yellow is still a clean one; under caution, not.
    drive(field, run.recorder, 3);
    expect(run.recorder.carStints(0)[0]).toMatchObject({
      laps: 4,
      cleanLaps: 2,
    });
  });

  it('is not invented for a counter that jumped', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 20);
    // Frames stopped for a while, or the sim corrected itself: two laps on.
    field.cars[0].lap += 2;
    drive(field, run.recorder, 20);

    expect(lapNumbers(run.recorder.carLaps(0))).toEqual([1, 2]);

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);

    expect(lapNumbers(run.recorder.carLaps(0))).toEqual([1, 2, 5]);
    expect(run.recorder.missingLaps(0)).toEqual([3, 4]);
    expect(run.recorder.summary().missingLaps).toEqual([2, 0, 0]);
    // What the car did on the laps between was not seen either.
    expect(run.recorder.carStints(0)).toMatchObject([
      { ordinal: 1, closedBy: 'gap', firstLap: 1, lastLap: 2, laps: 2 },
      { ordinal: 2, openedBy: 'joined', closedBy: null, firstLap: 5, laps: 1 },
    ]);
    expect(run.recorder.carStints(0)[0].endTime).toBeCloseTo(290, 6);
  });

  it('keeps the lap it has when a counter goes back and comes forward again', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    const kept = [...run.recorder.carLaps(0)];
    // A tow or a reset.
    field.cars[0].lap = 1;
    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 2);

    const laps = run.recorder.carLaps(0);
    expect(lapNumbers(laps)).toEqual([1, 2, 3]);
    expect(laps[0]).toBe(kept[0]);
    expect(laps[1]).toBe(kept[1]);
  });

  it('drops the oldest laps of a car past the cap', () => {
    const field = new Field({ cars: 1 });
    field.cars[0].pace = 1;
    const run = start(field);
    const extra = 25;

    driveLaps(field, run.recorder, 0, RACE_HISTORY_MAX_LAPS_PER_CAR + extra);

    const laps = run.recorder.carLaps(0);
    expect(laps).toHaveLength(RACE_HISTORY_MAX_LAPS_PER_CAR);
    expect(laps[0].lap).toBe(extra + 1);
    expect(laps.at(-1)?.lap).toBe(RACE_HISTORY_MAX_LAPS_PER_CAR + extra);
    // What is no longer held is said to be missing.
    expect(run.recorder.summary().missingLaps[0]).toBe(extra);
  });
});

describe('the gap to the class leader at the line', () => {
  it('is measured from the first car of the class to complete the lap', () => {
    const field = new Field();
    // Car 2 is in a class of its own.
    field.cars[2].classId = 9;
    const run = start(field);

    driveLaps(field, run.recorder, 2, 2);

    const leader = run.recorder.carLaps(0);
    const second = run.recorder.carLaps(1);
    expect(leader.map((lap) => lap.classGap)).toEqual([0, 0]);
    expect(second[0].classGap).toBeCloseTo(192.92 - 190, 6);
    expect(second[1].classGap).toBeCloseTo(293.92 - 290, 6);
    expect(run.recorder.carLaps(2).map((lap) => lap.classGap)).toEqual([0, 0]);
  });

  it('is not known for a lap whose leader crossed before recording began', () => {
    const field = new Field();
    // Picked up part-way: the leader is a lap ahead of the car behind.
    field.cars[0].lap = 6;
    field.cars[1].lap = 5;
    field.cars[2].lap = 5;
    const run = start(field);

    driveLaps(field, run.recorder, 2, 2);

    // Lap 5 was led before anything was seen.
    expect(run.recorder.carLaps(1)[0]).toMatchObject({
      lap: 5,
      classGap: null,
    });
    expect(run.recorder.carLaps(2)[0]).toMatchObject({
      lap: 5,
      classGap: null,
    });
    // Lap 6 was seen being led.
    expect(run.recorder.carLaps(0)[0]).toMatchObject({ lap: 6, classGap: 0 });
    const lapSix = run.recorder.carLaps(1)[1];
    expect(lapSix.lap).toBe(6);
    expect(lapSix.classGap).toBeCloseTo(
      lapSix.sessionTime - run.recorder.carLaps(0)[0].sessionTime,
      9
    );
    expect(lapSix.classGap).toBeGreaterThan(90);
  });
});

describe('a visit to the pit lane', () => {
  /** A stop for car 0 on its second lap: 10 s in, 30 s standing, 5 s out. */
  const stop = (
    field: Field,
    recorder: ReturnType<typeof recorded>['recorder']
  ) => {
    const car = field.cars[0];
    driveLaps(field, recorder, 0, 1);
    drive(field, recorder, 50);
    enterPits(car);
    const enteredAt = field.time;
    drive(field, recorder, 10);
    standInBox(car);
    drive(field, recorder, 30);
    leaveBox(car);
    drive(field, recorder, 5);
    leavePits(car);
    const leftAt = field.time;
    drive(field, recorder, 1);
    return { enteredAt, leftAt };
  };

  it('ends the stint when the car stood still on it', () => {
    const field = new Field();
    const run = start(field);

    const { enteredAt, leftAt } = stop(field, run.recorder);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const stints = run.recorder.carStints(0);
    expect(stints).toHaveLength(2);
    expect(stints[0]).toMatchObject({
      ordinal: 1,
      driver: 'Driver 0',
      openedBy: 'start',
      closedBy: 'stop',
      firstLap: 1,
      lastLap: 1,
      laps: 1,
      stop: { driverChanged: false },
    });
    // It ends where the car left the track, and the next begins where it
    // came back to it.
    expect(stints[0].endTime).toBeCloseTo(enteredAt, 0);
    expect(stints[0].stop?.laneTime).toBeCloseTo(45, 0);
    expect(stints[0].stop?.standingTime).toBeCloseTo(30, 0);
    expect(stints[1]).toMatchObject({
      ordinal: 2,
      driver: 'Driver 0',
      openedBy: 'stop',
      closedBy: null,
      firstLap: 2,
      laps: 2,
      stop: null,
    });
    expect(stints[1].startTime).toBeCloseTo(leftAt, 0);

    const laps = run.recorder.carLaps(0);
    expect(laps[1].flags & PIT_FLAGS).toBe(PIT_FLAGS);
    expect(laps[2].flags & PIT_FLAGS).toBe(0);
    // The lap of the stop is not in the pace of the stint after it.
    expect(stints[1].cleanLaps).toBe(1);
    expect(stints[1].avgLap).toBeCloseTo(100, 6);
    expect(run.recorder.summary().stops).toEqual([1, 0, 0]);
    expect(run.recorder.summary().previousStintAvgLap[0]).toBe(-1);
  });

  it('says so as it happens: the stint is closed while the car still stands', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 10);
    standInBox(car);
    drive(field, run.recorder, 3);

    const [ended, next] = run.recorder.carStints(0);
    expect(ended).toMatchObject({ closedBy: 'stop', stop: { laneTime: null } });
    expect(ended.stop?.standingTime).toBeGreaterThan(1);
    expect(next).toMatchObject({ openedBy: 'stop', laps: 0 });
    expect(run.stintCalls).toContain(ended);
  });

  it('puts the lap that ends in the lane before the box in the stint that is ending', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    // In at 95 % of the second lap, over the line in the lane, into the box
    // two seconds into the third.
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 95);
    enterPits(car);
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);
    standInBox(car);
    drive(field, run.recorder, 20);
    leaveBox(car);
    drive(field, run.recorder, 3);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const laps = run.recorder.carLaps(0);
    expect(laps[1].flags & PIT_FLAGS).toBe(LEDGER_LAP_IN_LAP);
    expect(laps[2].flags & PIT_FLAGS).toBe(LEDGER_LAP_OUT_LAP);
    expect(laps[3].flags & PIT_FLAGS).toBe(0);
    expect(run.recorder.carStints(0)).toMatchObject([
      { closedBy: 'stop', firstLap: 1, lastLap: 2, laps: 2 },
      { openedBy: 'stop', firstLap: 3, laps: 2, cleanLaps: 1 },
    ]);
  });

  it('does not end the stint when the car drove through', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 20);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { closedBy: null, firstLap: 1, laps: 3, cleanLaps: 1, stop: null },
    ]);
    expect(run.recorder.carLaps(0)[1].flags & PIT_FLAGS).toBe(PIT_FLAGS);
    expect(run.recorder.summary().stops).toEqual([0, 0, 0]);
  });

  it('does not make a pit lap of a brush of the entry line', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 1);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);

    expect(run.recorder.carLaps(0)[1].flags & PIT_FLAGS).toBe(0);
    expect(run.recorder.carStints(0)[0].cleanLaps).toBe(1);
  });

  it('ends the stint when the car is gone to its garage, but not for a blink', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];
    const vanish = () => {
      car.halted = true;
      car.surface = TrackLocation.NotInWorld;
    };

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 20);
    // Out of the world for two seconds: a car on another machine does that.
    vanish();
    drive(field, run.recorder, 2);
    leavePits(car);
    drive(field, run.recorder, 20);
    expect(run.recorder.carStints(0)).toHaveLength(1);

    vanish();
    const goneAt = field.time;
    drive(field, run.recorder, 30);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const stints = run.recorder.carStints(0);
    expect(stints).toMatchObject([
      { closedBy: 'garage', firstLap: 1, lastLap: 1, stop: null },
      { openedBy: 'garage', closedBy: null, firstLap: 2, laps: 2 },
    ]);
    expect(stints[0].endTime).toBeCloseTo(goneAt, 0);
    expect(run.recorder.carLaps(0)[1].flags & PIT_FLAGS).toBe(PIT_FLAGS);
    // Not a stop: the car was not seen to stand in the pit lane.
    expect(run.recorder.summary().stops[0]).toBe(0);
  });

  describe('a stint that began in the garage', () => {
    const vanish = (field: Field) => {
      field.cars[0].halted = true;
      field.cars[0].surface = TrackLocation.NotInWorld;
    };

    it('is driven from where the car came back to the track, not from when it went away', () => {
      const field = new Field();
      const run = start(field);
      const car = field.cars[0];

      driveLaps(field, run.recorder, 0, 1);
      drive(field, run.recorder, 20);
      vanish(field);
      const goneAt = field.time;
      // Twenty minutes of repairs.
      drive(field, run.recorder, 1200);
      leavePits(car);
      const backAt = field.time;
      driveLaps(field, run.recorder, 0, 2);
      drive(field, run.recorder, 2);

      const [before, after] = run.recorder.carStints(0);
      expect(before).toMatchObject({ closedBy: 'garage', laps: 1 });
      expect(before.endTime).toBeCloseTo(goneAt, 0);
      expect(after).toMatchObject({ openedBy: 'garage', closedBy: null });
      // It kept the moment the car went away as its start, so the twenty
      // minutes in the garage were part of the stint.
      expect(after.startTime).toBeCloseTo(backAt, 0);
    });

    it('is driven from the pit exit where the car came out by the lane', () => {
      const field = new Field();
      const run = start(field);
      const car = field.cars[0];

      driveLaps(field, run.recorder, 0, 1);
      drive(field, run.recorder, 20);
      vanish(field);
      drive(field, run.recorder, 600);
      // Down the lane without standing in it.
      car.halted = false;
      enterPits(car);
      drive(field, run.recorder, 8);
      leavePits(car);
      const exitAt = field.time;
      driveLaps(field, run.recorder, 0, 1);
      drive(field, run.recorder, 2);

      const after = run.recorder.carStints(0)[1];
      expect(after).toMatchObject({ openedBy: 'garage', laps: 1 });
      expect(after.startTime).toBeCloseTo(exitAt, 0);
      expect(run.recorder.summary().stops[0]).toBe(0);
    });

    it('stays as it was opened, with no lap, for a car that never comes back', () => {
      const field = new Field();
      const run = start(field);

      driveLaps(field, run.recorder, 0, 1);
      drive(field, run.recorder, 20);
      vanish(field);
      const goneAt = field.time;
      drive(field, run.recorder, 1200);

      const [before, open] = run.recorder.carStints(0);
      expect(before).toMatchObject({ closedBy: 'garage', laps: 1 });
      // What a reader has to go by: no lap, and the moment the car left.
      expect(open).toMatchObject({
        openedBy: 'garage',
        closedBy: null,
        laps: 0,
        firstLap: null,
      });
      expect(open.startTime).toBeCloseTo(goneAt, 0);
    });
  });

  it('counts no stop for a car found standing in its box before it has driven a lap', () => {
    // Staged as iRacing has it before a race: every car waits in its stall
    // until it is sent to the grid. Each was counted as having stopped, so
    // the summary read one stop for all of them before any was made.
    const field = new Field();
    const car = field.cars[0];
    enterPits(car);
    standInBox(car);
    const run = start(field);
    drive(field, run.recorder, 30);
    expect(run.recorder.summary().stops).toEqual([0, 0, 0]);

    leaveBox(car);
    drive(field, run.recorder, 5);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    expect(run.recorder.summary().stops).toEqual([0, 0, 0]);
    // The stint is the one the race began with, not one a stop opened.
    expect(run.recorder.carStints(0)).toMatchObject([
      { ordinal: 1, openedBy: 'start', closedBy: null, firstLap: 1, laps: 2 },
    ]);
    // Its first lap began in the pits all the same.
    expect(run.recorder.carLaps(0)[0].flags & PIT_FLAGS).toBe(
      LEDGER_LAP_OUT_LAP
    );
  });

  it('counts the stop of a car found standing in its box part-way through a race', () => {
    // The app started with the race under way and the car at its stop.
    const field = new Field();
    const car = field.cars[0];
    car.lap = 12;
    enterPits(car);
    standInBox(car);
    const run = start(field);
    drive(field, run.recorder, 30);

    expect(run.recorder.summary().stops[0]).toBe(1);
  });

  it('keeps no stint that ended without a lap', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    // Two stops before the car has completed a lap.
    for (let visit = 0; visit < 2; visit += 1) {
      drive(field, run.recorder, 10);
      enterPits(car);
      drive(field, run.recorder, 3);
      standInBox(car);
      drive(field, run.recorder, 5);
      leavePits(car);
    }
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { ordinal: 1, openedBy: 'stop', closedBy: null, firstLap: 1, laps: 1 },
    ]);
    // Both were stops all the same.
    expect(run.recorder.summary().stops[0]).toBe(2);
    expect(run.stintCalls.every((stint) => stint.laps > 0)).toBe(true);
  });
});

describe('a driver change', () => {
  const rename = (
    field: Field,
    run: ReturnType<typeof recorded>,
    name: string
  ) => {
    field.cars[0].name = name;
    run.recorder.onSession(field.session());
  };

  it('ends the stint when the session names another driver out on the track', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 30);
    const changedAt = field.time;
    rename(field, run, 'Team-Mate');
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const stints = run.recorder.carStints(0);
    expect(stints).toMatchObject([
      { driver: 'Driver 0', closedBy: 'driver', firstLap: 1, lastLap: 2 },
      { driver: 'Team-Mate', openedBy: 'driver', closedBy: null, firstLap: 3 },
    ]);
    expect(stints[0].endTime).toBeCloseTo(changedAt, 6);
    expect(run.recorder.carLaps(0).map((lap) => lap.driver)).toEqual([
      'Driver 0',
      'Driver 0',
      'Team-Mate',
      'Team-Mate',
    ]);
    expect(run.recorder.driverChanges()).toEqual([
      {
        carIdx: 0,
        seq: 1,
        sessionTime: changedAt,
        lap: 2,
        from: 'Driver 0',
        to: 'Team-Mate',
        atStop: false,
      },
    ]);
    const summary = run.recorder.summary();
    expect(summary.driverChanges).toEqual([1, 0, 0]);
    expect(summary.stintDriver[0]).toBe('Team-Mate');
    expect(summary.previousStintDriver[0]).toBe('Driver 0');
    expect(summary.previousStintAvgLap[0]).toBeCloseTo(100, 6);
  });

  it('belongs to the stop when it comes while the car stands in its box', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 10);
    standInBox(car);
    drive(field, run.recorder, 10);
    rename(field, run, 'Team-Mate');
    drive(field, run.recorder, 20);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', stop: { driverChanged: true } },
      { driver: 'Team-Mate', openedBy: 'stop', closedBy: null },
    ]);
    expect(run.recorder.driverChanges()).toMatchObject([
      { carIdx: 0, lap: 1, from: 'Driver 0', to: 'Team-Mate', atStop: true },
    ]);
    expect(run.recorder.summary().stops[0]).toBe(1);
  });

  it('belongs to the stop when it comes before the car has stood still', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 5);
    // Named while the car is still rolling down the lane.
    rename(field, run, 'Team-Mate');
    expect(run.recorder.driverChanges()).toMatchObject([{ atStop: false }]);
    drive(field, run.recorder, 5);
    standInBox(car);
    drive(field, run.recorder, 20);
    leavePits(car);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', stop: { driverChanged: true } },
      { driver: 'Team-Mate', openedBy: 'stop' },
    ]);
    expect(run.recorder.driverChanges()).toMatchObject([{ atStop: true }]);
    // Said again once it was known to have come with a stop.
    expect(run.changeCalls).toHaveLength(2);
    expect(run.changeCalls[0]).toBe(run.changeCalls[1]);
  });

  it('belongs to the stop when the session names the new driver a while after it', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    // A stop late on the second lap, so that lap ends in the new stint
    // before the session has caught up.
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 60);
    enterPits(car);
    drive(field, run.recorder, 5);
    standInBox(car);
    drive(field, run.recorder, 20);
    leavePits(car);
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 5);
    const second = run.recorder.carLaps(0)[1];
    expect(second.driver).toBe('Driver 0');
    const callsBefore = run.lapCalls.filter((call) => call.lap === second);

    rename(field, run, 'Team-Mate');

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', stop: { driverChanged: true } },
      { driver: 'Team-Mate', openedBy: 'stop', closedBy: null, firstLap: 2 },
    ]);
    // The lap already kept under the old name is the new driver's, and is
    // handed on again to be kept as that.
    expect(second.driver).toBe('Team-Mate');
    expect(run.lapCalls.filter((call) => call.lap === second)).toHaveLength(
      callsBefore.length + 1
    );
    expect(run.recorder.driverChanges()).toMatchObject([{ atStop: true }]);
  });

  it('ends the stint by itself when it comes long after the stop', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 20);
    enterPits(car);
    drive(field, run.recorder, 5);
    standInBox(car);
    drive(field, run.recorder, 20);
    leavePits(car);
    // Two laps on, far past the minute and a half the session can lag by.
    driveLaps(field, run.recorder, 0, 3);
    rename(field, run, 'Team-Mate');

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', stop: { driverChanged: false } },
      { driver: 'Driver 0', openedBy: 'stop', closedBy: 'driver' },
      { driver: 'Team-Mate', openedBy: 'driver', closedBy: null },
    ]);
    expect(run.recorder.driverChanges()).toMatchObject([{ atStop: false }]);
  });

  it('ends the stint when the car drove through with another name on it', () => {
    const field = new Field();
    const run = start(field);
    const car = field.cars[0];

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 5);
    rename(field, run, 'Team-Mate');
    drive(field, run.recorder, 15);
    leavePits(car);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'driver', stop: null },
      { driver: 'Team-Mate', openedBy: 'driver', closedBy: null },
    ]);
    expect(run.recorder.driverChanges()).toMatchObject([{ atStop: false }]);
    expect(run.recorder.summary().stops[0]).toBe(0);
  });

  it('is not one when a slot is given its first name, or loses its name', () => {
    const field = new Field();
    field.cars[0].name = '';
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    rename(field, run, 'Driver 0');
    drive(field, run.recorder, 5);
    rename(field, run, '');
    drive(field, run.recorder, 5);
    rename(field, run, 'Driver 0');
    driveLaps(field, run.recorder, 0, 1);

    expect(run.recorder.driverChanges()).toEqual([]);
    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: null, laps: 2 },
    ]);
  });
});

describe('the end of a race', () => {
  it('comes with another session, and a new race begins', () => {
    const field = new Field({ sessionType: 'Practice' });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    const practice = [...run.recorder.carStints(0)];
    field.sessionNum = 1;
    field.sessionType = 'Race';
    run.recorder.onSession(field.session());
    drive(field, run.recorder, 1);

    expect(run.ended).toBe(1);
    expect(run.starts).toHaveLength(2);
    expect(run.starts[0].info).toMatchObject({
      sessionNum: 0,
      sessionType: 'Practice',
      sessionKey: '4242:0',
    });
    expect(run.starts[1]).toMatchObject({
      token: 'boot:2',
      info: { sessionNum: 1, sessionType: 'Race', sessionKey: '4242:1' },
    });
    // What was open was closed with the session, and said to be.
    expect(practice[0]).toMatchObject({ closedBy: 'session', laps: 2 });
    expect(run.stintCalls.at(-1)?.closedBy).toBe('session');
    // The recorder holds the new race alone.
    expect(run.recorder.carLaps(0)).toEqual([]);
    expect(run.recorder.summary()).toMatchObject({
      raceToken: 'boot:2',
      laps: [0, 0, 0],
    });
  });

  it('does not mark the first lap of a practice as begun on the grid', () => {
    const field = new Field({ sessionType: 'Practice' });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);

    expect(run.recorder.carLaps(0)[0].flags).toBe(0);
  });

  it('comes with a session clock that starts again', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    field.time = 5;
    for (const car of field.cars) car.lap = 1;
    drive(field, run.recorder, 1);

    expect(run.ended).toBe(1);
    expect(run.starts).toHaveLength(2);
    expect(run.starts[1].lapsCompleted).toEqual([0, 0, 0]);
    expect(run.recorder.carLaps(0)).toEqual([]);
  });

  it('comes with another event or track', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    field.subSessionId = 9000;
    run.recorder.onSession(field.session());

    expect(run.ended).toBe(1);
    expect(run.recorder.currentRace()).toBeNull();
    drive(field, run.recorder, 1);
    expect(run.starts[1].info.sessionKey).toBe('9000:0');
  });

  it('comes with the sim going away, and nothing is recorded until a session is back', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    run.recorder.onDisconnect();
    drive(field, run.recorder, 5);

    expect(run.ended).toBe(1);
    expect(run.starts).toHaveLength(1);
    expect(run.recorder.summary()).toMatchObject({ raceToken: '', laps: [] });
  });

  it('hands on a lap still waiting for its time, so that it is kept', () => {
    const field = new Field({ timeLag: 2.5 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);
    const [first] = run.recorder.carLaps(0);
    run.recorder.onDisconnect();

    expect(run.lapCalls.filter((call) => call.lap === first)).toEqual([
      { lap: first, settled: false, lapTime: null },
      { lap: first, settled: true, lapTime: null },
    ]);
  });
});

describe('the entry list', () => {
  it('follows a car joining the session', () => {
    const field = new Field();
    field.cars[2].lap = -1;
    const run = start(field);
    drive(field, run.recorder, 5);
    expect(run.starts[0].info.entries).toHaveLength(2);

    field.cars[2].lap = 1;
    run.recorder.onSession(field.session());
    driveLaps(field, run.recorder, 2, 1);

    expect(run.infoChanges).toBe(1);
    expect(run.starts[0].info.entries.map((entry) => entry.carIdx)).toEqual([
      0, 1, 2,
    ]);
    expect(lapNumbers(run.recorder.carLaps(2))).toEqual([1]);
  });

  it('drops what was kept for a slot when another car takes it', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 1, 2);
    const revision = run.recorder.carRevision(1);
    field.cars[1].carNumber = '99';
    field.cars[1].carPath = 'lmp2';
    field.cars[1].name = 'Somebody Else';
    field.cars[1].lap = 1;
    run.recorder.onSession(field.session());

    expect(run.replaced).toEqual([1]);
    expect(run.recorder.carLaps(1)).toEqual([]);
    expect(run.recorder.carStints(1)).toEqual([]);
    expect(run.recorder.carRevision(1)).toBeGreaterThan(revision);
    // Nobody changed driver: it is another car.
    expect(run.recorder.driverChanges()).toEqual([]);

    driveLaps(field, run.recorder, 1, 1);
    expect(run.recorder.carLaps(1)).toMatchObject([
      { lap: 1, driver: 'Somebody Else' },
    ]);
    expect(run.recorder.carLaps(0).length).toBeGreaterThan(1);
  });

  it('keeps no record for the pace car or a spectator', () => {
    const field = new Field();
    const run = recorded();
    const session = field.session();
    session.DriverInfo.Drivers[2].CarIsPaceCar = 1;
    run.recorder.onSession(session);

    driveLaps(field, run.recorder, 2, 1);

    expect(run.recorder.carLaps(2)).toEqual([]);
    expect(run.starts[0].info.entries.map((entry) => entry.carIdx)).toEqual([
      0, 1,
    ]);
    expect(run.starts[0].lapsCompleted[2]).toBe(-1);
  });
});

describe('frames that resume after a gap', () => {
  it('record nothing for what happened meanwhile, and say which laps are missing', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);
    // Nothing asked for the record for two and a half laps.
    for (let frame = 0; frame < 2500; frame += 1) field.step();
    run.recorder.rebaseline();
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const laps = run.recorder.carLaps(0);
    expect(lapNumbers(laps)).toEqual([1, 2, 5, 6]);
    expect(run.recorder.missingLaps(0)).toEqual([3, 4]);
    expect(laps[2].lapTime).toBeCloseTo(100, 6);
    expect(run.recorder.carStints(0)).toMatchObject([
      { closedBy: 'gap', firstLap: 1, lastLap: 2 },
      { openedBy: 'joined', closedBy: null, firstLap: 5, laps: 2 },
    ]);
    expect(run.ended).toBe(0);
  });

  it('carry a stint on when no lap was missed', () => {
    const field = new Field();
    const run = start(field);

    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);
    for (let frame = 0; frame < 300; frame += 1) field.step();
    run.recorder.rebaseline();
    driveLaps(field, run.recorder, 0, 2);

    expect(lapNumbers(run.recorder.carLaps(0))).toEqual([1, 2, 3, 4]);
    expect(run.recorder.carStints(0)).toMatchObject([
      { closedBy: null, firstLap: 1, laps: 4 },
    ]);
  });
});

describe('a race found in the file', () => {
  /** A race recorded for a while, then the app stopped. */
  const before = (laps: number) => {
    const field = new Field({ timeLag: 2.5 });
    const first = start(field);
    driveLaps(field, first.recorder, 2, laps);
    drive(field, first.recorder, 4);
    return { field, kept: stored(first.recorder, 3) };
  };

  it('is carried on where no lap was missed', () => {
    const { field, kept } = before(3);
    const run = start(field, { bootId: 'later' });

    // Picked up again, and the file read a moment after.
    drive(field, run.recorder, 0.5);
    run.recorder.restore(kept);
    driveLaps(field, run.recorder, 2, 2);
    drive(field, run.recorder, 4);

    for (let carIdx = 0; carIdx < 3; carIdx += 1) {
      const laps = run.recorder.carLaps(carIdx);
      expect(lapNumbers(laps).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(run.recorder.missingLaps(carIdx)).toEqual([]);
      const stints = run.recorder.carStints(carIdx);
      expect(stints, `car ${carIdx}`).toHaveLength(1);
      expect(stints[0]).toMatchObject({
        ordinal: 1,
        openedBy: 'start',
        closedBy: null,
        firstLap: 1,
        laps: laps.length,
        // Every lap but the one from the grid, before and after.
        cleanLaps: laps.length - 1,
      });
      expect(stints[0].avgLap).toBeCloseTo(100 + carIdx, 6);
    }
    expect(run.recorder.summary()).toMatchObject({
      raceToken: 'later:1',
      resumed: true,
      missingLaps: [0, 0, 0],
    });
  });

  it('says which laps were driven while the app was not running', () => {
    const { field, kept } = before(3);
    // Two laps with nothing running.
    while (field.cars[2].lap < 6) field.step();
    const run = start(field, { bootId: 'later' });

    drive(field, run.recorder, 0.5);
    run.recorder.restore(kept);
    driveLaps(field, run.recorder, 2, 2);
    drive(field, run.recorder, 4);

    const laps = run.recorder.carLaps(2);
    expect(lapNumbers(laps)).toEqual([1, 2, 3, 6, 7]);
    expect(run.recorder.missingLaps(2)).toEqual([4, 5]);
    expect(run.recorder.summary().missingLaps[2]).toBe(2);
    // None of them was made up.
    expect(laps[3].sessionTime - laps[2].sessionTime).toBeGreaterThan(300);
    // The stint that was open is cut at its last lap: where it really
    // ended was not seen.
    const stints = run.recorder.carStints(2);
    expect(stints).toMatchObject([
      { ordinal: 1, closedBy: 'gap', firstLap: 1, lastLap: 3, laps: 3 },
      { ordinal: 2, openedBy: 'joined', closedBy: null, firstLap: 6, laps: 2 },
    ]);
    expect(stints[0].endTime).toBe(laps[2].sessionTime);
    // And said to be, so that the file has it closed too.
    expect(run.stintCalls).toContain(stints[0]);
  });

  it('keeps the laps completed while the file was being read', () => {
    const { field, kept } = before(3);
    const run = start(field, { bootId: 'later' });

    // A whole lap before the file answers.
    driveLaps(field, run.recorder, 2, 1);
    drive(field, run.recorder, 4);
    const live = run.recorder.carLaps(0)[0];
    expect(live.lap).toBe(4);
    run.recorder.restore(kept);

    const laps = run.recorder.carLaps(0);
    expect(lapNumbers(laps)).toEqual([1, 2, 3, 4]);
    // The lap seen is the one kept, not a copy from anywhere.
    expect(laps[3]).toBe(live);
    expect(run.recorder.carStints(0)).toMatchObject([
      { ordinal: 1, closedBy: null, firstLap: 1, lastLap: 4, laps: 4 },
    ]);
    expect(run.recorder.carStints(0)[0].cleanLaps).toBe(3);
  });

  it('records a driver who changed while the app was not running', () => {
    const { field, kept } = before(2);
    while (field.cars[2].lap < 6) field.step();
    field.cars[0].name = 'Team-Mate';
    const run = start(field, { bootId: 'later' });

    drive(field, run.recorder, 0.5);
    const noticedAt = field.time;
    run.recorder.restore(kept);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'gap' },
      { driver: 'Team-Mate', openedBy: 'joined', closedBy: null },
    ]);
    // When it happened is not known: only when it was noticed.
    expect(run.recorder.driverChanges()).toMatchObject([
      { carIdx: 0, seq: 1, from: 'Driver 0', to: 'Team-Mate', atStop: false },
    ]);
    expect(run.recorder.driverChanges()[0].sessionTime).toBeCloseTo(
      noticedAt,
      6
    );
    expect(run.recorder.summary().driverChanges[0]).toBe(1);
  });

  it('counts driver changes on from those in the file', () => {
    const field = new Field();
    const first = start(field);
    driveLaps(field, first.recorder, 0, 2);
    field.cars[0].name = 'Second';
    first.recorder.onSession(field.session());
    driveLaps(field, first.recorder, 0, 1);
    const kept = stored(first.recorder, 3);
    const run = start(field, { bootId: 'later' });

    drive(field, run.recorder, 0.5);
    run.recorder.restore(kept);
    driveLaps(field, run.recorder, 0, 1);
    field.cars[0].name = 'Third';
    run.recorder.onSession(field.session());

    expect(run.recorder.driverChanges()).toMatchObject([
      { carIdx: 0, seq: 1, from: 'Driver 0', to: 'Second' },
      { carIdx: 0, seq: 2, from: 'Second', to: 'Third' },
    ]);
    expect(run.recorder.summary().driverChanges[0]).toBe(2);
    expect(run.recorder.carStints(0)).toMatchObject([
      { ordinal: 1, driver: 'Driver 0', closedBy: 'driver' },
      { ordinal: 2, driver: 'Second', closedBy: 'driver' },
      { ordinal: 3, driver: 'Third', closedBy: null },
    ]);
  });

  it('still holds a car that is no longer in the session', () => {
    const { field, kept } = before(2);
    field.cars[1].lap = -1;
    const run = start(field, { bootId: 'later' });

    drive(field, run.recorder, 0.5);
    run.recorder.restore(kept);
    driveLaps(field, run.recorder, 0, 1);

    expect(lapNumbers(run.recorder.carLaps(1))).toEqual([1, 2]);
    expect(run.recorder.carStints(1)).toMatchObject([
      { ordinal: 1, firstLap: 1, lastLap: 2 },
    ]);
    expect(run.recorder.summary().laps[1]).toBe(2);
  });

  it('measures a gap against a lap that was led before the restart', () => {
    const { field, kept } = before(2);
    // Stopped after the leader completed its third lap and before car 2 did.
    while (field.cars[0].lap < 4) field.step();
    expect(field.cars[2].lap).toBe(3);
    const lead = new Field({ timeLag: 2.5 });
    const whole = start(lead);
    driveLaps(lead, whole.recorder, 0, 3);
    const leaderLap = structuredClone(whole.recorder.carLaps(0)[2]);
    const run = start(field, { bootId: 'later' });

    drive(field, run.recorder, 0.5);
    run.recorder.restore({ ...kept, laps: [...kept.laps, leaderLap] });
    driveLaps(field, run.recorder, 2, 1);

    const third = run.recorder.carLaps(2)[2];
    expect(third.lap).toBe(3);
    expect(third.classGap).toBeCloseTo(
      third.sessionTime - leaderLap.sessionTime,
      9
    );
  });

  it('is told the race is in the file, and says so on the summary', () => {
    const field = new Field();
    const run = start(field);
    drive(field, run.recorder, 1);
    const version = run.recorder.summary().version;

    run.recorder.noteStored(31);

    expect(run.starts[0].info.id).toBe(31);
    expect(run.recorder.summary().raceId).toBe(31);
    expect(run.recorder.summary().version).toBeGreaterThan(version);
  });
});

describe('the summary', () => {
  it('counts what is held for every car, by slot', () => {
    const field = new Field();
    field.cars[1].lap = -1;
    const run = start(field);

    driveLaps(field, run.recorder, 2, 2);
    drive(field, run.recorder, 2);

    expect(run.recorder.summary()).toMatchObject({
      raceToken: 'boot:1',
      raceId: null,
      resumed: false,
      laps: [2, 0, 2],
      lastLap: [2, 0, 2],
      missingLaps: [0, 0, 0],
      stintFirstLap: [1, 0, 1],
      stintLaps: [2, 0, 2],
      stintDriver: ['Driver 0', '', 'Driver 2'],
      // The one clean lap of each: the first began on the grid.
      stintCleanLaps: [1, 0, 1],
      previousStintAvgLap: [-1, -1, -1],
      previousStintDriver: ['', '', ''],
      previousDriverStintAvgLap: [-1, -1, -1],
      previousDriverStintDriver: ['', '', ''],
      driverChanges: [0, 0, 0],
      stops: [0, 0, 0],
      sessionNum: 0,
    });
  });

  it('counts the laps of a car picked up part-way as missing', () => {
    const field = new Field();
    field.cars[0].lap = 41;
    const run = start(field);

    driveLaps(field, run.recorder, 0, 1);

    expect(run.recorder.summary()).toMatchObject({
      laps: [1, 0, 0],
      lastLap: [41, 0, 0],
      missingLaps: [40, 0, 0],
      stintFirstLap: [41, 0, 0],
    });
    expect(run.recorder.missingLaps(0)).toHaveLength(40);
    expect(run.recorder.carStints(0)[0].openedBy).toBe('joined');
  });

  it('moves a car’s counter only when something kept for it changed', () => {
    const field = new Field({ timeLag: 2.5 });
    const run = start(field);

    // Every car through its first lap, and each lap given its time.
    driveLaps(field, run.recorder, 2, 1);
    drive(field, run.recorder, 5);
    const summary = run.recorder.summary();
    const version = summary.version;
    const revisions = [...summary.revision];

    drive(field, run.recorder, 30);
    expect(run.recorder.summary().version).toBe(version);
    expect(run.recorder.summary().revision).toEqual(revisions);

    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 1);
    const after = run.recorder.summary();
    expect(after.version).toBeGreaterThan(version);
    expect(after.revision[0]).toBeGreaterThan(revisions[0]);
    expect(after.revision[2]).toBe(revisions[2]);
  });

  it('is one object with the same arrays, written in place', () => {
    const field = new Field();
    const run = start(field);
    drive(field, run.recorder, 1);

    const first = run.recorder.summary();
    const arrays = {
      laps: first.laps,
      lastLap: first.lastLap,
      missingLaps: first.missingLaps,
      stintFirstLap: first.stintFirstLap,
      stintLaps: first.stintLaps,
      stintDriver: first.stintDriver,
      stintAvgLap: first.stintAvgLap,
      stintCleanLaps: first.stintCleanLaps,
      previousStintAvgLap: first.previousStintAvgLap,
      previousStintDriver: first.previousStintDriver,
      previousDriverStintAvgLap: first.previousDriverStintAvgLap,
      previousDriverStintDriver: first.previousDriverStintDriver,
      driverChanges: first.driverChanges,
      stops: first.stops,
      revision: first.revision,
    };

    driveLaps(field, run.recorder, 2, 3);

    const later = run.recorder.summary();
    expect(later).toBe(first);
    for (const [key, array] of Object.entries(arrays)) {
      expect(later[key as keyof typeof arrays], key).toBe(array);
    }
    expect(later.laps).toEqual([3, 3, 3]);
  });
});

describe('the pace of a stint on the summary', () => {
  /**
   * A stop for the one car, begun half a lap on from where it is: 10 s in,
   * 30 s standing, 5 s out. With `driver`, the session names them while the
   * car stands; with `pace`, the car laps at it from the pit exit.
   */
  const stop = (
    field: Field,
    run: ReturnType<typeof recorded>,
    { driver, pace }: { driver?: string; pace?: number } = {}
  ) => {
    const car = field.cars[0];
    drive(field, run.recorder, 50);
    enterPits(car);
    drive(field, run.recorder, 10);
    standInBox(car);
    drive(field, run.recorder, 10);
    if (driver !== undefined) {
      car.name = driver;
      run.recorder.onSession(field.session());
    }
    drive(field, run.recorder, 20);
    leaveBox(car);
    drive(field, run.recorder, 5);
    leavePits(car);
    if (pace !== undefined) car.pace = pace;
    drive(field, run.recorder, 1);
  };

  it('is the mean of its clean laps so far, with how many they are', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    // The first lap of a race began on the grid: it is nobody's clean lap.
    driveLaps(field, run.recorder, 0, 1);
    drive(field, run.recorder, 2);
    expect(run.recorder.summary().stintLaps[0]).toBe(1);
    expect(run.recorder.summary().stintCleanLaps[0]).toBe(0);
    expect(run.recorder.summary().stintAvgLap[0]).toBe(-1);

    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 2);
    const summary = run.recorder.summary();
    expect(summary.stintLaps[0]).toBe(4);
    expect(summary.stintCleanLaps[0]).toBe(3);
    expect(summary.stintAvgLap[0]).toBeCloseTo(100, 3);
  });

  it('starts again with the stint after a stop, and leaves the lap of the stop out', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 3);
    stop(field, run, { pace: 103 });
    // The lap the stop was on, then two at the new pace.
    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 2);

    const summary = run.recorder.summary();
    expect(summary.stintLaps[0]).toBe(3);
    expect(summary.stintCleanLaps[0]).toBe(2);
    expect(summary.stintAvgLap[0]).toBeCloseTo(103, 3);
    expect(summary.previousStintAvgLap[0]).toBeCloseTo(100, 3);
  });

  it('names the most recent stint by another driver, which after a double stint is not the one before', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    // Driver 0 for three laps, the team-mate for four, and the team-mate
    // again after a stop that changed nobody: a double stint.
    driveLaps(field, run.recorder, 0, 3);
    stop(field, run, { driver: 'Team-Mate', pace: 102 });
    driveLaps(field, run.recorder, 0, 4);
    stop(field, run, { pace: 101 });
    driveLaps(field, run.recorder, 0, 4);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', cleanLaps: 2 },
      { driver: 'Team-Mate', closedBy: 'stop', cleanLaps: 3 },
      { driver: 'Team-Mate', closedBy: null, cleanLaps: 3 },
    ]);
    const summary = run.recorder.summary();
    expect(summary.stintDriver[0]).toBe('Team-Mate');
    expect(summary.stintAvgLap[0]).toBeCloseTo(101, 3);
    // The stint before is the same driver's first half.
    expect(summary.previousStintDriver[0]).toBe('Team-Mate');
    expect(summary.previousStintAvgLap[0]).toBeCloseTo(102, 3);
    // The driver before is one stint further back.
    expect(summary.previousDriverStintDriver[0]).toBe('Driver 0');
    expect(summary.previousDriverStintAvgLap[0]).toBeCloseTo(100, 3);
  });

  it('is the stint before, where that one was driven by somebody else', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 3);
    stop(field, run, { driver: 'Team-Mate', pace: 102 });
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const summary = run.recorder.summary();
    expect(summary.previousStintDriver[0]).toBe('Driver 0');
    expect(summary.previousDriverStintDriver[0]).toBe('Driver 0');
    expect(summary.previousDriverStintAvgLap[0]).toBe(
      summary.previousStintAvgLap[0]
    );
    expect(summary.previousDriverStintAvgLap[0]).toBeCloseTo(100, 3);
  });

  it('has no stint by another driver while one driver has driven them all', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    driveLaps(field, run.recorder, 0, 3);
    stop(field, run);
    driveLaps(field, run.recorder, 0, 2);
    stop(field, run);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const summary = run.recorder.summary();
    expect(summary.stops[0]).toBe(2);
    expect(summary.previousStintDriver[0]).toBe('Driver 0');
    expect(summary.previousDriverStintDriver[0]).toBe('');
    expect(summary.previousDriverStintAvgLap[0]).toBe(-1);
  });

  it('names another driver whose stint had no clean lap, and gives it no pace', () => {
    const field = new Field({ cars: 1 });
    const run = start(field);

    // The team-mate is in for the lap of one stop and out at the next.
    driveLaps(field, run.recorder, 0, 3);
    stop(field, run, { driver: 'Team-Mate' });
    driveLaps(field, run.recorder, 0, 1);
    stop(field, run, { driver: 'Driver 0' });
    driveLaps(field, run.recorder, 0, 3);
    drive(field, run.recorder, 2);

    expect(run.recorder.carStints(0)).toMatchObject([
      { driver: 'Driver 0', cleanLaps: 2 },
      { driver: 'Team-Mate', laps: 1, cleanLaps: 0, avgLap: null },
      { driver: 'Driver 0', closedBy: null, cleanLaps: 2 },
    ]);
    const summary = run.recorder.summary();
    // Not the stint further back that had a pace: that one was their own.
    expect(summary.previousDriverStintDriver[0]).toBe('Team-Mate');
    expect(summary.previousDriverStintAvgLap[0]).toBe(-1);
  });

  it('cannot say another driver had the car while the one at the wheel is not named', () => {
    const field = new Field({ cars: 1 });
    field.cars[0].name = '';
    const run = start(field);

    driveLaps(field, run.recorder, 0, 3);
    stop(field, run);
    driveLaps(field, run.recorder, 0, 2);
    drive(field, run.recorder, 2);

    const summary = run.recorder.summary();
    expect(summary.stintDriver[0]).toBe('');
    expect(summary.previousStintAvgLap[0]).toBeCloseTo(100, 3);
    expect(summary.previousDriverStintDriver[0]).toBe('');
    expect(summary.previousDriverStintAvgLap[0]).toBe(-1);
  });
});

describe('a frame once the recorder is warm', () => {
  /** V8's collector, which Node hands out only when asked for by flag. */
  const collect = (): (() => void) => {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc') as () => void;
  };

  /** A full field in LMU's shape, every car with laps, a stint and a time. */
  const warm = () => {
    const field = new Field({ cars: 60, lmu: true, dt: 1 / 64 });
    field.cars.forEach((car, carIdx) => {
      car.pct = 0.05 + carIdx * 0.005;
      car.classId = 7 + (carIdx % 3);
    });
    const run = start(field, { simulator: () => 'lmu' });
    driveLaps(field, run.recorder, 59, 1);
    drive(field, run.recorder, 15);
    return { field, run };
  };

  it('changes nothing and says nothing while no car completes a lap, pits or changes driver', () => {
    const { field, run } = warm();
    const summary = run.recorder.summary();
    const arrays = Object.values(summary).filter(Array.isArray);
    const version = run.recorder.currentVersion();
    const calls =
      run.lapCalls.length + run.stintCalls.length + run.changeCalls.length;
    const laps = field.cars.map((_, carIdx) => run.recorder.carLaps(carIdx));
    const lapsBefore = field.cars.map((car) => car.lap);

    // Twenty seconds at the bridge's rate: 1,280 frames, 100 of them ticks.
    drive(field, run.recorder, 20);

    expect(field.cars.map((car) => car.lap)).toEqual(lapsBefore);
    expect(run.recorder.currentVersion()).toBe(version);
    expect(
      run.lapCalls.length + run.stintCalls.length + run.changeCalls.length
    ).toBe(calls);
    // The same summary, the same arrays, the same lists of laps.
    expect(run.recorder.summary()).toBe(summary);
    expect(Object.values(run.recorder.summary()).filter(Array.isArray)).toEqual(
      arrays
    );
    Object.values(run.recorder.summary())
      .filter(Array.isArray)
      .forEach((array, index) => expect(array).toBe(arrays[index]));
    field.cars.forEach((_, carIdx) =>
      expect(run.recorder.carLaps(carIdx)).toBe(laps[carIdx])
    );
  });

  it('allocates nothing on a frame between two readings of the field', () => {
    // Measured, not only read off the code: the heap is collected, a run of
    // frames is handed over, and what the heap grew by is what they cost.
    //
    // The frames are made beforehand, and their clock is moved on by so
    // little that none of them is one of the five a second on which the
    // pit lane, the flags and the lap times are read: what is measured is
    // the path every frame takes, 64 times a second. On it the engine boxes
    // the frame's clock, sixteen bytes; one object or array a car would be
    // sixty times that and more.
    const { field, run } = warm();
    const frames: Telemetry[] = [];
    for (let index = 0; index < 500; index += 1) frames.push(field.frame());
    const clocks = frames.map(
      (frame) =>
        (frame as unknown as { SessionTime: { value: number[] } }).SessionTime
          .value
    );
    let clock = field.time;
    const version = run.recorder.currentVersion();
    const gc = collect();
    const perFrame: number[] = [];

    for (let round = 0; round < 12; round += 1) {
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let index = 0; index < frames.length; index += 1) {
        clock += 1e-5;
        clocks[index][0] = clock;
        run.recorder.onFrame(frames[index]);
      }
      perFrame.push((process.memoryUsage().heapUsed - before) / frames.length);
    }

    // No tick in six thousand frames, so nothing but the frame path ran.
    expect(clock - field.time).toBeLessThan(0.1);
    expect(run.recorder.currentVersion()).toBe(version);
    // The best round: the first few still pay for the engine compiling.
    expect(Math.min(...perFrame)).toBeLessThan(96);
  });
});

describe('what is kept of the stints of a long race', () => {
  it('numbers them on, one for each stop', () => {
    const field = new Field({ cars: 1 });
    field.cars[0].pace = 20;
    const run = start(field);
    const car = field.cars[0];
    const stints: RaceStint[][] = [];

    for (let stop = 0; stop < 4; stop += 1) {
      driveLaps(field, run.recorder, 0, 3);
      drive(field, run.recorder, 5);
      enterPits(car);
      drive(field, run.recorder, 2);
      standInBox(car);
      drive(field, run.recorder, 4);
      leavePits(car);
      stints.push([...run.recorder.carStints(0)]);
    }

    expect(run.recorder.carStints(0).map((stint) => stint.ordinal)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      run.recorder.carStints(0).map((stint) => [stint.firstLap, stint.lastLap])
    ).toEqual([
      [1, 3],
      [4, 6],
      [7, 9],
      [10, 12],
      [null, null],
    ]);
    expect(run.recorder.summary().stops[0]).toBe(4);
    expect(stints.map((list) => list.length)).toEqual([2, 3, 4, 5]);
  });
});
