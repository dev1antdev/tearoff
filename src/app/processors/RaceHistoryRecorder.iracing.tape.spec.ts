import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { RaceLap, Session, Telemetry } from '@irdashies/types';
import {
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
} from '@irdashies/types';
import {
  TapeReader,
  type TapeVariable,
} from '../../../tools/telemetry-replay/tape';
import {
  RaceHistoryRecorder,
  type RaceHistoryListener,
  type RaceStart,
} from './RaceHistoryRecorder';

/**
 * The race history on a real iRacing race: ten minutes of an AI race at
 * Road America, recorded from the live SDK at 60 frames a second.
 *
 * What this adds to the Le Mans Ultimate recording is iRacing's own timing:
 * a lap's time comes up to a second after the car has crossed the line, not
 * with the lap count, and a lap is kept here with the time that came for it
 * and no other.
 *
 * The tape is read frame by frame, as the recorder needs a dozen of a
 * frame's values and nothing of the bridge.
 */

const TAPE_PATH = path.resolve('test-data/telemetry/ai-race-10min.irdt');
/** The recording itself, not the Git LFS pointer left in its place. */
const tapeAvailable = (): boolean =>
  fs.existsSync(TAPE_PATH) && fs.statSync(TAPE_PATH).size > 1024 * 1024;

/** The SDK's variable types, by number. */
const readers: Record<number, (payload: Buffer, at: number) => unknown> = {
  1: (payload, at) => payload.readUInt8(at) === 1,
  2: (payload, at) => payload.readInt32LE(at),
  3: (payload, at) => payload.readInt32LE(at),
  4: (payload, at) => payload.readFloatLE(at),
  5: (payload, at) => payload.readDoubleLE(at),
};
const widths: Record<number, number> = { 1: 1, 2: 4, 3: 4, 4: 4, 5: 8 };

/** The frame keys the recorder and the pit tracker inside it read. */
const KEYS = [
  'SessionTime',
  'SessionNum',
  'SessionFlags',
  'PlayerCarIdx',
  'CarIdxLap',
  'CarIdxLapCompleted',
  'CarIdxLapDistPct',
  'CarIdxLastLapTime',
  'CarIdxPosition',
  'CarIdxClassPosition',
  'CarIdxOnPitRoad',
  'CarIdxTrackSurface',
  'CarIdxSessionFlags',
  'CarIdxTireCompound',
] as const;

interface Played {
  recorder: RaceHistoryRecorder;
  starts: RaceStart[];
  ended: number;
  /** How many times each lap was handed on with its time settled. */
  settledTimes: Map<RaceLap, number>;
  /**
   * What the sim said each car's last lap took, each time it moved, with
   * the session time it moved at. A time of -1 is the sim saying it has
   * none.
   */
  timed: { time: number; at: number }[][];
  frames: number;
  sessions: number;
  firstClock: number;
  lastClock: number;
  drivers: Map<number, string>;
}

const play = async (): Promise<Played> => {
  const out: Played = {
    recorder: undefined as unknown as RaceHistoryRecorder,
    starts: [],
    ended: 0,
    settledTimes: new Map(),
    timed: [],
    frames: 0,
    sessions: 0,
    firstClock: Number.NaN,
    lastClock: Number.NaN,
    drivers: new Map(),
  };
  const listener: RaceHistoryListener = {
    onRaceStarted: (start) => out.starts.push(start),
    onLap: (lap, settled) => {
      if (settled) {
        out.settledTimes.set(lap, (out.settledTimes.get(lap) ?? 0) + 1);
      }
    },
    onStint: () => undefined,
    onDriverChange: () => undefined,
    onRaceInfoChanged: () => undefined,
    onCarReplaced: () => undefined,
    onRaceEnded: () => {
      out.ended += 1;
    },
  };
  out.recorder = new RaceHistoryRecorder(listener, {
    simulator: () => 'iracing',
    sessionIdsAreUnique: () => true,
    now: () => 1_800_000_000_000,
    bootId: 'tape',
  });

  const reader = await TapeReader.open(TAPE_PATH);
  const variables: [string, TapeVariable][] = KEYS.map((name) => {
    const found = reader.schema.variables.get(name);
    if (!found) throw new Error(`The tape has no ${name}`);
    return [name, found];
  });
  const last: number[] = [];
  try {
    for (;;) {
      const entry = await reader.readRecord();
      if (!entry) break;
      if (entry.kind === 'sessionInfo') {
        // The SDK's text is padded to its buffer with zero bytes.
        const text = entry.payload.toString('utf8');
        const end = text.indexOf(String.fromCharCode(0));
        const session = yaml.load(end < 0 ? text : text.slice(0, end), {
          json: true,
        }) as Session;
        out.sessions += 1;
        for (const driver of session.DriverInfo?.Drivers ?? []) {
          out.drivers.set(driver.CarIdx, driver.UserName);
        }
        out.recorder.onSession(session);
        continue;
      }
      if (entry.kind !== 'frame') continue;
      out.frames += 1;
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
      const clock = frame.SessionTime.value[0] as number;
      if (Number.isNaN(out.firstClock)) out.firstClock = clock;
      out.lastClock = clock;
      const times = frame.CarIdxLastLapTime.value as number[];
      for (let carIdx = 0; carIdx < times.length; carIdx += 1) {
        out.timed[carIdx] ??= [];
        if (out.frames > 1 && times[carIdx] !== last[carIdx]) {
          out.timed[carIdx].push({ time: times[carIdx], at: clock });
        }
        last[carIdx] = times[carIdx];
      }
      out.recorder.onFrame(frame as unknown as Telemetry);
    }
  } finally {
    await reader.close();
  }
  return out;
};

/** Cars in the recorded race: slots 0 to 39, in three classes. */
const CARS = 40;

describe.skipIf(!tapeAvailable())(
  'the race history on a recorded iRacing race',
  () => {
    it('keeps every lap of every car with the time iRacing gave it', async () => {
      const played = await play();
      const { recorder } = played;

      expect(played.frames).toBe(36_000);
      // One race from the first frame to the last. An AI race has no event
      // id, so nothing names the session but what it is made of.
      expect(played.starts).toHaveLength(1);
      expect(played.ended).toBe(0);
      expect(played.starts[0].info).toMatchObject({
        simulator: 'iracing',
        sessionKey: '',
        sessionType: 'Race',
        trackName: 'Road America',
      });
      expect(played.starts[0].info.entries).toHaveLength(CARS);
      // The pace car is in the session and is nobody's rival.
      expect(played.drivers.size).toBeGreaterThan(CARS);

      let laps = 0;
      let waiting = 0;
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const held = recorder.carLaps(carIdx);
        const timed = played.timed[carIdx];
        // Three or four laps each, numbered from 1 without a hole.
        expect(held.length, `car ${carIdx}`).toBeGreaterThanOrEqual(3);
        expect(held.map((lap) => lap.lap)).toEqual(
          held.map((_, index) => index + 1)
        );
        expect(recorder.missingLaps(carIdx)).toEqual([]);
        laps += held.length;

        held.forEach((lap, index) => {
          const fromSim = timed[index];
          if (!fromSim) {
            // Completed in the recording's last second: iRacing had not
            // said what it took before the recording ended.
            expect(index).toBe(held.length - 1);
            expect(played.lastClock - lap.sessionTime).toBeLessThan(1);
            expect(lap.lapTime).toBeNull();
            waiting += 1;
            return;
          }
          // The time is the one iRacing gave for this lap, and it gave it
          // after the car had crossed the line, by up to a second or so.
          expect(lap.lapTime, `car ${carIdx} lap ${lap.lap}`).toBe(
            fromSim.time
          );
          expect(fromSim.at).toBeGreaterThan(lap.sessionTime);
          expect(fromSim.at - lap.sessionTime).toBeLessThan(1.5);
          expect(played.settledTimes.get(lap)).toBe(1);
          // The line times are the car's own: two of them are as far apart
          // as iRacing says the lap between took.
          if (index > 0) {
            expect(lap.sessionTime - held[index - 1].sessionTime).toBeCloseTo(
              fromSim.time,
              1
            );
          }
          expect(lap.driver).toBe(played.drivers.get(carIdx));
          expect(lap.position).toBeGreaterThan(0);
          expect(lap.classPosition).toBeGreaterThan(0);
          // iRacing gives no sectors and no fuel for another car, and one
          // compound a car.
          expect(lap.sectors).toEqual([null, null, null]);
          expect(lap.energy).toBeNull();
          expect(new Set(lap.compounds).size).toBe(1);
          // The first lap of a race begins on the grid; nobody pits.
          expect(lap.flags & LEDGER_LAP_FROM_START).toBe(
            index === 0 ? LEDGER_LAP_FROM_START : 0
          );
          expect(lap.flags & (LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP)).toBe(0);
        });

        // One stint for the whole of it; the lap from the grid is not a
        // clean one, and a lap without its time yet is in nobody's pace.
        const timedLaps = held.filter((lap) => lap.lapTime !== null);
        expect(recorder.carStints(carIdx)).toMatchObject([
          {
            ordinal: 1,
            openedBy: 'start',
            closedBy: null,
            firstLap: 1,
            lastLap: held.length,
            laps: held.length,
            cleanLaps: timedLaps.length - 1,
            stop: null,
          },
        ]);
      }
      expect(laps).toBe(148);
      expect(waiting).toBe(2);
      expect(recorder.driverChanges()).toEqual([]);
    }, 180_000);

    it('measures each lap’s gap to the first car of its class at the line', async () => {
      const played = await play();
      const classOf = new Map(
        played.starts[0].info.entries.map((entry) => [
          entry.carIdx,
          entry.classId,
        ])
      );
      const byClassAndLap = new Map<string, RaceLap[]>();
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        for (const lap of played.recorder.carLaps(carIdx)) {
          const key = `${classOf.get(carIdx)}:${lap.lap}`;
          byClassAndLap.set(key, [...(byClassAndLap.get(key) ?? []), lap]);
        }
      }

      expect(new Set(classOf.values()).size).toBe(3);
      expect(byClassAndLap.size).toBe(12);
      for (const [key, laps] of byClassAndLap) {
        const first = laps.reduce((a, b) =>
          a.sessionTime <= b.sessionTime ? a : b
        );
        // Recorded from before the green flag, so every class leader's
        // crossing was seen and every gap is known.
        expect(first.classGap, key).toBe(0);
        for (const lap of laps) {
          expect(lap.classGap, key).toBeCloseTo(
            lap.sessionTime - first.sessionTime,
            9
          );
        }
      }
    }, 180_000);
  }
);
