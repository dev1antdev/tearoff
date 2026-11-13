import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getChannelSnapshotStore,
  useDriverCarIdx,
  useLovelyTrackData,
  useReferenceLapStore,
  useSessionStore,
  useTrackLength,
} from '@irdashies/context';
import { CornerPassTracker } from '@irdashies/domain/cornerDelta/cornerPassTracker';
import {
  cornerResultFrom,
  cornerSpanOf,
  timeableCorners,
  type CornerResult,
} from '@irdashies/domain/cornerDelta/cornerReadings';
import {
  trackCornersFrom,
  type CornerLabelStyle,
} from '@irdashies/domain/corners/trackCorners';
import { MAX_CORNER_HISTORY } from './useCornerDeltaSettings';

export interface CornerResults {
  /**
   * Whether the track has corners in the bundled track data: false when the
   * track is named and none are known for it. Undefined until a session
   * names its track, so nothing is claimed about a track not yet known.
   */
  hasCorners: boolean | undefined;
  /** The corners completed, newest first: the last one and those before it. */
  results: readonly CornerResult[];
  /**
   * The label each corner is shown under, by its section id. Apart from the
   * results so the label style can change without anything driven again.
   */
  labels: ReadonlyMap<string, string>;
}

const NO_RESULTS: readonly CornerResult[] = [];

/**
 * The corners the player has just driven, each set against the same corner
 * on their reference laps.
 *
 * Position is read through a direct channel subscription rather than a hook
 * (R2.3): it arrives at telemetry rate, and a hook would re-render the widget
 * on every frame. Everything between two corners lives in the tracker, and
 * setState fires once per corner completed.
 *
 * The reference laps are read at the moment a corner is completed, so a
 * corner is always measured against the laps that existed when it was driven.
 */
export const useCornerResults = (
  enabled: boolean,
  labelStyle: CornerLabelStyle
): CornerResults => {
  const trackName = useSessionStore((s) => s.session?.WeekendInfo?.TrackName);
  const { sections } = useLovelyTrackData();
  const trackLengthM = useTrackLength();
  const playerCarIdx = useDriverCarIdx();

  // Named once for the tracker: where the corners are does not depend on
  // how they are labelled, and a corner's id does not either.
  const corners = useMemo(
    () => timeableCorners(trackCornersFrom(sections, 'name'), trackLengthM),
    [sections, trackLengthM]
  );
  const labels = useMemo(
    () =>
      new Map(
        trackCornersFrom(sections, labelStyle).map((corner) => [
          corner.section_id,
          corner.label,
        ])
      ),
    [sections, labelStyle]
  );

  const [results, setResults] = useState(NO_RESULTS);
  const resultsRef = useRef(NO_RESULTS);
  // Read inside the per-frame callback, so it never restarts the subscription.
  const playerCarIdxRef = useRef(playerCarIdx);
  playerCarIdxRef.current = playerCarIdx;

  useEffect(() => {
    if (!enabled || corners.length === 0) return;
    const bridge = window.channelBridge;
    if (!bridge) return;

    const publish = (next: readonly CornerResult[]) => {
      // The not-driving branch runs on every frame while the car sits in the
      // pits; without this it would re-render the widget at telemetry rate.
      if (next === resultsRef.current) return;
      resultsRef.current = next;
      setResults(next);
    };

    const tracker = new CornerPassTracker(corners.map(cornerSpanOf), {
      trackLengthM,
    });
    let serial = 0;
    let sessionNum: number | null = null;
    let replayPlaying = false;
    // One object for every frame: the tracker reads it and keeps nothing.
    const frame = { sessionTime: 0, lapDistPct: 0, speedMs: 0, driving: false };

    const store = getChannelSnapshotStore('lap-trace.sample', bridge);
    // Object.is is a safe equality here: IPC structured-clones every delivery
    // into a fresh object, so each frame is a change and none is skipped.
    const selection = store.createSelection((s) => s, Object.is, 60);

    const onSample = () => {
      const sample = selection.getSnapshot();
      if (!sample) return;

      if (sample.sessionNum !== sessionNum) {
        // Practice into qualifying into the race: what was driven in the
        // session before is not this one's last lap.
        if (sessionNum !== null) tracker.reset();
        sessionNum = sample.sessionNum;
        publish(NO_RESULTS);
      }

      const driving = sample.isOnTrack && !sample.onPitRoad && !replayPlaying;
      // Whatever is on screen is stale once the car is in the pits. The
      // tracker keeps how each corner was last driven for the out-lap.
      if (!driving) publish(NO_RESULTS);

      frame.sessionTime = sample.sessionTime;
      frame.lapDistPct = sample.lapDistPct;
      frame.speedMs = sample.speed;
      frame.driving = driving;
      const passes = tracker.push(frame);
      if (passes.length === 0) return;

      const { bestLaps, playerAllTimeLap } = useReferenceLapStore.getState();
      const carIdx = playerCarIdxRef.current;
      const laps = {
        sessionBest: carIdx == null ? null : (bestLaps.get(carIdx) ?? null),
        allTime: playerAllTimeLap,
      };
      let next = resultsRef.current;
      for (const pass of passes) {
        serial += 1;
        next = [
          cornerResultFrom(pass, corners[pass.cornerIndex], laps, serial),
          ...next,
        ].slice(0, MAX_CORNER_HISTORY + 1);
      }
      publish(next);
    };

    const unsubscribe = selection.subscribe(onSample);

    // Whether a replay is playing is the one thing the sample channel does
    // not carry. It changes rarely, so it is watched on its own slow
    // selection rather than gating the per-frame path on a second snapshot.
    const replaySelection = getChannelSnapshotStore(
      'track-state.snapshot',
      bridge
    ).createSelection((s) => s.isReplayPlaying, Object.is, 4);
    const unsubscribeReplay = replaySelection.subscribe(() => {
      replayPlaying = replaySelection.getSnapshot() ?? false;
    });
    replayPlaying = replaySelection.getSnapshot() ?? false;

    return () => {
      unsubscribe();
      unsubscribeReplay();
      // Another track's corners, or the widget switched off: nothing held
      // here describes what is driven next.
      publish(NO_RESULTS);
    };
  }, [enabled, corners, trackLengthM]);

  return {
    hasCorners: trackName ? corners.length > 0 : undefined,
    results,
    labels,
  };
};
