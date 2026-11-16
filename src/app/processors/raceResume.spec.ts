import { describe, expect, it } from 'vitest';
import type { RaceEntry, RaceInfo, StoredRaceState } from '@irdashies/types';
import {
  isSameRace,
  RACE_RESUME_MAX_AWAY_MS,
  type LiveRaceState,
} from './raceResume';

const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);

const entry = (
  carIdx: number,
  overrides: Partial<RaceEntry> = {}
): RaceEntry => ({
  carIdx,
  carNumber: `${carIdx + 50}`,
  car: carIdx < 2 ? 'oreca07.veh' : 'ferrari296.veh',
  classId: carIdx < 2 ? 3 : 5,
  className: carIdx < 2 ? 'LMP2' : 'LMGT3',
  teamName: `Team ${carIdx}`,
  ...overrides,
});

const info = (overrides: Partial<RaceInfo> = {}): RaceInfo => ({
  id: null,
  simulator: 'lmu',
  sessionKey: '',
  sessionNum: 10,
  sessionType: 'Race',
  sessionName: 'Race',
  trackId: 694510461,
  trackName: 'Circuit de la Sarthe',
  trackConfig: null,
  trackLengthM: 13626,
  startedAt: T0,
  updatedAt: T0,
  sessionTime: 0,
  entries: [entry(0), entry(1), entry(2), entry(3)],
  tyres: [],
  ...overrides,
});

/** A race left three hours in, at lap 50 for the leader. */
const stored = (overrides: Partial<RaceInfo> = {}): StoredRaceState => ({
  info: info({
    id: 12,
    updatedAt: T0 + 3 * 3_600_000,
    sessionTime: 10_800,
    ...overrides,
  }),
  lastLaps: [
    { carIdx: 0, lap: 50 },
    { carIdx: 1, lap: 49 },
    { carIdx: 2, lap: 46 },
    { carIdx: 3, lap: 45 },
  ],
});

/** The same race two minutes later, as the app comes back to it. */
const live = (overrides: Partial<LiveRaceState> = {}): LiveRaceState => ({
  info: info(),
  lapsCompleted: [50, 50, 46, 45],
  sessionTime: 10_920,
  now: T0 + 3 * 3_600_000 + 120_000,
  ...overrides,
});

const reasonOf = (kept: StoredRaceState, now: LiveRaceState): string => {
  const verdict = isSameRace(kept, now);
  return verdict.same ? '' : verdict.reason;
};

describe('isSameRace', () => {
  it('carries on a race that is where it was left, or further on', () => {
    expect(isSameRace(stored(), live())).toEqual({ same: true });
    // Hours of it driven with the app shut.
    expect(
      isSameRace(
        stored(),
        live({
          lapsCompleted: [110, 109, 101, 99],
          sessionTime: 24_000,
          now: T0 + 7 * 3_600_000,
        })
      )
    ).toEqual({ same: true });
  });

  it('is not the same under another simulator, at another track or in another kind of session', () => {
    expect(
      reasonOf(stored(), live({ info: info({ simulator: 'iracing' }) }))
    ).toBe('another simulator');
    expect(reasonOf(stored(), live({ info: info({ trackId: 18 }) }))).toBe(
      'another track'
    );
    expect(
      reasonOf(stored(), live({ info: info({ trackConfig: 'Mulsanne' }) }))
    ).toBe('another track');
    expect(
      reasonOf(
        stored(),
        live({ info: info({ sessionType: 'Practice', sessionNum: 1 }) })
      )
    ).toBe('another kind of session');
    expect(reasonOf(stored(), live({ info: info({ sessionNum: 11 }) }))).toBe(
      'another kind of session'
    );
  });

  it('is not the same with another car in a slot', () => {
    const others = [
      entry(0),
      entry(1),
      entry(2),
      entry(3, { carNumber: '777', car: 'bmwm4.veh' }),
    ];

    expect(reasonOf(stored(), live({ info: info({ entries: others }) }))).toBe(
      'another entry list'
    );
  });

  it('is the same whoever drives the cars and whatever the teams are called', () => {
    // The entry list holds no driver, and a team's name can come from LMU's
    // REST API one time and from the entry's own name the next.
    const renamed = info({
      entries: [0, 1, 2, 3].map((carIdx) =>
        entry(carIdx, { teamName: 'Somebody Else Racing 2026' })
      ),
    });

    expect(isSameRace(stored(), live({ info: renamed }))).toEqual({
      same: true,
    });
  });

  it('is the same with a car gone or a car joined, while most of the field is there', () => {
    const oneGone = info({ entries: [entry(0), entry(1), entry(2)] });
    const oneJoined = info({
      entries: [entry(0), entry(1), entry(2), entry(3), entry(4)],
    });

    expect(isSameRace(stored(), live({ info: oneGone }))).toEqual({
      same: true,
    });
    expect(isSameRace(stored(), live({ info: oneJoined }))).toEqual({
      same: true,
    });
  });

  it('is not the same with fewer than half the cars that were kept, or none', () => {
    expect(
      reasonOf(stored(), live({ info: info({ entries: [entry(0)] }) }))
    ).toBe('another entry list');
    expect(reasonOf(stored(), live({ info: info({ entries: [] }) }))).toBe(
      'another entry list'
    );
    // Other slots altogether.
    expect(
      reasonOf(
        stored(),
        live({ info: info({ entries: [entry(7), entry(8), entry(9)] }) })
      )
    ).toBe('another entry list');
  });

  it('is not the same when a car has fewer laps than were kept for it', () => {
    expect(reasonOf(stored(), live({ lapsCompleted: [50, 50, 46, 44] }))).toBe(
      'car 3 has completed 44 laps and 45 were kept'
    );
    // A race begun again from the grid.
    expect(reasonOf(stored(), live({ lapsCompleted: [0, 0, 0, 0] }))).toMatch(
      /^car 0 has completed 0 laps/
    );
  });

  it('does not count a slot with no car in it now as a car with fewer laps', () => {
    expect(
      isSameRace(stored(), live({ lapsCompleted: [50, 50, -1, 45] }))
    ).toEqual({ same: true });
    expect(isSameRace(stored(), live({ lapsCompleted: [50, 50] }))).toEqual({
      same: true,
    });
  });

  it('is not the same when the session clock is behind the one kept', () => {
    expect(reasonOf(stored(), live({ sessionTime: 10_700 }))).toBe(
      'the session clock is behind the one kept'
    );
    // Within what one frame and the next can differ by, it is.
    expect(isSameRace(stored(), live({ sessionTime: 10_799 }))).toEqual({
      same: true,
    });
  });

  it('is not the same when it was left far longer ago than its clock moved on', () => {
    // The same grid at the same track the next evening, already past where
    // the other race was left.
    const nextDay = live({ now: T0 + 27 * 3_600_000 });

    expect(reasonOf(stored(), nextDay)).toBe('it was left too long ago');
    // A paused race picked up after a long break is still that race.
    expect(
      isSameRace(
        stored(),
        live({ now: T0 + 3 * 3_600_000 + RACE_RESUME_MAX_AWAY_MS })
      )
    ).toEqual({ same: true });
  });

  describe('where the sim names the session', () => {
    const named = (key: string, overrides: Partial<RaceInfo> = {}) =>
      info({
        simulator: 'iracing',
        sessionKey: key,
        sessionNum: 2,
        ...overrides,
      });

    it('goes by the name', () => {
      const kept = stored({
        simulator: 'iracing',
        sessionKey: '48213:2',
        sessionNum: 2,
      });

      expect(isSameRace(kept, live({ info: named('48213:2') }))).toEqual({
        same: true,
      });
      expect(reasonOf(kept, live({ info: named('48214:2') }))).toBe(
        'another session by the sim’s own id'
      );
      // A test session, which has no name, is not the event that had one.
      expect(reasonOf(kept, live({ info: named('') }))).toBe(
        'another session by the sim’s own id'
      );
    });

    it('carries on whoever is in the session by now, and however long it was left', () => {
      const kept = stored({
        simulator: 'iracing',
        sessionKey: '48213:2',
        sessionNum: 2,
      });

      expect(
        isSameRace(
          kept,
          live({
            info: named('48213:2', { entries: [entry(9)] }),
            now: T0 + 40 * 3_600_000,
          })
        )
      ).toEqual({ same: true });
    });

    it('still is not the same with fewer laps or an earlier clock', () => {
      const kept = stored({
        simulator: 'iracing',
        sessionKey: '48213:2',
        sessionNum: 2,
      });

      expect(
        reasonOf(
          kept,
          live({ info: named('48213:2'), lapsCompleted: [3, 3, 3, 3] })
        )
      ).toMatch(/has completed 3 laps/);
      expect(
        reasonOf(kept, live({ info: named('48213:2'), sessionTime: 60 }))
      ).toBe('the session clock is behind the one kept');
    });
  });
});
