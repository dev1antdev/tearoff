import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  TrackNote,
  TrackProfile,
  TrackProfileKey,
  TrackProfileLap,
} from '@irdashies/types';
import logger from '../logger';
import {
  cleanTrackNotes,
  createTrackProfileStore,
  mergeProfileLap,
  parseTrackProfile,
  profileDemand,
  resampleElevation,
  trackProfileFileName,
  type TrackProfileStore,
} from './trackProfiles';

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const POINTS = 360;
const KEY: TrackProfileKey = {
  simulator: 'lmu',
  trackId: 694510461,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  pointsCount: POINTS,
};
const FILE = 'lmu_694510461.json';
const IRACING_KEY: TrackProfileKey = {
  simulator: 'iracing',
  trackId: 18,
  trackName: 'Road America',
  trackLengthM: 6413.5,
  pointsCount: 642,
};

const heights = (points: number, scale = 10, offset = 0): Float32Array =>
  Float32Array.from(
    { length: points },
    (_, bucket) => offset + scale * Math.sin((2 * Math.PI * bucket) / points)
  );

/** A clean lap as the recorder hands one over under Le Mans Ultimate. */
const recordedLap = (
  overrides: Partial<TrackProfileLap> = {}
): TrackProfileLap => ({
  source: 'recorded',
  elevationM: heights(POINTS),
  xM: heights(POINTS, 400),
  zM: heights(POINTS, -400),
  closureM: 0.2,
  sectorStartPct: [0, 0.39, 0.792],
  sectorSource: 'learned',
  ...overrides,
});

/** And under iRacing: heights added up, no position, the session's sectors. */
const integratedLap = (
  overrides: Partial<TrackProfileLap> = {}
): TrackProfileLap => ({
  source: 'integrated',
  elevationM: heights(IRACING_KEY.pointsCount, 25),
  xM: null,
  zM: null,
  closureM: 0.4,
  sectorStartPct: [0, 0.25, 0.6],
  sectorSource: 'session',
  ...overrides,
});

const note = (overrides: Partial<TrackNote> = {}): TrackNote => ({
  id: 'note-1',
  distanceM: 520,
  kind: 'track',
  text: 'Turn 2',
  comment: '',
  pit: false,
  ...overrides,
});

const merged = (
  existing: TrackProfile | null,
  lap: TrackProfileLap,
  key = KEY,
  now = 5000
): TrackProfile => {
  const profile = mergeProfileLap(existing, key, lap, now);
  if (!profile) throw new Error('The lap was refused');
  return profile;
};

describe('trackProfileFileName', () => {
  it('names a file after the simulator and the track', () => {
    expect(trackProfileFileName('lmu', 694510461)).toBe(FILE);
    expect(trackProfileFileName('iracing', 18)).toBe('iracing_18.json');
  });

  it('names none for anything a session could not have said', () => {
    for (const [simulator, trackId] of [
      ['../lmu', 1],
      ['lmu/..', 1],
      ['LMU', 1],
      ['', 1],
      ['lmu', 1.5],
      ['lmu', Number.NaN],
      ['lmu', '1'],
      [undefined, 1],
    ]) {
      expect(trackProfileFileName(simulator, trackId)).toBeNull();
    }
  });
});

describe('parseTrackProfile', () => {
  const stored = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(merged(null, recordedLap())));

  it('reads back what a lap left behind', () => {
    const profile = merged(null, recordedLap());

    expect(parseTrackProfile(stored(), 'lmu', KEY.trackId)).toEqual(profile);
  });

  it('refuses what is not a profile of this track', () => {
    for (const value of ['x', 42, null, [], {}, { version: '1' }]) {
      expect(parseTrackProfile(value, 'lmu', KEY.trackId)).toBeNull();
    }
    expect(parseTrackProfile(stored(), 'iracing', KEY.trackId)).toBeNull();
    expect(parseTrackProfile(stored(), 'lmu', 7)).toBeNull();
    expect(
      parseTrackProfile({ ...stored(), version: 0 }, 'lmu', KEY.trackId)
    ).toBeNull();
    // A bucket count that is not the length's.
    expect(
      parseTrackProfile({ ...stored(), pointsCount: 359 }, 'lmu', KEY.trackId)
    ).toBeNull();
    expect(
      parseTrackProfile({ ...stored(), trackLengthM: -1 }, 'lmu', KEY.trackId)
    ).toBeNull();
  });

  it('knows a file a newer build wrote from one it can read', () => {
    expect(
      parseTrackProfile({ ...stored(), version: 2 }, 'lmu', KEY.trackId)
    ).toBe('newer');
  });

  it('drops a damaged elevation and keeps the notes', () => {
    const damaged = {
      ...stored(),
      elevationM: [1, 2, 'three'],
      notes: [note()],
    };

    const profile = parseTrackProfile(damaged, 'lmu', KEY.trackId);
    expect(profile).toMatchObject({
      elevationM: null,
      elevationSource: null,
      elevationLaps: 0,
      xM: null,
      zM: null,
      notes: [note()],
      // The sector starts are their own part.
      sectorStartPct: [0, 0.39, 0.792],
      sectorSource: 'learned',
    });
  });

  it('keeps the elevation when only the line is damaged', () => {
    const profile = parseTrackProfile(
      { ...stored(), zM: null },
      'lmu',
      KEY.trackId
    ) as TrackProfile;

    expect(profile.elevationM).toHaveLength(POINTS);
    expect(profile.xM).toBeNull();
    expect(profile.zM).toBeNull();
  });

  it('falls back to no sector starts when they are not starts', () => {
    for (const sectorStartPct of [
      [0.1, 0.5],
      [0, 0.5, 0.4],
      [0, 1],
      'thirds',
    ]) {
      expect(
        parseTrackProfile({ ...stored(), sectorStartPct }, 'lmu', KEY.trackId)
      ).toMatchObject({ sectorStartPct: [], sectorSource: 'nominal' });
    }
  });

  it('leaves out malformed notes and cuts long ones', () => {
    const profile = parseTrackProfile(
      {
        ...stored(),
        notes: [
          note({ id: 'b', distanceM: 900 }),
          note({ id: 'a', distanceM: 100, text: 'x'.repeat(200) }),
          note({ id: 'off', distanceM: 4000 }),
          note({ id: 'b', distanceM: 950 }),
          { id: 'no-kind', distanceM: 5, text: '' },
          'not a note',
        ],
      },
      'lmu',
      KEY.trackId
    ) as TrackProfile;

    expect(profile.notes.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(profile.notes[0].text).toHaveLength(120);
  });
});

describe('cleanTrackNotes', () => {
  it('sorts by distance and cuts the comment too', () => {
    const notes = cleanTrackNotes(
      [
        note({ id: 'c', distanceM: 3000, comment: 'y'.repeat(600) }),
        note({ id: 'a', distanceM: 0 }),
        note({ id: 'b', distanceM: 3590.34, kind: 'pace', pit: true }),
        note({ id: 'd', distanceM: 3590.35 }),
        note({ id: 'e', distanceM: -1 }),
      ],
      KEY.trackLengthM
    );

    expect(notes.map(({ id }) => id)).toEqual(['a', 'c', 'b']);
    expect(notes[1].comment).toHaveLength(500);
    expect(notes[2]).toMatchObject({ kind: 'pace', pit: true });
  });

  it('gives nothing for what is not a list', () => {
    expect(cleanTrackNotes({ id: 'a' }, 100)).toEqual([]);
    expect(cleanTrackNotes(undefined, 100)).toEqual([]);
  });
});

describe('mergeProfileLap', () => {
  it('takes the first clean lap as the profile', () => {
    const profile = merged(null, recordedLap());

    expect(profile).toMatchObject({
      version: 1,
      simulator: 'lmu',
      trackId: KEY.trackId,
      trackName: KEY.trackName,
      trackLengthM: KEY.trackLengthM,
      pointsCount: POINTS,
      elevationSource: 'recorded',
      elevationLaps: 1,
      sectorStartPct: [0, 0.39, 0.792],
      sectorSource: 'learned',
      notes: [],
      updatedAt: 5000,
    });
    expect(profile.elevationM).toHaveLength(POINTS);
    expect(profile.xM).toHaveLength(POINTS);
    expect(profile.zM).toHaveLength(POINTS);
    // Kept to the centimetre.
    expect(profile.elevationM?.[90]).toBe(10);
    expect(profile.elevationM?.[1]).toBe(0.17);
  });

  it('refuses a lap that ends more than a metre from where it began', () => {
    expect(
      mergeProfileLap(null, KEY, recordedLap({ closureM: 2 }), 1)
    ).toBeNull();
    expect(
      mergeProfileLap(null, KEY, recordedLap({ closureM: 1.01 }), 1)
    ).toBeNull();
    expect(
      mergeProfileLap(null, KEY, recordedLap({ closureM: 1 }), 1)
    ).not.toBeNull();
    expect(
      mergeProfileLap(null, KEY, recordedLap({ closureM: Number.NaN }), 1)
    ).toBeNull();
  });

  it('refuses a lap that is not whole or not a number throughout', () => {
    expect(
      mergeProfileLap(
        null,
        KEY,
        recordedLap({ elevationM: heights(POINTS - 1) }),
        1
      )
    ).toBeNull();
    const holed = heights(POINTS);
    holed[40] = Number.NaN;
    expect(
      mergeProfileLap(null, KEY, recordedLap({ elevationM: holed }), 1)
    ).toBeNull();
    expect(
      mergeProfileLap(null, KEY, recordedLap({ xM: heights(12) }), 1)
    ).toBeNull();
  });

  it('refuses a lap for a track it cannot name a file for', () => {
    expect(
      mergeProfileLap(null, { ...KEY, simulator: '../lmu' }, recordedLap(), 1)
    ).toBeNull();
    expect(
      mergeProfileLap(null, { ...KEY, pointsCount: 361 }, recordedLap(), 1)
    ).toBeNull();
  });

  it('leaves a recorded profile alone, however good the next lap', () => {
    const first = merged(null, recordedLap());
    const second = recordedLap({
      elevationM: heights(POINTS, 10, 3),
      closureM: 0,
      sectorStartPct: [0, 0.4, 0.8],
    });

    expect(mergeProfileLap(first, KEY, second, 9000)).toBeNull();
  });

  it('takes the sector starts from a later lap when the first had none', () => {
    const first = merged(
      null,
      recordedLap({ sectorStartPct: null, sectorSource: null })
    );
    expect(first).toMatchObject({
      sectorStartPct: [],
      sectorSource: 'nominal',
    });

    const second = merged(
      first,
      recordedLap({ elevationM: heights(POINTS, 10, 3) }),
      KEY,
      9000
    );
    expect(second).toMatchObject({
      sectorStartPct: [0, 0.39, 0.792],
      sectorSource: 'learned',
      updatedAt: 9000,
    });
    // The elevation is still the first lap's.
    expect(second.elevationM).toEqual(first.elevationM);
  });

  it('ignores sector starts that are not in order', () => {
    const profile = merged(
      null,
      recordedLap({ sectorStartPct: [0, 0.8, 0.4] })
    );

    expect(profile).toMatchObject({
      sectorStartPct: [],
      sectorSource: 'nominal',
    });
  });

  it('replaces an imported elevation with a recorded one', () => {
    const imported: TrackProfile = {
      ...merged(null, recordedLap()),
      elevationM: Array.from({ length: POINTS }, () => 4),
      elevationSource: 'tinypedal',
      elevationLaps: 0,
      xM: null,
      zM: null,
      notes: [note()],
    };

    const profile = merged(imported, recordedLap());
    expect(profile.elevationSource).toBe('recorded');
    expect(profile.elevationM?.[90]).toBe(10);
    expect(profile.xM).toHaveLength(POINTS);
    expect(profile.notes).toEqual([note()]);
  });

  it('starts afresh for another length of the same track, with the notes', () => {
    const longer: TrackProfileKey = {
      ...KEY,
      trackLengthM: 3602,
      pointsCount: 361,
    };
    const existing: TrackProfile = {
      ...merged(null, recordedLap()),
      notes: [note({ id: 'kept', distanceM: 3595 }), note()],
    };
    const lap = recordedLap({
      elevationM: heights(361, 8),
      xM: heights(361),
      zM: heights(361),
      sectorStartPct: null,
      sectorSource: null,
    });

    const profile = merged(existing, lap, longer);
    expect(profile.pointsCount).toBe(361);
    expect(profile.elevationM).toHaveLength(361);
    // Sector starts learned at the old length do not carry over.
    expect(profile.sectorSource).toBe('nominal');
    expect(profile.notes.map(({ id }) => id)).toEqual(['note-1', 'kept']);
  });

  describe('for heights that were added up', () => {
    it('refuses a lap more than five metres out', () => {
      expect(
        mergeProfileLap(null, IRACING_KEY, integratedLap({ closureM: 6 }), 1)
      ).toBeNull();
      expect(
        mergeProfileLap(null, IRACING_KEY, integratedLap({ closureM: 5 }), 1)
      ).not.toBeNull();
    });

    it('keeps the mean of the first three laps and then stands', () => {
      const points = IRACING_KEY.pointsCount;
      const first = merged(null, integratedLap(), IRACING_KEY);
      expect(first).toMatchObject({
        elevationSource: 'integrated',
        elevationLaps: 1,
        xM: null,
        zM: null,
        sectorStartPct: [0, 0.25, 0.6],
        sectorSource: 'session',
      });

      const second = merged(
        first,
        integratedLap({ elevationM: heights(points, 25, 3) }),
        IRACING_KEY
      );
      expect(second.elevationLaps).toBe(2);
      expect(second.elevationM?.[0]).toBe(1.5);

      const third = merged(
        second,
        integratedLap({ elevationM: heights(points, 25, 6) }),
        IRACING_KEY
      );
      expect(third.elevationLaps).toBe(3);
      expect(third.elevationM?.[0]).toBe(3);
      expect(third.elevationM?.[Math.round(points / 4)]).toBeCloseTo(28, 1);

      expect(
        mergeProfileLap(
          third,
          IRACING_KEY,
          integratedLap({ elevationM: heights(points, 25, 90) }),
          1
        )
      ).toBeNull();
    });

    it("follows the session's sector starts when they change", () => {
      const settled = [
        integratedLap(),
        integratedLap(),
        integratedLap(),
      ].reduce<TrackProfile | null>(
        (profile, lap) => merged(profile, lap, IRACING_KEY),
        null
      );

      const moved = merged(
        settled,
        integratedLap({ sectorStartPct: [0, 0.3, 0.7] }),
        IRACING_KEY
      );
      expect(moved.sectorStartPct).toEqual([0, 0.3, 0.7]);
      // And nothing else did.
      expect(moved.elevationM).toEqual(settled?.elevationM);
      expect(moved.elevationLaps).toBe(3);
    });
  });
});

describe('profileDemand', () => {
  const recorded = merged(null, recordedLap());

  it('wants a first lap for a track with no elevation of its own', () => {
    expect(profileDemand(null, KEY, 'recorded')).toBe('first');
    expect(
      profileDemand(
        { ...recorded, elevationSource: 'tinypedal' },
        KEY,
        'recorded'
      )
    ).toBe('first');
    // Stored at another length: not this layout's.
    expect(
      profileDemand(
        recorded,
        { ...KEY, trackLengthM: 3602, pointsCount: 361 },
        'recorded'
      )
    ).toBe('first');
  });

  it('wants more only until the sector starts are learned', () => {
    expect(profileDemand(recorded, KEY, 'recorded')).toBe('none');
    expect(
      profileDemand(
        { ...recorded, sectorStartPct: [], sectorSource: 'nominal' },
        KEY,
        'recorded'
      )
    ).toBe('more');
  });

  it('wants three laps of heights that are added up', () => {
    const one = merged(null, integratedLap(), IRACING_KEY);

    expect(profileDemand(null, IRACING_KEY, 'integrated')).toBe('first');
    expect(profileDemand(one, IRACING_KEY, 'integrated')).toBe('more');
    expect(
      profileDemand({ ...one, elevationLaps: 2 }, IRACING_KEY, 'integrated')
    ).toBe('more');
    expect(
      profileDemand({ ...one, elevationLaps: 3 }, IRACING_KEY, 'integrated')
    ).toBe('none');
  });
});

describe('resampleElevation', () => {
  it('brings uneven pairs to one height a bucket, ends included', () => {
    // 300 pairs at uneven steps of 9 to 15 m, as a car leaves them.
    const pairs: [number, number][] = [];
    let distance = 0;
    for (let index = 0; index < 300; index += 1) {
      pairs.push([distance, 20 + distance / 100]);
      distance += 9 + (index % 7);
    }
    const last = pairs[pairs.length - 1];
    expect(last[0]).toBeGreaterThan(KEY.trackLengthM - 30);

    const resampled = resampleElevation(pairs, KEY) as number[];
    expect(resampled).toHaveLength(POINTS);
    expect(resampled[0]).toBe(20);
    // A straight line stays one: bucket 100 is 997.3 m into the lap.
    expect(resampled[100]).toBeCloseTo(29.97, 2);
    // Past the last pair its height stands.
    expect(resampled[POINTS - 1]).toBeCloseTo(
      Math.min(20 + (359 * KEY.trackLengthM) / POINTS / 100, last[1]),
      2
    );
  });

  it('takes the pairs in whatever order they come', () => {
    const resampled = resampleElevation(
      [
        [3000, 30],
        [0, 0],
        [1000, 10],
      ],
      KEY
    ) as number[];

    expect(resampled[50]).toBeCloseTo(4.99, 2);
  });

  it('gives nothing for fewer than two pairs', () => {
    expect(resampleElevation([], KEY)).toBeNull();
    expect(resampleElevation([[0, 1]], KEY)).toBeNull();
    expect(
      resampleElevation(
        [
          [0, 1],
          [Number.NaN, 2],
        ],
        KEY
      )
    ).toBeNull();
  });
});

describe('the track profile store', () => {
  let directory: string;
  let filePath: string;
  /** The store's clock, moved by hand. */
  let now: number;
  let nextId: number;
  let store: TrackProfileStore;

  const createStore = (maxFiles?: number) =>
    createTrackProfileStore(directory, {
      now: () => now,
      newId: () => `id-${(nextId += 1)}`,
      maxFiles,
    });
  const onDisk = async (file = filePath) =>
    JSON.parse(await fsp.readFile(file, 'utf8'));
  const files = async () =>
    (await fsp.readdir(path.join(directory, 'track-profiles'))).sort();
  const warnings = () =>
    vi.mocked(logger.warn).mock.calls.map(([message]) => message);
  /** Puts a file where the store keeps its own, before it has looked. */
  const plant = async (name: string, content: string) => {
    await fsp.mkdir(path.join(directory, 'track-profiles'), {
      recursive: true,
    });
    await fsp.writeFile(path.join(directory, 'track-profiles', name), content);
  };

  beforeEach(async () => {
    directory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'tearoff-track-profiles-')
    );
    filePath = path.join(directory, 'track-profiles', FILE);
    now = 1000;
    nextId = 0;
    store = createStore();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await store.flush();
    // directory is the exact mkdtemp result, never a real application profile.
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it('answers from memory, and says when the file has been read', async () => {
    await plant(FILE, JSON.stringify(merged(null, recordedLap())));

    // The first ask starts the read and cannot wait for it.
    expect(store.get('lmu', KEY.trackId)).toBeNull();
    const before = store.revision();
    const loaded = await store.whenLoaded('lmu', KEY.trackId);

    expect(store.revision()).toBeGreaterThan(before);
    expect(store.get('lmu', KEY.trackId)).toBe(loaded);
    expect(loaded?.elevationSource).toBe('recorded');
    // The same object for as long as the profile is the same.
    expect(store.load('lmu', KEY.trackId, POINTS)).toBe(loaded);
    // And nothing at another bucket count than the session's.
    expect(store.load('lmu', KEY.trackId, 361)).toBeNull();
  });

  it('has nothing for a track that was never driven', async () => {
    expect(await store.whenLoaded('lmu', 5)).toBeNull();
    expect(store.get('lmu', 5)).toBeNull();
    expect(store.get('../lmu', 5)).toBeNull();
    expect(warnings()).toEqual([]);
  });

  it('keeps a clean lap, in its own file, without making the caller wait', async () => {
    const before = store.revision();
    const recording = store.recordLap(KEY, recordedLap());

    // Handed over and not on disk yet: the write follows on its own time.
    await expect(fsp.access(filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await recording).toBe(true);
    expect(store.revision()).toBeGreaterThan(before);
    expect(store.get('lmu', KEY.trackId)?.elevationSource).toBe('recorded');

    await store.flush();
    expect(await files()).toEqual([FILE]);
    const written = await onDisk();
    expect(written).toMatchObject({
      version: 1,
      simulator: 'lmu',
      trackId: KEY.trackId,
      trackLengthM: KEY.trackLengthM,
      pointsCount: POINTS,
      elevationSource: 'recorded',
      sectorStartPct: [0, 0.39, 0.792],
      updatedAt: 1000,
    });
    expect(written.elevationM).toHaveLength(POINTS);
  });

  it('writes through a temporary file and a rename', async () => {
    const rename = vi.spyOn(fsp, 'rename');
    await store.recordLap(KEY, recordedLap());
    await store.flush();

    expect(rename).toHaveBeenCalledTimes(1);
    const [from, to] = rename.mock.calls[0];
    expect(to).toBe(filePath);
    expect(String(from)).toMatch(/lmu_694510461\.json\.\d+\.tmp$/);
    // Nothing left behind.
    expect(await files()).toEqual([FILE]);
  });

  it('leaves the old file whole when a write fails', async () => {
    await store.recordLap(KEY, recordedLap());
    await store.flush();
    const before = await fsp.readFile(filePath, 'utf8');

    vi.spyOn(fsp, 'rename').mockRejectedValue(
      Object.assign(new Error('busy'), { code: 'EBUSY' })
    );
    await store.saveNotes(KEY, [note()]);
    await store.flush();

    expect(await fsp.readFile(filePath, 'utf8')).toBe(before);
    expect(await files()).toEqual([FILE]);
    expect(warnings()).toContain('[TrackProfiles] Failed to write');
    // Still the profile for the rest of the run.
    expect(store.get('lmu', KEY.trackId)?.notes).toEqual([note()]);
  });

  it('reads back in another run what this one wrote', async () => {
    await store.recordLap(KEY, recordedLap());
    await store.saveNotes(KEY, [note()]);
    await store.flush();
    const written = store.get('lmu', KEY.trackId);

    const reopened = createStore();
    expect(await reopened.whenLoaded('lmu', KEY.trackId)).toEqual(written);
    await reopened.flush();
  });

  it('writes one small file a track', async () => {
    await store.recordLap(KEY, recordedLap());
    await store.recordLap(IRACING_KEY, integratedLap());
    await store.flush();

    expect(await files()).toEqual(['iracing_18.json', FILE]);
    // Three numbers a bucket, to the centimetre.
    expect((await fsp.stat(filePath)).size).toBeLessThan(12_000);
  });

  it('refuses a lap that does not close, and one for no track', async () => {
    expect(await store.recordLap(KEY, recordedLap({ closureM: 2 }))).toBe(
      false
    );
    expect(
      await store.recordLap({ ...KEY, simulator: '../../x' }, recordedLap())
    ).toBe(false);
    await store.flush();

    await expect(fsp.access(filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the first lap when a second is handed over', async () => {
    await store.recordLap(KEY, recordedLap());
    const first = store.get('lmu', KEY.trackId);
    now = 2000;

    expect(
      await store.recordLap(
        KEY,
        recordedLap({ elevationM: heights(POINTS, 10, 3) })
      )
    ).toBe(false);
    expect(store.get('lmu', KEY.trackId)).toBe(first);
  });

  describe('a file a newer build wrote', () => {
    const NEWER = JSON.stringify({
      ...merged(null, recordedLap()),
      version: 2,
      somethingNew: true,
    });

    beforeEach(() => plant(FILE, NEWER));

    it('is not read', async () => {
      expect(await store.whenLoaded('lmu', KEY.trackId)).toBeNull();
      expect(store.load('lmu', KEY.trackId, POINTS)).toBeNull();
      expect(warnings()).toEqual([
        '[TrackProfiles] Written by a newer version, left as it is',
      ]);
    });

    it('is not written over, by a lap or by a note', async () => {
      expect(await store.recordLap(KEY, recordedLap())).toBe(false);
      expect(await store.saveNotes(KEY, [note()])).toBeNull();
      expect(await store.clearElevation('lmu', KEY.trackId)).toBe(false);
      await store.flush();

      expect(await fsp.readFile(filePath, 'utf8')).toBe(NEWER);
      expect(await files()).toEqual([FILE]);
    });

    it('wants no lap sampled for it', async () => {
      await store.whenLoaded('lmu', KEY.trackId);

      expect(store.demand(KEY, 'recorded')).toBe('none');
    });
  });

  describe('a corrupt file', () => {
    it('loads as no profile, with a warning', async () => {
      await plant(FILE, '{"version":1,"simulator":"lmu","trackId":6945');

      expect(await store.whenLoaded('lmu', KEY.trackId)).toBeNull();
      expect(warnings()).toEqual(['[TrackProfiles] Invalid file']);
    });

    it('loads as no profile when it is JSON of another shape', async () => {
      await plant(FILE, JSON.stringify({ version: 1, tracks: [] }));

      expect(await store.whenLoaded('lmu', KEY.trackId)).toBeNull();
      expect(warnings()).toEqual(['[TrackProfiles] Invalid file']);
    });

    it('is not read at all when it is far larger than a profile can be', async () => {
      const readFile = vi.spyOn(fsp, 'readFile');
      await plant(FILE, ' '.repeat(4_000_001));
      readFile.mockClear();

      expect(await store.whenLoaded('lmu', KEY.trackId)).toBeNull();
      expect(readFile).not.toHaveBeenCalled();
      expect(warnings()).toEqual(['[TrackProfiles] Invalid file']);
    });

    it('is replaced by the next lap', async () => {
      await plant(FILE, 'not json at all');

      expect(await store.recordLap(KEY, recordedLap())).toBe(true);
      await store.flush();
      expect((await onDisk()).elevationSource).toBe('recorded');
    });
  });

  it('writes nothing over a file it could not read, and tries again', async () => {
    await plant(FILE, JSON.stringify(merged(null, recordedLap())));
    const readFile = vi
      .spyOn(fsp, 'readFile')
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { code: 'EBUSY' })
      );

    // Held by something else for a moment: there may be a profile in it.
    expect(await store.saveNotes(KEY, [note()])).toBeNull();
    expect(warnings()).toEqual(['[TrackProfiles] Failed to read']);
    await store.flush();
    expect((await onDisk()).notes).toEqual([]);

    readFile.mockRestore();
    expect(await store.saveNotes(KEY, [note()])).toEqual([note()]);
    await store.flush();
    const written = await onDisk();
    expect(written.notes).toEqual([note()]);
    expect(written.elevationSource).toBe('recorded');
  });

  describe('what a lap is still wanted for', () => {
    it('does not call a lap the first before the file has been read', async () => {
      expect(store.demand(KEY, 'recorded')).toBe('more');
      await store.whenLoaded('lmu', KEY.trackId);

      expect(store.demand(KEY, 'recorded')).toBe('first');
    });

    it('wants none once a lap is in, and one again when it is cleared', async () => {
      await store.recordLap(KEY, recordedLap());
      expect(store.demand(KEY, 'recorded')).toBe('none');

      expect(await store.clearElevation('lmu', KEY.trackId)).toBe(true);
      expect(store.demand(KEY, 'recorded')).toBe('first');
    });
  });

  describe('clearing the elevation', () => {
    it('forgets the heights, the line and the learned sectors, not the notes', async () => {
      await store.recordLap(KEY, recordedLap());
      await store.saveNotes(KEY, [note()]);
      now = 3000;

      expect(await store.clearElevation('lmu', KEY.trackId)).toBe(true);
      expect(store.get('lmu', KEY.trackId)).toMatchObject({
        elevationM: null,
        elevationSource: null,
        elevationLaps: 0,
        xM: null,
        zM: null,
        sectorStartPct: [],
        sectorSource: 'nominal',
        notes: [note()],
        updatedAt: 3000,
      });

      // And the next clean lap is taken.
      expect(await store.recordLap(KEY, recordedLap())).toBe(true);
    });

    it('does nothing for a track with nothing to forget', async () => {
      expect(await store.clearElevation('lmu', KEY.trackId)).toBe(false);
      await store.saveNotes(KEY, [note()]);
      expect(await store.clearElevation('lmu', KEY.trackId)).toBe(false);
    });
  });

  describe('an imported elevation', () => {
    const PAIRS: [number, number][] = Array.from(
      { length: 300 },
      (_, index) => [index * 12, 5 + index / 10]
    );

    it('fills in a track that has none, and marks where it came from', async () => {
      expect(await store.importElevation(KEY, PAIRS)).toBe(true);

      const profile = store.get('lmu', KEY.trackId);
      expect(profile).toMatchObject({
        elevationSource: 'tinypedal',
        elevationLaps: 0,
        xM: null,
        zM: null,
      });
      expect(profile?.elevationM).toHaveLength(POINTS);
      expect(profile?.elevationM?.[0]).toBe(5);
      // Still wanted: a lap of the player's own replaces it.
      expect(store.demand(KEY, 'recorded')).toBe('first');
      expect(await store.recordLap(KEY, recordedLap())).toBe(true);
      expect(store.get('lmu', KEY.trackId)?.elevationSource).toBe('recorded');
    });

    it('never replaces one that is there', async () => {
      await store.recordLap(KEY, recordedLap());

      expect(await store.importElevation(KEY, PAIRS)).toBe(false);
      expect(store.get('lmu', KEY.trackId)?.elevationSource).toBe('recorded');
    });

    it('takes nothing from pairs that are not a lap', async () => {
      expect(await store.importElevation(KEY, [[0, 1]])).toBe(false);
      expect(store.get('lmu', KEY.trackId)).toBeNull();
    });
  });

  describe('sunrise and sunset', () => {
    const SUN = { sunriseMinutes: 372, sunsetMinutes: 1231 };

    it('are kept for a track with no profile yet, and read back in another run', async () => {
      const changed = vi.fn();
      store.onChanged(changed);
      const before = store.revision();

      expect(await store.saveSunTimes(KEY, SUN)).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(store.revision()).toBeGreaterThan(before);
      expect(store.get('lmu', KEY.trackId)).toMatchObject(SUN);

      await store.flush();
      expect(await onDisk()).toMatchObject({
        version: 1,
        trackName: KEY.trackName,
        elevationM: null,
        notes: [],
        ...SUN,
      });
      expect(await createStore().whenLoaded('lmu', KEY.trackId)).toMatchObject(
        SUN
      );
    });

    it('change nothing when they are the ones already kept', async () => {
      await store.saveSunTimes(KEY, SUN);
      const changed = vi.fn();
      store.onChanged(changed);

      expect(await store.saveSunTimes(KEY, { ...SUN })).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      // Nor is a file made for a track only to say it has none.
      expect(
        await store.saveSunTimes(IRACING_KEY, {
          sunriseMinutes: null,
          sunsetMinutes: null,
        })
      ).toBe(false);
      expect(store.get('iracing', IRACING_KEY.trackId)).toBeNull();
    });

    it('are cleared one at a time, leaving no key behind', async () => {
      await store.saveSunTimes(KEY, SUN);

      expect(
        await store.saveSunTimes(KEY, { ...SUN, sunriseMinutes: null })
      ).toBe(true);
      const profile = store.get('lmu', KEY.trackId);
      expect(profile?.sunsetMinutes).toBe(1231);
      expect(profile && 'sunriseMinutes' in profile).toBe(false);

      await store.flush();
      const file = await onDisk();
      expect(file.sunsetMinutes).toBe(1231);
      expect('sunriseMinutes' in file).toBe(false);
    });

    it.each([[-1], [1440], [372.5], [Number.NaN], ['06:12'], [undefined]])(
      'are refused when one is %s',
      async (bad) => {
        expect(
          await store.saveSunTimes(KEY, {
            sunriseMinutes: bad as number,
            sunsetMinutes: 1231,
          })
        ).toBe(false);
        // Nothing is kept of the pair, the good half included.
        expect(store.get('lmu', KEY.trackId)).toBeNull();
      }
    );

    it('are refused for a track that cannot be named', async () => {
      expect(
        await store.saveSunTimes({ ...KEY, simulator: '../lmu' }, SUN)
      ).toBe(false);
    });

    it('stay when a lap is recorded after them, and when the notes change', async () => {
      await store.saveSunTimes(KEY, SUN);
      await store.recordLap(KEY, recordedLap());
      await store.saveNotes(KEY, [note()]);
      await store.clearElevation('lmu', KEY.trackId);

      expect(store.get('lmu', KEY.trackId)).toMatchObject({
        ...SUN,
        elevationSource: null,
        notes: [note()],
      });
    });

    it('are read back only when they are minutes of a day', async () => {
      await plant(
        FILE,
        JSON.stringify({
          ...merged(null, recordedLap()),
          sunriseMinutes: 372,
          sunsetMinutes: 2000,
        })
      );

      const loaded = await store.whenLoaded('lmu', KEY.trackId);
      expect(loaded?.sunriseMinutes).toBe(372);
      expect(loaded && 'sunsetMinutes' in loaded).toBe(false);
      expect(loaded?.elevationSource).toBe('recorded');
    });
  });

  describe('notes', () => {
    it('are kept for a track with no profile yet', async () => {
      const changed = vi.fn();
      store.onChanged(changed);
      const before = store.revision();

      expect(
        await store.saveNotes(KEY, [
          note({ id: 'b', distanceM: 3000 }),
          note({ id: 'a', distanceM: 100 }),
        ])
      ).toEqual([
        note({ id: 'a', distanceM: 100 }),
        note({ id: 'b', distanceM: 3000 }),
      ]);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(store.revision()).toBeGreaterThan(before);

      await store.flush();
      expect(await onDisk()).toMatchObject({
        version: 1,
        trackName: KEY.trackName,
        elevationM: null,
        sectorSource: 'nominal',
        notes: [{ id: 'a' }, { id: 'b' }],
      });
    });

    it('are refused past five hundred', async () => {
      const many = Array.from({ length: 501 }, (_, index) =>
        note({ id: `n${index}`, distanceM: index })
      );

      expect(await store.saveNotes(KEY, many)).toBeNull();
      expect(store.get('lmu', KEY.trackId)).toBeNull();
      expect(await store.saveNotes(KEY, many.slice(0, 500))).toHaveLength(500);
    });

    it('are refused when they are not a list', async () => {
      expect(await store.saveNotes(KEY, { id: 'a' })).toBeNull();
      expect(await store.saveNotes(KEY, 'notes')).toBeNull();
    });

    it('are cut to length', async () => {
      const [saved] = (await store.saveNotes(KEY, [
        note({ text: 'x'.repeat(121), comment: 'y'.repeat(501) }),
      ])) as TrackNote[];

      expect(saved.text).toHaveLength(120);
      expect(saved.comment).toHaveLength(500);
    });

    it('stay when a lap is recorded after them', async () => {
      await store.saveNotes(KEY, [note()]);
      await store.recordLap(KEY, recordedLap());

      expect(store.get('lmu', KEY.trackId)).toMatchObject({
        elevationSource: 'recorded',
        notes: [note()],
      });
    });

    it('stop being listened for when asked', async () => {
      const changed = vi.fn();
      const stop = store.onChanged(changed);
      stop();
      await store.saveNotes(KEY, [note()]);

      expect(changed).not.toHaveBeenCalled();
    });

    describe('from a notes file', () => {
      const TRACK_FILE = [
        'TINYPEDAL TRACK NOTES FILE VERSION,2',
        'distance,track note,comment,tags',
        '100,"Turn 1","Brake at the 100 board, late",',
        '3000,"Pit entry","Keep right\\nSpeed limit 60","#pit"',
        'somewhere,"Not a distance","",',
        '9999,"Past the end of the lap","",',
        '',
      ].join('\n');

      it('are added to the notes the track has', async () => {
        await store.saveNotes(KEY, [note()]);

        const notes = await store.importNotes(KEY, 'pace', TRACK_FILE);
        expect(notes).toEqual([
          {
            id: 'id-1',
            distanceM: 100,
            // The header says what they are, whatever was asked for.
            kind: 'track',
            text: 'Turn 1',
            comment: 'Brake at the 100 board, late',
            pit: false,
          },
          note(),
          {
            id: 'id-2',
            distanceM: 3000,
            kind: 'track',
            text: 'Pit entry',
            comment: 'Keep right\nSpeed limit 60',
            pit: true,
          },
        ]);
        expect(store.get('lmu', KEY.trackId)?.notes).toEqual(notes);
      });

      it('take the kind asked for where the header names none', async () => {
        const notes = await store.importNotes(
          KEY,
          'pace',
          'distance,note\n250,"Flat"\n'
        );

        expect(notes).toMatchObject([{ kind: 'pace', text: 'Flat' }]);
      });

      it('are refused from what is not a notes file', async () => {
        expect(
          await store.importNotes(KEY, 'track', 'hello\nworld')
        ).toBeNull();
        expect(await store.importNotes(KEY, 'track', 42)).toBeNull();
        expect(
          await store.importNotes(
            KEY,
            'track',
            `distance,track note\n${'1,"x"\n'.repeat(180_000)}`
          )
        ).toBeNull();
        expect(store.get('lmu', KEY.trackId)).toBeNull();
      });

      it('are refused when they would take the track past five hundred', async () => {
        await store.saveNotes(
          KEY,
          Array.from({ length: 499 }, (_, index) =>
            note({ id: `n${index}`, distanceM: index })
          )
        );

        expect(await store.importNotes(KEY, 'track', TRACK_FILE)).toBeNull();
        expect(store.get('lmu', KEY.trackId)?.notes).toHaveLength(499);
      });

      it('come back out as the file they went in as', async () => {
        await store.importNotes(KEY, 'track', TRACK_FILE);
        await store.importNotes(
          KEY,
          'pace',
          'distance,pace note,comment,tags\n820,"Left 4 tightens","",\n'
        );

        const exported = await store.exportNotes('lmu', KEY.trackId, 'track');
        expect(exported).toBe(
          [
            'TINYPEDAL TRACK NOTES FILE VERSION,2',
            'distance,track note,comment,tags',
            '100,"Turn 1","Brake at the 100 board, late",',
            '3000,"Pit entry","Keep right\\nSpeed limit 60","#pit"',
            '',
          ].join('\n')
        );
        expect(await store.exportNotes('lmu', KEY.trackId, 'pace')).toContain(
          '820,"Left 4 tightens","",'
        );

        // And into another track's notes, the same notes.
        const other = { ...KEY, trackId: 7 };
        const imported = await store.importNotes(other, 'track', exported);
        // Each under a new id, and otherwise as they were.
        const content = (notes: readonly TrackNote[] | null | undefined) =>
          notes?.map((entry) => ({ ...entry, id: '' }));
        expect(content(imported)).toEqual(
          content(
            store
              .get('lmu', KEY.trackId)
              ?.notes.filter(({ kind }) => kind === 'track')
          )
        );
      });

      it('export as an empty file for a track with none', async () => {
        expect(await store.exportNotes('lmu', 5, 'pace')).toBe(
          'TINYPEDAL PACE NOTES FILE VERSION,2\ndistance,pace note,comment,tags\n'
        );
      });
    });
  });

  it('lists every track, the one changed last first', async () => {
    await store.recordLap(KEY, recordedLap());
    now = 2000;
    await store.recordLap(IRACING_KEY, integratedLap());
    await store.flush();
    now = 3000;
    const reopened = createStore();
    // One more, not on disk yet.
    await reopened.saveNotes({ ...KEY, trackId: 7, trackName: 'Sebring' }, [
      note(),
    ]);

    expect(await reopened.list()).toEqual([
      {
        simulator: 'lmu',
        trackId: 7,
        trackName: 'Sebring',
        trackLengthM: KEY.trackLengthM,
        elevationSource: null,
        notes: 1,
        updatedAt: 3000,
      },
      {
        simulator: 'iracing',
        trackId: 18,
        trackName: 'Road America',
        trackLengthM: 6413.5,
        elevationSource: 'integrated',
        notes: 0,
        updatedAt: 2000,
      },
      {
        simulator: 'lmu',
        trackId: KEY.trackId,
        trackName: KEY.trackName,
        trackLengthM: KEY.trackLengthM,
        elevationSource: 'recorded',
        notes: 0,
        updatedAt: 1000,
      },
    ]);
    await reopened.flush();
  });

  it('lists nothing before anything was ever kept', async () => {
    expect(await store.list()).toEqual([]);
    expect(warnings()).toEqual([]);
  });

  describe('past the most files kept', () => {
    const trackKey = (trackId: number): TrackProfileKey => ({
      ...KEY,
      trackId,
      trackName: `Track ${trackId}`,
    });

    it('drops the ones changed longest ago, never one with a note', async () => {
      // Four tracks from earlier runs: 1 is the oldest, and has a note.
      const earlier = createStore(3);
      for (const trackId of [1, 2, 3, 4]) {
        now = trackId * 100;
        await earlier.recordLap(trackKey(trackId), recordedLap());
      }
      now = 150;
      await earlier.saveNotes(trackKey(1), [note()]);
      await earlier.flush();
      expect(await files()).toHaveLength(4);

      // This run adds a fifth, with room for three.
      store = createStore(3);
      now = 900;
      await store.recordLap(trackKey(5), recordedLap());
      await store.flush();

      // 2 and 3 went: the oldest without a note. 1 keeps its note, 4 is
      // the newest of the rest, 5 is the one just written.
      expect(await files()).toEqual(['lmu_1.json', 'lmu_4.json', 'lmu_5.json']);
    });

    it('never drops one with a sunrise or a sunset entered for it', async () => {
      const earlier = createStore(2);
      for (const trackId of [1, 2, 3]) {
        now = trackId * 100;
        await earlier.recordLap(trackKey(trackId), recordedLap());
      }
      now = 150;
      await earlier.saveSunTimes(trackKey(1), {
        sunriseMinutes: 372,
        sunsetMinutes: null,
      });
      await earlier.flush();

      store = createStore(2);
      now = 900;
      await store.recordLap(trackKey(4), recordedLap());
      await store.flush();

      // Two too many: 2 and 3 went, 1 is the driver's own.
      expect(await files()).toEqual(['lmu_1.json', 'lmu_4.json']);
    });

    it('leaves alone a track this run has asked for', async () => {
      const earlier = createStore(2);
      for (const trackId of [1, 2, 3]) {
        now = trackId * 100;
        await earlier.recordLap(trackKey(trackId), recordedLap());
      }
      await earlier.flush();

      store = createStore(2);
      // The oldest is the one being driven now.
      await store.whenLoaded('lmu', 1);
      now = 900;
      await store.recordLap(trackKey(4), recordedLap());
      await store.flush();

      // Two too many, and 2 and 3 are the only ones nobody is using.
      expect(await files()).toEqual(['lmu_1.json', 'lmu_4.json']);
      expect(store.get('lmu', 1)?.elevationSource).toBe('recorded');
    });
  });
});
