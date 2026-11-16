import { beforeAll, describe, expect, it } from 'vitest';
import type {
  Telemetry,
  TrackNote,
  TrackProfile,
  TrackProfileKey,
  TrackProfileSnapshot,
} from '@irdashies/types';
import {
  mergeProfileLap,
  parseTrackProfile,
  profileDemand,
} from '../storage/trackProfiles';
import {
  sessionSecondsFrameClock,
  takeTick,
  type TickSchedule,
} from './ProcessorHost';
import { TrackProfileProcessor } from './TrackProfileProcessor';
import { TrackProfileRecorder } from './TrackProfileRecorder';
import { TrackStateProcessor } from './TrackStateProcessor';
import {
  heightAtFraction,
  selectCarLapFraction,
  selectCurrentNotes,
  splitNotes,
} from '@irdashies/shared';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';

/**
 * The elevation profile and the track notes on the recorded Le Mans Ultimate
 * race: four minutes at Laguna Seca in an LMGT3, with the line crossed at
 * 232.8 s and at 319.5 s. One whole lap between the two, most of a lap
 * before it and the first two thirds of one after.
 *
 * Both widgets are about a point on the lap, and both read it from
 * `track-state.snapshot`. That channel carries the player's own lap fraction
 * as the frame has it, and every car's to three decimals, which is 3.6 m of
 * this track: the first is what the widgets read at the wheel, the second
 * what they read while a car is being watched. What is checked here is what
 * the widgets do with each, by the rules they share with this spec: where
 * they place the car on the profile, and when they find a note due. The
 * main process's side is the app's own: the recorder, the rules that turn a
 * lap into a profile, the processors that publish both channels on the
 * host's schedule. The notes are a stored profile's, read
 * as the store reads a profile's file; the disk itself is left out, as
 * nothing can wait for one while the tape plays.
 *
 * Windows only, like the other tape specs.
 */

/** The driver's notes: three track notes round the lap, and two pace notes. */
const NOTES = [
  { distanceM: 500, kind: 'track', text: 'Flat run', comment: '', pit: false },
  { distanceM: 1500, kind: 'track', text: 'Turn 5', comment: '', pit: false },
  { distanceM: 3000, kind: 'track', text: 'Turn 10', comment: '', pit: false },
  {
    distanceM: 2000,
    kind: 'pace',
    text: 'Brake uphill',
    comment: '',
    pit: false,
  },
  { distanceM: 2900, kind: 'pace', text: 'Flat', comment: '', pit: false },
] as const;
/** Pace notes are looked up this far ahead of the car. */
const PACE_LEAD_M = 150;

const numberAt = (
  telemetry: Telemetry,
  key: string,
  index = 0
): number | undefined => {
  const value = (
    telemetry as unknown as Record<string, { value?: unknown[] } | undefined>
  )[key]?.value?.[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

/** One update of the track-state channel, and what the car was doing. */
interface Sample {
  sessionTime: number;
  /** The lap fraction the widgets read at the wheel. */
  fraction: number;
  /** The one they read for the same car while it is watched: three decimals. */
  watchedFraction: number;
  /** The car's own lap fraction on that frame, at full precision. */
  trueFraction: number;
  /** The car's height in the world on that frame, metres. */
  worldY: number;
}

/** A note becoming current, on the update it did. */
interface NoteChange {
  sessionTime: number;
  distanceM: number;
  /** Metres into the lap as the widget read them, on this update and the last. */
  positionM: number;
  previousPositionM: number;
  /** The car's own metres into the lap on that frame. */
  truePositionM: number;
}

interface Recording {
  frames: number;
  updates: number;
  trackLengthM: number;
  samples: Sample[];
  crossingTimes: number[];
  trackChanges: NoteChange[];
  paceChanges: NoteChange[];
  /** The track notes becoming current for the same car as a watched one. */
  watchedTrackChanges: NoteChange[];
  /** The track note current on the first update of each lap. */
  noteAtLapStart: number[];
  profile: TrackProfile;
  snapshot: TrackProfileSnapshot;
}

/**
 * The track's profile as the store would have it on disk before a lap has
 * been driven: no elevation, and the driver's notes.
 */
const storedProfile = (key: TrackProfileKey): TrackProfile => {
  const profile = parseTrackProfile(
    {
      version: 1,
      ...key,
      elevationM: null,
      elevationSource: null,
      elevationLaps: 0,
      xM: null,
      zM: null,
      sectorStartPct: [],
      sectorSource: 'nominal',
      notes: NOTES.map((note, index) => ({ ...note, id: `note-${index}` })),
      updatedAt: 1_700_000_000_000,
    },
    key.simulator,
    key.trackId
  );
  if (profile === null || profile === 'newer') {
    throw new Error('The store does not read the profile');
  }
  return profile;
};

const record = async (): Promise<Recording> => {
  // Held in memory where the store would hold it.
  let profile: TrackProfile | null = null;
  let revision = 0;
  const recorder = new TrackProfileRecorder(
    {
      wants: (key) => profileDemand(profile, key, 'recorded'),
      recordLap: (key, lap) => {
        const next = mergeProfileLap(profile, key, lap, 1_700_000_100_000);
        if (!next) return;
        profile = next;
        revision += 1;
      },
    },
    { simulator: 'lmu' }
  );
  recorder.onEnter();
  const profiles = new TrackProfileProcessor(
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
  const trackState = new TrackStateProcessor();
  profiles.onLifecycle({ type: 'enter', replay: false });
  trackState.onLifecycle({ type: 'enter', replay: false });
  const schedule: TickSchedule = {};

  const samples: Sample[] = [];
  const crossingTimes: number[] = [];
  const trackChanges: NoteChange[] = [];
  const paceChanges: NoteChange[] = [];
  const watchedTrackChanges: NoteChange[] = [];
  const noteAtLapStart: number[] = [];
  let frames = 0;
  let trackLengthM = 0;
  let lists = splitNotes([]);
  let notes: readonly TrackNote[] | undefined;
  let lastVersion = -1;
  let trackIndex = -2;
  let paceIndex = -2;
  let watchedTrackIndex = -2;
  let previousPositionM = -1;
  let previousWatchedPositionM = -1;
  let previousTrueFraction = -1;
  let lapStarted = true;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      if (sessionChanged) {
        recorder.onSession(session);
        const key = recorder.trackKey();
        if (profile === null && key) {
          profile = storedProfile(key);
          revision += 1;
        }
        profiles.init(session);
      }
      recorder.onFrame(telemetry);
      profiles.onFrame(telemetry);
      const published = profiles.snapshot();
      trackLengthM = published.trackLengthM;
      if (published.notes !== notes) {
        notes = published.notes;
        lists = splitNotes(notes);
      }

      const trueFraction = numberAt(telemetry, 'LapDistPct') ?? -1;
      if (previousTrueFraction > 0.95 && trueFraction < 0.05) {
        crossingTimes.push(sessionTime);
        lapStarted = true;
      }
      previousTrueFraction = trueFraction;

      // Twenty-five times a second, as the host runs the channel.
      if (!takeTick(schedule, 25, sessionSecondsFrameClock(telemetry))) return;
      trackState.onFrame(telemetry);
      const state = trackState.snapshot();
      if (state.version === lastVersion) return;
      lastVersion = state.version;

      const fraction = selectCarLapFraction(state, false);
      // The same car as the camera's: its place in the per-car array.
      const watchedFraction = selectCarLapFraction(state, true);
      samples.push({
        sessionTime,
        fraction,
        watchedFraction,
        trueFraction,
        worldY: numberAt(telemetry, 'LmuPlayerWorldPos', 1) ?? Number.NaN,
      });

      const options = {
        trackLengthM,
        paceLeadMeters: PACE_LEAD_M,
        paceLeadSeconds: 0,
        showPitNotes: true,
      };
      const selection = selectCurrentNotes(
        lists,
        {
          lapFraction: fraction,
          speedMs: state.speed,
          onPitRoad: state.onPitRoad,
        },
        options
      );
      const watched = selectCurrentNotes(
        lists,
        {
          lapFraction: watchedFraction,
          speedMs: 0,
          onPitRoad: state.onPitRoad,
        },
        options
      );
      const positionM = fraction * trackLengthM;
      const watchedPositionM = watchedFraction * trackLengthM;
      const change = (distanceM: number): NoteChange => ({
        sessionTime,
        distanceM,
        positionM,
        previousPositionM,
        truePositionM: trueFraction * trackLengthM,
      });
      if (selection.trackIndex !== trackIndex) {
        // The first update only says which note the recording opens on.
        if (trackIndex !== -2) {
          trackChanges.push(
            change(lists.track[selection.trackIndex].distanceM)
          );
        }
        trackIndex = selection.trackIndex;
      }
      if (selection.paceIndex !== paceIndex) {
        if (paceIndex !== -2) {
          paceChanges.push(change(lists.pace[selection.paceIndex].distanceM));
        }
        paceIndex = selection.paceIndex;
      }
      if (watched.trackIndex !== watchedTrackIndex) {
        if (watchedTrackIndex !== -2) {
          watchedTrackChanges.push({
            ...change(lists.track[watched.trackIndex].distanceM),
            positionM: watchedPositionM,
            previousPositionM: previousWatchedPositionM,
          });
        }
        watchedTrackIndex = watched.trackIndex;
      }
      if (lapStarted) {
        lapStarted = false;
        noteAtLapStart.push(lists.track[selection.trackIndex]?.distanceM ?? -1);
      }
      previousPositionM = positionM;
      previousWatchedPositionM = watchedPositionM;
    },
  });

  // Assigned from inside the callbacks, which the compiler does not follow.
  const recorded = profile as TrackProfile | null;
  if (!recorded) throw new Error('The recording names no track');
  return {
    frames,
    updates: samples.length,
    trackLengthM,
    samples,
    crossingTimes,
    trackChanges,
    paceChanges,
    watchedTrackChanges,
    noteAtLapStart,
    profile: recorded,
    snapshot: profiles.snapshot(),
  };
};

const sorted = (values: readonly number[]): number[] =>
  [...values].sort((a, b) => a - b);
const percentile = (ordered: readonly number[], share: number): number =>
  ordered[Math.min(Math.floor(ordered.length * share), ordered.length - 1)];

describe.skipIf(!lmuTapeAvailable())(
  'the elevation profile and the track notes on a recorded LMU race',
  () => {
    let tape: Recording;
    /** The lowest point of the recorded lap, on the track model's datum. */
    let lowestWorldY: number;

    beforeAll(async () => {
      tape = await record();
      lowestWorldY = Math.min(...(tape.profile.elevationM ?? [Number.NaN]));
    }, 120_000);

    it('reads the whole recording, twenty-five updates a second', () => {
      expect(tape.frames).toBeGreaterThan(14_000);
      expect(tape.updates).toBeGreaterThan(5_800);
      expect(tape.updates).toBeLessThan(6_050);
      expect(tape.trackLengthM).toBeCloseTo(3590.35, 1);
      expect(tape.crossingTimes).toHaveLength(2);
    });

    it("carries the player's own lap fraction as the frame has it", () => {
      for (const sample of tape.samples) {
        expect(sample.fraction).toBe(sample.trueFraction);
      }
    });

    it("carries a watched car's to three decimals: 3.6 m of this track", () => {
      for (const sample of tape.samples) {
        expect(sample.watchedFraction * 1000).toBeCloseTo(
          Math.round(sample.watchedFraction * 1000),
          6
        );
      }
      const off = sorted(
        tape.samples
          // Away from the line, where the two wrap apart.
          .filter((sample) => sample.fraction > 0.01 && sample.fraction < 0.99)
          .map(
            (sample) =>
              Math.abs(sample.watchedFraction - sample.trueFraction) *
              tape.trackLengthM
          )
      );
      // Half a thousandth of the lap at the most.
      expect(percentile(off, 1)).toBeLessThan(1.81);
      expect(percentile(off, 0.5)).toBeGreaterThan(0.5);
    });

    describe('the elevation profile', () => {
      it('is recorded from the one whole lap, with the notes kept', () => {
        expect(tape.profile.elevationSource).toBe('recorded');
        expect(tape.snapshot.elevationM).toHaveLength(360);
        expect(Math.abs(tape.snapshot.elevationRangeM - 55.2)).toBeLessThan(
          0.5
        );
        expect(tape.snapshot.notes.map((note) => note.distanceM)).toEqual([
          500, 1500, 2000, 2900, 3000,
        ]);
      });

      /**
       * How far the height read off the profile where the widget places the
       * car is from the car's own height in the world on the same frame,
       * metres, smallest first. Without the two seconds the recording opens
       * on: the field rolling up to the start, where the sim holds the lap
       * fraction at 0 with the car still short of the line.
       */
      const heightErrors = (pick: (sample: Sample) => number): number[] =>
        sorted(
          tape.samples
            .filter((sample) => sample.trueFraction > 0)
            .map((sample) =>
              Math.abs(
                (heightAtFraction(tape.snapshot.elevationM, pick(sample)) ??
                  Number.NaN) +
                  lowestWorldY -
                  sample.worldY
              )
            )
        );

      it('places the car at the height it is at, on every lap of the recording', () => {
        // On the lap that was recorded and on the two either side of it:
        // 3 cm off at the median, 0.8 m at the most, where the car took
        // another line over a crest.
        const errors = heightErrors((sample) => sample.fraction);

        expect(errors.length).toBeGreaterThan(5_800);
        expect(tape.updates - errors.length).toBeLessThan(90);
        expect(percentile(errors, 0.5)).toBeLessThan(0.1);
        expect(percentile(errors, 0.95)).toBeLessThan(0.4);
        expect(percentile(errors, 1)).toBeLessThan(1.2);
      });

      it('places a watched car as well, to the 3.6 m its fraction is carried to', () => {
        const errors = heightErrors((sample) => sample.watchedFraction);

        expect(percentile(errors, 0.5)).toBeLessThan(0.1);
        expect(percentile(errors, 0.95)).toBeLessThan(0.45);
        expect(percentile(errors, 1)).toBeLessThan(1.3);
      });

      it('marks the car at the top of the profile as it crests the Corkscrew', () => {
        const highest = tape.samples.reduce((top, sample) =>
          sample.worldY > top.worldY ? sample : top
        );

        // Some 2.4 km round, two thirds of the lap.
        expect(highest.fraction).toBeGreaterThan(0.655);
        expect(highest.fraction).toBeLessThan(0.675);
        const height =
          heightAtFraction(tape.snapshot.elevationM, highest.fraction) ?? 0;
        // Within half a metre of the top of the profile's 55.2 m.
        expect(tape.snapshot.elevationRangeM - height).toBeLessThan(0.5);
      });

      it('marks the car at the bottom in the flat run after the hairpin', () => {
        const lowest = tape.samples.reduce((bottom, sample) =>
          sample.worldY < bottom.worldY ? sample : bottom
        );

        // Between 530 and 790 m.
        expect(lowest.fraction * tape.trackLengthM).toBeGreaterThan(500);
        expect(lowest.fraction * tape.trackLengthM).toBeLessThan(820);
        const height =
          heightAtFraction(tape.snapshot.elevationM, lowest.fraction) ?? 99;
        expect(height).toBeLessThan(0.5);
      });

      it('reads the line 4.8 m above the lowest point', () => {
        const atTheLine = heightAtFraction(tape.snapshot.elevationM, 0) ?? 0;

        expect(atTheLine).toBe(tape.snapshot.lineElevationM);
        expect(Math.abs(atTheLine - 4.8)).toBeLessThan(0.5);
      });
    });

    describe('the track notes', () => {
      it('finds each note due in turn, three to a lap', () => {
        // Most of a lap, a whole one, and two thirds of a third.
        expect(tape.trackChanges.map((change) => change.distanceM)).toEqual([
          500, 1500, 3000, 500, 1500, 3000, 500, 1500,
        ]);
        const [first, second] = tape.crossingTimes;
        const lapTwo = tape.trackChanges.filter(
          (change) => change.sessionTime > first && change.sessionTime < second
        );
        expect(lapTwo.map((change) => change.distanceM)).toEqual([
          500, 1500, 3000,
        ]);
      });

      it('shows a note on the first update in which the car has reached it', () => {
        for (const change of tape.trackChanges) {
          // At or past the note now, and short of it on the update before.
          expect(change.positionM).toBeGreaterThanOrEqual(change.distanceM);
          expect(change.previousPositionM).toBeLessThan(change.distanceM);
          // At the wheel the position is the car's own: never early, and
          // late by no more than one update, which is 3 m at 64 m/s when
          // the host lets every third frame through. 2.2 m at the most on
          // this recording.
          const late = change.truePositionM - change.distanceM;
          expect(late).toBeGreaterThanOrEqual(0);
          expect(late).toBeLessThan(3.5);
        }
      });

      it('shows it for a watched car within the 3.6 m its fraction is carried to', () => {
        expect(
          tape.watchedTrackChanges.map((change) => change.distanceM)
        ).toEqual(tape.trackChanges.map((change) => change.distanceM));
        for (const change of tape.watchedTrackChanges) {
          expect(change.positionM).toBeGreaterThanOrEqual(change.distanceM);
          expect(change.previousPositionM).toBeLessThan(change.distanceM);
          // Half a thousandth of a lap early at the most, and no later than
          // that and one update.
          const late = change.truePositionM - change.distanceM;
          expect(late).toBeGreaterThan(-1.81);
          expect(late).toBeLessThan(1.81 + 3.5);
        }
        // Rounding does show a note early: one at least was, on this tape.
        expect(
          tape.watchedTrackChanges.some(
            (change) => change.truePositionM < change.distanceM
          )
        ).toBe(true);
      });

      it('carries the last note of the lap over the line', () => {
        // The recording opens short of the first note, and each of the two
        // laps that begin in it begins on the note at 3,000 m.
        expect(tape.noteAtLapStart).toEqual([3000, 3000, 3000]);
      });

      it('finds a pace note due early by its lead', () => {
        // The notes at 2,000 m and 2,900 m, looked up 150 m ahead of the
        // car: due as it passes 1,850 m and 2,750 m.
        expect(tape.paceChanges.map((change) => change.distanceM)).toEqual([
          2000, 2900, 2000, 2900, 2000,
        ]);
        for (const change of tape.paceChanges) {
          const late = change.truePositionM + PACE_LEAD_M - change.distanceM;
          expect(late).toBeGreaterThanOrEqual(0);
          expect(late).toBeLessThan(3.5);
        }
      });
    });
  }
);
