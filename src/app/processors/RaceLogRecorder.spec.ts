import { describe, expect, it } from 'vitest';
import type { RaceEvent, RaceLap, Session } from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  GlobalFlags,
  LMU_FINISH_STATUS,
  LMU_PENALTY_CODE,
  RACE_LOG_MAX_EVENTS,
  RACE_LOG_PAGE_EVENTS,
  RACE_LOG_SNAPSHOT_EVENTS,
  RACE_LOG_THIN_FROM,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import {
  drive,
  driveLaps,
  enterPits,
  Field,
  leaveBox,
  leavePits,
  standInBox,
} from './raceHistoryFixture';
import { logged, raced, Stage, tell } from './raceLogFixture';
import {
  RACE_LOG_FASTEST_LAP_FROM_LAP,
  RACE_LOG_FASTEST_LAP_SETTLE_SECONDS,
  RACE_LOG_PARKED_SECONDS,
  RACE_LOG_PLACE_HOLD_LAPS,
} from './RaceLogRecorder';

/**
 * The race's log, from staged races.
 *
 * Staged, every one of them: the one recording of a race there is has no
 * pit stop, no driver change, no caution and no penalty in it. Where the
 * race history matters -- a stop, a driver change, a lap time -- the real
 * recorder is run on a staged field and the log is wired to it as the
 * runtime wires it (`raced`). Where the log reads the frames by itself --
 * the flags, a car staying away, the own car's place, the penalties -- it
 * is ticked with staged frames alone (`Stage`).
 */

const kinds = (events: readonly RaceEvent[]): string[] =>
  events.map((event) => event.kind);

/** A lap as the race history would hand it over, with the sim's time. */
const lapOf = (
  carIdx: number,
  lap: number,
  lapTime: number | null,
  sessionTime = lap * 100
): RaceLap => ({
  carIdx,
  lap,
  sessionTime,
  lapTime,
  sectors: [null, null, null],
  position: 1,
  classPosition: 1,
  classGap: 0,
  flags: 0,
  driver: `Driver ${carIdx}`,
  energy: null,
  energyIsVirtual: false,
  compounds: [-1, -1, -1, -1],
});

/** A stage with its race begun and its first tick, the baseline, read. */
const begun = (configure?: (stage: Stage) => void) => {
  const stage = new Stage();
  configure?.(stage);
  const out = logged();
  out.log.onRaceStarted(stage.start());
  stage.tick(out.log);
  return { stage, ...out };
};

describe('a car in the pit lane', () => {
  it('is said to have come in once it has stayed, with its place and the time it came in', () => {
    const field = new Field();
    const race = raced(field);
    drive(field, race, 5);
    field.cars[1].classPosition = 2;
    enterPits(field.cars[1]);
    const cameInAt = field.time;

    drive(field, race, 1.5);
    // Not yet: a car that only brushes the entry has not pitted.
    expect(race.told()).toEqual([]);
    drive(field, race, 1.5);

    expect(race.told()).toEqual([
      { carIdx: 1, kind: 'pit-entry', classPosition: 2 },
    ]);
    // Timed at the line, not when it was said: within a tick of it.
    expect(race.events()[0].sessionTime).toBeGreaterThanOrEqual(cameInAt);
    expect(race.events()[0].sessionTime).toBeLessThan(cameInAt + 0.35);
  });

  it('is not said to have pitted for brushing the pit entry', () => {
    const field = new Field();
    const race = raced(field);
    drive(field, race, 5);

    enterPits(field.cars[1]);
    drive(field, race, 1);
    leavePits(field.cars[1]);
    drive(field, race, 10);

    expect(race.told()).toEqual([]);
  });

  it('is said to be out after a stop, with the times the race history gave it', () => {
    const field = new Field();
    const race = raced(field);
    // A lap first: the race history keeps a stint once it has one.
    driveLaps(field, race, 0, 1);
    const car = field.cars[0];

    enterPits(car);
    drive(field, race, 5);
    standInBox(car);
    drive(field, race, 30);
    leaveBox(car);
    drive(field, race, 4);
    // Still in the lane: nothing is said of the stop before the car leaves.
    expect(kinds(race.events())).toEqual(['pit-entry']);
    leavePits(car);
    drive(field, race, 2);

    const [stint] = race.recorder.carStints(0);
    expect(stint).toMatchObject({ closedBy: 'stop' });
    expect(stint.stop?.standingTime).toBeCloseTo(30, 0);
    expect(stint.stop?.laneTime).toBeCloseTo(39, 0);
    expect(race.told()).toEqual([
      { carIdx: 0, kind: 'pit-entry', classPosition: 1 },
      {
        carIdx: 0,
        kind: 'pit-exit',
        // The stint's own figures, not a second measurement.
        standingTime: stint.stop?.standingTime,
        laneTime: stint.stop?.laneTime,
        driverFrom: '',
        driverTo: '',
      },
    ]);
  });

  it('is said to be out after a stop on a lap before its first, which ends no stint', () => {
    const field = new Field();
    const race = raced(field);
    drive(field, race, 5);
    const car = field.cars[2];

    enterPits(car);
    drive(field, race, 4);
    standInBox(car);
    drive(field, race, 12);
    leaveBox(car);
    drive(field, race, 2);
    leavePits(car);
    drive(field, race, 2);

    // The race history kept nothing for it...
    expect(race.recorder.carStints(2).filter((s) => s.closedBy)).toEqual([]);
    // ...and it is a stop all the same, not a drive-through.
    expect(kinds(race.events())).toEqual(['pit-entry', 'pit-exit']);
    const exit = race.events()[1];
    expect(exit).toMatchObject({ carIdx: 2, driverFrom: '', driverTo: '' });
    expect(exit.kind === 'pit-exit' && exit.standingTime).toBeCloseTo(12, 0);
    expect(exit.kind === 'pit-exit' && exit.laneTime).toBeCloseTo(18, 0);
  });

  it('is said to have driven through when it never stood still', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);

    enterPits(field.cars[0]);
    drive(field, race, 22);
    leavePits(field.cars[0]);
    drive(field, race, 2);

    expect(kinds(race.events())).toEqual(['pit-entry', 'drive-through']);
    const through = race.events()[1];
    expect(through.kind === 'drive-through' && through.laneTime).toBeCloseTo(
      22,
      0
    );
    // And it ended no stint.
    expect(race.recorder.carStints(0)).toMatchObject([{ closedBy: null }]);
  });

  it('is not said to have pitted when it was found standing there with no lap to its name', () => {
    const field = new Field();
    // Standing at its box when the first frame is read: as every car of an
    // iRacing session is before it goes out for the first time.
    field.cars[1].onPitRoad = true;
    standInBox(field.cars[1]);
    const race = raced(field);

    drive(field, race, 10);
    leaveBox(field.cars[1]);
    drive(field, race, 2);
    leavePits(field.cars[1]);
    drive(field, race, 2);

    // Not seen to come in, and no lap of it known: nothing says it pitted.
    expect(race.told()).toEqual([]);
  });

  it('is said to be out of a stop it was found in the middle of, with no time in the lane', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);
    const car = field.cars[0];

    // Nothing is read while the car comes in and stops: as when the record
    // is switched off for a while, or the app is started again.
    enterPits(car);
    standInBox(car);
    field.time += 20;
    race.recorder.rebaseline();
    race.log.rebaseline();
    drive(field, race, 15);
    leaveBox(car);
    drive(field, race, 3);
    leavePits(car);
    drive(field, race, 2);

    // The race history ended a stint of laps with it, so it was a stop. The
    // car was not seen going in, so there is no entry, and no time is said:
    // the fifteen seconds it was seen to stand are not how long it stood.
    const [stint] = race.recorder.carStints(0);
    expect(stint).toMatchObject({ closedBy: 'stop' });
    expect(stint.stop?.standingTime).toBeCloseTo(15, 0);
    expect(race.told()).toEqual([
      {
        carIdx: 0,
        kind: 'pit-exit',
        standingTime: null,
        laneTime: null,
        driverFrom: '',
        driverTo: '',
      },
    ]);
  });

  it('is not said to have pitted for driving out of its garage', () => {
    const field = new Field();
    field.cars[2].surface = TrackLocation.NotInWorld;
    field.cars[2].halted = true;
    const race = raced(field);
    drive(field, race, 10);

    field.cars[2].halted = false;
    enterPits(field.cars[2]);
    drive(field, race, 8);
    leavePits(field.cars[2]);
    drive(field, race, 5);

    expect(race.told()).toEqual([]);
  });
});

describe('a driver change', () => {
  /** Car 0 round a lap, into its box, and standing there. */
  const stopped = () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);
    enterPits(field.cars[0]);
    drive(field, race, 5);
    standInBox(field.cars[0]);
    drive(field, race, 10);
    return { field, race };
  };

  const rename = (
    field: Field,
    race: ReturnType<typeof raced>,
    carIdx: number,
    name: string
  ) => {
    field.cars[carIdx].name = name;
    race.onSession(field.session());
  };

  const leave = (field: Field, race: ReturnType<typeof raced>) => {
    leaveBox(field.cars[0]);
    drive(field, race, 3);
    leavePits(field.cars[0]);
    drive(field, race, 2);
  };

  it('named during a stop is said with the stop, and not on its own', () => {
    const { field, race } = stopped();

    rename(field, race, 0, 'Second Driver');
    drive(field, race, 20);
    leave(field, race);

    expect(race.told()).toMatchObject([
      { kind: 'pit-entry' },
      {
        kind: 'pit-exit',
        carIdx: 0,
        driverFrom: 'Driver 0',
        driverTo: 'Second Driver',
      },
    ]);
  });

  it('named a while after the stop is added to the exit already said', () => {
    const { field, race } = stopped();
    leave(field, race);
    expect(race.told()[1]).toMatchObject({ driverFrom: '', driverTo: '' });
    const exit = race.events()[1];

    drive(field, race, 30);
    rename(field, race, 0, 'Second Driver');
    drive(field, race, 5);

    // The same event, changed: nothing new in the list.
    expect(kinds(race.events())).toEqual(['pit-entry', 'pit-exit']);
    expect(race.events()[1]).toEqual({
      ...exit,
      driverFrom: 'Driver 0',
      driverTo: 'Second Driver',
    });
    // And announced again, under its own number, so that it is stored again.
    expect(race.said.filter((event) => event.seq === exit.seq)).toHaveLength(2);
  });

  it('with no stop is said on its own, at the time the session named the driver', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);

    rename(field, race, 1, 'Somebody Else');
    const [change] = race.recorder.driverChanges();
    drive(field, race, 1);

    expect(race.told()).toEqual([
      {
        carIdx: 1,
        kind: 'driver-change',
        driverFrom: 'Driver 1',
        driverTo: 'Somebody Else',
      },
    ]);
    expect(race.events()[0].sessionTime).toBe(change.sessionTime);
  });

  it('named in the pit lane waits to see whether the car stops', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);
    enterPits(field.cars[0]);
    drive(field, race, 3);

    rename(field, race, 0, 'Second Driver');
    drive(field, race, 3);
    // In the lane, not stopped: it could still be either.
    expect(kinds(race.events())).toEqual(['pit-entry']);

    standInBox(field.cars[0]);
    drive(field, race, 10);
    leave(field, race);

    expect(race.told()).toMatchObject([
      { kind: 'pit-entry' },
      { kind: 'pit-exit', driverFrom: 'Driver 0', driverTo: 'Second Driver' },
    ]);
  });

  it('named in the pit lane of a car that drives through is said on its own', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);
    enterPits(field.cars[0]);
    drive(field, race, 3);

    rename(field, race, 0, 'Second Driver');
    drive(field, race, 15);
    leavePits(field.cars[0]);
    drive(field, race, 2);

    expect(race.told()).toMatchObject([
      { kind: 'pit-entry' },
      { kind: 'drive-through' },
      { kind: 'driver-change', driverTo: 'Second Driver' },
    ]);
  });

  it('told a second time by the race history is said once', () => {
    const field = new Field();
    const race = raced(field);
    driveLaps(field, race, 0, 1);
    rename(field, race, 1, 'Somebody Else');
    drive(field, race, 1);
    const [change] = race.recorder.driverChanges();

    // As when a race carried on after a restart numbers its changes again.
    race.log.onDriverChange(change);
    drive(field, race, 1);

    expect(kinds(race.events())).toEqual(['driver-change']);
  });
});

describe('the fastest lap of a class', () => {
  /** A field whose laps the sim times as the table says, by car and lap. */
  const timed = (times: number[][], configure?: (field: Field) => void) => {
    const field = new Field({ cars: times.length });
    configure?.(field);
    field.timeFor = (carIdx, lap) => times[carIdx][lap - 1] ?? 999;
    const race = raced(field);
    return { field, race };
  };

  const fastest = (events: readonly RaceEvent[]) =>
    events
      .filter((event) => event.kind === 'fastest-lap')
      .map((event) => [event.carIdx, event.lap, event.lapTime]);

  it('is said from the lap one of its cars completes its third on, as the one that stands', () => {
    expect(RACE_LOG_FASTEST_LAP_FROM_LAP).toBe(3);
    expect(RACE_LOG_FASTEST_LAP_SETTLE_SECONDS).toBe(15);
    const { field, race } = timed([
      [120, 101, 100.5, 100.9, 100.2],
      [121, 100.8, 100.4, 100.45, 100.6],
      [125, 105, 105, 105, 105],
    ]);

    driveLaps(field, race, 0, 2);
    drive(field, race, 30);
    // Two laps run, each with somebody's best: nothing said.
    expect(fastest(race.events())).toEqual([]);

    driveLaps(field, race, 0, 1);
    drive(field, race, 3);
    // The third lap of the first car is in and is the class's fastest, and
    // the car behind is about to better it: not said yet.
    expect(fastest(race.events())).toEqual([]);
    drive(field, race, 20);
    // One line for the two of them: the lap that stands.
    expect(fastest(race.events())).toEqual([[1, 3, 100.4]]);
    expect(race.events()[0]).toMatchObject({ driver: 'Driver 1' });

    driveLaps(field, race, 2, 2);
    drive(field, race, 20);

    expect(fastest(race.events())).toEqual([
      [1, 3, 100.4],
      [0, 5, 100.2],
    ]);
  });

  it('is timed at the line, though it is said a moment later', () => {
    const { field, race } = timed([[120, 101, 100.5]]);

    driveLaps(field, race, 0, 3);
    drive(field, race, 20);

    const [lap] = race.recorder.carLaps(0).slice(-1);
    expect(race.events()).toMatchObject([
      { kind: 'fastest-lap', lap: 3, sessionTime: lap.sessionTime },
    ]);
  });

  it('is the quickest of the first laps, said once, when the third is in', () => {
    const { field, race } = timed([[120, 99, 100.5, 100.2, 98.5]]);

    driveLaps(field, race, 0, 3);
    drive(field, race, 20);
    // The second lap is the fastest so far, and the third did not better
    // it: one line, for the second.
    expect(fastest(race.events())).toEqual([[0, 2, 99]]);

    driveLaps(field, race, 0, 2);
    drive(field, race, 20);

    expect(fastest(race.events())).toEqual([
      [0, 2, 99],
      [0, 5, 98.5],
    ]);
  });

  it('is each class’s own', () => {
    const { field, race } = timed(
      [
        [120, 101, 100, 99],
        [130, 111, 110, 109.5],
      ],
      (field) => {
        field.cars[1].classId = 9;
      }
    );

    driveLaps(field, race, 1, 4);
    drive(field, race, 20);

    expect(fastest(race.events())).toEqual([
      [0, 3, 100],
      [1, 3, 110],
      [0, 4, 99],
      [1, 4, 109.5],
    ]);
  });

  it('is one line when several cars better it one after another', () => {
    const { stage, log, events } = begun();

    log.onLap(lapOf(0, 6, 99));
    stage.run(log, 5);
    log.onLap(lapOf(1, 6, 98.5));
    stage.run(log, 5);
    log.onLap(lapOf(0, 7, 98.25, 712));
    expect(events()).toEqual([]);
    stage.run(log, 6);

    // Fifteen seconds from the first of them, and the last one stands.
    expect(fastest(events())).toEqual([[0, 7, 98.25]]);
    expect(events()[0].sessionTime).toBe(712);

    // One that comes later is another line, after its own moment.
    log.onLap(lapOf(1, 8, 98));
    stage.run(log, 14);
    expect(events()).toHaveLength(1);
    stage.run(log, 2);
    expect(fastest(events())).toEqual([
      [0, 7, 98.25],
      [1, 8, 98],
    ]);
  });

  it('is said once however often the race history tells the lap', () => {
    const stage = new Stage();
    const { log, events } = logged();
    log.onRaceStarted(stage.start());
    const lap = lapOf(0, 4, 99.5);

    // Just completed, with no time yet; then with it; then once more, as
    // when its driver is named late.
    log.onLap(lapOf(0, 4, null));
    log.onLap(lap);
    log.onLap({ ...lap, driver: 'Somebody Else' });
    stage.run(log, 40);

    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      kind: 'fastest-lap',
      lap: 4,
      lapTime: 99.5,
      sessionTime: 400,
    });
  });

  it('starts from the sim’s own best laps when the log begins in the middle of a race', () => {
    const { stage, log, told } = begun((staged) => {
      staged.cars.forEach((car, carIdx) => {
        car.lap = 40;
        car.best = 95 + carIdx;
      });
    });
    expect(stage.cars[0].classId).toBe(stage.cars[1].classId);

    // Quick, and not the class's fastest: the sim has a 95 for it.
    log.onLap(lapOf(1, 40, 95.5));
    stage.run(log, 20);
    expect(told()).toEqual([]);

    log.onLap(lapOf(1, 41, 94.75));
    // The other class's best is its own: a 97.
    log.onLap(lapOf(3, 40, 96.9));
    stage.run(log, 20);

    expect(told()).toEqual([
      {
        carIdx: 1,
        kind: 'fastest-lap',
        lap: 41,
        lapTime: 94.75,
        driver: 'Driver 1',
      },
      {
        carIdx: 3,
        kind: 'fastest-lap',
        lap: 40,
        lapTime: 96.9,
        driver: 'Driver 3',
      },
    ]);
  });

  it('is not said of a car whose slot another has taken before it was', () => {
    const { stage, log, events } = begun();

    log.onLap(lapOf(1, 6, 98.5));
    log.onCarReplaced(1);
    stage.run(log, 20);

    expect(events()).toEqual([]);
  });
});

describe('the flags for the whole field', () => {
  const flag = (
    flagName: string,
    after: string | null = null,
    durationS: number | null = null,
    late = false
  ) => ({ carIdx: null, kind: 'flag', flag: flagName, after, durationS, late });

  it('are the start, a caution with its length, a red and the chequered flag under iRacing', () => {
    const { stage, log, told } = begun((staged) => {
      staged.sessionState = SessionState.ParadeLaps;
    });
    expect(told()).toEqual([]);

    stage.sessionState = SessionState.Racing;
    stage.tick(log);
    stage.run(log, 60);
    stage.sessionFlags = GlobalFlags.Caution | GlobalFlags.Yellow;
    stage.tick(log, 1);
    stage.run(log, 360);
    // Waving, then one lap to green: still the same caution.
    stage.sessionFlags = GlobalFlags.CautionWaving | GlobalFlags.OneLapToGreen;
    stage.run(log, 30);
    stage.sessionFlags = GlobalFlags.Green;
    stage.tick(log, 1);
    stage.sessionFlags = GlobalFlags.Red;
    stage.tick(log, 1);
    stage.run(log, 119);
    stage.sessionFlags = 0;
    stage.tick(log, 1);
    stage.sessionState = SessionState.Checkered;
    stage.tick(log, 1);
    stage.sessionState = SessionState.CoolDown;
    stage.run(log, 30);

    expect(told()).toEqual([
      flag('green', 'start'),
      flag('caution'),
      flag('green', 'caution', 391),
      flag('red'),
      flag('green', 'red', 120),
      flag('chequered'),
    ]);
  });

  it('are the same under Le Mans Ultimate, read from its phase', () => {
    const { stage, log, told } = begun((staged) => {
      staged.lmu = { phase: 3, yellowState: 0 };
    });

    stage.lmu = { phase: 4, yellowState: 0 };
    stage.tick(log);
    stage.lmu = { phase: 5, yellowState: 0 };
    stage.tick(log);
    stage.run(log, 30);
    // A yellow state with the phase still green is a full-course yellow.
    stage.lmu = { phase: 5, yellowState: 1 };
    stage.tick(log, 1);
    stage.lmu = { phase: 6, yellowState: 4 };
    stage.run(log, 199);
    stage.lmu = { phase: 5, yellowState: 0 };
    stage.tick(log, 1);
    stage.lmu = { phase: 7, yellowState: 0 };
    stage.tick(log, 1);
    stage.lmu = { phase: 5, yellowState: 0 };
    stage.tick(log, 60);
    stage.lmu = { phase: 8, yellowState: 0 };
    stage.tick(log, 1);
    stage.run(log, 10);

    expect(told()).toEqual([
      flag('green', 'start'),
      flag('caution'),
      flag('green', 'caution', 200),
      flag('red'),
      flag('green', 'red', 60),
      flag('chequered'),
    ]);
  });

  it('take a paused or frozen Le Mans Ultimate frame to say nothing', () => {
    const { stage, log, told } = begun((staged) => {
      staged.lmu = { phase: 5, yellowState: 0 };
    });

    // Paused in the menu, then a frame the sim has stopped writing that
    // happens to read as a caution.
    stage.lmu = { phase: 9, yellowState: 0 };
    stage.run(log, 30);
    stage.lmu = { phase: 6, yellowState: 2, stale: true };
    stage.run(log, 30);
    stage.lmu = { phase: 5, yellowState: 0 };
    stage.run(log, 5);

    expect(told()).toEqual([]);
  });

  it('take the first car Le Mans Ultimate lists as finished for the chequered flag', () => {
    const { stage, log, told } = begun((staged) => {
      staged.lmu = { phase: 5, yellowState: 0 };
    });

    // The phase stays green until the last car is in.
    stage.cars[1].finish = LMU_FINISH_STATUS.finished;
    stage.tick(log);
    stage.cars[0].finish = LMU_FINISH_STATUS.finished;
    stage.tick(log);
    stage.lmu = { phase: 8, yellowState: 0 };
    stage.tick(log);

    expect(told()).toEqual([flag('chequered')]);
  });

  it('do not log a local yellow, a blue or a white flag', () => {
    const { stage, log, told } = begun();

    for (const flags of [
      GlobalFlags.Yellow,
      GlobalFlags.YellowWaving,
      GlobalFlags.Blue,
      GlobalFlags.White,
      GlobalFlags.Debris,
      GlobalFlags.Black,
    ]) {
      stage.sessionFlags = flags;
      stage.run(log, 5);
    }

    expect(told()).toEqual([]);
  });

  it('say a caution found out when recording began, late, and its end with no length', () => {
    const { stage, log, told, events } = begun((staged) => {
      staged.sessionFlags = GlobalFlags.Caution;
    });

    expect(told()).toEqual([flag('caution', null, null, true)]);
    // Timed when it was noticed: when it was shown is not known.
    expect(events()[0].sessionTime).toBe(stage.time);

    stage.run(log, 100);
    stage.sessionFlags = 0;
    stage.tick(log, 1);

    expect(told()[1]).toEqual(flag('green', 'caution', null));
  });

  it('say nothing of a race found already under way, or already over', () => {
    const racing = begun();
    racing.stage.run(racing.log, 10);
    expect(racing.told()).toEqual([]);

    const over = begun((staged) => {
      staged.sessionState = SessionState.CoolDown;
    });
    over.stage.run(over.log, 10);
    expect(over.told()).toEqual([]);
  });

  it('say no start for a practice session, which has none', () => {
    const { stage, log, told } = begun((staged) => {
      staged.sessionType = 'Practice';
      staged.sessionState = SessionState.GetInCar;
    });

    stage.sessionState = SessionState.Racing;
    stage.run(log, 10);
    stage.sessionState = SessionState.Checkered;
    stage.tick(log);

    // The end of it is the end of it, in any session.
    expect(told()).toEqual([flag('chequered')]);
  });
});

describe('a car that stays away', () => {
  const retired = (carIdx: number, reason: string) => ({
    carIdx,
    kind: 'retired',
    reason,
  });

  it('is said to be out after five minutes out of the world, once, and back when it is', () => {
    expect(RACE_LOG_PARKED_SECONDS).toBe(300);
    const { stage, log, told, events } = begun();

    stage.vanish(2);
    stage.tick(log, 1);
    const goneAt = stage.time;
    stage.run(log, 298);
    expect(told()).toEqual([]);
    stage.run(log, 2);
    expect(told()).toEqual([retired(2, 'gone')]);

    // Said once, however long it stays away.
    stage.run(log, 900);
    expect(told()).toHaveLength(1);

    stage.appear(2);
    stage.tick(log, 1);
    expect(told()[1]).toMatchObject({ carIdx: 2, kind: 'rejoined' });
    const back = events()[1];
    expect(back.kind === 'rejoined' && back.awayS).toBeCloseTo(
      stage.time - goneAt,
      5
    );

    // And again the next time it goes: each absence is said once.
    stage.vanish(2);
    stage.run(log, 301);
    expect(kinds(events())).toEqual(['retired', 'rejoined', 'retired']);
  });

  it('is said to be in its garage where the sim says that is where it is', () => {
    const { stage, log, told } = begun();

    // In the world, and in its garage: Le Mans Ultimate's own flag.
    stage.cars[1].where = CAR_PIT_IN_GARAGE;
    stage.cars[1].surface = TrackLocation.InPitStall;
    stage.run(log, 301);

    expect(told()).toEqual([retired(1, 'garage')]);
  });

  it('is not said to be out for a moment out of the world', () => {
    const { stage, log, told } = begun();

    stage.vanish(1);
    stage.run(log, 3);
    stage.appear(1);
    stage.run(log, 600);

    expect(told()).toEqual([]);
  });

  it('is not counted before the start, while the race is stopped, or in a practice', () => {
    const grid = begun((staged) => {
      staged.sessionState = SessionState.ParadeLaps;
    });
    grid.stage.vanish(1);
    grid.stage.run(grid.log, 400);
    expect(grid.told()).toEqual([]);

    const stopped = begun();
    stopped.stage.sessionFlags = GlobalFlags.Red;
    stopped.stage.tick(stopped.log, 1);
    stopped.stage.vanish(1);
    stopped.stage.run(stopped.log, 400);
    expect(kinds(stopped.events())).toEqual(['flag']);

    const practice = begun((staged) => {
      staged.sessionType = 'Practice';
    });
    practice.stage.vanish(1);
    practice.stage.run(practice.log, 400);
    expect(practice.told()).toEqual([]);
  });

  it('is not said of a car that was never seen to race', () => {
    const { stage, log, told } = begun((staged) => {
      staged.vanish(3);
    });

    stage.run(log, 400);

    expect(told()).toEqual([]);
  });

  it('is said at once when Le Mans Ultimate lists the car as not finishing, and not again as parked', () => {
    const { stage, log, told } = begun((staged) => {
      staged.lmu = { phase: 5, yellowState: 0 };
    });

    stage.cars[3].finish = LMU_FINISH_STATUS.dnf;
    stage.tick(log);
    expect(told()).toEqual([retired(3, 'dnf')]);

    stage.vanish(3);
    stage.run(log, 400);
    expect(told()).toHaveLength(1);
  });

  it('is said of a car the sim disqualifies, which may well drive on', () => {
    const { stage, log, told } = begun();

    stage.cars[1].flags = GlobalFlags.Disqualify;
    stage.run(log, 5);
    stage.run(log, 400);

    expect(told()).toEqual([retired(1, 'disqualified')]);
  });

  it('is not said after the chequered flag, when every car comes in', () => {
    const { stage, log, events } = begun();
    stage.sessionState = SessionState.Checkered;
    stage.tick(log);

    stage.cars[1].where = CAR_PIT_IN_LANE;
    stage.run(log, 10);
    stage.vanish(1);
    stage.vanish(2);
    stage.run(log, 400);

    expect(kinds(events())).toEqual(['flag']);
  });
});

describe('the own car’s place in its class', () => {
  const place = (from: number, to: number) => ({
    carIdx: 0,
    kind: 'position',
    from,
    to,
  });

  it('is said once it has held for a lap and a little more', () => {
    expect(RACE_LOG_PLACE_HOLD_LAPS).toBe(1.05);
    const { stage, log, told } = begun((staged) => {
      staged.cars[0].classPosition = 3;
    });
    stage.run(log, 10);

    stage.cars[0].classPosition = 2;
    // A lap is 100 seconds here. Not at the line itself: that is where the
    // sim hands out the next place.
    stage.run(log, 104);
    expect(told()).toEqual([]);
    stage.run(log, 3);

    expect(told()).toEqual([place(3, 2)]);
  });

  it('is not said for a place taken and lost again within a lap', () => {
    const { stage, log, told } = begun((staged) => {
      staged.cars[0].classPosition = 3;
    });

    stage.cars[0].classPosition = 2;
    stage.run(log, 60);
    stage.cars[0].classPosition = 3;
    stage.run(log, 200);

    expect(told()).toEqual([]);
  });

  it('is said from where it was last said to where it settles, through a round of stops', () => {
    const { stage, log, told } = begun((staged) => {
      staged.cars[0].classPosition = 3;
    });

    for (const position of [2, 1, 4, 5, 4, 1]) {
      stage.cars[0].classPosition = position;
      stage.run(log, 40);
    }
    expect(told()).toEqual([]);
    stage.run(log, 70);

    expect(told()).toEqual([place(3, 1)]);
  });

  it('is not followed before the start, after the flag, or in a practice', () => {
    const grid = begun((staged) => {
      staged.sessionState = SessionState.ParadeLaps;
      staged.cars[0].classPosition = 3;
    });
    grid.stage.cars[0].classPosition = 1;
    grid.stage.run(grid.log, 250);
    // The place it starts the race in is where it stands, not a change.
    grid.stage.sessionState = SessionState.Racing;
    grid.stage.run(grid.log, 250);
    expect(kinds(grid.events())).toEqual(['flag']);

    const practice = begun((staged) => {
      staged.sessionType = 'Practice';
    });
    practice.stage.cars[0].classPosition = 4;
    practice.stage.run(practice.log, 250);
    expect(practice.told()).toEqual([]);
  });

  it('is the own car’s, whichever slot that is', () => {
    const { stage, log, told } = begun((staged) => {
      staged.playerCarIdx = 2;
    });

    stage.cars[0].classPosition = 2;
    stage.cars[2].classPosition = 2;
    stage.run(log, 120);

    expect(told()).toEqual([{ ...place(1, 2), carIdx: 2 }]);
  });
});

describe('a penalty', () => {
  const lmu = () =>
    begun((staged) => {
      staged.lmu = { phase: 5, yellowState: 0 };
      // One already outstanding when the log begins: where things stand.
      staged.cars[3].penalties = 1;
    });

  it('is said when Le Mans Ultimate counts one more for a car, and when one fewer', () => {
    const { stage, log, told } = lmu();
    expect(told()).toEqual([]);

    stage.cars[1].penalties = 1;
    stage.cars[1].penaltyKind = LMU_PENALTY_CODE.driveThrough;
    stage.tick(log);
    stage.cars[1].penalties = 2;
    stage.cars[1].penaltyKind = LMU_PENALTY_CODE.time;
    stage.cars[1].penaltySeconds = 10;
    stage.tick(log);
    stage.cars[1].penalties = 1;
    stage.tick(log);
    stage.cars[3].penalties = 0;
    stage.tick(log);

    const penalty = (carIdx: number, rest: Record<string, unknown>) => ({
      carIdx,
      kind: 'penalty',
      seconds: null,
      ...rest,
    });
    expect(told()).toEqual([
      penalty(1, { change: 'given', penalty: 'DT', pending: 1 }),
      penalty(1, { change: 'given', penalty: 'TIME', seconds: 10, pending: 2 }),
      // Which of the two was served is not said.
      penalty(1, { change: 'served', penalty: '', pending: 1 }),
      penalty(3, { change: 'served', penalty: '', pending: 0 }),
    ]);
  });

  it('is given its name when the sim says it a moment after counting it', () => {
    const { stage, log, events, said } = lmu();

    stage.cars[2].penalties = 1;
    stage.tick(log);
    expect(events()[0]).toMatchObject({ kind: 'penalty', penalty: '' });

    stage.tick(log);
    stage.cars[2].penaltyKind = LMU_PENALTY_CODE.stopGo;
    stage.tick(log);

    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ change: 'given', penalty: 'SG' });
    expect(said.map((event) => event.seq)).toEqual([1, 1]);
  });

  it('is a black flag shown and taken back under iRacing', () => {
    const { stage, log, told } = begun((staged) => {
      // Shown before the log began: not said.
      staged.cars[3].flags = GlobalFlags.Black;
    });

    stage.cars[1].flags = GlobalFlags.Black | GlobalFlags.Blue;
    stage.run(log, 30);
    stage.cars[1].flags = 0;
    stage.cars[3].flags = 0;
    stage.tick(log);

    expect(told()).toEqual([
      {
        carIdx: 1,
        kind: 'penalty',
        change: 'given',
        penalty: 'black',
        seconds: null,
        pending: null,
      },
      {
        carIdx: 1,
        kind: 'penalty',
        change: 'served',
        penalty: 'black',
        seconds: null,
        pending: null,
      },
      {
        carIdx: 3,
        kind: 'penalty',
        change: 'served',
        penalty: 'black',
        seconds: null,
        pending: null,
      },
    ]);
  });
});

describe('the forecast', () => {
  const HOURS = 3600;
  const node = (start: number, skyType: number, rainChance: number) => ({
    start,
    skyType,
    temperature: 16,
    rainChance,
  });
  /** A session whose race forecast has these four points after its start. */
  const session = (points: [number, number][]): Session =>
    ({
      LmuRest: {
        raceTime: 8 * HOURS,
        forecast: {
          race: [
            node(0, 1, 0),
            ...points.map(([skyType, rainChance], index) =>
              node((index + 1) / 4, skyType, rainChance)
            ),
          ],
        },
      },
    }) as unknown as Session;

  const DRY: [number, number][] = [
    [1, 0],
    [2, 0.1],
    [2, 0.1],
    [1, 0],
  ];

  /** An eight-hour Le Mans Ultimate race, a quarter of an hour in. */
  const lmuRace = () => {
    const stage = new Stage();
    stage.lmu = { phase: 5, yellowState: 0 };
    // Le Mans Ultimate's index for a race: which forecast it runs on.
    stage.sessionNum = 10;
    stage.sessionEndTime = 8 * HOURS;
    stage.time = 900;
    const out = logged();
    out.log.onSession(session(DRY));
    out.log.onRaceStarted(stage.start());
    stage.tick(out.log);
    return { stage, ...out };
  };

  it('is said when it changes, with how far off its first rain is', () => {
    const { stage, log, told } = lmuRace();
    // What the forecast is when the race begins is not a change to it.
    expect(told()).toEqual([]);

    // Asked for again and the same: still not one.
    log.onSession(session(DRY));
    stage.tick(log);
    expect(told()).toEqual([]);

    // Rain from the second point on, which begins four hours in.
    log.onSession(
      session([
        [2, 0.2],
        [7, 0.8],
        [8, 0.9],
        [3, 0.3],
      ])
    );
    stage.tick(log);

    expect(told()).toEqual([
      {
        carIdx: null,
        kind: 'forecast',
        rain: true,
        // The Weather Forecast's own estimate, in whole minutes.
        inMinutes: Math.floor((4 * HOURS - stage.time) / 60),
        rainChance: 0.8,
      },
    ]);

    log.onSession(session(DRY));
    stage.tick(log);
    expect(told()[1]).toEqual({
      carIdx: null,
      kind: 'forecast',
      rain: false,
      inMinutes: null,
      rainChance: null,
    });
  });

  it('is not said to have changed when it first arrives during a race', () => {
    const stage = new Stage();
    stage.lmu = { phase: 5, yellowState: 0 };
    stage.sessionNum = 10;
    stage.sessionEndTime = 8 * HOURS;
    const { log, told } = logged();
    log.onSession({} as Session);
    log.onRaceStarted(stage.start());
    stage.tick(log);

    log.onSession(session(DRY));
    stage.run(log, 5);

    expect(told()).toEqual([]);
  });

  it('is never said under iRacing, which publishes none', () => {
    const { stage, log, told } = begun();

    log.onSession({ WeekendInfo: {} } as unknown as Session);
    stage.run(log, 5);
    log.onSession({ WeekendInfo: { TrackID: 3 } } as unknown as Session);
    stage.run(log, 5);

    expect(told()).toEqual([]);
  });
});

describe('the clocks on an event', () => {
  it('are the session clock and the clock in the sim at the tick', () => {
    const { stage, log, events } = begun();

    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log, 1);

    expect(events()[0]).toMatchObject({
      seq: 1,
      sessionTime: stage.time,
      timeOfDay: stage.timeOfDay,
    });
  });

  it('have no clock in the sim where the frame gives none', () => {
    const { stage, log, events } = begun((staged) => {
      staged.timeOfDay = null;
    });

    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log, 1);

    expect(events()[0].timeOfDay).toBeNull();
  });
});

describe('the cap', () => {
  /** One event that is not thinned: a black flag shown or taken back. */
  const flagEvent = (stage: Stage, log: ReturnType<typeof logged>['log']) => {
    stage.cars[1].flags = stage.cars[1].flags === 0 ? GlobalFlags.Black : 0;
    stage.tick(log);
  };
  /** One that is: a fastest lap, each quicker than the one before. */
  let quickest = 200;
  const lapEvent = (
    stage: Stage,
    log: ReturnType<typeof logged>['log'],
    lap: number
  ) => {
    quickest -= 0.001;
    log.onLap(lapOf(0, lap, quickest));
    // Past the moment it waits before it is said.
    stage.tick(log, 16);
  };

  it('costs the oldest fastest laps first, then the oldest of anything', () => {
    expect([RACE_LOG_THIN_FROM, RACE_LOG_MAX_EVENTS]).toEqual([900, 1000]);
    const { stage, log, events, removed } = begun();
    for (let lap = 3; lap < 53; lap += 1) lapEvent(stage, log, lap);
    while (events().length < RACE_LOG_THIN_FROM) flagEvent(stage, log);
    expect(removed).toEqual([]);
    expect(
      kinds(events()).filter((kind) => kind === 'fastest-lap')
    ).toHaveLength(50);

    // From here a new event costs a fastest lap, the oldest first.
    flagEvent(stage, log);
    flagEvent(stage, log);
    expect(events()).toHaveLength(RACE_LOG_THIN_FROM);
    expect(removed).toEqual([1, 2]);
    expect(events()[0]).toMatchObject({ seq: 3, kind: 'fastest-lap' });

    // Until there is none left to give, and the log grows to its cap.
    for (let index = 0; index < 48; index += 1) flagEvent(stage, log);
    expect(kinds(events())).not.toContain('fastest-lap');
    expect(events()).toHaveLength(RACE_LOG_THIN_FROM);
    for (let index = 0; index < 100; index += 1) flagEvent(stage, log);
    expect(events()).toHaveLength(RACE_LOG_MAX_EVENTS);
    expect(removed).toHaveLength(50);

    // Past it the oldest event goes, whatever it is.
    const oldest = events()[0].seq;
    flagEvent(stage, log);
    flagEvent(stage, log);
    expect(events()).toHaveLength(RACE_LOG_MAX_EVENTS);
    expect(removed.slice(-2)).toEqual([oldest, oldest + 1]);
    expect(events()[0].seq).toBe(oldest + 2);
  });

  it('does not cost a fastest lap its own place the moment it is made', () => {
    const { stage, log, events, removed } = begun();
    while (events().length < RACE_LOG_THIN_FROM) flagEvent(stage, log);

    lapEvent(stage, log, 3);
    expect(events().at(-1)).toMatchObject({ kind: 'fastest-lap' });
    expect(removed).toEqual([]);

    // It is the next one's to cost.
    lapEvent(stage, log, 4);
    expect(removed).toEqual([RACE_LOG_THIN_FROM + 1]);
    expect(events()).toHaveLength(RACE_LOG_THIN_FROM + 1);
  });

  it('never uses a number twice', () => {
    const { stage, log, events } = begun();
    for (let index = 0; index < RACE_LOG_MAX_EVENTS + 20; index += 1) {
      flagEvent(stage, log);
    }

    const seqs = events().map((event) => event.seq);
    expect(seqs[0]).toBe(21);
    expect(seqs.at(-1)).toBe(RACE_LOG_MAX_EVENTS + 20);
    expect(new Set(seqs).size).toBe(RACE_LOG_MAX_EVENTS);
  });
});

describe('what is read of the log', () => {
  const filled = (count: number) => {
    const out = begun();
    for (let index = 0; index < count; index += 1) {
      out.stage.cars[1].flags =
        out.stage.cars[1].flags === 0 ? GlobalFlags.Black : 0;
      out.stage.tick(out.log);
    }
    return out;
  };

  it('is the most recent events on the snapshot, and how many there are in all', () => {
    expect(RACE_LOG_SNAPSHOT_EVENTS).toBe(200);
    const { log } = filled(450);

    const snapshot = log.snapshot();

    expect(snapshot).toMatchObject({
      raceToken: 'boot:1',
      total: 450,
      sessionNum: 0,
      version: log.currentVersion(),
    });
    expect(snapshot.events).toHaveLength(200);
    expect(snapshot.events[0].seq).toBe(251);
    expect(snapshot.events.at(-1)?.seq).toBe(450);
    // A new list every time: one handed out is not changed under its reader.
    expect(log.snapshot().events).not.toBe(snapshot.events);
  });

  it('is a page at a time further back, oldest first', () => {
    expect(RACE_LOG_PAGE_EVENTS).toBe(200);
    const { log } = filled(450);

    const latest = log.page();
    const before = log.page(latest[0].seq);
    const first = log.page(before[0].seq);

    expect([latest[0].seq, latest.at(-1)?.seq]).toEqual([251, 450]);
    expect([before[0].seq, before.at(-1)?.seq]).toEqual([51, 250]);
    expect([first[0].seq, first.at(-1)?.seq]).toEqual([1, 50]);
    expect(log.page(1)).toEqual([]);
    // Copies: a reader cannot change the log.
    latest[0].sessionTime = -1;
    expect(log.page()[0].sessionTime).not.toBe(-1);
  });

  it('moves its version with every event added or changed, and not otherwise', () => {
    const { stage, log } = begun();
    const before = log.currentVersion();

    stage.run(log, 30);
    expect(log.currentVersion()).toBe(before);

    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);
    expect(log.currentVersion()).toBe(before + 1);
  });

  it('is nothing between two races', () => {
    const { stage, log } = filled(5);

    log.onRaceEnded();

    expect(log.allEvents()).toEqual([]);
    expect(log.page()).toEqual([]);
    expect(log.snapshot()).toMatchObject({
      raceToken: '',
      events: [],
      total: 0,
      sessionNum: null,
    });
    // And a tick with no race is read by nobody.
    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);
    expect(log.allEvents()).toEqual([]);
  });

  it('starts over, from 1, with another race', () => {
    const { stage, log, events } = filled(5);

    log.onRaceStarted(stage.start());
    stage.tick(log);
    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);

    expect(events()).toMatchObject([{ seq: 1, kind: 'flag' }]);
  });
});

describe('a slot another car has taken', () => {
  it('loses what was logged of the car that left, and nothing else', () => {
    const { stage, log, events } = begun();
    stage.cars[1].flags = GlobalFlags.Black;
    stage.cars[2].flags = GlobalFlags.Black;
    stage.tick(log);
    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);
    stage.cars[1].flags = 0;
    stage.tick(log);
    const version = log.currentVersion();

    log.onCarReplaced(1);

    expect(events().map((event) => event.carIdx)).toEqual([2, null]);
    expect(log.currentVersion()).toBe(version + 1);
    // And the car now in the slot is logged like any other.
    stage.cars[1].flags = GlobalFlags.Black;
    stage.tick(log);
    expect(events().at(-1)).toMatchObject({ carIdx: 1, change: 'given' });
  });
});

describe('frames that resume after a gap', () => {
  it('are where things stand, not something that happened', () => {
    const { stage, log, told } = begun((staged) => {
      staged.lmu = { phase: 5, yellowState: 0 };
    });

    log.rebaseline();
    // Everything moved while nothing was read.
    stage.cars[1].where = CAR_PIT_IN_LANE;
    stage.cars[2].penalties = 2;
    stage.cars[3].finish = LMU_FINISH_STATUS.dnf;
    stage.vanish(3);
    stage.tick(log, 600);
    expect(told()).toEqual([]);

    // The car found in the lane leaves it: not seen going in, and not seen
    // to stand, so nothing is known of the visit.
    stage.cars[1].where = CAR_PIT_ON_TRACK;
    stage.run(log, 400);
    expect(told()).toEqual([]);

    // What happens from here on is said.
    stage.cars[2].penalties = 3;
    stage.tick(log);
    expect(told()).toMatchObject([{ carIdx: 2, change: 'given', pending: 3 }]);
  });

  it('close a caution that ended unseen, with no length', () => {
    const { stage, log, told } = begun();
    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);

    log.rebaseline();
    stage.sessionFlags = 0;
    stage.tick(log, 900);

    expect(told()).toMatchObject([
      { flag: 'caution', late: false },
      { flag: 'green', after: 'caution', durationS: null },
    ]);
  });

  it('carry a caution on that is still out, and measure it whole', () => {
    const { stage, log, told } = begun();
    stage.sessionFlags = GlobalFlags.Caution;
    stage.tick(log);
    const since = stage.time;

    log.rebaseline();
    stage.tick(log, 300);
    stage.sessionFlags = 0;
    stage.tick(log, 100);

    expect(told()).toHaveLength(2);
    expect(told()[1]).toMatchObject({
      flag: 'green',
      durationS: stage.time - since,
    });
  });

  it('say a place the own car has moved to since, once it has held', () => {
    const { stage, log, told } = begun((staged) => {
      staged.cars[0].classPosition = 3;
    });

    log.rebaseline();
    stage.cars[0].classPosition = 5;
    stage.tick(log, 600);
    expect(told()).toEqual([]);
    stage.run(log, 107);

    expect(told()).toEqual([{ carIdx: 0, kind: 'position', from: 3, to: 5 }]);
  });
});

describe('a race carried on after a restart', () => {
  const at = (seq: number, sessionTime: number) => ({
    seq,
    sessionTime,
    timeOfDay: null,
  });
  const stored = (): RaceEvent[] => [
    {
      ...at(1, 200),
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'start',
      durationS: null,
      late: false,
    },
    { ...at(2, 400), carIdx: 2, kind: 'retired', reason: 'gone' },
    { ...at(5, 600), carIdx: 0, kind: 'position', from: 3, to: 2 },
    {
      ...at(9, 900),
      carIdx: null,
      kind: 'flag',
      flag: 'caution',
      after: null,
      durationS: null,
      late: false,
    },
  ];

  /**
   * This run picked the race up under a caution, with car 2 away and the
   * own car third, and logged a penalty before the file answered.
   */
  const pickedUp = () => {
    const out = begun((staged) => {
      staged.sessionFlags = GlobalFlags.Caution;
      staged.cars[0].classPosition = 3;
      staged.vanish(2);
    });
    out.stage.cars[1].flags = GlobalFlags.Black;
    out.stage.tick(out.log);
    return out;
  };

  it('puts the file’s events first and numbers this run’s on from them', () => {
    const { log, events, said, removed } = pickedUp();
    expect(events().map((event) => [event.seq, event.kind])).toEqual([
      [1, 'flag'],
      [2, 'penalty'],
    ]);
    said.length = 0;

    log.restore(stored());

    expect(events().map((event) => [event.seq, event.kind])).toEqual([
      [1, 'flag'],
      [2, 'retired'],
      [5, 'position'],
      [9, 'flag'],
      [10, 'penalty'],
    ]);
    // The caution this run found out is the one the file saw begin: said
    // once, by the file, and this run's late notice of it is dropped.
    expect(removed).toEqual([1]);
    expect(events().filter((event) => event.kind === 'flag')).toMatchObject([
      { flag: 'green' },
      { flag: 'caution', late: false, sessionTime: 900 },
    ]);
    // What this run logged is announced again, under its new number, to be
    // stored; what the file holds is not.
    expect(said).toMatchObject([{ seq: 10, kind: 'penalty' }]);
  });

  it('goes on from what the file knew: the caution’s length, the car away, the place said', () => {
    const { stage, log, told } = pickedUp();
    log.restore(stored());
    const before = told().length;

    // The caution ends: measured from when the file saw it begin.
    stage.sessionFlags = 0;
    stage.tick(log, 1);
    expect(told()[before]).toEqual({
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'caution',
      durationS: stage.time - 900,
      late: false,
    });

    // Car 2 was said to be out before the restart: not again, however long.
    stage.run(log, 400);
    expect(
      told()
        .slice(before)
        .filter((event) => event.kind === 'retired')
    ).toEqual([]);
    // The own car is third now and was second when last said: said, once
    // it has held, as a move from second.
    expect(told().at(-1)).toEqual({
      carIdx: 0,
      kind: 'position',
      from: 2,
      to: 3,
    });

    // And when car 2 is back, how long it was away is from the file's time.
    stage.appear(2);
    stage.tick(log, 1);
    expect(told().at(-1)).toEqual({
      carIdx: 2,
      kind: 'rejoined',
      awayS: stage.time - 400,
    });
  });

  it('closes a caution the file left open that is over by now', () => {
    const { log, told } = begun();

    log.restore(stored());

    expect(told().at(-1)).toEqual({
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'caution',
      // It ended while nothing was recording: when is not known.
      durationS: null,
      late: false,
    });
  });

  it('does not say the chequered flag a second time', () => {
    const { stage, log, events } = begun();
    log.restore([
      {
        ...at(4, 500),
        carIdx: null,
        kind: 'flag',
        flag: 'chequered',
        after: null,
        durationS: null,
        late: false,
      },
    ]);

    stage.sessionState = SessionState.Checkered;
    stage.run(log, 5);

    expect(kinds(events())).toEqual(['flag']);
  });

  it('keeps to the cap, and says which of the file’s events went', () => {
    const { log, events, removed } = pickedUp();
    const file: RaceEvent[] = Array.from(
      { length: RACE_LOG_MAX_EVENTS },
      (_, index) => ({
        ...at(index + 1, index),
        carIdx: 1,
        kind: 'pit-entry',
        classPosition: null,
      })
    );

    log.restore(file);

    // The file's thousand and this run's two.
    expect(events()).toHaveLength(RACE_LOG_MAX_EVENTS);
    expect(events()[0].seq).toBe(3);
    expect(events().at(-1)).toMatchObject({ seq: 1002, kind: 'penalty' });
    expect(removed).toEqual([1, 2]);
  });

  it('takes a file with no log as nothing to take', () => {
    const { log, events, said } = pickedUp();
    said.length = 0;

    log.restore([]);

    expect(events().map((event) => event.seq)).toEqual([1, 2]);
    expect(said).toEqual([]);
  });
});

describe('what an event is told as', () => {
  it('leaves out only its number and its clocks', () => {
    expect(
      tell({
        seq: 4,
        sessionTime: 10,
        timeOfDay: null,
        carIdx: 3,
        kind: 'retired',
        reason: 'gone',
      })
    ).toEqual({ carIdx: 3, kind: 'retired', reason: 'gone' });
  });
});
