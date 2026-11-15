import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  Session,
  Telemetry,
  TrackProfile,
  TrackProfileKey,
  TrackProfileLap,
} from '@irdashies/types';
import { TapeReader } from '../../../tools/telemetry-replay/tape';
import { mergeProfileLap, profileDemand } from '../storage/trackProfiles';
import { TrackProfileRecorder } from './TrackProfileRecorder';

/**
 * The track profile added up from a real iRacing race: ten minutes at Road
 * America, 60 frames a second, three whole laps of the player's.
 *
 * iRacing states no height in live telemetry, so a lap's elevation is the
 * car's vertical speed added up from the line, and which way round Pitch
 * and Roll count is not written down anywhere. This is where it is settled:
 * only the right signs bring the car back to the height it started the lap
 * at. With them every lap closes to a hand's width and spans 53.7 m, and
 * Road America's own figure is 174 ft, 53 m.
 *
 * The tape is read here frame by frame, as the recorder needs nothing from
 * a frame but a dozen values.
 */

const TAPE_PATH = path.resolve('test-data/telemetry/ai-race-10min.irdt');
/** The recording itself, not the Git LFS pointer left in its place. */
const tapeAvailable = (): boolean =>
  fs.existsSync(TAPE_PATH) && fs.statSync(TAPE_PATH).size > 1024 * 1024;

type Reading = Record<
  | 'time'
  | 'sessionNum'
  | 'pct'
  | 'forwards'
  | 'toTheLeft'
  | 'upwards'
  | 'pitch'
  | 'roll',
  number
> & { onTrack: boolean; pitRoad: boolean };

/** Which way round a second recorder is told the car's attitude counts. */
interface Signs {
  pitch: 1 | -1;
  roll: 1 | -1;
}

const toFrame = (reading: Reading, signs: Signs): Telemetry =>
  ({
    SessionTime: { value: [reading.time] },
    SessionNum: { value: [reading.sessionNum] },
    CarIdxLapDistPct: { value: [reading.pct] },
    CarIdxOnPitRoad: { value: [reading.pitRoad] },
    IsOnTrack: { value: [reading.onTrack] },
    VelocityX: { value: [reading.forwards] },
    VelocityY: { value: [reading.toTheLeft] },
    VelocityZ: { value: [reading.upwards] },
    Pitch: { value: [reading.pitch * signs.pitch] },
    Roll: { value: [reading.roll * signs.roll] },
  }) as unknown as Telemetry;

/** One value of the session text, by its key. */
const sessionField = (yaml: string, key: string): string =>
  new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(yaml)?.[1].trim() ?? '';

/** As much of the session as a track profile is filed and sampled by. */
const toSession = (yaml: string): Session =>
  ({
    WeekendInfo: {
      TrackID: Number(sessionField(yaml, 'TrackID')),
      TrackDisplayName: sessionField(yaml, 'TrackDisplayName'),
      TrackLength: sessionField(yaml, 'TrackLength'),
    },
    // The player's car is slot 0, where the recorder is given its lap
    // fraction.
    DriverInfo: { DriverCarIdx: 0 },
    SplitTimeInfo: {
      Sectors: [...yaml.matchAll(/SectorStartPct:\s*([\d.]+)/g)].map(
        (match, SectorNum) => ({
          SectorNum,
          SectorStartPct: Number(match[1]),
        })
      ),
    },
  }) as unknown as Session;

interface Recording {
  frames: number;
  session: Session;
  /** The laps handed over with the signs the recorder uses. */
  laps: { key: TrackProfileKey; lap: TrackProfileLap; at: number }[];
  /** The profile after each of them, as the store would keep it. */
  profiles: TrackProfile[];
  /** How far out each lap was with one of the two signs turned. */
  pitchTurned: number[];
  rollTurned: number[];
}

const record = async (): Promise<Recording> => {
  const reader = await TapeReader.open(TAPE_PATH);
  const variable = (name: string) => {
    const found = reader.schema.variables.get(name);
    if (!found) throw new Error(`The tape has no ${name}`);
    return found.offset;
  };
  const at = {
    time: variable('SessionTime'),
    sessionNum: variable('SessionNum'),
    pct: variable('LapDistPct'),
    forwards: variable('VelocityX'),
    toTheLeft: variable('VelocityY'),
    upwards: variable('VelocityZ'),
    pitch: variable('Pitch'),
    roll: variable('Roll'),
    onTrack: variable('IsOnTrack'),
    pitRoad: variable('OnPitRoad'),
  };

  let profile: TrackProfile | null = null;
  let now = 0;
  const laps: Recording['laps'] = [];
  const profiles: TrackProfile[] = [];
  const recorder = new TrackProfileRecorder(
    {
      wants: (key) => profileDemand(profile, key, 'integrated'),
      recordLap: (key, lap) => {
        laps.push({ key, lap, at: now });
        const next = mergeProfileLap(profile, key, lap, 1_700_000_000_000);
        if (!next) return;
        profile = next;
        profiles.push(next);
      },
    },
    { simulator: 'iracing' }
  );
  /** A recorder told the attitude the other way round; it keeps nothing. */
  const turned = (signs: Signs) => {
    const closures: number[] = [];
    const other = new TrackProfileRecorder(
      {
        wants: () => 'first',
        recordLap: (_key, lap) => {
          closures.push(lap.closureM);
        },
      },
      { simulator: 'iracing' }
    );
    return { closures, recorder: other, signs };
  };
  const others = [
    turned({ pitch: -1, roll: 1 }),
    turned({ pitch: 1, roll: -1 }),
  ];
  const recorders = [
    { recorder, signs: { pitch: 1, roll: 1 } as Signs },
    ...others,
  ];
  for (const each of recorders) each.recorder.onEnter();

  let frames = 0;
  let session: Session | null = null;
  try {
    for (;;) {
      const entry = await reader.readRecord();
      if (!entry) break;
      if (entry.kind === 'sessionInfo') {
        // The first is enough: the track does not change, and the rest are
        // the standings moving.
        if (session) continue;
        session = toSession(entry.payload.toString('utf8'));
        for (const each of recorders) each.recorder.onSession(session);
        continue;
      }
      if (entry.kind !== 'frame' || !session) continue;
      frames += 1;
      const payload = entry.payload;
      const reading: Reading = {
        time: payload.readDoubleLE(at.time),
        sessionNum: payload.readInt32LE(at.sessionNum),
        pct: payload.readFloatLE(at.pct),
        forwards: payload.readFloatLE(at.forwards),
        toTheLeft: payload.readFloatLE(at.toTheLeft),
        upwards: payload.readFloatLE(at.upwards),
        pitch: payload.readFloatLE(at.pitch),
        roll: payload.readFloatLE(at.roll),
        onTrack: payload.readUInt8(at.onTrack) === 1,
        pitRoad: payload.readUInt8(at.pitRoad) === 1,
      };
      now = reading.time;
      for (const each of recorders) {
        each.recorder.onFrame(toFrame(reading, each.signs));
      }
    }
  } finally {
    await reader.close();
  }
  if (!session) throw new Error('The tape holds no session');
  return {
    frames,
    session,
    laps,
    profiles,
    pitchTurned: others[0].closures,
    rollTurned: others[1].closures,
  };
};

const rangeOf = (values: Iterable<number>): number => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const value of values) {
    lowest = Math.min(lowest, value);
    highest = Math.max(highest, value);
  }
  return highest - lowest;
};

describe.skipIf(!tapeAvailable())(
  'the track profile on a recorded iRacing race at Road America',
  () => {
    let tape: Recording;

    beforeAll(async () => {
      tape = await record();
    }, 120_000);

    it('reads the recording from end to end', () => {
      expect(tape.frames).toBe(36_000);
      expect(tape.session.WeekendInfo.TrackID).toBe(18);
      expect(tape.session.WeekendInfo.TrackLength).toBe('6.4135 km');
    });

    it('takes the three laps driven from line to line', () => {
      // Over the line at 160.2, 299.9, 431.2 and 560.5 s.
      expect(tape.laps).toHaveLength(3);
      expect(tape.laps.map(({ at }) => Math.round(at))).toEqual([
        300, 431, 560,
      ]);
      for (const { key, lap } of tape.laps) {
        expect(key).toMatchObject({
          simulator: 'iracing',
          trackId: 18,
          trackLengthM: 6413.5,
          pointsCount: 642,
        });
        expect(lap.source).toBe('integrated');
        expect(lap.elevationM).toHaveLength(642);
        // No position to keep: iRacing states none.
        expect(lap.xM).toBeNull();
        expect(lap.zM).toBeNull();
      }
    });

    it('closes every lap, far inside the five metres a lap is allowed', () => {
      for (const { lap } of tape.laps) {
        expect(lap.closureM).toBeLessThan(0.15);
        // Zero at the line, and back to it.
        expect(Math.abs(lap.elevationM[0])).toBeLessThan(0.2);
        expect(Math.abs(lap.elevationM[641])).toBeLessThan(0.5);
      }
    });

    it('closes with one pair of signs only', () => {
      // Pitch counted the other way: the car ends each lap 90 m above
      // where it began it, which the store would refuse.
      expect(tape.pitchTurned).toHaveLength(3);
      for (const closure of tape.pitchTurned) {
        expect(closure).toBeGreaterThan(85);
        expect(closure).toBeLessThan(95);
      }
      // Roll counted the other way moves little, a car's sideways speed
      // being small, and still leaves every lap further out than ours.
      expect(tape.rollTurned).toHaveLength(3);
      tape.rollTurned.forEach((closure, index) => {
        expect(closure).toBeGreaterThan(0.2);
        expect(closure).toBeGreaterThan(tape.laps[index].lap.closureM * 3);
      });
    });

    it("spans Road America's 53 m on every lap", () => {
      for (const { lap } of tape.laps) {
        expect(Math.abs(rangeOf(lap.elevationM) - 53.7)).toBeLessThan(0.8);
      }
      // And the three agree with one another, bucket for bucket.
      const [first, second, third] = tape.laps.map(({ lap }) => lap.elevationM);
      let furthest = 0;
      for (let bucket = 0; bucket < 642; bucket += 1) {
        furthest = Math.max(
          furthest,
          Math.abs(first[bucket] - second[bucket]),
          Math.abs(first[bucket] - third[bucket])
        );
      }
      expect(furthest).toBeLessThan(1.5);
    });

    it('keeps the mean of the three, and then wants no more', () => {
      expect(tape.profiles.map(({ elevationLaps }) => elevationLaps)).toEqual([
        1, 2, 3,
      ]);
      const profile = tape.profiles[2];
      expect(profile).toMatchObject({
        simulator: 'iracing',
        trackId: 18,
        trackLengthM: 6413.5,
        pointsCount: 642,
        elevationSource: 'integrated',
        xM: null,
        zM: null,
      });
      const elevation = profile.elevationM as number[];
      expect(Math.abs(rangeOf(elevation) - 53.7)).toBeLessThan(0.8);
      expect(Math.abs(elevation[0])).toBeLessThan(0.2);
      expect(profileDemand(profile, tape.laps[0].key, 'integrated')).toBe(
        'none'
      );
    });

    it('takes the sector starts the session states', () => {
      const profile = tape.profiles[2];
      const stated = tape.session.SplitTimeInfo.Sectors.map(
        (sector) => sector.SectorStartPct
      );

      expect(stated.length).toBeGreaterThan(1);
      expect(stated[0]).toBe(0);
      expect(profile.sectorSource).toBe('session');
      expect(profile.sectorStartPct).toEqual(stated);
    });
  }
);
