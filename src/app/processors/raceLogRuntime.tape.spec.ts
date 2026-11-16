import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceEvent, Session, Telemetry } from '@irdashies/types';
import {
  TapeReader,
  type TapeVariable,
} from '../../../tools/telemetry-replay/tape';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ChannelBus } from '../bridge/channelBus';
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
 * The race's log on the two recordings there are, through the runtime that
 * hosts it: a Le Mans Ultimate race of four minutes at Laguna Seca, 38
 * cars, and an iRacing race of ten minutes at Road America, 40 cars.
 *
 * Neither has a pit stop, a driver change, a caution or a penalty in it. As
 * they stand they show two things: that the log makes nothing up over
 * minutes of a full field racing, and what it does say of a race start and
 * of each class's fastest lap as iRacing really times them.
 *
 * The rest is STAGED on the Le Mans Ultimate recording, by rewriting a few
 * of the sim's fields before they are mapped: a full-course yellow, a stop
 * for one car and a penalty for another. That is the app's own mapping and
 * the real shape of 38 cars' frames, with made-up events put on them. What
 * the sim really writes through any of the three, only a recording can say.
 *
 * Windows only, like the other tape specs.
 */

const IRACING_TAPE_PATH = path.resolve(
  'test-data/telemetry/ai-race-10min.irdt'
);
/** The recording itself, not the Git LFS pointer left in its place. */
const iracingTapeAvailable = (): boolean =>
  fs.existsSync(IRACING_TAPE_PATH) &&
  fs.statSync(IRACING_TAPE_PATH).size > 1024 * 1024;

let file: RaceHistoryFile;

const start = (store: RaceHistoryStore, simulator: string) => {
  const bus = new ChannelBus({
    schedule: () => ({ cancel: () => undefined }),
  });
  return new RaceHistoryRuntime(
    bus,
    createSessionLifecycle(),
    { markStart: () => undefined, markEnd: () => undefined },
    store,
    {
      simulator: () => simulator,
      sessionIdsAreUnique: () => simulator === 'iracing',
      now: () => Date.now(),
      bootId: 'tape',
      logError: (message, error) =>
        file.errors.push(`${message} ${String(error)}`),
    }
  );
};

type Stage = <T extends LmuRawTelemetry>(raw: T) => T;

/** The session clock of a raw Le Mans Ultimate frame. */
const clockOf = (raw: LmuRawTelemetry): number =>
  typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
    ? raw.elapsedTime
    : raw.currentET;

const playLmu = async (
  runtime: RaceHistoryRuntime,
  stage?: Stage
): Promise<number> => {
  let frames = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    transformRaw: stage,
    onFrame: ({ telemetry, session, sessionChanged }) => {
      frames += 1;
      if (sessionChanged || frames === 1) runtime.onSession(session);
      runtime.onFrame(telemetry);
    },
  });
  return frames;
};

/** The SDK's variable types, by number. */
const readers: Record<number, (payload: Buffer, at: number) => unknown> = {
  1: (payload, at) => payload.readUInt8(at) === 1,
  2: (payload, at) => payload.readInt32LE(at),
  3: (payload, at) => payload.readInt32LE(at),
  4: (payload, at) => payload.readFloatLE(at),
  5: (payload, at) => payload.readDoubleLE(at),
};
const widths: Record<number, number> = { 1: 1, 2: 4, 3: 4, 4: 4, 5: 8 };

/** The frame keys the race history and the log read under iRacing. */
const IRACING_KEYS = [
  'SessionTime',
  'SessionNum',
  'SessionFlags',
  'SessionState',
  'SessionTimeOfDay',
  'PlayerCarIdx',
  'CarIdxLap',
  'CarIdxLapCompleted',
  'CarIdxLapDistPct',
  'CarIdxLastLapTime',
  'CarIdxBestLapTime',
  'CarIdxPosition',
  'CarIdxClassPosition',
  'CarIdxOnPitRoad',
  'CarIdxTrackSurface',
  'CarIdxSessionFlags',
  'CarIdxTireCompound',
] as const;

/**
 * Plays the iRacing recording to a runtime, frame by frame, and returns
 * every time the sim itself gave for a lap: what each car's last lap time
 * moved to.
 */
const playIracing = async (
  runtime: RaceHistoryRuntime
): Promise<{ frames: number; timed: Set<number>[]; greenAt: number }> => {
  const reader = await TapeReader.open(IRACING_TAPE_PATH);
  const variables: [string, TapeVariable][] = IRACING_KEYS.map((name) => {
    const found = reader.schema.variables.get(name);
    if (!found) throw new Error(`The tape has no ${name}`);
    return [name, found];
  });
  const timed: Set<number>[] = [];
  let frames = 0;
  let greenAt = Number.NaN;
  try {
    for (;;) {
      const entry = await reader.readRecord();
      if (!entry) break;
      if (entry.kind === 'sessionInfo') {
        // The SDK's text is padded to its buffer with zero bytes.
        const text = entry.payload.toString('utf8');
        const end = text.indexOf(String.fromCharCode(0));
        runtime.onSession(
          yaml.load(end < 0 ? text : text.slice(0, end), {
            json: true,
          }) as Session
        );
        continue;
      }
      if (entry.kind !== 'frame') continue;
      frames += 1;
      // A new array for every key of every frame, as the SDK hands them.
      const frame: Record<string, { value: unknown[] }> = {};
      for (const [name, variable] of variables) {
        const read = readers[variable.type];
        const width = widths[variable.type];
        const value = new Array<unknown>(variable.count);
        for (let index = 0; index < variable.count; index += 1) {
          value[index] = read(entry.payload, variable.offset + index * width);
        }
        frame[name] = { value };
      }
      // SessionState 4 is racing: the first frame that says so.
      if (Number.isNaN(greenAt) && frame.SessionState.value[0] === 4) {
        greenAt = frame.SessionTime.value[0] as number;
      }
      (frame.CarIdxLastLapTime.value as number[]).forEach((time, carIdx) => {
        if (time > 0) (timed[carIdx] ??= new Set()).add(time);
      });
      runtime.onFrame(frame as unknown as Telemetry);
    }
  } finally {
    await reader.close();
  }
  return { frames, timed, greenAt };
};

const kinds = (events: readonly RaceEvent[]) =>
  events.map((event) => event.kind);

beforeEach(() => {
  file = openRaceHistoryFile();
});

afterEach(() => {
  file.close();
  vi.unstubAllEnvs();
});

describe.skipIf(!lmuTapeAvailable())(
  'the race log on a recorded LMU race',
  () => {
    beforeEach(() => {
      // As the app is started for a recording: before anything is made.
      vi.stubEnv('IRDASHIES_LMU_REPLAY', LMU_CURATED_TAPE_PATH);
    });

    /** Car 20, an LMGT3 that never leaves the track, on its second lap. */
    const STOPPER = 20;
    const ENTERS_AT = 250;
    const STOPS_AT = 260;
    const GOES_AT = 290;
    const LEAVES_AT = 300;
    /** Car 3 is given a penalty and serves it. */
    const PENALISED = 3;
    const PENALTY_AT = 320;
    const SERVED_AT = 350;
    /** A full-course yellow for half a minute. */
    const YELLOW_AT = 200;
    const GREEN_AT = 230;

    /** Staged, not recorded: see the note at the top. */
    const stage: Stage = (raw) => {
      const clock = clockOf(raw);
      const inLane = clock >= ENTERS_AT && clock < LEAVES_AT;
      const pitState =
        clock < ENTERS_AT
          ? 0
          : clock < STOPS_AT
            ? 2
            : clock < GOES_AT
              ? 3
              : clock < LEAVES_AT
                ? 4
                : 0;
      return {
        ...raw,
        gamePhase: clock >= YELLOW_AT && clock < GREEN_AT ? 6 : raw.gamePhase,
        vehInPits: Uint8Array.from(raw.vehInPits, (value, carIdx) =>
          carIdx === STOPPER ? Number(inLane) : value
        ),
        vehPitState: Uint8Array.from(raw.vehPitState, (value, carIdx) =>
          carIdx === STOPPER ? pitState : value
        ),
        vehNumPenalties: Array.from(
          raw.vehNumPenalties ?? [],
          (value, carIdx) =>
            carIdx === PENALISED && clock >= PENALTY_AT && clock < SERVED_AT
              ? 1
              : value
        ),
      };
    };

    it('logs nothing of a race in which nothing of the kind happens', async () => {
      const store = file.openStore(() => !isRecordedSource());
      const runtime = start(store, 'lmu');
      runtime.setPersisting(!isRecordedSource());

      const frames = await playLmu(runtime);

      // Four minutes of 38 cars under one green flag, read at the race
      // history's five ticks a second, and not a line: no car pits, none is
      // away, the own car holds no new place for a lap, and no lap is yet a
      // class's fastest by the time its cars have run three.
      expect(frames).toBeGreaterThan(14_000);
      expect((await runtime.getCarLaps(8)).laps).toHaveLength(3);
      expect(await runtime.getEvents()).toEqual([]);
      runtime.dispose();
    }, 120_000);

    it('logs a caution, a stop and a penalty staged on it, and writes none of it', async () => {
      expect(isRecordedSource()).toBe(true);
      // The two guards the app has, both as main.ts makes them.
      const store = file.openStore(() => !isRecordedSource());
      const runtime = start(store, 'lmu');
      runtime.setPersisting(!isRecordedSource());

      await playLmu(runtime, stage);
      const events = await runtime.getEvents();
      runtime.dispose();
      await idle();
      await store.flush();
      await idle();

      expect(kinds(events)).toEqual([
        'flag',
        'flag',
        'pit-entry',
        'pit-exit',
        'penalty',
        'penalty',
      ]);
      const [yellow, green, entry, exit, given, served] = events;
      // The clock in the sim comes with each, as the recording has it.
      expect(events.every((event) => (event.timeOfDay ?? 0) > 50_000)).toBe(
        true
      );

      expect(yellow).toMatchObject({ flag: 'caution', late: false });
      expect(yellow.sessionTime).toBeGreaterThanOrEqual(YELLOW_AT);
      expect(yellow.sessionTime).toBeLessThan(YELLOW_AT + 0.4);
      expect(green).toMatchObject({ flag: 'green', after: 'caution' });
      expect(green.kind === 'flag' && green.durationS).toBeCloseTo(
        GREEN_AT - YELLOW_AT,
        0
      );

      // Into the lane from the place the recording has the car in, and out
      // with the times the race history gave the stop.
      expect(entry).toMatchObject({ carIdx: STOPPER, kind: 'pit-entry' });
      expect(entry.kind === 'pit-entry' && entry.classPosition).toBeGreaterThan(
        0
      );
      expect(entry.sessionTime).toBeGreaterThanOrEqual(ENTERS_AT);
      expect(entry.sessionTime).toBeLessThan(ENTERS_AT + 0.4);
      const [stint] = await runtime.getCarStints(STOPPER);
      expect(stint).toMatchObject({ closedBy: 'stop', laps: 1 });
      expect(exit).toMatchObject({
        carIdx: STOPPER,
        kind: 'pit-exit',
        standingTime: stint.stop?.standingTime,
        laneTime: stint.stop?.laneTime,
        driverFrom: '',
        driverTo: '',
      });
      expect(stint.stop?.standingTime).toBeCloseTo(GOES_AT - STOPS_AT, 0);
      expect(stint.stop?.laneTime).toBeCloseTo(LEAVES_AT - ENTERS_AT, 0);
      expect(exit.sessionTime).toBeGreaterThanOrEqual(LEAVES_AT);

      // The count alone: nothing on a recording names a penalty's kind.
      expect(given).toMatchObject({
        carIdx: PENALISED,
        change: 'given',
        penalty: '',
        pending: 1,
      });
      expect(served).toMatchObject({
        carIdx: PENALISED,
        change: 'served',
        pending: 0,
      });

      // And none of it is in the file, which was never asked for anything
      // but how it opened.
      expect(file.requests.map((request) => request.method)).toEqual([
        'status',
      ]);
      expect(file.db.races.list()).toEqual([]);
      expect(file.errors).toEqual([]);
    }, 120_000);

    it('writes none of it even with the runtime left storing: the store refuses for itself', async () => {
      const store = file.openStore(() => !isRecordedSource());
      const runtime = start(store, 'lmu');
      // Not told that the source is a recording.

      await playLmu(runtime, stage);
      const events = await runtime.getEvents();
      runtime.dispose();
      await idle();
      await store.flush();
      await idle();

      expect(events).toHaveLength(6);
      expect(file.asked('raceWrite')).toBe(0);
      expect(file.db.races.list()).toEqual([]);
      expect(file.errors).toEqual([]);
    }, 120_000);

    it('stores the same log when the recording stands in for a live race', async () => {
      // The other side of the two cases above: with a store that writes,
      // what is logged is what is in the file.
      const store = file.openStore(() => true);
      const runtime = start(store, 'lmu');

      await playLmu(runtime, stage);
      const events = await runtime.getEvents();
      runtime.dispose();
      await idle();
      await store.flush();
      await idle();

      const [race] = file.db.races.list();
      expect(events).toHaveLength(6);
      expect(file.db.races.events(race.id)).toEqual(events);
      expect(file.errors).toEqual([]);
    }, 120_000);
  }
);

describe.skipIf(!iracingTapeAvailable())(
  'the race log on a recorded iRacing race',
  () => {
    it('says the start, and each class’s fastest lap once its cars have run three', async () => {
      const runtime = start(file.openStore(), 'iracing');
      // A recording: nothing of it is to be written.
      runtime.setPersisting(false);

      const { frames, timed, greenAt } = await playIracing(runtime);
      const events = await runtime.getEvents();
      runtime.dispose();
      await idle();

      expect(frames).toBe(36_000);
      // The green flag, then one line for each of the three classes as its
      // third lap comes in, and one more for a lap that bettered one of
      // them later. Nobody pits, nobody is away, no caution, no black flag.
      expect(events.map((event) => [event.kind, event.carIdx])).toEqual([
        ['flag', null],
        ['fastest-lap', 31],
        ['fastest-lap', 12],
        ['fastest-lap', 0],
        ['fastest-lap', 7],
      ]);

      const [green, ...laps] = events;
      expect(green).toMatchObject({
        flag: 'green',
        after: 'start',
        durationS: null,
        late: false,
      });
      // Within a tick of the frame the session went racing on.
      expect(green.sessionTime).toBeGreaterThanOrEqual(greenAt);
      expect(green.sessionTime).toBeLessThan(greenAt + 0.4);
      // iRacing's clock in the sim, on every one of them.
      expect(events.every((event) => (event.timeOfDay ?? 0) > 52_000)).toBe(
        true
      );

      expect(
        laps.map((event) => event.kind === 'fastest-lap' && event.lap)
      ).toEqual([3, 3, 3, 4]);
      for (const event of laps) {
        if (event.kind !== 'fastest-lap') throw new Error('Not a lap');
        // A time the sim itself gave that car, and no other.
        expect(
          timed[event.carIdx].has(event.lapTime),
          `car ${event.carIdx}`
        ).toBe(true);
        expect(event.driver).not.toBe('');
      }
      // And the quickest lap any car of the recording was given is among
      // them: the fastest class's fastest lap.
      const quickest = Math.min(...timed.flatMap((times) => [...times]));
      expect(
        laps.some(
          (event) => event.kind === 'fastest-lap' && event.lapTime === quickest
        )
      ).toBe(true);
      expect(file.asked('raceWrite')).toBe(0);
    }, 120_000);
  }
);
