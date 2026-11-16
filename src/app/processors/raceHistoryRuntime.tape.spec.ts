import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceHistorySummarySnapshot, Session } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ChannelBus, type RendererTarget } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import type { RaceHistoryStore } from '../storage/lapLibrary/raceHistoryStore';
import { isRecordedSource } from '../tapeReplaySource';
import { RaceHistoryRuntime } from './raceHistoryRuntime';
import {
  idle,
  openRaceHistoryFile,
  type RaceHistoryFile,
} from './raceHistoryStoreFixture';

/**
 * The race history's runtime and its real storage on a recorded Le Mans
 * Ultimate race: four minutes at Laguna Seca, 38 cars.
 *
 * Two things are shown. That a recording played back in place of a
 * simulator, which is what this is, reaches the file by neither of the two
 * guards the app has. And that a race is carried on after a restart, with
 * the laps driven meanwhile reported as missing and none made up.
 *
 * The restart is STAGED: the recording is played to one runtime up to a
 * moment, to nothing for eighteen seconds, and then to a second runtime
 * with the same file. There the recording stands in for a live race, and
 * the spec's own store is one that writes. No recording of a real restart
 * exists, and what LMU says of a session to an app that joins it mid-race
 * online is what this cannot show.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
const CHANNEL = 'race-history.summary';
/** The fourteen LMP2s, which lead: slots 1 to 14. */
const isLmp2 = (carIdx: number) => carIdx >= 1 && carIdx <= 14;

let file: RaceHistoryFile;
let logs: string[];

const start = (store: RaceHistoryStore, bootId: string) => {
  const bus = new ChannelBus({
    schedule: () => ({ cancel: () => undefined }),
  });
  const runtime = new RaceHistoryRuntime(
    bus,
    createSessionLifecycle(),
    { markStart: () => undefined, markEnd: () => undefined },
    store,
    {
      simulator: () => 'lmu',
      sessionIdsAreUnique: () => false,
      now: () => Date.now(),
      bootId,
      log: (message) => logs.push(message),
      logError: (message, error) =>
        file.errors.push(`${message} ${String(error)}`),
    }
  );
  const delivered: RaceHistorySummarySnapshot[] = [];
  const target: RendererTarget = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    send: (_channel, _name, payload) =>
      delivered.push(structuredClone(payload as RaceHistorySummarySnapshot)),
  };
  bus.subscribe(target, CHANNEL);
  return { runtime, bus, delivered, target };
};

/**
 * Plays the recording to a runtime between two moments of its session
 * clock, and returns what the sim itself said each car's laps took: every
 * time its last lap time moved to a real time, over the whole of what was
 * played.
 */
const play = async (
  runtime: RaceHistoryRuntime | null,
  from: number,
  until: number
): Promise<number[][]> => {
  const timed: number[][] = [];
  const last: number[] = [];
  let frames = 0;
  let sessionGiven: Session | null = null;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    onFrame: ({ raw, telemetry, session, sessionTime }) => {
      frames += 1;
      for (let carIdx = 0; carIdx < raw.vehLastLapTime.length; carIdx += 1) {
        const time = raw.vehLastLapTime[carIdx];
        timed[carIdx] ??= [];
        if (frames > 1 && time > 0 && time !== last[carIdx]) {
          timed[carIdx].push(time);
        }
        last[carIdx] = time;
      }
      if (sessionTime >= until) return false;
      if (!runtime || sessionTime < from) return true;
      if (sessionGiven !== session) {
        sessionGiven = session;
        runtime.onSession(session);
      }
      runtime.onFrame(telemetry);
      return true;
    },
  });
  return timed;
};

beforeEach(() => {
  file = openRaceHistoryFile();
  logs = [];
  // As the app is started for a recording: before anything is made.
  vi.stubEnv('IRDASHIES_LMU_REPLAY', LMU_CURATED_TAPE_PATH);
});

afterEach(() => {
  file.close();
  vi.unstubAllEnvs();
});

describe.skipIf(!lmuTapeAvailable())(
  'the race history’s storage on a recorded LMU race',
  () => {
    it('records the recording and writes nothing of it, as the app sets it up', async () => {
      expect(isRecordedSource()).toBe(true);
      // The two guards the app has, both as main.ts makes them.
      const store = file.openStore(() => !isRecordedSource());
      const { runtime, delivered } = start(store, 'tape');
      runtime.setPersisting(!isRecordedSource());

      await play(runtime, 0, Number.POSITIVE_INFINITY);
      runtime.dispose();
      await idle();
      await store.flush();
      await idle();

      // The whole race is there to be read and shown.
      let laps = 0;
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        laps += (await runtime.getCarLaps(carIdx)).laps.length;
      }
      expect(laps).toBe(90);
      expect(delivered.length).toBeGreaterThan(0);
      expect(delivered.at(-1)).toMatchObject({ raceId: null, resumed: false });
      // And none of it is in the file, which was never asked for anything
      // but how it opened.
      expect(file.requests.map((request) => request.method)).toEqual([
        'status',
      ]);
      expect(file.db.races.list()).toEqual([]);
      expect(file.errors).toEqual([]);
      expect(logs[0]).toContain('not stored');
    }, 120_000);

    it('writes nothing of it even with the runtime left storing: the store refuses for itself', async () => {
      const store = file.openStore(() => !isRecordedSource());
      const { runtime } = start(store, 'tape');
      // Not told that the source is a recording.

      await play(runtime, 0, Number.POSITIVE_INFINITY);
      runtime.dispose();
      await idle();
      await store.flush();
      await idle();

      expect((await runtime.getCarLaps(8)).laps).toHaveLength(3);
      // The file was asked whether it holds the race, and it holds none;
      // nothing was written.
      expect(file.asked('raceWrite')).toBe(0);
      expect(file.db.races.list()).toEqual([]);
      expect(file.errors).toEqual([]);
    }, 120_000);

    it('carries the race on after a restart staged on it, and reports the laps between as missing', async () => {
      // Every car completes its first lap before 239 s on the session
      // clock. The LMP2s complete their second between 291 and 300, the
      // rest after 306; the LMP2s' third comes at 368 and after.
      const QUIT_AT = 285;
      const BACK_AT = 303;
      // The recording stands in for a live race: a store that writes.
      const before = file.openStore(() => true);
      const first = start(before, 'run-a');

      await play(first.runtime, 0, QUIT_AT);
      // The app quits: what is in hand is stored.
      first.runtime.dispose();
      await idle();
      await before.flush();
      await idle();

      const [kept] = file.db.races.list();
      expect(kept).toMatchObject({
        simulator: 'lmu',
        sessionType: 'Race',
        sessionKey: '',
        cars: CARS,
        laps: CARS,
      });
      expect(kept.entries).toHaveLength(CARS);
      const requestsBefore = file.requests.length;

      // Started again eighteen seconds later, on the same file.
      const after = file.openStore(() => true);
      const second = start(after, 'run-b');
      const timed = await play(
        second.runtime,
        BACK_AT,
        Number.POSITIVE_INFINITY
      );
      await idle();
      await after.flush();
      await idle();

      // The race in the file was taken for this one, and carried on in its
      // row: no second race.
      expect(
        logs.some((line) => line.includes(`Carrying on race ${kept.id}`))
      ).toBe(true);
      expect(file.db.races.list()).toHaveLength(1);
      expect(second.runtime.currentRace()).toMatchObject({
        id: kept.id,
        startedAt: kept.startedAt,
      });
      const written = file.requests
        .slice(requestsBefore)
        .filter((request) => request.method === 'raceWrite');
      expect(written.length).toBeGreaterThan(0);
      for (const request of written) {
        expect(request.args[0]).toMatchObject({ raceId: kept.id });
      }

      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const { laps, missingLaps } = await second.runtime.getCarLaps(carIdx);
        const stints = await second.runtime.getCarStints(carIdx);
        if (isLmp2(carIdx)) {
          // Their second lap was driven with nothing running.
          expect(
            laps.map((lap) => lap.lap),
            `car ${carIdx}`
          ).toEqual([1, 3]);
          expect(missingLaps, `car ${carIdx}`).toEqual([2]);
          // Each lap that is there has the sim's own time for it.
          expect(laps.map((lap) => lap.lapTime)).toEqual([
            timed[carIdx][0],
            timed[carIdx][2],
          ]);
          // What the car did on the lap between was not seen, so the stint
          // it was on is cut at the last lap that was.
          expect(stints).toMatchObject([
            { ordinal: 1, openedBy: 'start', closedBy: 'gap', lastLap: 1 },
            { ordinal: 2, openedBy: 'joined', closedBy: null, firstLap: 3 },
          ]);
          expect(stints[0].endTime).toBe(laps[0].sessionTime);
        } else {
          // Nothing of theirs was missed: one stint, carried on.
          expect(
            laps.map((lap) => lap.lap),
            `car ${carIdx}`
          ).toEqual([1, 2]);
          expect(missingLaps, `car ${carIdx}`).toEqual([]);
          expect(laps.map((lap) => lap.lapTime)).toEqual(timed[carIdx]);
          expect(stints).toMatchObject([
            {
              ordinal: 1,
              openedBy: 'start',
              closedBy: null,
              firstLap: 1,
              lastLap: 2,
              laps: 2,
              cleanLaps: 1,
            },
          ]);
        }
        // The file holds what is held, lap for lap and stint for stint.
        expect(file.db.races.carLaps(kept.id, carIdx)).toEqual(laps);
        expect(file.db.races.carStints(kept.id, carIdx)).toEqual(stints);
      }

      // The leader of the LMP2s was seen to lead the third lap; the gaps of
      // its class are measured from it.
      const leader = (await second.runtime.getCarLaps(8)).laps[1];
      expect(leader).toMatchObject({ lap: 3, classGap: 0, classPosition: 1 });
      const chaser = (await second.runtime.getCarLaps(6)).laps[1];
      expect(chaser.classGap).toBeCloseTo(
        chaser.sessionTime - leader.sessionTime,
        9
      );

      // A window that opens now is told all of it at once.
      second.bus.unsubscribe(second.target.id, CHANNEL);
      second.bus.subscribe(second.target, CHANNEL);
      const summary = second.delivered.at(-1);
      expect(summary).toMatchObject({
        raceToken: 'run-b:1',
        raceId: kept.id,
        resumed: true,
      });
      expect(summary?.missingLaps).toEqual(
        Array.from({ length: CARS }, (_, carIdx) => (isLmp2(carIdx) ? 1 : 0))
      );
      expect(summary?.laps).toEqual(Array.from({ length: CARS }, () => 2));
      expect(second.runtime.currentRace()?.entries).toHaveLength(CARS);
      second.runtime.dispose();
      await idle();
      expect(file.errors).toEqual([]);
    }, 180_000);
  }
);
