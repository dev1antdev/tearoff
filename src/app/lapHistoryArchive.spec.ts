import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ActiveSimulator,
  LapHistorySnapshot,
  Session,
  Telemetry,
} from '@irdashies/types';
import { simulatorHasUniqueSessionIds, TrackLocation } from '@irdashies/types';
import { ChannelBus } from './bridge/channelBridge';
import { createSessionLifecycle } from './sessionLifecycle';
import { createLmuSessionIdentity } from './lmu/sessionIdentity';
import { LapHistoryRuntime } from './processors/lapHistoryRuntime';
import { createLapHistoryArchive } from './lapHistoryArchive';
import {
  __resetForTests,
  flushLapHistoryOnShutdown,
} from './storage/lapHistoryStorage';

/**
 * Two races that Le Mans Ultimate cannot tell apart by id.
 *
 * LMU has no event id. The one the bridge derives is made of the track, the
 * session type and the server, so the next race on the same server and track
 * carries the same one: after the app is restarted, and equally when the
 * server goes round practice and qualifying and comes back to a race while
 * the app keeps running. The lap history is stored under that id and read
 * back as "this session's laps", which made the second race open with the
 * first one's crossings.
 *
 * Staged here with the real identity, the real runtime and the real files.
 */

// The runtime and the lifecycle narrate every session change.
vi.mock('./logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** LMU's own session numbers: they are session types, not a count. */
const PRACTICE = 1;
const RACE = 10;

const TRACK = 'Circuit de la Sarthe';
const SERVER = 'Weekly Endurance';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-lap-archive-'));
  __resetForTests();
});

afterEach(async () => {
  await flushLapHistoryOnShutdown();
  __resetForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const session = (subSessionId: number, sessionNum: number): Session =>
  ({
    WeekendInfo: { SubSessionID: subSessionId },
    SessionInfo: {
      Sessions: [
        {
          SessionNum: sessionNum,
          SessionType: sessionNum === RACE ? 'Race' : 'Practice',
        },
      ],
    },
    DriverInfo: {
      Drivers: [
        { CarIdx: 0, UserName: 'A' },
        { CarIdx: 1, UserName: 'B' },
      ],
    },
  }) as unknown as Session;

const frame = (
  sessionNum: number,
  sessionTime: number,
  laps: number[]
): Telemetry =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    CarIdxLap: { value: laps },
    CarIdxClassPosition: { value: laps.map((_, index) => index + 1) },
    CarIdxOnPitRoad: { value: laps.map(() => false) },
    CarIdxTrackSurface: { value: laps.map(() => TrackLocation.OnTrack) },
  }) as unknown as Telemetry;

/** The crossings held for a car, oldest first. */
const crossings = (snapshot: LapHistorySnapshot, carIdx: number) =>
  Array.from({ length: snapshot.count[carIdx] }, (_, index) => {
    const slot =
      carIdx * snapshot.capacity +
      ((snapshot.start[carIdx] + index) % snapshot.capacity);
    return { lap: snapshot.lap[slot], sessionTime: snapshot.sessionTime[slot] };
  });

/**
 * One run of the app, from its start to its quit: a runtime with nothing in
 * memory, wired to the archive the way main.ts wires it.
 */
const startApp = (canArchive: () => boolean) => {
  const lifecycle = createSessionLifecycle();
  const archive = createLapHistoryArchive({
    canArchive,
    logError: vi.fn(),
    storageDir: tmpDir,
  });
  const reads: Promise<unknown>[] = [];
  const runtime = new LapHistoryRuntime(
    new ChannelBus(),
    lifecycle,
    { markStart: vi.fn(), markEnd: vi.fn() },
    {
      ...archive,
      load: (sessionId) => {
        const read = archive.load(sessionId);
        reads.push(read.catch(() => null));
        return read;
      },
    }
  );
  lifecycle._onEnter({ replay: false });

  return {
    runtime,
    /** A session is entered: its snapshot arrives, and its file is read. */
    enter: async (subSessionId: number, sessionNum: number) => {
      const entered = session(subSessionId, sessionNum);
      lifecycle._onSession(entered);
      runtime.onSession(entered);
      await Promise.all(reads);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    drive: (sessionNum: number, sessionTime: number, laps: number[]) => {
      const telemetry = frame(sessionNum, sessionTime, laps);
      lifecycle._onTelemetry(telemetry);
      runtime.onFrame(telemetry);
    },
    /** Long enough for the debounced write: a race outlasts two seconds. */
    timePasses: () => flushLapHistoryOnShutdown(),
    /** The sim goes, the app quits, and what it held in memory with it. */
    quit: async () => {
      lifecycle._onDisconnect();
      runtime.dispose();
      await flushLapHistoryOnShutdown();
      __resetForTests();
    },
  };
};

type App = ReturnType<typeof startApp>;

/** Two cars, two laps each: what the first race leaves behind. */
const driveFirstRace = (app: App) => {
  app.drive(RACE, 100, [1, 1]);
  app.drive(RACE, 190, [2, 1]);
  app.drive(RACE, 192, [2, 2]);
  app.drive(RACE, 280, [3, 2]);
  app.drive(RACE, 283, [3, 3]);
};

/** The second race from its grid: one lap by the first car. */
const driveSecondRace = (app: App) => {
  app.drive(RACE, 30, [1, 1]);
  app.drive(RACE, 120, [2, 1]);
};

const FIRST_RACE_CAR_0 = [
  { lap: 1, sessionTime: 190 },
  { lap: 2, sessionTime: 280 },
];
const SECOND_RACE_CAR_0 = [{ lap: 1, sessionTime: 120 }];

/** The id LMU's bridge would publish for a session of this type. */
const lmuId = (
  identity: ReturnType<typeof createLmuSessionIdentity>,
  sessionNum: number,
  currentET: number
) =>
  identity.observe({
    trackName: TRACK,
    session: sessionNum,
    serverName: SERVER,
    currentET,
  });

/**
 * Race, quit, start again, race: the same server and track the next day.
 * Returns the two ids and the app the second race ran in.
 */
const raceRestartRace = async (canArchive: () => boolean) => {
  const firstId = lmuId(createLmuSessionIdentity(), RACE, 60);
  const first = startApp(canArchive);
  await first.enter(firstId, RACE);
  driveFirstRace(first);
  await first.quit();

  // A new process: nothing of the identity survives it either.
  const secondId = lmuId(createLmuSessionIdentity(), RACE, 5);
  const second = startApp(canArchive);
  await second.enter(secondId, RACE);
  driveSecondRace(second);
  return { firstId, secondId, app: second };
};

/**
 * Race, practice, race, in one run of the app: a server on rotation coming
 * back round to its race.
 */
const raceRotationRace = async (canArchive: () => boolean) => {
  const identity = createLmuSessionIdentity();
  const app = startApp(canArchive);

  const firstId = lmuId(identity, RACE, 60);
  await app.enter(firstId, RACE);
  driveFirstRace(app);
  await app.timePasses();

  const practiceId = lmuId(identity, PRACTICE, 0);
  await app.enter(practiceId, PRACTICE);
  app.drive(PRACTICE, 10, [1, 1]);
  app.drive(PRACTICE, 100, [2, 1]);
  await app.timePasses();

  const secondId = lmuId(identity, RACE, 0);
  await app.enter(secondId, RACE);
  driveSecondRace(app);
  return { firstId, practiceId, secondId, app };
};

const underSimulator = (simulator: ActiveSimulator) => () =>
  simulatorHasUniqueSessionIds(simulator);

describe('two Le Mans Ultimate races with one session id', () => {
  it('really do share it: after a restart, and round a rotation', async () => {
    const restarted = await raceRestartRace(underSimulator('lmu'));
    expect(restarted.secondId).toBe(restarted.firstId);

    const rotated = await raceRotationRace(underSimulator('lmu'));
    expect(rotated.secondId).toBe(rotated.firstId);
    expect(rotated.practiceId).not.toBe(rotated.firstId);
  });

  it.each([
    ['after a restart', raceRestartRace],
    ['round a rotation', raceRotationRace],
  ])(
    'would open the second race with the laps of the first if the id were trusted: %s',
    async (_name, stage) => {
      // The archive as it was wired before: any id is taken at its word.
      // This is the fault itself, so the specs below are known to stage it.
      const { app } = await stage(() => true);

      expect(crossings(app.runtime.snapshot(), 0)).toEqual([
        ...FIRST_RACE_CAR_0,
        ...SECOND_RACE_CAR_0,
      ]);
      // The second car has not crossed the line in this race, and has two
      // laps to its name already.
      expect(crossings(app.runtime.snapshot(), 1)).toHaveLength(2);
    }
  );

  it('starts the second race empty after the app was restarted', async () => {
    const { app } = await raceRestartRace(underSimulator('lmu'));

    expect(crossings(app.runtime.snapshot(), 0)).toEqual(SECOND_RACE_CAR_0);
    expect(crossings(app.runtime.snapshot(), 1)).toEqual([]);
  });

  it('starts the second race empty when the server comes back round to it', async () => {
    const { app } = await raceRotationRace(underSimulator('lmu'));

    expect(crossings(app.runtime.snapshot(), 0)).toEqual(SECOND_RACE_CAR_0);
    expect(crossings(app.runtime.snapshot(), 1)).toEqual([]);
  });

  it('writes no file that nothing may read back', async () => {
    const { app } = await raceRestartRace(underSimulator('lmu'));
    await app.quit();

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('still records the race in memory for the widgets that are open', async () => {
    const app = startApp(underSimulator('lmu'));
    await app.enter(lmuId(createLmuSessionIdentity(), RACE, 60), RACE);
    driveFirstRace(app);

    expect(crossings(app.runtime.snapshot(), 0)).toEqual(FIRST_RACE_CAR_0);
    expect(crossings(app.runtime.snapshot(), 1)).toHaveLength(2);
  });
});

describe('an iRacing race, whose session id names it alone', () => {
  const SUB_SESSION_ID = 71234567;

  it('is found again after a restart in the middle of it', async () => {
    const first = startApp(underSimulator('iracing'));
    await first.enter(SUB_SESSION_ID, RACE);
    driveFirstRace(first);
    await first.quit();

    const second = startApp(underSimulator('iracing'));
    await second.enter(SUB_SESSION_ID, RACE);
    // The same race, further on.
    second.drive(RACE, 400, [4, 4]);
    second.drive(RACE, 460, [5, 4]);

    expect(crossings(second.runtime.snapshot(), 0)).toEqual([
      ...FIRST_RACE_CAR_0,
      { lap: 4, sessionTime: 460 },
    ]);
    expect(crossings(second.runtime.snapshot(), 1)).toHaveLength(2);
  });
});

describe('createLapHistoryArchive', () => {
  it('asks whether the id can be trusted on every call', async () => {
    // Left on auto-detect the simulator is named after the app has started,
    // and a profile can pin another one later.
    const subSessionId = 5550001;
    let trusted = true;
    const app = startApp(() => trusted);
    await app.enter(subSessionId, RACE);
    driveFirstRace(app);
    await app.quit();
    expect(fs.readdirSync(tmpDir)).toHaveLength(1);

    trusted = false;
    const archive = createLapHistoryArchive({
      canArchive: () => trusted,
      logError: vi.fn(),
      storageDir: tmpDir,
    });
    await expect(archive.load(String(subSessionId))).resolves.toBeNull();

    trusted = true;
    const stored = await archive.load(String(subSessionId));
    expect(stored?.sessionNums).toEqual([RACE]);
  });
});
