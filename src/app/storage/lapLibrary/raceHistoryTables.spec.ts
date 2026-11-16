import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RaceInfo, RaceStint } from '../../../types/raceHistory';
import { RACE_HISTORY_MAX_RACES } from '../../../types/raceHistory';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import {
  MINUTE,
  raceBatch,
  raceChange as change,
  raceInfo,
  raceLap,
  raceStint,
  T0,
} from './raceHistoryRowsFixture';

/**
 * The race tables of the lap library's file, against a real database in a
 * file of its own under the system's temporary folder.
 */

let directory: string;
let file: string;
let db: LapLibraryDatabase;

const countRows = (table: string, where = '1'): number => {
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      raw
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
        .get() as {
        n: number;
      }
    ).n;
  } finally {
    raw.close();
  }
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-races-'));
  file = path.join(directory, 'laps.db');
  db = new LapLibraryDatabase(file);
});

afterEach(() => {
  db.close();
  // The exact mkdtemp result, never a real application folder.
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('writing a race', () => {
  it('makes the race’s row with its first batch and hands back its id', () => {
    const { raceId, removedRaces } = db.races.write(
      raceBatch({ laps: [raceLap(0, 1)] })
    );

    expect(raceId).toBeGreaterThan(0);
    expect(removedRaces).toBe(0);
    expect(db.races.list()).toEqual([
      { ...raceInfo(), id: raceId, laps: 1, cars: 1 },
    ]);
  });

  it('keeps a lap, a stint and a driver change exactly as they were handed in', () => {
    const laps = [
      raceLap(0, 1),
      // Every nullable figure null, and the lap the sim gave no time.
      raceLap(0, 2, {
        lapTime: null,
        sectors: [70.5, null, null],
        position: null,
        classPosition: null,
        classGap: null,
        flags: 4 | 1,
        driver: '',
        energy: null,
        energyIsVirtual: false,
        compounds: [-1, -1, -1, -1],
      }),
      raceLap(7, 1, { driver: 'Jérôme d’Été' }),
    ];
    const stints = [
      raceStint(0, 1, {
        closedBy: 'stop',
        endTime: 2090.5,
        stop: { laneTime: 48.2, standingTime: 31.7, driverChanged: true },
      }),
      raceStint(0, 2, {
        avgLap: null,
        bestLap: null,
        cleanLaps: 0,
        firstLap: null,
        lastLap: null,
        laps: 1,
      }),
      // A stop the car has not left yet: no lane time.
      raceStint(7, 1, {
        closedBy: 'stop',
        endTime: 100,
        stop: { laneTime: null, standingTime: 2.5, driverChanged: false },
      }),
    ];
    const changes = [change(0, 1), change(7, 1, { atStop: false })];

    const { raceId } = db.races.write(
      raceBatch({ laps, stints, driverChanges: changes })
    );

    expect(db.races.carLaps(raceId, 0)).toEqual([laps[0], laps[1]]);
    expect(db.races.carLaps(raceId, 7)).toEqual([laps[2]]);
    expect(db.races.carStints(raceId, 0)).toEqual([stints[0], stints[1]]);
    expect(db.races.carStints(raceId, 7)).toEqual([stints[2]]);
    // Oldest first, across the cars.
    expect(db.races.driverChanges(raceId)).toEqual(changes);
    expect(db.races.load(raceId)).toEqual({
      laps,
      stints,
      driverChanges: changes,
      events: [],
    });
    // Nothing of another car, and nothing of a race that is not there.
    expect(db.races.carLaps(raceId, 3)).toEqual([]);
    expect(db.races.carLaps(raceId + 1, 0)).toEqual([]);
    expect(db.races.load(raceId + 1)).toBeNull();
  });

  it('adds later batches to the same race, by its token', () => {
    const first = db.races.write(raceBatch({ laps: [raceLap(0, 1)] }));
    const second = db.races.write(
      raceBatch({
        info: raceInfo({ updatedAt: T0 + 4 * MINUTE, sessionTime: 421 }),
        laps: [raceLap(0, 2), raceLap(7, 1)],
      })
    );

    expect(second.raceId).toBe(first.raceId);
    expect(db.races.list()).toMatchObject([
      {
        id: first.raceId,
        laps: 3,
        cars: 2,
        // When it began stays; where it has got to moves.
        startedAt: T0,
        updatedAt: T0 + 4 * MINUTE,
        sessionTime: 421,
      },
    ]);
  });

  it('replaces a row written again: a lap given its time late, a stint that grew', () => {
    const { raceId } = db.races.write(
      raceBatch({
        laps: [raceLap(0, 1, { lapTime: null })],
        stints: [raceStint(0, 1, { laps: 1, lastLap: 1 })],
        driverChanges: [change(0, 1, { atStop: false })],
      })
    );

    db.races.write(
      raceBatch({
        laps: [raceLap(0, 1, { lapTime: 211.25, driver: 'Somebody Else' })],
        stints: [raceStint(0, 1, { laps: 2, lastLap: 2 })],
        driverChanges: [change(0, 1, { atStop: true })],
      })
    );

    expect(db.races.carLaps(raceId, 0)).toMatchObject([
      { lap: 1, lapTime: 211.25, driver: 'Somebody Else' },
    ]);
    expect(db.races.carStints(raceId, 0)).toMatchObject([
      { ordinal: 1, laps: 2, lastLap: 2 },
    ]);
    expect(db.races.driverChanges(raceId)).toMatchObject([{ atStop: true }]);
    expect(countRows('race_lap')).toBe(1);
    expect(countRows('race_stint')).toBe(1);
    expect(countRows('race_driver_change')).toBe(1);
  });

  it('carries a race on under another run’s token, in the row it has', () => {
    const before = db.races.write(raceBatch({ laps: [raceLap(0, 1)] }));

    // After a restart: another token, and the row the race was found in.
    const after = db.races.write(
      raceBatch({
        raceId: before.raceId,
        token: 'boot2:1',
        info: raceInfo({ updatedAt: T0 + 9 * MINUTE }),
        laps: [raceLap(0, 4)],
      })
    );
    // And from then on by the new token alone.
    const later = db.races.write(
      raceBatch({ token: 'boot2:1', laps: [raceLap(0, 5)] })
    );

    expect(after.raceId).toBe(before.raceId);
    expect(later.raceId).toBe(before.raceId);
    expect(countRows('race')).toBe(1);
    expect(db.races.carLaps(before.raceId, 0).map((lap) => lap.lap)).toEqual([
      1, 4, 5,
    ]);
    expect(db.races.list()[0].startedAt).toBe(T0);
  });

  it('makes a new race when the row it was to carry on is gone', () => {
    const { raceId } = db.races.write(
      raceBatch({ raceId: 999, token: 'boot2:1', laps: [raceLap(0, 1)] })
    );

    expect(raceId).not.toBe(999);
    expect(db.races.list()).toHaveLength(1);
  });

  it('removes what is kept for a slot another car has taken, then writes the new car’s', () => {
    const { raceId } = db.races.write(
      raceBatch({
        laps: [raceLap(0, 1), raceLap(7, 1), raceLap(7, 2), raceLap(7, 3)],
        stints: [raceStint(0, 1), raceStint(7, 1)],
        driverChanges: [change(7, 1)],
      })
    );

    db.races.write(
      raceBatch({
        replacedCars: [7],
        laps: [raceLap(7, 1, { driver: 'The Newcomer' })],
      })
    );

    expect(db.races.carLaps(raceId, 7)).toMatchObject([
      { lap: 1, driver: 'The Newcomer' },
    ]);
    expect(db.races.carStints(raceId, 7)).toEqual([]);
    expect(db.races.driverChanges(raceId)).toEqual([]);
    // The other car is as it was.
    expect(db.races.carLaps(raceId, 0)).toHaveLength(1);
    expect(db.races.carStints(raceId, 0)).toHaveLength(1);
  });

  it('writes a batch whole or not at all', () => {
    const { raceId } = db.races.write(raceBatch({ laps: [raceLap(0, 1)] }));

    expect(() =>
      db.races.write(
        raceBatch({
          info: raceInfo({ updatedAt: T0 + MINUTE }),
          laps: [raceLap(0, 2), raceLap(0, 3)],
          // Not a list: the batch fails after its laps were written.
          stints: 12 as unknown as RaceStint[],
        })
      )
    ).toThrow();

    expect(db.races.carLaps(raceId, 0).map((lap) => lap.lap)).toEqual([1]);
    expect(db.races.list()[0].updatedAt).toBe(T0);
    // And the database is not left in a transaction.
    expect(db.races.write(raceBatch({ laps: [raceLap(0, 2)] })).raceId).toBe(
      raceId
    );
  });

  it('leaves out a row with no car or number rather than fail the rest', () => {
    const { raceId } = db.races.write(
      raceBatch({
        laps: [
          raceLap(0, 1),
          raceLap(-1, 2),
          raceLap(0, Number.NaN),
          raceLap(0.5, 3),
        ],
        stints: [raceStint(0, 1), raceStint(0, -3)],
        driverChanges: [change(0, 1), change(Number.NaN, 2)],
      })
    );

    expect(countRows('race_lap')).toBe(1);
    expect(countRows('race_stint')).toBe(1);
    expect(countRows('race_driver_change')).toBe(1);
    expect(db.races.carLaps(raceId, 0)).toHaveLength(1);
  });

  it('stores what it is given as what it should be, whatever it is', () => {
    // The rows arrive from another thread as data: a figure that is not a
    // number is kept as none, never as a string in a number's column.
    const { raceId } = db.races.write(
      raceBatch({
        laps: [
          raceLap(0, 1, {
            lapTime: '211' as unknown as number,
            flags: null as unknown as number,
            driver: 7 as unknown as string,
            compounds: ['soft'] as unknown as number[],
            energy: Number.POSITIVE_INFINITY,
          }),
        ],
        stints: [
          raceStint(0, 1, {
            openedBy: 'teleport' as unknown as RaceStint['openedBy'],
            closedBy: 'magic' as unknown as RaceStint['closedBy'],
          }),
        ],
      })
    );

    expect(db.races.carLaps(raceId, 0)[0]).toMatchObject({
      lapTime: null,
      flags: 0,
      driver: '',
      compounds: [-1, -1, -1, -1],
      energy: null,
    });
    expect(db.races.carStints(raceId, 0)[0]).toMatchObject({
      openedBy: 'joined',
      closedBy: null,
    });
  });
});

describe('the races kept', () => {
  const write = (index: number, overrides: Partial<RaceInfo> = {}) =>
    db.races.write(
      raceBatch({
        token: `boot${index}:1`,
        info: raceInfo({
          startedAt: T0 + index * 60 * MINUTE,
          updatedAt: T0 + index * 60 * MINUTE,
          ...overrides,
        }),
        laps: [raceLap(0, 1), raceLap(0, 2)],
        stints: [raceStint(0, 1)],
        driverChanges: [change(0, 1)],
      })
    ).raceId;

  it('are listed most recent first', () => {
    const first = write(1);
    const second = write(2);
    const third = write(3);

    expect(db.races.list().map((race) => race.id)).toEqual([
      third,
      second,
      first,
    ]);
    expect(db.races.list(2).map((race) => race.id)).toEqual([third, second]);
  });

  it('are the twenty most recent: an older one goes with every row of it', () => {
    expect(RACE_HISTORY_MAX_RACES).toBe(20);
    const ids: number[] = [];
    for (let index = 1; index <= RACE_HISTORY_MAX_RACES; index += 1) {
      ids.push(write(index));
    }
    expect(countRows('race')).toBe(20);
    expect(countRows('race_lap')).toBe(40);

    const result = db.races.write(
      raceBatch({
        token: 'boot21:1',
        info: raceInfo({ updatedAt: T0 + 21 * 60 * MINUTE }),
        laps: [raceLap(0, 1)],
      })
    );

    expect(result.removedRaces).toBe(1);
    expect(countRows('race')).toBe(20);
    // The oldest went, and its laps, stints and driver changes with it.
    expect(db.races.list().map((race) => race.id)).not.toContain(ids[0]);
    expect(db.races.load(ids[0])).toBeNull();
    expect(countRows('race_lap', `race_id = ${ids[0]}`)).toBe(0);
    expect(countRows('race_stint', `race_id = ${ids[0]}`)).toBe(0);
    expect(countRows('race_driver_change', `race_id = ${ids[0]}`)).toBe(0);
    expect(countRows('race_lap')).toBe(19 * 2 + 1);
    expect(countRows('race_stint')).toBe(19);
    // The others are whole.
    expect(db.races.carLaps(ids[1], 0)).toHaveLength(2);
  });

  it('do not lose one for being written to again: only a new race makes room', () => {
    const ids: number[] = [];
    for (let index = 1; index <= RACE_HISTORY_MAX_RACES; index += 1) {
      ids.push(write(index));
    }

    // More laps for the oldest of them, as a race carried on would get.
    const result = db.races.write(
      raceBatch({
        raceId: ids[0],
        token: 'boot99:1',
        info: raceInfo({ updatedAt: T0 + 30 * 60 * MINUTE }),
        laps: [raceLap(0, 3)],
      })
    );

    expect(result).toEqual({ raceId: ids[0], removedRaces: 0 });
    expect(countRows('race')).toBe(20);
    // And it is now the most recent, so the next race costs another one.
    expect(db.races.list()[0].id).toBe(ids[0]);
    db.races.write(
      raceBatch({
        token: 'boot100:1',
        info: raceInfo({ updatedAt: T0 + 31 * 60 * MINUTE }),
        laps: [raceLap(0, 1)],
      })
    );
    expect(db.races.list().map((race) => race.id)).not.toContain(ids[1]);
    expect(db.races.load(ids[0])?.laps).toHaveLength(3);
  });

  it('never cost the player a lap of their own', () => {
    const session = {
      token: 'run-1',
      simulator: 'lmu',
      sessionKey: '',
      trackId: 9,
      trackName: 'Laguna Seca',
      trackConfig: null,
      trackLengthM: 3590,
      carKey: 'Ferrari 296 LMGT3 Evo',
      carName: 'Kessel Racing #74',
      sessionType: 'Race',
      sessionName: 'Race',
    };
    db.recordLap(session, {
      lapNumber: 1,
      lapTime: 86.5,
      completedAt: T0,
      complete: false,
      pit: false,
      voided: false,
      own: true,
      incidents: null,
      fuelUsed: null,
      energyUsed: null,
      airTemp: null,
      trackTemp: null,
      curve: null,
    });

    for (let index = 1; index <= RACE_HISTORY_MAX_RACES + 5; index += 1) {
      write(index);
    }

    expect(db.stats()).toEqual({ sessions: 1, laps: 1 });
    // Nor does the lap library's own cap see a race's laps.
    expect(db.prune(1)).toBe(0);
    expect(countRows('race_lap')).toBe(40);
  });
});

describe('finding a race to carry on', () => {
  it('offers the most recent races of the simulator, track and kind of session', () => {
    const write = (
      token: string,
      minutes: number,
      overrides: Partial<RaceInfo> = {}
    ) =>
      db.races.write(
        raceBatch({
          token,
          info: raceInfo({ updatedAt: T0 + minutes * MINUTE, ...overrides }),
          laps: [raceLap(0, 1), raceLap(0, 2), raceLap(7, 1)],
        })
      ).raceId;
    const older = write('a:1', 10);
    const newer = write('b:1', 50);
    write('c:1', 60, { trackId: 18 });
    write('d:1', 70, { simulator: 'iracing' });
    write('e:1', 80, { sessionType: 'Practice' });

    const found = db.races.candidates('lmu', 694510461, 'Race');

    expect(found.map((candidate) => candidate.info.id)).toEqual([newer, older]);
    expect(found[0].lastLaps).toEqual([
      { carIdx: 0, lap: 2 },
      { carIdx: 7, lap: 1 },
    ]);
    expect(found[0].info).toMatchObject({
      simulator: 'lmu',
      sessionType: 'Race',
      updatedAt: T0 + 50 * MINUTE,
    });
    expect(found[0].info.entries).toEqual(raceInfo().entries);
    expect(db.races.candidates('lmu', 694510461, 'Race', 1)).toHaveLength(1);
    expect(db.races.candidates('lmu', 12345, 'Race')).toEqual([]);
  });

  it('reads an entry list it cannot make sense of as an empty one', () => {
    const { raceId } = db.races.write(raceBatch({ laps: [raceLap(0, 1)] }));
    db.close();
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE race SET entries = 'not json', tyres = '{}'").run();
    raw.close();
    db = new LapLibraryDatabase(file);

    expect(db.races.list()).toMatchObject([
      { id: raceId, entries: [], tyres: [] },
    ]);
  });
});
