import { beforeAll, describe, expect, it } from 'vitest';
import type {
  TrackProfile,
  TrackProfileKey,
  TrackProfileLap,
} from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { mergeProfileLap, profileDemand } from '../storage/trackProfiles';
import { trackLengthFrom } from './lapTiming';
import { TrackProfileProcessor } from './TrackProfileProcessor';
import { TrackProfileRecorder } from './TrackProfileRecorder';

/**
 * The track profile recorded from a real race: four minutes at Laguna Seca
 * under Le Mans Ultimate, the player in an LMGT3.
 *
 * The recording opens on the lap from the rolling start, which was not seen
 * from the line and is not taken. The player then crosses the line at 232.8
 * s and again at 319.5 s: one whole lap, clean, and the profile is that
 * lap. What follows is the first sector of a third.
 *
 * The recorder, the rules that turn a lap into a stored profile and the
 * processor that publishes it are the app's own; only the disk is left
 * out, with the profile held in memory where the store would hold it.
 *
 * Windows only, like the other tape specs.
 */

interface Recorded {
  frames: number;
  /** The sim's own lap length, metres, as shared memory states it. */
  simLapDist: number;
  sessionLengthM: number;
  sessionTrackId: number;
  laps: { key: TrackProfileKey; lap: TrackProfileLap; at: number }[];
  profile: TrackProfile | null;
  /** Every different progress the channel published, in order. */
  progress: (number | null)[];
  /** The channel's version when the tape began and when it ended. */
  published: number;
  snapshot: ReturnType<TrackProfileProcessor['snapshot']>;
}

const record = async (): Promise<Recorded> => {
  let profile: TrackProfile | null = null;
  let revision = 0;
  let sessionTime = 0;
  const laps: Recorded['laps'] = [];
  const recorder = new TrackProfileRecorder(
    {
      wants: (key) => profileDemand(profile, key, 'recorded'),
      recordLap: (key, lap) => {
        laps.push({ key, lap, at: sessionTime });
        const next = mergeProfileLap(profile, key, lap, 1_700_000_000_000);
        if (!next) return;
        profile = next;
        revision += 1;
      },
    },
    { simulator: 'lmu' }
  );
  recorder.onEnter();
  const processor = new TrackProfileProcessor(
    {
      load: (_simulator, trackId, pointsCount) =>
        profile?.trackId === trackId && profile.pointsCount === pointsCount
          ? profile
          : null,
      revision: () => revision,
      recordingProgress: () => recorder.progress(),
    },
    'lmu'
  );
  processor.onLifecycle({ type: 'enter', replay: false });

  const progress: (number | null)[] = [];
  let frames = 0;
  let simLapDist = 0;
  let sessionLengthM = 0;
  let sessionTrackId = 0;
  let firstVersion = -1;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: (frame) => {
      frames += 1;
      sessionTime = frame.sessionTime;
      simLapDist = frame.raw.lapDist;
      if (frame.sessionChanged) {
        sessionLengthM = trackLengthFrom(frame.session);
        sessionTrackId = frame.session.WeekendInfo.TrackID;
        recorder.onSession(frame.session);
        processor.init(frame.session);
      }
      recorder.onFrame(frame.telemetry);
      processor.onFrame(frame.telemetry);
      const snapshot = processor.snapshot();
      if (firstVersion < 0) firstVersion = snapshot.version;
      if (
        progress.length === 0 ||
        progress.at(-1) !== snapshot.recordingProgress
      ) {
        progress.push(snapshot.recordingProgress);
      }
    },
  });
  return {
    frames,
    simLapDist,
    sessionLengthM,
    sessionTrackId,
    laps,
    profile,
    progress,
    published: processor.snapshot().version - firstVersion,
    snapshot: processor.snapshot(),
  };
};

const indexOfHighest = (values: readonly number[]): number =>
  values.indexOf(Math.max(...values));
const indexOfLowest = (values: readonly number[]): number =>
  values.indexOf(Math.min(...values));

describe.skipIf(!lmuTapeAvailable())(
  'the track profile on a recorded LMU race at Laguna Seca',
  () => {
    let tape: Recorded;
    let profile: TrackProfile;

    beforeAll(async () => {
      tape = await record();
      if (!tape.profile) throw new Error('No profile was recorded');
      profile = tape.profile;
    }, 120_000);

    it('takes the one lap driven from line to line, and no other', () => {
      expect(tape.frames).toBeGreaterThan(14_000);
      expect(tape.laps).toHaveLength(1);
      // Handed over as the player crosses the line the second time.
      expect(tape.laps[0].at).toBeGreaterThan(319.4);
      expect(tape.laps[0].at).toBeLessThan(319.7);
      expect(tape.laps[0].lap.source).toBe('recorded');
    });

    it("files it under the session's track, at the sim's own lap length", () => {
      expect(profile.simulator).toBe('lmu');
      expect(profile.trackId).toBe(tape.sessionTrackId);
      expect(profile.trackName).toMatch(/Laguna Seca/);
      // 3,590.35 m, which is what the session and shared memory both say.
      expect(profile.trackLengthM).toBe(tape.sessionLengthM);
      expect(Math.abs(profile.trackLengthM - tape.simLapDist)).toBeLessThan(
        0.01
      );
      expect(profile.trackLengthM).toBeCloseTo(3590.35, 1);
      expect(profile.pointsCount).toBe(360);
    });

    it('records the height every ten metres, from -15.4 to 39.8 m', () => {
      const elevation = profile.elevationM as number[];
      expect(profile.elevationSource).toBe('recorded');
      expect(profile.elevationLaps).toBe(1);
      expect(elevation).toHaveLength(360);

      const lowest = Math.min(...elevation);
      const highest = Math.max(...elevation);
      // World Y on the track model's own datum, not above the sea.
      expect(Math.abs(lowest - -15.4)).toBeLessThan(0.5);
      expect(Math.abs(highest - 39.8)).toBeLessThan(0.5);
      expect(Math.abs(highest - lowest - 55.2)).toBeLessThan(0.5);
      // The Corkscrew is the top, some 2.4 km round; the bottom is the
      // flat run between 530 and 790 m.
      expect(indexOfHighest(elevation)).toBeGreaterThanOrEqual(235);
      expect(indexOfHighest(elevation)).toBeLessThanOrEqual(243);
      expect(indexOfLowest(elevation)).toBeGreaterThanOrEqual(50);
      expect(indexOfLowest(elevation)).toBeLessThanOrEqual(82);
      // The line is 10.6 m under the datum.
      expect(Math.abs(elevation[0] - -10.6)).toBeLessThan(0.5);
    });

    it('closes: the lap ends at the height it began at', () => {
      const elevation = profile.elevationM as number[];

      expect(tape.laps[0].lap.closureM).toBeLessThan(0.3);
      expect(Math.abs(elevation[359] - elevation[0])).toBeLessThan(1);
      // No step between two buckets anywhere: the steepest ten metres on
      // the lap, the drop into the Corkscrew, falls under two.
      for (let bucket = 1; bucket < 360; bucket += 1) {
        expect(
          Math.abs(elevation[bucket] - elevation[bucket - 1])
        ).toBeLessThan(2.5);
      }
    });

    it('records the line of the road in world metres', () => {
      const x = profile.xM as number[];
      const z = profile.zM as number[];
      expect(x).toHaveLength(360);
      expect(z).toHaveLength(360);
      // Inside the box the car's position stays in on the whole recording.
      expect(Math.min(...x)).toBeGreaterThan(-411);
      expect(Math.max(...x)).toBeLessThan(388);
      expect(Math.min(...z)).toBeGreaterThan(-502);
      expect(Math.max(...z)).toBeLessThan(481);

      // Bucket to bucket is ten metres of road, and all the way round and
      // back to the first is the lap: the ground distance, a little under
      // the 3,590 m the sim measures along its own line.
      let around = 0;
      for (let bucket = 0; bucket < 360; bucket += 1) {
        const next = (bucket + 1) % 360;
        const stride = Math.hypot(x[next] - x[bucket], z[next] - z[bucket]);
        expect(stride, `bucket ${bucket}`).toBeGreaterThan(7);
        expect(stride, `bucket ${bucket}`).toBeLessThan(13);
        around += stride;
      }
      expect(around / profile.trackLengthM).toBeGreaterThan(0.98);
      expect(around / profile.trackLengthM).toBeLessThan(1.02);
    });

    it('learns where the sim starts its sectors: 39.0 % and 79.2 %', () => {
      expect(profile.sectorSource).toBe('learned');
      expect(profile.sectorStartPct).toHaveLength(3);
      expect(profile.sectorStartPct[0]).toBe(0);
      expect(profile.sectorStartPct[1]).toBeCloseTo(0.39, 2);
      expect(profile.sectorStartPct[2]).toBeCloseTo(0.792, 2);
      // To the few metres the estimate of the car's position is good for.
      expect(Math.abs(profile.sectorStartPct[1] - 0.39)).toBeLessThan(0.003);
      expect(Math.abs(profile.sectorStartPct[2] - 0.792)).toBeLessThan(0.003);
    });

    it('publishes it from the lowest point, with the sectors and the range', () => {
      const { snapshot } = tape;

      expect(snapshot.trackKey).toBe(`lmu:${tape.sessionTrackId}`);
      expect(snapshot.trackLengthM).toBe(profile.trackLengthM);
      expect(snapshot.elevationSource).toBe('recorded');
      expect(snapshot.elevationM).toHaveLength(360);
      expect(Math.min(...snapshot.elevationM)).toBe(0);
      expect(Math.abs(snapshot.elevationRangeM - 55.2)).toBeLessThan(0.5);
      expect(Math.max(...snapshot.elevationM)).toBe(snapshot.elevationRangeM);
      // The line stands 4.8 m above the lowest point of the lap.
      expect(Math.abs(snapshot.lineElevationM - 4.8)).toBeLessThan(0.5);
      expect(snapshot.sectorStartPct).toEqual(profile.sectorStartPct);
      expect(snapshot.notes).toEqual([]);
    });

    it('reports the lap being recorded in steps of 5 %, and then stops', () => {
      // Nothing on the lap from the rolling start, twenty steps round the
      // lap that became the profile, nothing once it is in.
      expect(tape.progress).toEqual([
        null,
        ...Array.from({ length: 20 }, (_, step) => step / 20),
        null,
      ]);
      // The channel moved for those and for the profile, which arrives on
      // the frame the progress ends: some twenty publishes in fifteen
      // thousand frames.
      expect(tape.published).toBeGreaterThanOrEqual(21);
      expect(tape.published).toBeLessThan(25);
    });
  }
);
