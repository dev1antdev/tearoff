import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { testDir } = vi.hoisted(() => ({
  testDir: `./tmp-data/personal-best-spec-${process.pid}`,
}));

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue(testDir) },
}));

import { PersonalBestLapTimesDatabase } from './personalBestLapTimes';

const file = path.join(testDir, 'personalBestLapTimes.json');

const stored = (): Record<string, number> =>
  (
    JSON.parse(fs.readFileSync(file, 'utf8')) as {
      bests: Record<string, number>;
    }
  ).bests;

describe('PersonalBestLapTimesDatabase', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('stores a best lap and keeps only a faster one', () => {
    const db = new PersonalBestLapTimesDatabase();
    db.setPersonalBest(1, 'car', 90);
    db.setPersonalBest(1, 'car', 95);
    expect(db.getPersonalBest(1, 'car')).toBe(90);
    expect(stored()).toEqual({ '1:car': 90 });

    db.setPersonalBest(1, 'car', 88.5);
    expect(stored()).toEqual({ '1:car': 88.5 });
    expect(new PersonalBestLapTimesDatabase().getPersonalBest(1, 'car')).toBe(
      88.5
    );
  });

  describe.each(['IRDASHIES_TELEMETRY_REPLAY', 'IRDASHIES_LMU_REPLAY'])(
    'while a tape plays (%s)',
    (tapeVariable) => {
      it('keeps the tape best for the run and writes no file', () => {
        vi.stubEnv(tapeVariable, 'session.tape');
        const db = new PersonalBestLapTimesDatabase();
        db.setPersonalBest(1, 'car', 86.66);

        // The lap log still reads it back, as it does live.
        expect(db.getPersonalBest(1, 'car')).toBe(86.66);
        expect(fs.existsSync(file)).toBe(false);
      });

      it("leaves the user's own best on disk as it was", () => {
        new PersonalBestLapTimesDatabase().setPersonalBest(1, 'car', 90);
        const before = fs.readFileSync(file, 'utf8');

        vi.stubEnv(tapeVariable, 'session.tape');
        const db = new PersonalBestLapTimesDatabase();
        expect(db.getPersonalBest(1, 'car')).toBe(90);
        db.setPersonalBest(1, 'car', 80);

        expect(db.getPersonalBest(1, 'car')).toBe(80);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
      });
    }
  );
});
