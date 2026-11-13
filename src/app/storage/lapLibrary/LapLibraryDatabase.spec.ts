import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type {
  LapCurve,
  LapInput,
  LapSessionInput,
} from '../../../types/lapLibrary';
import { LapLibraryDatabase, isEligibleLap } from './LapLibraryDatabase';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 13, 16, 0, 0);

const curve = (lapTime: number, points = 100): LapCurve => {
  const pointPos = new Float32Array(points);
  const times = new Float32Array(points);
  const speedsKph = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    pointPos[index] = (index + 0.3) / points;
    times[index] = pointPos[index] * lapTime;
    speedsKph[index] = 150 + index;
  }
  return { interval: 1 / points, pointPos, times, speedsKph };
};

const session = (
  overrides: Partial<LapSessionInput> = {}
): LapSessionInput => ({
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
  ...overrides,
});

const lap = (lapTime: number, overrides: Partial<LapInput> = {}): LapInput => ({
  lapNumber: 1,
  lapTime,
  completedAt: T0,
  complete: true,
  pit: false,
  voided: false,
  own: true,
  incidents: 0,
  fuelUsed: 2.4,
  energyUsed: 0.021,
  airTemp: 21,
  trackTemp: 30,
  curve: curve(lapTime),
  ...overrides,
});

let db: LapLibraryDatabase;

beforeEach(() => {
  db = new LapLibraryDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('isEligibleLap', () => {
  it('takes a complete lap the player drove cleanly', () => {
    expect(isEligibleLap(lap(90))).toBe(true);
    // A sim that counts no incidents has none to hold against the lap.
    expect(isEligibleLap(lap(90, { incidents: null }))).toBe(true);
  });

  it('refuses anything in doubt', () => {
    expect(isEligibleLap(lap(90, { pit: true }))).toBe(false);
    expect(isEligibleLap(lap(90, { voided: true }))).toBe(false);
    expect(isEligibleLap(lap(90, { own: false }))).toBe(false);
    expect(isEligibleLap(lap(90, { incidents: 1 }))).toBe(false);
    expect(isEligibleLap(lap(90, { complete: false }))).toBe(false);
    expect(isEligibleLap(lap(90, { curve: null }))).toBe(false);
  });
});

describe('LapLibraryDatabase recording', () => {
  it('starts empty', () => {
    expect(db.listSessions()).toEqual([]);
    expect(db.stats()).toEqual({ sessions: 0, laps: 0 });
  });

  it('keeps a lap under its session, with what was recorded about it', () => {
    const { sessionId, lapId, eligible } = db.recordLap(session(), lap(90.5));

    expect(eligible).toBe(true);
    const [listed] = db.listSessions();
    expect(listed).toMatchObject({
      id: sessionId,
      simulator: 'lmu',
      startedAt: T0,
      trackId: 9,
      trackName: 'Laguna Seca',
      trackConfig: null,
      trackLengthM: 3590,
      carKey: 'Ferrari 296 LMGT3 Evo',
      carName: 'Kessel Racing #74',
      sessionType: 'Race',
      lapCount: 1,
      bestLapTime: 90.5,
    });
    expect(db.listLaps(sessionId)).toEqual([
      {
        id: lapId,
        sessionId,
        lapNumber: 1,
        lapTime: 90.5,
        completedAt: T0,
        complete: true,
        pit: false,
        voided: false,
        own: true,
        incidents: 0,
        eligible: true,
        fuelUsed: 2.4,
        energyUsed: 0.021,
        airTemp: 21,
        trackTemp: 30,
        isReference: true,
        isPinned: false,
      },
    ]);
  });

  it('puts laps sharing a token in one session, in the order driven', () => {
    const first = db.recordLap(session(), lap(92, { completedAt: T0 }));
    db.recordLap(
      session(),
      lap(90, { lapNumber: 2, completedAt: T0 + 90_000 })
    );
    db.recordLap(
      session(),
      lap(91, { lapNumber: 3, completedAt: T0 + 181_000 })
    );

    expect(db.stats()).toEqual({ sessions: 1, laps: 3 });
    expect(db.listLaps(first.sessionId).map((row) => row.lapTime)).toEqual([
      92, 90, 91,
    ]);
    expect(db.listSessions()[0]).toMatchObject({
      lapCount: 3,
      bestLapTime: 90,
      // The session began with its first lap, not its latest.
      startedAt: T0,
    });
  });

  it('starts a new session for a new token', () => {
    db.recordLap(session({ token: 'run-1' }), lap(90));
    db.recordLap(
      session({ token: 'run-2', sessionType: 'Practice' }),
      lap(91, { completedAt: T0 + HOUR })
    );

    const listed = db.listSessions();
    expect(listed.map((row) => row.sessionType)).toEqual(['Practice', 'Race']);
  });

  it('rejoins the same session of the sim after the app is restarted', () => {
    const keyed = { sessionKey: '48213:2' };
    const before = db.recordLap(
      session({ token: 'boot-1', ...keyed }),
      lap(92)
    );

    // A new token, as a restarted app would make, but the sim's own session
    // identity, track and car are the same.
    const after = db.recordLap(
      session({ token: 'boot-2', ...keyed }),
      lap(90, { lapNumber: 2, completedAt: T0 + 10 * 60_000 })
    );

    expect(after.sessionId).toBe(before.sessionId);
    expect(db.stats()).toEqual({ sessions: 1, laps: 2 });
    // And keeps going there under the new token.
    const third = db.recordLap(
      session({ token: 'boot-2', ...keyed }),
      lap(91, { lapNumber: 3, completedAt: T0 + 12 * 60_000 })
    );
    expect(third.sessionId).toBe(before.sessionId);
  });

  it('does not rejoin on a sim identity it cannot trust, or a stale one', () => {
    // No identity at all: iRacing test sessions all report 0.
    db.recordLap(session({ token: 'a', sessionKey: '' }), lap(92));
    db.recordLap(
      session({ token: 'b', sessionKey: '' }),
      lap(90, { completedAt: T0 + 60_000 })
    );
    expect(db.stats().sessions).toBe(2);

    // The same identity a day later is another session.
    db.recordLap(session({ token: 'c', sessionKey: '7:0' }), lap(92));
    db.recordLap(
      session({ token: 'd', sessionKey: '7:0' }),
      lap(90, { completedAt: T0 + 13 * HOUR })
    );
    expect(db.stats().sessions).toBe(4);

    // And a different car is never the same session.
    db.recordLap(
      session({ token: 'e', sessionKey: '7:0', carKey: 'Porsche 963' }),
      lap(88, { completedAt: T0 + 13 * HOUR + 60_000 })
    );
    expect(db.stats().sessions).toBe(5);
  });

  it('stores an incomplete lap without a curve', () => {
    const { sessionId, eligible } = db.recordLap(
      session(),
      lap(95, { complete: false, curve: null, pit: true })
    );

    expect(eligible).toBe(false);
    expect(db.listLaps(sessionId)[0]).toMatchObject({
      complete: false,
      pit: true,
      eligible: false,
      isReference: false,
    });
    // Not a lap time to hold up as the session's best.
    expect(db.listSessions()[0].bestLapTime).toBeNull();
  });

  it('does not count a voided lap as the best of its session', () => {
    // The sim took the lap away. Every other lap's gap is measured from the
    // session's best, so it has to be a lap that stands.
    db.recordLap(session(), lap(86.216));
    db.recordLap(session(), lap(85.902, { voided: true }));
    db.recordLap(session(), lap(86.744));

    expect(db.listSessions()[0].bestLapTime).toBe(86.216);
  });

  it('keeps unknowns as unknown rather than zero', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(90, {
        lapNumber: null,
        incidents: null,
        fuelUsed: null,
        energyUsed: null,
        airTemp: null,
        trackTemp: null,
      })
    );

    expect(db.listLaps(sessionId)[0]).toMatchObject({
      lapNumber: null,
      incidents: null,
      fuelUsed: null,
      energyUsed: null,
      airTemp: null,
      trackTemp: null,
    });
  });
});

describe('LapLibraryDatabase reference lap', () => {
  const key = ['lmu', 9, 'Ferrari 296 LMGT3 Evo'] as const;

  it('is the quickest eligible lap for the track and car', () => {
    db.recordLap(session(), lap(92));
    const quick = db.recordLap(session(), lap(90, { completedAt: T0 + 1 }));
    db.recordLap(session(), lap(91, { completedAt: T0 + 2 }));

    const reference = db.referenceLap(...key);

    expect(reference?.lapId).toBe(quick.lapId);
    expect(reference?.lapTime).toBe(90);
    expect(reference?.pinned).toBe(false);
  });

  it('hands the curve back as it went in', () => {
    const stored = curve(90);
    db.recordLap(session(), lap(90, { curve: stored }));

    const reference = db.referenceLap(...key);

    expect(reference?.curve.interval).toBeCloseTo(0.01, 6);
    expect(reference?.curve.pointPos).toEqual(stored.pointPos);
    expect(reference?.curve.times).toEqual(stored.times);
    expect(reference?.curve.speedsKph).toEqual(stored.speedsKph);
  });

  it('works for a lap recorded without speeds', () => {
    db.recordLap(
      session(),
      lap(90, { curve: { ...curve(90), speedsKph: null } })
    );

    expect(db.referenceLap(...key)?.curve.speedsKph).toBeNull();
  });

  it('passes over quicker laps that are not eligible', () => {
    db.recordLap(session(), lap(85, { incidents: 2 }));
    db.recordLap(session(), lap(86, { voided: true }));
    db.recordLap(session(), lap(87, { own: false }));
    db.recordLap(session(), lap(88, { pit: true }));
    const clean = db.recordLap(session(), lap(90));

    expect(db.referenceLap(...key)?.lapId).toBe(clean.lapId);
  });

  it('is kept apart by simulator, track and car', () => {
    db.recordLap(session(), lap(90));
    db.recordLap(session({ token: 'b', simulator: 'iracing' }), lap(80));
    db.recordLap(session({ token: 'c', trackId: 10 }), lap(81));
    db.recordLap(session({ token: 'd', carKey: 'Porsche 963' }), lap(82));

    expect(db.referenceLap(...key)?.lapTime).toBe(90);
    expect(db.referenceLap('iracing', 9, key[2])?.lapTime).toBe(80);
    expect(db.referenceLap('lmu', 10, key[2])?.lapTime).toBe(81);
    expect(db.referenceLap('lmu', 9, 'Porsche 963')?.lapTime).toBe(82);
    expect(db.referenceLap('lmu', 11, key[2])).toBeNull();
  });

  it('spans every session on that track in that car', () => {
    db.recordLap(session({ token: 'monday' }), lap(89));
    db.recordLap(
      session({ token: 'friday' }),
      lap(90, { completedAt: T0 + 96 * HOUR })
    );

    expect(db.referenceLap(...key)?.lapTime).toBe(89);
  });

  it('only offers a lap with the number of points asked for', () => {
    // The quicker lap was recorded against a different track length.
    db.recordLap(session(), lap(88, { curve: curve(88, 120) }));
    const fits = db.recordLap(session(), lap(90, { curve: curve(90, 100) }));

    expect(db.referenceLap(...key, 100)?.lapId).toBe(fits.lapId);
    expect(db.referenceLap(...key, 120)?.lapTime).toBe(88);
    expect(db.referenceLap(...key, 77)).toBeNull();
    // Unasked, the quickest wins whatever its length.
    expect(db.referenceLap(...key)?.lapTime).toBe(88);
  });

  it('moves to the next quickest when the reference is deleted', () => {
    db.recordLap(session(), lap(92));
    const quick = db.recordLap(session(), lap(90));
    const next = db.recordLap(session(), lap(91));

    expect(db.deleteLap(quick.lapId)).toBe(true);

    expect(db.referenceLap(...key)?.lapId).toBe(next.lapId);
  });

  it('marks the reference in the lap list', () => {
    const { sessionId } = db.recordLap(session(), lap(92));
    db.recordLap(session(), lap(90));

    expect(db.listLaps(sessionId).map((row) => row.isReference)).toEqual([
      false,
      true,
    ]);
  });
});

describe('LapLibraryDatabase pinning', () => {
  const key = ['lmu', 9, 'Ferrari 296 LMGT3 Evo'] as const;

  it('makes a chosen lap the reference over a quicker one', () => {
    const chosen = db.recordLap(session(), lap(92));
    db.recordLap(session(), lap(90));

    expect(db.pinReference(chosen.lapId)).toBe(true);

    const reference = db.referenceLap(...key);
    expect(reference?.lapId).toBe(chosen.lapId);
    expect(reference?.pinned).toBe(true);
    expect(
      db
        .listLaps(chosen.sessionId)
        .map((row) => [row.isReference, row.isPinned])
    ).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('holds against a quicker lap set afterwards', () => {
    const chosen = db.recordLap(session(), lap(92));
    db.pinReference(chosen.lapId);

    db.recordLap(session(), lap(88));

    expect(db.referenceLap(...key)?.lapId).toBe(chosen.lapId);
  });

  it('lets a lap that is not eligible be chosen by hand', () => {
    // An incident the player knows cost time, say. Their call.
    const flagged = db.recordLap(session(), lap(89, { incidents: 1 }));
    db.recordLap(session(), lap(90));

    expect(db.pinReference(flagged.lapId)).toBe(true);
    expect(db.referenceLap(...key)?.lapId).toBe(flagged.lapId);
  });

  it('refuses a lap with no curve, and a lap that does not exist', () => {
    const partial = db.recordLap(
      session(),
      lap(95, { complete: false, curve: null })
    );

    expect(db.pinReference(partial.lapId)).toBe(false);
    expect(db.pinReference(9999)).toBe(false);
  });

  it('moves the pin when another lap is chosen', () => {
    const first = db.recordLap(session(), lap(92));
    const second = db.recordLap(session(), lap(93));
    db.pinReference(first.lapId);

    db.pinReference(second.lapId);

    expect(db.referenceLap(...key)?.lapId).toBe(second.lapId);
  });

  it('goes back to the quickest lap when unpinned', () => {
    const chosen = db.recordLap(session(), lap(92));
    const quick = db.recordLap(session(), lap(90));
    db.pinReference(chosen.lapId);

    // Unpinning by any lap of that track and car clears the pin.
    expect(db.unpinReference(quick.lapId)).toBe(true);

    const reference = db.referenceLap(...key);
    expect(reference?.lapId).toBe(quick.lapId);
    expect(reference?.pinned).toBe(false);
    expect(db.unpinReference(quick.lapId)).toBe(false);
  });

  it('drops the pin with the lap it points at', () => {
    const chosen = db.recordLap(session(), lap(92));
    const quick = db.recordLap(session(), lap(90));
    db.pinReference(chosen.lapId);

    db.deleteLap(chosen.lapId);

    expect(db.referenceLap(...key)?.lapId).toBe(quick.lapId);
  });

  it('ignores a pinned lap of the wrong length when a length is asked for', () => {
    const chosen = db.recordLap(session(), lap(92, { curve: curve(92, 120) }));
    const fits = db.recordLap(session(), lap(93));
    db.pinReference(chosen.lapId);

    expect(db.referenceLap(...key, 100)?.lapId).toBe(fits.lapId);
  });

  it('pins per track and car', () => {
    const here = db.recordLap(session(), lap(92));
    db.recordLap(session(), lap(90));
    const there = db.recordLap(session({ token: 'b', trackId: 10 }), lap(80));
    db.pinReference(here.lapId);

    expect(db.referenceLap('lmu', 10, key[2])?.lapId).toBe(there.lapId);
    expect(db.referenceLap('lmu', 10, key[2])?.pinned).toBe(false);
  });
});

describe('LapLibraryDatabase deleting', () => {
  it('deletes one lap and leaves the rest', () => {
    const first = db.recordLap(session(), lap(92));
    const second = db.recordLap(session(), lap(90));

    expect(db.deleteLap(first.lapId)).toBe(true);

    expect(db.listLaps(first.sessionId).map((row) => row.id)).toEqual([
      second.lapId,
    ]);
    expect(db.deleteLap(first.lapId)).toBe(false);
  });

  it('removes a session when its last lap goes', () => {
    const only = db.recordLap(session(), lap(92));

    db.deleteLap(only.lapId);

    expect(db.stats()).toEqual({ sessions: 0, laps: 0 });
  });

  it('deletes a session with every lap in it', () => {
    const kept = db.recordLap(session({ token: 'keep' }), lap(91));
    const gone = db.recordLap(session({ token: 'drop' }), lap(92));
    db.recordLap(session({ token: 'drop' }), lap(93));

    expect(db.deleteSession(gone.sessionId)).toBe(true);

    expect(db.stats()).toEqual({ sessions: 1, laps: 1 });
    expect(db.listLaps(gone.sessionId)).toEqual([]);
    expect(db.listSessions()[0].id).toBe(kept.sessionId);
    expect(db.deleteSession(gone.sessionId)).toBe(false);
  });

  it('starts a fresh session if laps arrive for one that was deleted', () => {
    const before = db.recordLap(session(), lap(92));
    db.deleteSession(before.sessionId);

    const after = db.recordLap(session(), lap(90));

    expect(after.sessionId).not.toBe(before.sessionId);
    expect(db.listLaps(after.sessionId)).toHaveLength(1);
  });
});

describe('LapLibraryDatabase listing', () => {
  it('lists sessions most recent first, in pages', () => {
    for (let index = 0; index < 5; index += 1) {
      db.recordLap(
        session({ token: `run-${index}`, sessionName: `S${index}` }),
        lap(90, { completedAt: T0 + index * HOUR })
      );
    }

    expect(db.listSessions().map((row) => row.sessionName)).toEqual([
      'S4',
      'S3',
      'S2',
      'S1',
      'S0',
    ]);
    expect(db.listSessions(2, 0).map((row) => row.sessionName)).toEqual([
      'S4',
      'S3',
    ]);
    expect(db.listSessions(2, 4).map((row) => row.sessionName)).toEqual(['S0']);
  });

  it('has no laps for a session that does not exist', () => {
    expect(db.listLaps(404)).toEqual([]);
  });
});

describe('LapLibraryDatabase pruning', () => {
  it('does nothing under the cap', () => {
    db.recordLap(session(), lap(90));

    expect(db.prune(10)).toBe(0);
    expect(db.stats().laps).toBe(1);
  });

  it('drops the oldest laps beyond the cap', () => {
    const ids: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      ids.push(
        db.recordLap(
          session(),
          // Slower as they go, so the first lap is the reference.
          lap(90 + index, { completedAt: T0 + index * 100_000 })
        ).lapId
      );
    }

    expect(db.prune(3)).toBe(3);

    // The oldest three went, except the reference, which is the very oldest:
    // the fourth-oldest went in its place.
    const kept = db.listLaps(db.listSessions()[0].id).map((row) => row.id);
    expect(kept).toEqual([ids[0], ids[4], ids[5]]);
  });

  it('never drops a pinned lap', () => {
    const pinned = db.recordLap(session(), lap(99, { completedAt: T0 }));
    db.pinReference(pinned.lapId);
    for (let index = 1; index <= 4; index += 1) {
      db.recordLap(session(), lap(90 + index, { completedAt: T0 + index }));
    }

    db.prune(2);

    const kept = db.listLaps(pinned.sessionId).map((row) => row.id);
    expect(kept).toContain(pinned.lapId);
  });

  it('removes sessions left with no laps', () => {
    db.recordLap(session({ token: 'old' }), lap(95, { completedAt: T0 }));
    db.recordLap(session({ token: 'old' }), lap(96, { completedAt: T0 + 1 }));
    db.recordLap(
      session({ token: 'new', trackId: 10 }),
      lap(80, { completedAt: T0 + HOUR })
    );
    db.recordLap(
      session({ token: 'new', trackId: 10 }),
      lap(81, { completedAt: T0 + HOUR + 1 })
    );

    // Each track keeps its reference; the other two laps are the oldest.
    db.prune(2);

    expect(db.stats()).toEqual({ sessions: 2, laps: 2 });
  });
});

describe('LapLibraryDatabase on disk', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-laps-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps laps across a close and reopen', () => {
    const file = path.join(directory, 'laps.db');
    const first = new LapLibraryDatabase(file);
    const { sessionId } = first.recordLap(session(), lap(90.123));
    first.close();

    const second = new LapLibraryDatabase(file);
    expect(second.listLaps(sessionId)[0].lapTime).toBe(90.123);
    expect(
      second.referenceLap('lmu', 9, 'Ferrari 296 LMGT3 Evo')?.curve.times
    ).toEqual(curve(90.123).times);
    second.close();
  });

  it('refuses a database written by a newer build', () => {
    const file = path.join(directory, 'laps.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    // Reading it with this schema would be guessing.
    expect(() => new LapLibraryDatabase(file)).toThrow(/newer/);
  });
});
