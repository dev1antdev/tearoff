import { beforeAll, describe, expect, it } from 'vitest';
import type { BrakingZone } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { BrakingProcessor } from './BrakingProcessor';

/**
 * The braking channel on the recorded Le Mans Ultimate race: four minutes in
 * an LMGT3 with ABS at Laguna Seca, with five knocks to the nose, two of
 * them in the middle of a stop.
 *
 * Every frame goes to the processor, as in the app. The replay drops a few
 * dozen of the 15,430 frames, a different few on each run (see
 * frameKeys.tape.spec.ts), never two in a row: a zone can start or end a
 * frame late and miss the frame of its peak, so times are held to 0.05 s,
 * peaks to 0.05 g, distances to 3 m and speeds to 0.5 m/s.
 *
 * Windows only, like the other tape specs.
 */

/** A brake application, whether or not it came to count as a zone. */
interface Application {
  /** SessionTime of the first frame the zone was live on. */
  startedAt: number;
  /** The first frame it was no longer live on. */
  closedAt: number;
  entrySpeed: number;
  /** The highest peak the live zone showed. */
  peakG: number;
  /** The zone it became, or null when it was dropped or discarded. */
  zone: BrakingZone | null;
}

interface Recording {
  frames: number;
  /** Frames on which the snapshot's version moved. */
  publishes: number;
  unavailableFrames: number;
  applications: Application[];
  /** The rolling best in the snapshot: the first value, then each change. */
  reference: { at: number; g: number }[];
  /** Every different lock reading published, as text. */
  locks: Set<string>;
  sessionBestG: number;
  zoneCount: number;
  /** The reference moved while a zone was live. */
  referenceMovedWhileLive: boolean;
}

const play = async (): Promise<Recording> => {
  const processor = new BrakingProcessor();
  const tape: Recording = {
    frames: 0,
    publishes: 0,
    unavailableFrames: 0,
    applications: [],
    reference: [],
    locks: new Set(),
    sessionBestG: 0,
    zoneCount: 0,
    referenceMovedWhileLive: false,
  };
  let started = false;
  let lastVersion = -1;
  let lastZone: BrakingZone | null = null;
  let open: Application | null = null;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
      }
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      tape.frames += 1;
      if (snapshot.version !== lastVersion) tape.publishes += 1;
      lastVersion = snapshot.version;
      if (!snapshot.available) tape.unavailableFrames += 1;

      const previous = tape.reference.at(-1);
      if (previous?.g !== snapshot.referenceG) {
        if (previous && open && snapshot.live) {
          tape.referenceMovedWhileLive = true;
        }
        tape.reference.push({ at: sessionTime, g: snapshot.referenceG });
      }

      if (snapshot.live) {
        if (!open) {
          open = {
            startedAt: sessionTime,
            closedAt: Number.NaN,
            entrySpeed: snapshot.live.entrySpeed,
            peakG: 0,
            zone: null,
          };
          tape.applications.push(open);
        }
        open.peakG = Math.max(open.peakG, snapshot.live.peakG);
      } else if (open) {
        open.closedAt = sessionTime;
        if (snapshot.last !== lastZone) open.zone = snapshot.last;
        open = null;
      }
      lastZone = snapshot.last;

      tape.locks.add(JSON.stringify(snapshot.lockS));
      tape.sessionBestG = snapshot.sessionBestG;
      tape.zoneCount = snapshot.zoneCount;
    },
  });
  return tape;
};

const expectNear = (actual: number, expected: number, tolerance: number) =>
  expect(
    Math.abs(actual - expected),
    `${actual} is not within ${tolerance} of ${expected}`
  ).toBeLessThanOrEqual(tolerance + 1e-9);

const TIME = 0.05;
const PEAK = 0.05;
const DISTANCE = 3;
const SPEED = 0.5;
const KMH = 3.6;

describe.skipIf(!lmuTapeAvailable())(
  'the braking channel on a recorded LMU race',
  () => {
    let tape: Recording;
    let zones: BrakingZone[];
    /** The application that was live at `t`. */
    const liveAt = (t: number) =>
      tape.applications.find(
        (application) => application.startedAt <= t && t < application.closedAt
      );
    /** The zone that began nearest `t`. */
    const zoneStartingAt = (t: number) =>
      tape.applications.find(
        (application) =>
          application.zone !== null && Math.abs(application.startedAt - t) < 0.2
      );

    beforeAll(async () => {
      tape = await play();
      zones = tape.applications.flatMap(({ zone }) => (zone ? [zone] : []));
    }, 120_000);

    it('reads the whole recording, in the car throughout', () => {
      expect(tape.frames).toBeGreaterThan(14_900);
      expect(tape.frames).toBeLessThanOrEqual(15_430);
      expect(tape.unavailableFrames).toBe(0);
    });

    it('finds 26 braking zones in 31 brake applications', () => {
      expect(zones).toHaveLength(26);
      expect(tape.zoneCount).toBe(26);
      expect(tape.applications).toHaveLength(31);
      // From the first application that counted to the last release.
      expectNear(zones[0].endedAt - zones[0].durationS, 149.21, TIME);
      expectNear(zones[25].endedAt, 375.63, TIME);
    });

    it('measures the first: 155 to 90 km/h in 70 m and 2.20 s at 1.60 g', () => {
      const [first] = zones;
      expectNear(first.entrySpeed * KMH, 155, SPEED * KMH);
      expectNear(first.exitSpeed * KMH, 90, SPEED * KMH);
      expectNear(first.distanceM, 70, DISTANCE);
      expectNear(first.durationS, 2.2, TIME);
      expectNear(first.peakG, 1.6, PEAK);
      expectNear(first.averageG, 0.83, PEAK);
      // Nothing to measure it against yet.
      expect(first.deltaG).toBe(first.peakG);
    });

    it('starts that one in the middle of a stop, when an impact is 2 s old', () => {
      // The brake goes on at 146.80 s and the car is hit at 147.20 s, which
      // discards the zone. The driver is still braking two seconds later,
      // and the first frame after that is where the first zone begins.
      const discarded = tape.applications[0];
      expectNear(discarded.startedAt, 146.8, TIME);
      expectNear(discarded.closedAt, 147.2, TIME);
      expect(discarded.zone).toBeNull();

      const first = tape.applications[1];
      expectNear(first.startedAt, 149.21, TIME);
      expect(first.zone).toBe(zones[0]);
    });

    it('has its hardest stop at 2.39 g: 214 to 116 km/h in 81 m', () => {
      const best = zoneStartingAt(265.81)?.zone;
      expect(best).toBeDefined();
      if (!best) return;
      expectNear(best.peakG, 2.39, PEAK);
      expect(Math.max(...zones.map((zone) => zone.peakG))).toBe(best.peakG);
      expect(tape.sessionBestG).toBe(best.peakG);
      expectNear(best.entrySpeed * KMH, 214, SPEED * KMH);
      expectNear(best.exitSpeed * KMH, 116, SPEED * KMH);
      expectNear(best.distanceM, 81, DISTANCE);
      expectNear(best.durationS, 1.88, TIME);
      expectNear(best.averageG, 1.48, PEAK);
      expectNear(best.absS, 0.5, 0.1);
      // Against a rolling best of 2.29 g.
      expectNear(best.deltaG, 0.1, PEAK);
    });

    it('follows the rolling best through the race', () => {
      // Each step is seen a quarter of a second after the release that
      // caused it, once the zone is known to be over.
      const expected = [
        { at: 139.91, g: 0 },
        { at: 151.66, g: 1.6 },
        { at: 181.27, g: 2.35 },
        // Sixty seconds after the 2.29 g stop that had become the runner-up.
        { at: 263.08, g: 2.29 },
        { at: 267.94, g: 2.39 },
        // The 2.39 g ran out at 327.7 s, in the middle of a stop: the
        // snapshot keeps it until that stop is over.
        { at: 328.81, g: 2.29 },
      ];
      expect(tape.reference).toHaveLength(expected.length);
      expected.forEach((step, index) => {
        expectNear(tape.reference[index].at, step.at, TIME);
        expectNear(tape.reference[index].g, step.g, PEAK);
      });
      expect(tape.referenceMovedWhileLive).toBe(false);
    });

    it('discards the stop that runs into the hardest impact', () => {
      // Live from 238.61 s, at 2.43 g by 239.0 s, into the impact stamped
      // 240.72 s.
      const stop = liveAt(239.5);
      expect(stop).toBeDefined();
      if (!stop) return;
      expectNear(stop.startedAt, 238.61, TIME);
      expectNear(stop.closedAt, 240.73, TIME);
      expectNear(stop.peakG, 2.43, PEAK);
      expect(stop.zone).toBeNull();
      // Its 2.43 g is in no best, and no zone ends near it.
      expect(tape.sessionBestG).toBeLessThan(stop.peakG);
      expect(
        zones.filter((zone) => zone.endedAt > 225 && zone.endedAt < 250)
      ).toEqual([]);
    });

    it('keeps the 3.95 s stop at 199.1 s as one zone', () => {
      const long = zoneStartingAt(199.11)?.zone;
      expect(long).toBeDefined();
      if (!long) return;
      expectNear(long.durationS, 3.95, TIME);
      expectNear(long.distanceM, 129, DISTANCE);
      expectNear(long.absS, 1.4, 0.1);
      expectNear(long.peakG, 2.29, PEAK);
      // Nothing else begins before it is over.
      expect(liveAt(201)?.zone).toBe(long);
      expect(liveAt(202.9)?.zone).toBe(long);
    });

    it('drops the three applications too short or too soft to count', () => {
      const dropped = tape.applications.filter(
        (application) => application.zone === null
      );
      // Two discarded by impacts, and three dropped: 0.27 s at 0.76 g,
      // 0.20 s at 0.36 g and 0.34 s at 0.24 g.
      expect(dropped).toHaveLength(5);
      expect(dropped.map(({ startedAt }) => Math.round(startedAt))).toEqual([
        147, 156, 239, 251, 296,
      ]);
      expect(dropped[1].peakG).toBeGreaterThan(0.5);
      expect(dropped[3].peakG).toBeLessThan(0.5);
      expect(dropped[4].peakG).toBeLessThan(0.5);
    });

    it('reports no locked wheel: an LMGT3 has ABS', () => {
      expect([...tape.locks]).toEqual(['[0,0]']);
    });

    it('publishes while a zone is live, and not between zones', () => {
      // 2,443 publishes in 15,379 frames on one run: 66 s of the 240 are
      // spent braking.
      expect(tape.publishes).toBeGreaterThan(2_000);
      expect(tape.publishes).toBeLessThan(3_000);
    });
  }
);
