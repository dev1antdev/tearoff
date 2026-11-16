import { describe, expect, it } from 'vitest';
import type { RaceEvent, RaceLogKinds } from '@irdashies/types';
import {
  formatSessionClock,
  isKindListed,
  isScopeListed,
  mergeRaceLog,
  prependRaceLog,
  raceEventFigure,
  raceEventMark,
  raceEventText,
  raceEventTime,
  type RaceLogOwnCar,
} from './raceLogDisplay';

const at = (seq = 1) => ({ seq, sessionTime: 3600, timeOfDay: 66_660 });

const pitEntry = (seq: number, carIdx = 4): RaceEvent => ({
  ...at(seq),
  carIdx,
  kind: 'pit-entry',
  classPosition: 5,
});

const exit = (
  rest: Partial<Extract<RaceEvent, { kind: 'pit-exit' }>> = {}
): RaceEvent => ({
  ...at(),
  carIdx: 4,
  kind: 'pit-exit',
  standingTime: 27.2,
  laneTime: 58.4,
  driverFrom: '',
  driverTo: '',
  ...rest,
});

const flag = (
  rest: Partial<Extract<RaceEvent, { kind: 'flag' }>>
): RaceEvent => ({
  ...at(),
  carIdx: null,
  kind: 'flag',
  flag: 'green',
  after: null,
  durationS: null,
  late: false,
  ...rest,
});

const penalty = (
  rest: Partial<Extract<RaceEvent, { kind: 'penalty' }>>
): RaceEvent => ({
  ...at(),
  carIdx: 4,
  kind: 'penalty',
  change: 'given',
  penalty: '',
  seconds: null,
  pending: 1,
  ...rest,
});

describe('what an event says', () => {
  it('says a car into the pits, from its place where the sim had one', () => {
    expect(raceEventText(pitEntry(1))).toBe('into the pits from P5');
    expect(
      raceEventText({
        ...at(),
        carIdx: 4,
        kind: 'pit-entry',
        classPosition: null,
      })
    ).toBe('into the pits');
  });

  it('says a car out of the pits, with the times that are known', () => {
    expect(raceEventText(exit())).toBe('out after 58.4 s, stopped 27.2 s');
    // Past a minute, still in seconds: the two are read against each other.
    expect(raceEventText(exit({ laneTime: 67.44, standingTime: 35.6 }))).toBe(
      'out after 67.4 s, stopped 35.6 s'
    );
    // A stop long enough to be a repair, as a clock reads.
    expect(raceEventText(exit({ laneTime: 127.6, standingTime: 99.96 }))).toBe(
      'out after 2:08, stopped 1:40'
    );
    // Not seen going in: only how long it stood.
    expect(raceEventText(exit({ laneTime: null }))).toBe(
      'out of the pits, stopped 27.2 s'
    );
    expect(raceEventText(exit({ laneTime: null, standingTime: null }))).toBe(
      'out of the pits'
    );
  });

  it('adds who got out and who got in when the driver changed at the stop', () => {
    expect(
      raceEventText(exit({ driverFrom: 'A. Petrov', driverTo: 'M. Ivanov' }))
    ).toBe('out after 58.4 s, stopped 27.2 s, driver A. Petrov to M. Ivanov');
    // A driver the session never named is not made up.
    expect(raceEventText(exit({ driverFrom: '', driverTo: 'M. Ivanov' }))).toBe(
      'out after 58.4 s, stopped 27.2 s, driver -- to M. Ivanov'
    );
  });

  it('says a pass down the pit lane for what it is, and not as a penalty served', () => {
    expect(
      raceEventText({
        ...at(),
        carIdx: 4,
        kind: 'drive-through',
        laneTime: 24.31,
      })
    ).toBe('through the pit lane without stopping, 24.3 s');
    expect(
      raceEventText({
        ...at(),
        carIdx: 4,
        kind: 'drive-through',
        laneTime: null,
      })
    ).toBe('through the pit lane without stopping');
  });

  it('says a driver change with no stop', () => {
    expect(
      raceEventText({
        ...at(),
        carIdx: 4,
        kind: 'driver-change',
        driverFrom: 'A. Petrov',
        driverTo: 'M. Ivanov',
      })
    ).toBe('driver A. Petrov to M. Ivanov');
  });

  it('says a class’s fastest lap with its time, which is its figure', () => {
    const lap: RaceEvent = {
      ...at(),
      carIdx: 4,
      kind: 'fastest-lap',
      lap: 31,
      lapTime: 113.604,
      driver: 'M. Ivanov',
    };

    expect(raceEventText(lap)).toBe('fastest lap of the class, 1:53.604');
    expect(raceEventFigure(lap)).toBe('1:53.604');
    expect(raceEventText(lap).endsWith(raceEventFigure(lap))).toBe(true);
    // Under a minute, and a time that rounds up to the next one.
    expect(raceEventFigure({ ...lap, lapTime: 59.0004 })).toBe('0:59.000');
    expect(raceEventFigure({ ...lap, lapTime: 119.9996 })).toBe('2:00.000');
    // No other event has one.
    expect(raceEventFigure(pitEntry(1))).toBe('');
  });

  it('says each flag for the whole field', () => {
    expect(raceEventText(flag({ after: 'start' }))).toBe('Green flag');
    expect(raceEventText(flag({ flag: 'caution' }))).toBe('Full-course yellow');
    expect(raceEventText(flag({ flag: 'caution', late: true }))).toBe(
      'Full-course yellow, already out when recording began'
    );
    expect(raceEventText(flag({ after: 'caution', durationS: 362 }))).toBe(
      'Full-course yellow ended after 6 min'
    );
    // Its beginning or its end was not seen: no length is made up.
    expect(raceEventText(flag({ after: 'caution' }))).toBe(
      'Full-course yellow ended'
    );
    expect(raceEventText(flag({ flag: 'red' }))).toBe('Red flag');
    expect(raceEventText(flag({ flag: 'red', late: true }))).toBe(
      'Red flag, already out when recording began'
    );
    expect(raceEventText(flag({ after: 'red', durationS: 4_260 }))).toBe(
      'Restarted after 1 h 11 min under the red flag'
    );
    expect(raceEventText(flag({ after: 'red' }))).toBe(
      'Restarted after the red flag'
    );
    expect(raceEventText(flag({ flag: 'chequered' }))).toBe('Chequered flag');
  });

  it('says how long a short caution lasted in seconds', () => {
    expect(raceEventText(flag({ after: 'caution', durationS: 74.6 }))).toBe(
      'Full-course yellow ended after 75 s'
    );
    expect(raceEventText(flag({ after: 'caution', durationS: 95 }))).toBe(
      'Full-course yellow ended after 2 min'
    );
  });

  it('says why a car is out, and when it is back', () => {
    const out = (reason: 'garage' | 'gone' | 'dnf' | 'disqualified') =>
      raceEventText({ ...at(), carIdx: 4, kind: 'retired', reason });

    expect(out('garage')).toBe(
      'in the garage for five minutes: parked or retired'
    );
    expect(out('gone')).toBe('out of the session for five minutes: retired');
    expect(out('dnf')).toBe('retired');
    expect(out('disqualified')).toBe('disqualified');
    expect(
      raceEventText({ ...at(), carIdx: 4, kind: 'rejoined', awayS: 1085 })
    ).toBe('back on track after 18 min');
    expect(
      raceEventText({ ...at(), carIdx: 4, kind: 'rejoined', awayS: null })
    ).toBe('back on track');
  });

  it('says which way our place moved', () => {
    expect(
      raceEventText({ ...at(), carIdx: 4, kind: 'position', from: 4, to: 3 })
    ).toBe('up to P3 in class from P4');
    expect(
      raceEventText({ ...at(), carIdx: 4, kind: 'position', from: 3, to: 6 })
    ).toBe('down to P6 in class from P3');
  });

  it('names a penalty where the sim does, and counts what is left to serve', () => {
    expect(raceEventText(penalty({ penalty: 'DT' }))).toBe(
      'drive-through penalty'
    );
    expect(raceEventText(penalty({ penalty: 'SG', pending: 2 }))).toBe(
      'stop-and-go penalty, 2 to serve'
    );
    expect(raceEventText(penalty({ penalty: 'TIME', seconds: 10 }))).toBe(
      'time penalty of 10 s'
    );
    expect(raceEventText(penalty({ penalty: 'TIME' }))).toBe('time penalty');
    // A count and no kind: it is a penalty, and that is all that is said.
    expect(raceEventText(penalty({}))).toBe('penalty');
    expect(raceEventText(penalty({ penalty: 'black', pending: null }))).toBe(
      'black flag'
    );

    expect(raceEventText(penalty({ change: 'served', pending: 0 }))).toBe(
      'penalty served'
    );
    expect(raceEventText(penalty({ change: 'served', pending: 1 }))).toBe(
      'penalty served, 1 still to serve'
    );
    expect(
      raceEventText(
        penalty({ change: 'served', penalty: 'black', pending: null })
      )
    ).toBe('black flag cleared');
  });

  it('marks the one estimate there is: when a forecast’s rain begins', () => {
    const forecast = (
      rest: Partial<Extract<RaceEvent, { kind: 'forecast' }>>
    ): RaceEvent => ({
      ...at(),
      carIdx: null,
      kind: 'forecast',
      rain: true,
      inMinutes: 118,
      rainChance: 0.85,
      ...rest,
    });

    expect(raceEventText(forecast({}))).toBe(
      'Forecast changed: rain in ~1 h 58 min, 85 %'
    );
    expect(raceEventText(forecast({ inMinutes: 40, rainChance: null }))).toBe(
      'Forecast changed: rain in ~40 min'
    );
    // A race run to a lap count has no minutes to count.
    expect(raceEventText(forecast({ inMinutes: null }))).toBe(
      'Forecast changed: rain to come, 85 %'
    );
    expect(
      raceEventText(
        forecast({ rain: false, inMinutes: null, rainChance: null })
      )
    ).toBe('Forecast changed: no rain in it');
  });
});

describe('the mark at the head of a line', () => {
  it('is the flag, the weather, or the car', () => {
    expect(raceEventMark(flag({ flag: 'caution' }))).toBe('caution');
    expect(raceEventMark(flag({ flag: 'green', after: 'caution' }))).toBe(
      'green'
    );
    expect(raceEventMark(flag({ flag: 'red' }))).toBe('red');
    expect(raceEventMark(flag({ flag: 'chequered' }))).toBe('chequered');
    expect(
      raceEventMark({
        ...at(),
        carIdx: null,
        kind: 'forecast',
        rain: true,
        inMinutes: 5,
        rainChance: 1,
      })
    ).toBe('rain');
    expect(
      raceEventMark({
        ...at(),
        carIdx: null,
        kind: 'forecast',
        rain: false,
        inMinutes: null,
        rainChance: null,
      })
    ).toBe('dry');
    expect(raceEventMark(pitEntry(1))).toBe('car');
    expect(raceEventMark(penalty({}))).toBe('car');
  });
});

describe('the time on a line', () => {
  it('is the clock in the sim to the minute where it is asked for and known', () => {
    expect(raceEventTime(at(), 'timeOfDay')).toBe('18:31');
    expect(
      raceEventTime(
        { sessionTime: 3600, timeOfDay: 23 * 3600 + 59 * 60 + 59 },
        'timeOfDay'
      )
    ).toBe('23:59');
    // Midnight is a time of day like any other.
    expect(
      raceEventTime({ sessionTime: 3600, timeOfDay: 0 }, 'timeOfDay')
    ).toBe('00:00');
  });

  it('is the session clock where the sim gave no clock, or it is asked for', () => {
    expect(
      raceEventTime({ sessionTime: 16_524, timeOfDay: null }, 'timeOfDay')
    ).toBe('4:35:24');
    expect(raceEventTime(at(), 'session')).toBe('1:00:00');
  });

  it('writes the session clock as a clock', () => {
    expect(formatSessionClock(0)).toBe('0:00');
    expect(formatSessionClock(59.9)).toBe('0:59');
    expect(formatSessionClock(1_616)).toBe('26:56');
    expect(formatSessionClock(12_416)).toBe('3:26:56');
    expect(formatSessionClock(86_400)).toBe('24:00:00');
    expect(formatSessionClock(-1)).toBe('--');
    expect(formatSessionClock(Number.NaN)).toBe('--');
  });
});

describe('which events a list shows', () => {
  const ALL: RaceLogKinds = {
    pits: true,
    drivers: true,
    fastestLaps: true,
    flags: true,
    status: true,
  };
  const only = (kinds: Partial<RaceLogKinds>): RaceLogKinds => ({
    pits: false,
    drivers: false,
    fastestLaps: false,
    flags: false,
    status: false,
    ...kinds,
  });
  const everyKind: RaceEvent[] = [
    pitEntry(1),
    exit(),
    { ...at(), carIdx: 4, kind: 'drive-through', laneTime: 24 },
    {
      ...at(),
      carIdx: 4,
      kind: 'driver-change',
      driverFrom: 'A',
      driverTo: 'B',
    },
    {
      ...at(),
      carIdx: 4,
      kind: 'fastest-lap',
      lap: 3,
      lapTime: 100,
      driver: '',
    },
    flag({ flag: 'caution' }),
    {
      ...at(),
      carIdx: null,
      kind: 'forecast',
      rain: false,
      inMinutes: null,
      rainChance: null,
    },
    { ...at(), carIdx: 4, kind: 'retired', reason: 'gone' },
    { ...at(), carIdx: 4, kind: 'rejoined', awayS: null },
    { ...at(), carIdx: 4, kind: 'position', from: 2, to: 1 },
    penalty({}),
  ];
  const listed = (kinds: RaceLogKinds) =>
    everyKind.filter((event) => isKindListed(event, kinds)).map((e) => e.kind);

  it('lists every kind with every switch on, and none with every one off', () => {
    expect(listed(ALL)).toHaveLength(everyKind.length);
    expect(listed(only({}))).toEqual([]);
  });

  it('lists each kind under one switch', () => {
    expect(listed(only({ pits: true }))).toEqual([
      'pit-entry',
      'pit-exit',
      'drive-through',
    ]);
    expect(listed(only({ drivers: true }))).toEqual(['driver-change']);
    expect(listed(only({ fastestLaps: true }))).toEqual(['fastest-lap']);
    expect(listed(only({ flags: true }))).toEqual(['flag', 'forecast']);
    expect(listed(only({ status: true }))).toEqual([
      'retired',
      'rejoined',
      'position',
      'penalty',
    ]);
  });

  it('lists a stop at which the driver changed as a pit stop and as a driver change', () => {
    const swap = exit({ driverFrom: 'A', driverTo: 'B' });

    expect(isKindListed(swap, only({ drivers: true }))).toBe(true);
    expect(isKindListed(swap, only({ pits: true }))).toBe(true);
    expect(isKindListed(swap, only({ flags: true }))).toBe(false);
    // A stop with the same driver is not a driver change.
    expect(isKindListed(exit(), only({ drivers: true }))).toBe(false);
  });

  /** Slots 0 to 3 are one class, 4 to 7 another. Ours is 5. */
  const classOf = (carIdx: number) =>
    carIdx < 4 ? 10 : carIdx < 8 ? 30 : undefined;
  const own = { carIdx: 5, classId: 30 };
  const cars = [1, 4, 5, 9].map((carIdx, index) => pitEntry(index + 1, carIdx));
  const shown = (scope: 'all' | 'class' | 'car', who: RaceLogOwnCar = own) =>
    cars
      .filter((event) => isScopeListed(event, scope, who, classOf))
      .map((event) => event.carIdx);

  it('lists every car, our class, or our car', () => {
    expect(shown('all')).toEqual([1, 4, 5, 9]);
    // A car the session does not class is in nobody's class.
    expect(shown('class')).toEqual([4, 5]);
    expect(shown('car')).toEqual([5]);
  });

  it('lists a flag and the forecast whichever cars are listed', () => {
    for (const scope of ['all', 'class', 'car'] as const) {
      expect(
        isScopeListed(flag({ flag: 'caution' }), scope, own, classOf)
      ).toBe(true);
    }
  });

  it('lists everything while our car is not known: there is nothing to keep it to', () => {
    const nobody = { carIdx: null, classId: null };

    expect(shown('class', nobody)).toEqual([1, 4, 5, 9]);
    expect(shown('car', nobody)).toEqual([1, 4, 5, 9]);
    // Known, in a class the session has not said yet.
    expect(shown('class', { carIdx: 5, classId: null })).toEqual([1, 4, 5, 9]);
    expect(shown('car', { carIdx: 5, classId: null })).toEqual([5]);
  });
});

describe('the events a reader holds', () => {
  const run = (from: number, to: number): RaceEvent[] =>
    Array.from({ length: to - from + 1 }, (_, index) => pitEntry(from + index));
  const seqs = (events: readonly RaceEvent[]) =>
    events.map((event) => event.seq);

  it('are the channel’s, with what has moved out of it kept before them', () => {
    const held = run(1, 200);

    // Three more events: the channel's window has moved on by three.
    const merged = mergeRaceLog(held, run(4, 203));

    expect(seqs(merged)).toEqual(seqs(run(1, 203)));
    // The channel's own objects, as they stand now.
    expect(merged[3]).not.toBe(held[3]);
  });

  it('are the channel’s own list when nothing came before it', () => {
    const latest = run(1, 5);

    expect(mergeRaceLog([], latest)).toBe(latest);
    expect(mergeRaceLog(run(1, 3), latest)).toBe(latest);
  });

  it('take an event as it now stands, and let go of one the log took out', () => {
    const changed = { ...exit({ driverTo: 'B. Driver' }), seq: 12 };

    // 11 was thinned out of the log; 12 was given its driver.
    const merged = mergeRaceLog(run(8, 13), [
      pitEntry(10),
      changed,
      pitEntry(13),
    ]);

    expect(seqs(merged)).toEqual([8, 9, 10, 12, 13]);
    expect(merged[3]).toBe(changed);
  });

  it('are none when the channel has none: the race is over', () => {
    expect(mergeRaceLog(run(1, 50), [])).toEqual([]);
  });

  it('take an earlier page before them, and nothing they already hold', () => {
    const held = run(51, 250);

    expect(seqs(prependRaceLog(run(1, 50), held))).toEqual(seqs(run(1, 250)));
    // A page that overlaps, as one asked for twice would.
    expect(seqs(prependRaceLog(run(40, 60), held))).toEqual(seqs(run(40, 250)));
    expect(prependRaceLog([], held)).toBe(held);
    expect(prependRaceLog(run(60, 70), held)).toBe(held);
    const page = run(1, 3);
    expect(prependRaceLog(page, [])).toBe(page);
  });
});
