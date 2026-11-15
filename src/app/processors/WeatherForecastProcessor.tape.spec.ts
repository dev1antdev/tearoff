import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LmuRestSession, WeatherForecastSnapshot } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  LMU_TAPE_ADDON_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { createLmuRestPoller } from '../lmu/rest/poller';
import { createLmuRestData } from '../lmu/rest/state';
import { createLmuTapeRestTransport } from '../lmu/rest/tapeTransport';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import { SessionBarProcessor } from './SessionBarProcessor';
import { WeatherForecastProcessor } from './WeatherForecastProcessor';

const WEATHER = '/rest/sessions/weather';
const SESSIONS = '/rest/sessions';
/** One speed for both passes: the addon reads it once per process. */
const TAPE_SPEED = 40;

interface RestSdk {
  start(): boolean;
  stop(): boolean;
  read(): { running?: boolean };
  readRest(restPath: string): string | null;
}

type Bodies = Record<string, string>;

/** The first answers the recording holds for the forecast and the settings. */
const recordedBodies = (): Bodies => {
  process.env.IRDASHIES_LMU_REPLAY = LMU_CURATED_TAPE_PATH;
  process.env.IRDASHIES_LMU_REPLAY_SPEED = String(TAPE_SPEED);
  process.env.IRDASHIES_LMU_REPLAY_LOOP = '0';
  const { LmuSdkNode } = createRequire(import.meta.url)(
    LMU_TAPE_ADDON_PATH
  ) as {
    LmuSdkNode: new () => RestSdk;
  };
  const sdk = new LmuSdkNode();
  const bodies: Bodies = {};
  try {
    sdk.start();
    // The tape moves only when it is read, and both are among its first
    // records.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      for (const restPath of [WEATHER, SESSIONS]) {
        const body = sdk.readRest(restPath);
        if (body !== null) bodies[restPath] = body;
      }
      if (bodies[WEATHER] && bodies[SESSIONS]) break;
      sdk.read();
    }
  } finally {
    sdk.stop();
  }
  return bodies;
};

/** What the real poller lands on the session from those answers. */
const landedSession = async (bodies: Bodies): Promise<LmuRestSession> => {
  const data = createLmuRestData();
  const poller = createLmuRestPoller({
    data,
    transport: createLmuTapeRestTransport({
      readRest: (restPath) => bodies[restPath] ?? null,
    }),
    tasks: LMU_REST_TASKS,
  });
  poller.setActive(true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  poller.stop();
  return data.session;
};

/**
 * The forecast on a recorded Le Mans Ultimate race: fifteen minutes at Laguna
 * Seca in real time, under a sky that clouds over a little and never rains,
 * joined 140 s in and followed for four minutes. The recording holds the
 * sim's own answers for the forecast and the session settings, so this is the
 * processor on what the sim sent, through the parsers that read it.
 *
 * It is also where the placement of the forecast's points was measured: the
 * air temperature the sim published meets the second and the third point's
 * on the step of their times. One dry race at a time scale of 1; nothing
 * here says what a session with changing weather or a faster day does.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'the weather forecast on a recorded LMU race',
  () => {
    let rest: LmuRestSession = {};
    /** Every snapshot whose version moved, with the tick it moved on. */
    const published: { at: number; snapshot: WeatherForecastSnapshot }[] = [];
    /** The snapshot as the recording leaves it, and its last tick. */
    let final: { at: number; snapshot: WeatherForecastSnapshot } | undefined;
    /**
     * The sim's own air temperature, each time it moved: on the session
     * clock the app runs on, and on scoring's, which the weather is written
     * with, five times a second.
     */
    const airTemps: { at: number; scoringAt: number; celsius: number }[] = [];
    /** When the sim's cloud cover index moved, and to what. */
    const cloudCover: { at: number; index: number }[] = [];
    /** Every length and end time the frames stated. */
    const timeTotals = new Set<number>();
    const endTimes = new Set<number>();
    const rain = new Set<number>();

    beforeAll(async () => {
      const bodies = recordedBodies();
      expect(Object.keys(bodies).sort()).toEqual([SESSIONS, WEATHER].sort());
      rest = await landedSession(bodies);

      // As the host wires them: the session bar measures the time scale and
      // the forecast reads it, once a second.
      const bar = new SessionBarProcessor();
      const forecast = new WeatherForecastProcessor(
        () => bar.snapshot().timeScale
      );
      let started = false;
      let lastTick = Number.NEGATIVE_INFINITY;
      let lastVersion = -1;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: TAPE_SPEED,
        onFrame: ({ raw, telemetry, session, sessionChanged, sessionTime }) => {
          if (!started || sessionChanged) {
            // The session as the bridge publishes it once REST has answered.
            const withRest = { ...session, LmuRest: rest };
            bar.init(withRest);
            forecast.init(withRest);
          }
          if (!started) {
            started = true;
            bar.onLifecycle({ type: 'enter', replay: false });
            forecast.onLifecycle({ type: 'enter', replay: false });
          }
          bar.onFrame(telemetry);

          const cloud = telemetry.Skies?.value?.[0];
          if (
            typeof cloud === 'number' &&
            cloud !== cloudCover[cloudCover.length - 1]?.index
          ) {
            cloudCover.push({ at: sessionTime, index: cloud });
          }
          const airTemp = telemetry.AirTemp?.value?.[0];
          if (
            typeof airTemp === 'number' &&
            airTemp !== airTemps[airTemps.length - 1]?.celsius
          ) {
            airTemps.push({
              at: sessionTime,
              scoringAt: raw.currentET,
              celsius: airTemp,
            });
          }
          const timeTotal = telemetry.SessionTimeTotal?.value?.[0];
          if (typeof timeTotal === 'number') timeTotals.add(timeTotal);
          const endTime = telemetry.LmuSessionEndTime?.value?.[0];
          if (typeof endTime === 'number') endTimes.add(endTime);
          const precipitation = telemetry.Precipitation?.value?.[0];
          if (typeof precipitation === 'number') rain.add(precipitation);

          if (sessionTime - lastTick < 1) return;
          lastTick = sessionTime;
          forecast.onFrame(telemetry);
          const snapshot = forecast.snapshot();
          final = { at: sessionTime, snapshot };
          if (snapshot.version === lastVersion) return;
          lastVersion = snapshot.version;
          published.push({ at: sessionTime, snapshot });
        },
      });
    }, 180_000);

    it('holds five points for each of practice, qualifying and the race', () => {
      expect(rest.forecast?.practice).toHaveLength(5);
      expect(rest.forecast?.qualify).toHaveLength(5);
      const race = rest.forecast?.race ?? [];
      expect(race.map((node) => node.start)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
      expect(race.map((node) => node.skyType)).toEqual([0, 1, 1, 1, 2]);
      expect(race.map((node) => node.temperature)).toEqual([
        18, 17, 16, 16, 16,
      ]);
      expect(race.map((node) => node.rainChance)).toEqual([0, 0, 0, 0, 0]);
    });

    it('takes the race’s length from its setting, the green flag not having been seen', () => {
      // Fifteen minutes, as the sim's session settings state it.
      expect(rest.raceTime).toBe(900);
      // The clock ends at 1035 s, 135 s more than that.
      expect([...endTimes]).toEqual([1035]);
      // The recording begins after the flag, so the frames never state a
      // length shorter than the end time. The rule's first choice, the end
      // time less the flag, is not what this recording exercises.
      expect([...timeTotals]).toEqual([1035]);
    });

    it('is available from its first tick, with the four points at 180, 360, 540 and 720 s', () => {
      const [first] = published;
      expect(first.at).toBeGreaterThan(139);
      expect(first.at).toBeLessThan(141);
      expect(first.snapshot.available).toBe(true);
      expect(first.snapshot.lapLimited).toBe(false);
      // A race is session 10 and above, so this is the race's forecast.
      expect(first.snapshot.sessionNum).toBeGreaterThanOrEqual(10);

      const nodes = first.snapshot.nodes;
      expect(nodes.map((node) => node.index)).toEqual([1, 2, 3, 4]);
      // Fifths of the race's 900 s, seen from 139.8 s: 40, 220, 400 and
      // 580 s away.
      expect(nodes.map((node) => node.startsInMinutes)).toEqual([0, 3, 6, 9]);
      expect(nodes.map((node) => node.skyType)).toEqual([1, 1, 1, 2]);
      expect(nodes.map((node) => node.airTempC)).toEqual([17, 16, 16, 16]);
      expect(nodes.map((node) => node.rainChance)).toEqual([0, 0, 0, 0]);
      expect(nodes.map((node) => node.humidity)).toEqual([
        0.6, 0.62, 0.54, 0.57,
      ]);
      expect(nodes.map((node) => node.windSpeedMs)).toEqual([17, 17, 14, 11]);
      // North-west, all four.
      nodes.forEach((node) =>
        expect(node.windDirectionRad).toBeCloseTo((7 * Math.PI) / 4, 6)
      );
    });

    it('drops each point as its time comes: the first at 180 s, the second at 360 s', () => {
      // Ticks are a second apart, so a point goes on the first one at or
      // after its time.
      const firstWithout = (index: number) =>
        published.find((entry) =>
          entry.snapshot.nodes.every((node) => node.index !== index)
        );
      expect(firstWithout(1)?.at).toBeGreaterThanOrEqual(180);
      expect(firstWithout(1)?.at).toBeLessThan(181.5);
      expect(firstWithout(2)?.at).toBeGreaterThanOrEqual(360);
      expect(firstWithout(2)?.at).toBeLessThan(361.5);

      // The recording ends at 379.9 s, with the third 160 s away and the
      // fourth 340 s.
      expect(final?.at).toBeGreaterThan(375);
      expect(final?.snapshot.nodes.map((node) => node.index)).toEqual([3, 4]);
      expect(final?.snapshot.nodes.map((node) => node.startsInMinutes)).toEqual(
        [2, 5]
      );
    });

    it('is met by the air temperature on the step of each point’s time', () => {
      // What the placement rests on. The forecast says 18 degrees at the
      // start, 17 at the second point and 16 at the third, and the sim's air
      // temperature eases from one to the next. On scoring's clock, which
      // steps a fifth of a second at a time, it is exactly 17 at 180.0 s and
      // exactly 16 at 360.0 s: the fifths of the race's 900 s, not of the
      // 1035 s its clock ends at.
      const race = rest.forecast?.race ?? [];
      expect([race[1].temperature, race[2].temperature]).toEqual([17, 16]);

      const firstAtOrBelow = (celsius: number) =>
        airTemps.findIndex((entry) => entry.celsius <= celsius);
      const secondIndex = firstAtOrBelow(17);
      const thirdIndex = firstAtOrBelow(16);
      expect(secondIndex).toBeGreaterThan(0);
      expect(thirdIndex).toBeGreaterThan(secondIndex);
      const second = airTemps[secondIndex];
      const third = airTemps[thirdIndex];

      // Reached exactly, not passed between two readings...
      expect(second.celsius).toBe(17);
      expect(third.celsius).toBe(16);
      // ...and on the scoring step of the point's time. The session clock
      // the app runs on is the player's own, a few milliseconds on.
      expect(second.scoringAt).toBeCloseTo(180, 6);
      expect(third.scoringAt).toBeCloseTo(360, 6);
      expect(Math.abs(second.at - 180)).toBeLessThan(0.1);
      expect(Math.abs(third.at - 360)).toBeLessThan(0.1);

      // One step earlier, a fifth of a second, each was still short of it,
      // by less than a ten thousandth of a degree.
      const beforeSecond = airTemps[secondIndex - 1];
      const beforeThird = airTemps[thirdIndex - 1];
      expect(second.scoringAt - beforeSecond.scoringAt).toBeCloseTo(0.2, 6);
      expect(third.scoringAt - beforeThird.scoringAt).toBeCloseTo(0.2, 6);
      expect(beforeSecond.celsius - 17).toBeGreaterThan(0);
      expect(beforeSecond.celsius - 17).toBeLessThan(0.0001);
      expect(beforeThird.celsius - 16).toBeGreaterThan(0);
      expect(beforeThird.celsius - 16).toBeLessThan(0.0001);

      // Past the second point it goes on falling toward the third, and from
      // the third it holds: the fourth and fifth are 16 degrees as well.
      expect(airTemps[secondIndex + 1].celsius).toBeLessThan(17);
      expect(thirdIndex).toBe(airTemps.length - 1);
      expect(final?.snapshot.now.airTempC).toBe(16);
    });

    it('has nothing to say about rain, and a cloud cover that fits no fifth', () => {
      // No point of this forecast has any chance of rain, and none fell:
      // nothing to place.
      expect([...rain]).toEqual([0]);

      // The forecast's sky is clear at the start and light cloud from the
      // second point, at 180 s. The sim's cloud cover index went from 0 to 1
      // at 247.6 s: 67.6 s after that point's time, and at no fifth of the
      // race's length or of the end time. Why is not known.
      expect(cloudCover.map((entry) => entry.index)).toEqual([0, 1]);
      expect(cloudCover[1].at).toBeGreaterThan(247);
      expect(cloudCover[1].at).toBeLessThan(248);
      expect(published[0].snapshot.now.skyType).toBe(0);
      expect(final?.snapshot.now.skyType).toBe(1);
    });

    it('reads a clear, dry sky and an air temperature a little over 17, falling', () => {
      const { now } = published[0].snapshot;
      expect(now.skyType).toBe(0);
      expect(now.rain).toBe(0);
      expect(now.airTempC).toBeGreaterThanOrEqual(17.1);
      expect(now.airTempC).toBeLessThanOrEqual(17.2);
      // The first reading is a baseline, not a rise.
      expect(now.airTempTrend).toBe(0);
      expect(now.rainTrend).toBe(0);

      // 17.15 falling to 16.00 over the four minutes: never rising, and
      // seen falling.
      const trends = published.map((entry) => entry.snapshot.now.airTempTrend);
      expect(trends).toContain(-1);
      expect(trends).not.toContain(1);
      expect(
        published.every((entry) => entry.snapshot.now.rainTrend === 0)
      ).toBe(true);
      expect(final?.snapshot.now).toMatchObject({ airTempC: 16, rain: 0 });
    });

    it('gives the points a clock time once the time scale is measured', () => {
      // Nothing to turn minutes into a clock with for the first window.
      expect(
        published[0].snapshot.nodes.map((node) => node.startsAtTimeOfDay)
      ).toEqual([null, null, null, null]);

      const timed = published.find((entry) =>
        entry.snapshot.nodes.some((node) => node.startsAtTimeOfDay !== null)
      );
      expect(timed).toBeDefined();
      expect((timed?.at ?? 0) - published[0].at).toBeLessThan(8);
      // The day began at 15:10:00 and runs in real time: 15:13, 15:16, 15:19
      // and 15:22.
      expect(
        timed?.snapshot.nodes.map((node) => node.startsAtTimeOfDay)
      ).toEqual([54_780, 54_960, 55_140, 55_320]);

      // And they stay put: each point has one clock time for as long as it
      // is published.
      const seen = new Map<number, Set<number>>();
      for (const { snapshot } of published) {
        for (const node of snapshot.nodes) {
          if (node.startsAtTimeOfDay === null) continue;
          const times = seen.get(node.index) ?? new Set<number>();
          times.add(node.startsAtTimeOfDay);
          seen.set(node.index, times);
        }
      }
      expect([...seen.values()].map((times) => times.size)).toEqual([
        1, 1, 1, 1,
      ]);
    });

    it('publishes a few times a minute, not once a second', () => {
      // Four minutes of ticks, 240 of them.
      expect(published.length).toBeGreaterThan(8);
      expect(published.length).toBeLessThan(45);
    });
  }
);
