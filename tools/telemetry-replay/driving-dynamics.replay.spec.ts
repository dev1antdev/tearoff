import { beforeAll, describe, expect, it } from 'vitest';
import {
  STANDARD_GRAVITY,
  type BrakingZone,
  type Telemetry,
} from '@irdashies/types';
import { BrakingProcessor } from '../../src/app/processors/BrakingProcessor';
import { GForceProcessor } from '../../src/app/processors/GForceProcessor';
import metadata from '../../test-data/telemetry/ai-race-10min.json';
import { rateLimited } from './rateLimited';
import {
  validateReplay,
  type ReplayProbe,
  type TelemetryFrame,
} from './validator';

/**
 * The friction circle's and the brake performance widget's channels on the
 * recorded iRacing race: ten minutes against the AI, every one of its 36,000
 * frames, so the figures here are exact.
 *
 * iRacing states no impact time, so the frame in which the incident count
 * rises stands in for one. The recording shows what that misses: see the
 * 3.68 g frame below.
 *
 * Optional 332 MB Git LFS capture:
 * IRDASHIES_TEST_CURATED_REPLAY=1 npx vitest run --no-coverage tools/telemetry-replay/driving-dynamics.replay.spec.ts
 */

const telemetryFrom = (frame: TelemetryFrame): Telemetry =>
  Object.fromEntries(
    Object.entries(frame).map(([name, entry]) => [
      name,
      { value: Array.isArray(entry) ? entry : [entry] },
    ])
  ) as unknown as Telemetry;

/** A brake application, whether or not it came to count as a zone. */
interface Application {
  startedAt: number;
  closedAt: number;
  peakG: number;
  zone: BrakingZone | null;
}

interface Mean {
  sum: number;
  count: number;
}

interface Recording {
  frames: number;
  unavailableFrames: number;
  /** When the incident count rose. */
  incidentsAt: number[];

  gPublishes: number;
  maxLatG: number;
  maxLongG: number;
  /** When the longitudinal maximum last rose. */
  maxLongSetAt: number;
  /** The longitudinal maximum over everything but that frame's hold. */
  maxLongBefore: number;
  sustainedLatG: number;
  /** Lateral acceleration with the wheel turned each way, m/s2. */
  steeringLeft: Mean;
  steeringRight: Mean;
  /**
   * Longitudinal acceleration with the raw brake above 0.8 at more than
   * 30 m/s, m/s2.
   */
  hardBraking: Mean;

  brakingPublishes: number;
  applications: Application[];
  reference: { at: number; g: number }[];
  locks: Set<string>;
  sessionBestG: number;
  zoneCount: number;
}

/** Radians of steering before a frame counts as cornering. */
const CORNERING_STEER = 0.1;
/** The one frame of 3.68 g, and the five seconds it stands as a maximum. */
const SPIKE_AT = 626.07;

const play = async (): Promise<Recording> => {
  const braking = new BrakingProcessor();
  // On the host's schedule, which at the tape's 60 Hz is every frame.
  const gForce = rateLimited(new GForceProcessor());
  braking.onLifecycle({ type: 'enter', replay: false });
  gForce.onLifecycle({ type: 'enter', replay: false });

  const tape: Recording = {
    frames: 0,
    unavailableFrames: 0,
    incidentsAt: [],
    gPublishes: 0,
    maxLatG: 0,
    maxLongG: 0,
    maxLongSetAt: 0,
    maxLongBefore: 0,
    sustainedLatG: 0,
    steeringLeft: { sum: 0, count: 0 },
    steeringRight: { sum: 0, count: 0 },
    hardBraking: { sum: 0, count: 0 },
    brakingPublishes: 0,
    applications: [],
    reference: [],
    locks: new Set(),
    sessionBestG: 0,
    zoneCount: 0,
  };
  let incidents: number | undefined;
  let gVersion = -1;
  let brakingVersion = -1;
  let lastZone: BrakingZone | null = null;
  let open: Application | null = null;

  const probe: ReplayProbe<number> = {
    name: 'driving-dynamics',
    schemaVersion: 1,
    variables: [
      'SessionTime',
      'SessionTick',
      'SessionNum',
      'LatAccel',
      'LongAccel',
      'BrakeRaw',
      'Speed',
      'BrakeABSactive',
      'OnPitRoad',
      'IsOnTrack',
      'IsInGarage',
      'LapCompleted',
      'PlayerCarMyIncidentCount',
      'SteeringWheelAngle',
    ],
    onFrame(frame) {
      const telemetry = telemetryFrom(frame);
      const t = Number(frame.SessionTime);
      tape.frames += 1;

      const count = Number(frame.PlayerCarMyIncidentCount);
      if (incidents !== undefined && count > incidents) {
        tape.incidentsAt.push(t);
      }
      incidents = count;

      gForce.onFrame(telemetry);
      const g = gForce.snapshot();
      if (g.version !== gVersion) tape.gPublishes += 1;
      gVersion = g.version;
      if (!g.available) tape.unavailableFrames += 1;
      tape.maxLatG = Math.max(tape.maxLatG, g.maxLatG);
      if (g.maxLongG > tape.maxLongG) {
        tape.maxLongG = g.maxLongG;
        tape.maxLongSetAt = t;
      }
      if (t < SPIKE_AT - 0.05 || t > SPIKE_AT + 5.1) {
        tape.maxLongBefore = Math.max(tape.maxLongBefore, g.maxLongG);
      }
      tape.sustainedLatG = Math.max(tape.sustainedLatG, g.sustainedLatG);

      const latAccel = Number(frame.LatAccel);
      const steer = Number(frame.SteeringWheelAngle);
      if (steer > CORNERING_STEER) {
        tape.steeringLeft.sum += latAccel;
        tape.steeringLeft.count += 1;
      }
      if (steer < -CORNERING_STEER) {
        tape.steeringRight.sum += latAccel;
        tape.steeringRight.count += 1;
      }
      if (Number(frame.BrakeRaw) > 0.8 && Number(frame.Speed) > 30) {
        tape.hardBraking.sum += Number(frame.LongAccel);
        tape.hardBraking.count += 1;
      }

      braking.onFrame(telemetry);
      const snapshot = braking.snapshot();
      if (snapshot.version !== brakingVersion) tape.brakingPublishes += 1;
      brakingVersion = snapshot.version;
      if (tape.reference.at(-1)?.g !== snapshot.referenceG) {
        tape.reference.push({ at: t, g: snapshot.referenceG });
      }
      if (snapshot.live) {
        if (!open) {
          open = {
            startedAt: t,
            closedAt: Number.NaN,
            peakG: 0,
            zone: null,
          };
          tape.applications.push(open);
        }
        open.peakG = Math.max(open.peakG, snapshot.live.peakG);
      } else if (open) {
        open.closedAt = t;
        if (snapshot.last !== lastZone) open.zone = snapshot.last;
        open = null;
      }
      lastZone = snapshot.last;
      tape.locks.add(JSON.stringify(snapshot.lockS));
      tape.sessionBestG = snapshot.sessionBestG;
      tape.zoneCount = snapshot.zoneCount;
      return snapshot.zoneCount;
    },
    onDisconnect() {
      braking.onLifecycle({ type: 'disconnect' });
      gForce.onLifecycle({ type: 'disconnect' });
    },
  };

  await validateReplay({
    path: 'test-data/telemetry/ai-race-10min.irdt',
    expected: { sha256: metadata.sha256, frameCount: metadata.frameCount },
    probes: [probe],
  });
  return tape;
};

const mean = ({ sum, count }: Mean): number => sum / count;

describe.skipIf(process.env.IRDASHIES_TEST_CURATED_REPLAY !== '1')(
  'driving dynamics with curated iRacing telemetry',
  () => {
    let tape: Recording;
    let zones: BrakingZone[];

    beforeAll(async () => {
      tape = await play();
      zones = tape.applications.flatMap(({ zone }) => (zone ? [zone] : []));
    }, 300_000);

    describe('the g-force channel', () => {
      it('reads every frame, in the car throughout', () => {
        expect(tape.frames).toBe(36_000);
        expect(tape.unavailableFrames).toBe(0);
        // A car being driven moves a hundredth of a g on most frames.
        expect(tape.gPublishes).toBe(32_736);
      });

      it('reads a left-hand corner as positive lateral acceleration', () => {
        // The wheel past 0.1 rad either way: 4,643 frames to the left and
        // 11,098 to the right. Past 0.3 rad the two means are +12.5 and
        // -13.3, which is nearer the figures the widget spec quotes.
        expect(mean(tape.steeringLeft)).toBeCloseTo(10.09, 1);
        expect(mean(tape.steeringRight)).toBeCloseTo(-11.11, 1);
      });

      it('reads braking as negative longitudinal acceleration', () => {
        // The raw brake above 0.8 at more than 30 m/s, on 145 frames: 1.97 g.
        expect(mean(tape.hardBraking)).toBeCloseTo(-19.31, 1);
        expect(tape.hardBraking.count).toBe(145);
        expect(mean(tape.hardBraking) / STANDARD_GRAVITY).toBeCloseTo(-1.97, 1);
      });

      it('holds a lateral maximum of 2.83 g', () => {
        expect(tape.maxLatG).toBe(2.83);
      });

      it('finds the sustained lateral grip at 2.29 g', () => {
        expect(tape.sustainedLatG).toBe(2.29);
      });

      it('brakes at 2.16 g at the most, but for one frame of 3.68 g', () => {
        // The whole race but the five seconds after that frame.
        expect(tape.maxLongBefore).toBe(2.16);
        // At 626.07 s the car reads 3.68 g for a single frame, with the
        // brake a quarter on: a kerb or a touch. The incident count does
        // not move for it (it rises twice, 415 s before and 40 s after), so
        // nothing marks the frame as an impact and it stands as the maximum
        // for five seconds. Le Mans Ultimate would have stamped it.
        expect(tape.maxLongG).toBe(3.68);
        expect(tape.maxLongSetAt).toBeCloseTo(SPIKE_AT, 2);
        expect(tape.incidentsAt).toHaveLength(2);
        expect(tape.incidentsAt[0]).toBeCloseTo(211.2, 2);
        expect(tape.incidentsAt[1]).toBeCloseTo(666.4, 2);
      });
    });

    describe('the braking channel', () => {
      it('finds 35 braking zones in 55 brake applications', () => {
        expect(zones).toHaveLength(35);
        expect(tape.zoneCount).toBe(35);
        expect(tape.applications).toHaveLength(55);
        // The twenty that did not count all peaked under half a g: a foot
        // resting on the pedal behind another car.
        const dropped = tape.applications.filter(({ zone }) => zone === null);
        expect(dropped).toHaveLength(20);
        expect(Math.max(...dropped.map(({ peakG }) => peakG))).toBe(0.49);
      });

      it('measures the first: 39.4 to 30.2 m/s in 66 m and 1.95 s', () => {
        expect(zones[0]).toMatchObject({
          peakG: 1.06,
          averageG: 0.48,
          distanceM: 66,
          durationS: 1.95,
          entrySpeed: 39.4,
          exitSpeed: 30.2,
          absS: 0,
          deltaG: 1.06,
        });
        expect(zones[0].endedAt).toBeCloseTo(112.52, 2);
      });

      it('has its hardest clean stop at 2.16 g: 259 to 99 km/h in 186 m', () => {
        const clean = zones.filter((zone) => zone.peakG < 3);
        const best = clean.reduce((a, b) => (b.peakG > a.peakG ? b : a));
        expect(best).toMatchObject({
          peakG: 2.16,
          averageG: 1.15,
          distanceM: 186,
          durationS: 3.93,
          entrySpeed: 71.9,
          exitSpeed: 27.4,
          absS: 0.1,
          // Against a rolling best of 2.12 g.
          deltaG: 0.04,
        });
        expect(best.endedAt).toBeCloseTo(531.73, 2);
      });

      it('takes the one frame of 3.68 g for the best stop of the race', () => {
        // The stop it falls in ends at 628.12 s: 5.22 s from 58.6 to
        // 8.6 m/s, 0.98 g on average, and a "peak" from that one frame.
        // Under iRacing there is nothing to gate it with.
        const spiked = zones.find((zone) => zone.peakG > 3);
        expect(spiked).toMatchObject({
          peakG: 3.68,
          averageG: 0.98,
          distanceM: 171,
          durationS: 5.22,
          entrySpeed: 58.6,
          exitSpeed: 8.6,
          deltaG: 1.56,
        });
        expect(spiked?.endedAt).toBeCloseTo(628.12, 2);
        expect(tape.sessionBestG).toBe(3.68);
      });

      it('follows the rolling best through the race', () => {
        expect(tape.reference.map(({ g }) => g)).toEqual([
          0, 1.06, 1.75, 1.85, 1.86, 2.03, 1.86, 2.12, 2.16, 2.12, 3.68,
        ]);
        expect(
          tape.reference.map(({ at }) => Math.round(at * 10) / 10)
        ).toEqual([
          90.9, 112.8, 172.6, 271.7, 344.1, 401.9, 461.7, 474.8, 532, 591.8,
          628.4,
        ]);
      });

      it('has no lock times: iRacing publishes no wheel speeds', () => {
        expect([...tape.locks]).toEqual(['null']);
      });

      it('publishes while a zone is live, and not between zones', () => {
        expect(tape.brakingPublishes).toBe(7_433);
      });
    });
  }
);
