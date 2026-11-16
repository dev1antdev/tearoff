import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RACE_LOG_MAX_EVENTS,
  RACE_LOG_PAGE_EVENTS,
  type RaceEvent,
} from '../../../types/raceLog';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import {
  everyKindOfEvent,
  MINUTE,
  raceBatch,
  raceEvent,
  raceInfo,
  raceLap,
  T0,
} from './raceHistoryRowsFixture';

/**
 * The race's log in the lap library's file (table `race_event`), against a
 * real database in a file of its own under the system's temporary folder.
 */

let directory: string;
let file: string;
let db: LapLibraryDatabase;

const rows = (where = '1'): Record<string, unknown>[] => {
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    return raw
      .prepare(`SELECT * FROM race_event WHERE ${where} ORDER BY race_id, seq`)
      .all() as Record<string, unknown>[];
  } finally {
    raw.close();
  }
};

/** Changes the file behind the database's back, as nothing in the app does. */
const tamper = (sql: string): void => {
  db.close();
  const raw = new DatabaseSync(file);
  raw.exec(sql);
  raw.close();
  db = new LapLibraryDatabase(file);
};

const seqs = (events: readonly RaceEvent[]): number[] =>
  events.map((event) => event.seq);

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-race-log-'));
  file = path.join(directory, 'laps.db');
  db = new LapLibraryDatabase(file);
});

afterEach(() => {
  db.close();
  // The exact mkdtemp result, never a real application folder.
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('writing a race’s log', () => {
  it('keeps an event of every kind exactly as it was handed in', () => {
    const events = everyKindOfEvent();

    const { raceId } = db.races.write(raceBatch({ events }));

    expect(db.races.events(raceId)).toEqual(events);
    expect(db.races.load(raceId)?.events).toEqual(events);
    // What every event has is in columns; what its kind adds is JSON.
    expect(rows('seq = 2')).toEqual([
      {
        race_id: raceId,
        seq: 2,
        session_time: 121,
        time_of_day: 50_521,
        car_idx: 7,
        kind: 'pit-entry',
        data: '{"classPosition":5}',
      },
    ]);
    // An event about the whole field has no car.
    expect(rows('seq = 1')[0].car_idx).toBeNull();
  });

  it('replaces an event written again: a stop whose driver change was named late', () => {
    const exit: RaceEvent = {
      seq: 4,
      sessionTime: 1830.5,
      timeOfDay: 64_800,
      carIdx: 7,
      kind: 'pit-exit',
      standingTime: 31.5,
      laneTime: 58.25,
      driverFrom: '',
      driverTo: '',
    };
    const { raceId } = db.races.write(
      raceBatch({ events: [raceEvent(3, 7), exit] })
    );

    db.races.write(
      raceBatch({
        events: [{ ...exit, driverFrom: 'A. Petrov', driverTo: 'M. Ivanov' }],
      })
    );

    expect(rows()).toHaveLength(2);
    expect(db.races.events(raceId)[1]).toMatchObject({
      seq: 4,
      driverFrom: 'A. Petrov',
      driverTo: 'M. Ivanov',
    });
  });

  it('takes out the events a batch says went at the cap', () => {
    const { raceId } = db.races.write(
      raceBatch({
        events: [1, 2, 3, 4, 5].map((seq) => raceEvent(seq)),
      })
    );

    db.races.write(
      raceBatch({
        removedEvents: [2, 4, 99, Number.NaN, -1],
        events: [raceEvent(6)],
      })
    );

    expect(seqs(db.races.events(raceId))).toEqual([1, 3, 5, 6]);
  });

  it('keeps a race’s log to its most recent events', () => {
    expect(RACE_LOG_MAX_EVENTS).toBe(1000);
    const { raceId } = db.races.write(
      raceBatch({
        events: Array.from({ length: RACE_LOG_MAX_EVENTS }, (_, index) =>
          raceEvent(index + 1)
        ),
      })
    );
    expect(rows()).toHaveLength(RACE_LOG_MAX_EVENTS);

    // Three more than it holds, with nothing said about which went: as a
    // file would be left by a run that stopped before saying.
    db.races.write(
      raceBatch({
        events: [1001, 1002, 1003].map((seq) => raceEvent(seq)),
      })
    );

    const kept = db.races.load(raceId)?.events ?? [];
    expect(kept).toHaveLength(RACE_LOG_MAX_EVENTS);
    expect(kept[0].seq).toBe(4);
    expect(kept.at(-1)?.seq).toBe(1003);
  });

  it('takes out the events of a slot another car has taken, and no others', () => {
    const { raceId } = db.races.write(
      raceBatch({
        laps: [raceLap(7, 1)],
        events: [
          raceEvent(1, 0),
          raceEvent(2, 7),
          {
            seq: 3,
            sessionTime: 200,
            timeOfDay: null,
            carIdx: null,
            kind: 'flag',
            flag: 'caution',
            after: null,
            durationS: null,
            late: false,
          },
          raceEvent(4, 7),
        ],
      })
    );

    db.races.write(raceBatch({ replacedCars: [7], events: [raceEvent(5, 7)] }));

    // The newcomer's own event is written after the slot was cleared.
    expect(
      db.races.events(raceId).map((event) => [event.seq, event.carIdx])
    ).toEqual([
      [1, 0],
      [3, null],
      [5, 7],
    ]);
  });

  it('leaves out what is not an event rather than fail the rest', () => {
    const { raceId } = db.races.write(
      raceBatch({
        laps: [raceLap(0, 1)],
        events: [
          raceEvent(1),
          // No number, a number below the first, a kind there is not, a
          // car event with no car, and nothing at all.
          raceEvent(Number.NaN),
          raceEvent(0),
          { ...raceEvent(2), kind: 'teleport' } as unknown as RaceEvent,
          { ...raceEvent(3), carIdx: null } as unknown as RaceEvent,
          null as unknown as RaceEvent,
          raceEvent(4),
        ],
      })
    );

    expect(seqs(db.races.events(raceId))).toEqual([1, 4]);
    expect(db.races.carLaps(raceId, 0)).toHaveLength(1);
  });

  it('writes what an event is made of and nothing that came along with it', () => {
    const { raceId } = db.races.write(
      raceBatch({
        events: [
          {
            ...raceEvent(1),
            classPosition: '3' as unknown as number,
            note: 'C:\\Users\\somebody',
          } as unknown as RaceEvent,
          {
            seq: 2,
            sessionTime: 90,
            timeOfDay: 'noon' as unknown as number,
            carIdx: 0,
            kind: 'penalty',
            change: 'given',
            penalty: 'made up' as unknown as 'DT',
            seconds: Number.POSITIVE_INFINITY,
            pending: 1,
          },
        ],
      })
    );

    expect(rows().map((row) => row.data)).toEqual([
      '{"classPosition":null}',
      '{"change":"given","penalty":"","seconds":null,"pending":1}',
    ]);
    expect(db.races.events(raceId)[1]).toMatchObject({
      timeOfDay: null,
      penalty: '',
      seconds: null,
    });
  });

  it('writes a batch whole or not at all, its events included', () => {
    const { raceId } = db.races.write(raceBatch({ events: [raceEvent(1)] }));

    expect(() =>
      db.races.write(
        raceBatch({
          events: [raceEvent(2), raceEvent(3)],
          // Not a list: the batch fails before it gets to its events.
          laps: 12 as unknown as [],
        })
      )
    ).toThrow();
    expect(() =>
      db.races.write(
        raceBatch({
          removedEvents: [1],
          // Not a list either, after the removal was made.
          events: 12 as unknown as [],
        })
      )
    ).toThrow();

    expect(seqs(db.races.events(raceId))).toEqual([1]);
  });
});

describe('reading a race’s log', () => {
  const write = (count: number): number =>
    db.races.write(
      raceBatch({
        events: Array.from({ length: count }, (_, index) =>
          raceEvent(index + 1)
        ),
      })
    ).raceId;

  it('answers with the most recent page, oldest first', () => {
    expect(RACE_LOG_PAGE_EVENTS).toBe(200);
    const raceId = write(450);

    const latest = db.races.events(raceId);

    expect(latest).toHaveLength(200);
    expect(latest[0].seq).toBe(251);
    expect(latest.at(-1)?.seq).toBe(450);
  });

  it('goes back a page at a time from an event, to the first', () => {
    const raceId = write(450);

    const second = db.races.events(raceId, 251);
    const third = db.races.events(raceId, second[0].seq);

    expect([second[0].seq, second.at(-1)?.seq]).toEqual([51, 250]);
    expect(seqs(third)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1)
    );
    // Nothing lies before the first.
    expect(db.races.events(raceId, 1)).toEqual([]);
  });

  it('answers with as many as it is asked for, within what a race holds', () => {
    const raceId = write(30);

    expect(seqs(db.races.events(raceId, undefined, 3))).toEqual([28, 29, 30]);
    expect(db.races.events(raceId, undefined, 0)).toHaveLength(1);
    expect(db.races.events(raceId, undefined, 1e9)).toHaveLength(30);
    expect(db.races.events(raceId, 20, 5).map((event) => event.seq)).toEqual([
      15, 16, 17, 18, 19,
    ]);
  });

  it('has nothing for a race with no log, and for no race', () => {
    const { raceId } = db.races.write(raceBatch({ laps: [raceLap(0, 1)] }));

    expect(db.races.events(raceId)).toEqual([]);
    expect(db.races.load(raceId)?.events).toEqual([]);
    expect(db.races.events(raceId + 1)).toEqual([]);
  });

  it('keeps the logs of two races apart', () => {
    const first = db.races.write(
      raceBatch({ events: [raceEvent(1), raceEvent(2)] })
    ).raceId;
    const second = db.races.write(
      raceBatch({
        token: 'boot2:1',
        info: raceInfo({ updatedAt: T0 + MINUTE }),
        events: [raceEvent(1, 7)],
      })
    ).raceId;

    expect(seqs(db.races.events(first))).toEqual([1, 2]);
    expect(db.races.events(second)).toMatchObject([{ seq: 1, carIdx: 7 }]);
  });

  it('leaves out a row it cannot make an event of', () => {
    const raceId = db.races.write(
      raceBatch({ events: everyKindOfEvent() })
    ).raceId;

    tamper(`
      UPDATE race_event SET kind = 'from-a-newer-build' WHERE seq = 2;
      UPDATE race_event SET data = 'not json' WHERE seq IN (3, 6);
      UPDATE race_event SET car_idx = NULL WHERE seq = 4;
    `);

    const events = db.races.events(raceId);
    // A kind this build does not know, a fastest lap with no time and a car
    // event with no car are not events. A stop that has lost its times is
    // still a stop.
    expect(seqs(events)).toEqual([1, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(events[1]).toEqual({
      seq: 3,
      sessionTime: 181.5,
      timeOfDay: 50_581.5,
      carIdx: 7,
      kind: 'pit-exit',
      standingTime: null,
      laneTime: null,
      driverFrom: '',
      driverTo: '',
    });
    expect(seqs(db.races.load(raceId)?.events ?? [])).toEqual(seqs(events));
  });
});

describe('a race that goes', () => {
  it('takes its log with it', () => {
    const write = (index: number) =>
      db.races.write(
        raceBatch({
          token: `boot${index}:1`,
          info: raceInfo({ updatedAt: T0 + index * MINUTE }),
          events: [raceEvent(1), raceEvent(2)],
          maxRaces: 2,
        })
      ).raceId;
    const oldest = write(1);
    write(2);
    expect(rows()).toHaveLength(4);

    const newest = write(3);

    expect(rows(`race_id = ${oldest}`)).toEqual([]);
    expect(rows()).toHaveLength(4);
    expect(seqs(db.races.events(newest))).toEqual([1, 2]);
  });
});
