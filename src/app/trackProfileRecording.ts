import type { ActiveSimulator, TrackProfileKey } from '../types';
import { findTinyPedalElevation } from './lmu/tinyPedalElevation';
import { tinyPedalTrackMapDirectories } from './lmu/trackMap';
import {
  wirePlayerLapRecording,
  type LapRecordingBridge,
} from './playerLapRecording';
import type { TrackProfileSource } from './processors/TrackProfileProcessor';
import {
  TrackProfileRecorder,
  trackProfileLapSource,
} from './processors/TrackProfileRecorder';
import {
  getTrackProfileStore,
  type TrackProfileStore,
} from './storage/trackProfiles';

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/** As much of the perf metrics as the recording needs. */
interface PerformanceSections {
  markStart(label: string): void;
  markEnd(label: string): void;
}

export interface TrackProfileRecordingOptions {
  store: TrackProfileStore;
  getBridge: () => LapRecordingBridge | undefined;
  getSimulator: () => ActiveSimulator | undefined;
  /** Called when the app moves to another bridge. */
  onBridgeChanged: (callback: () => void) => Unsubscribe;
  /** Called when the running simulator becomes known, changes or is lost. */
  onSimulatorChanged: (callback: () => void) => Unsubscribe;
  lifecycle: {
    onEnter(callback: (event: { replay: boolean }) => void): () => void;
    onDisconnect(callback: () => void): () => void;
  };
  /**
   * Whether what is on the bridge is the player's own driving, now: not a
   * tape, a replay file or demo mode. A profile is built from nothing else.
   */
  isLive: () => boolean;
  /** Called when `isLive` may answer differently. */
  onLiveChanged: (callback: () => void) => Unsubscribe;
  /**
   * Looks for an elevation to start a track from, by the track's name:
   * pairs of metres into the lap and metres up, or null. TinyPedal's track
   * maps by default.
   */
  findElevation?: (
    trackName: string
  ) => Promise<readonly (readonly [number, number])[] | null>;
  metrics?: PerformanceSections;
  logInfo?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

let store: TrackProfileStore | undefined;
/** The recorder fed now: the channel asks it how far round its lap it is. */
let activeRecorder: TrackProfileRecorder | undefined;

/**
 * Opens the installation's track profiles. Called once at startup, before
 * the telemetry bridge is made, so the bridge's processors find them.
 */
export const startTrackProfiles = (): TrackProfileStore =>
  (store ??= getTrackProfileStore());

/**
 * What the track-profile channel reads: the stored profiles, and the lap
 * being recorded. Null before `startTrackProfiles`.
 */
export const getTrackProfileSource = (): TrackProfileSource | null => {
  const profiles = store;
  return profiles
    ? {
        load: (simulator, trackId, pointsCount) =>
          profiles.load(simulator, trackId, pointsCount),
        revision: () => profiles.revision(),
        recordingProgress: () => activeRecorder?.progress() ?? null,
      }
    : null;
};

/**
 * The track of the running session as a profile is filed under it, or null
 * while no session names one: what the notes editor starts a track that has
 * nothing stored yet from. Known from a tape, a replay and demo mode too,
 * where nothing is recorded: a note can be written for any track on screen.
 */
export const getSessionTrackKey = (): TrackProfileKey | null =>
  activeRecorder?.trackKey() ?? null;

/**
 * Builds each track's profile from the laps the player drives, for as long
 * as the app runs.
 *
 * Hosted outside the ProcessorHost, beside the lap library's recorder and
 * for the same reason: a processor runs only while a window wants its
 * channel, and a profile that could only be recorded with a widget on
 * screen would be missing for most of the tracks a user drives. Like the
 * library it takes nothing from a tape, a replay or demo mode.
 *
 * It follows the simulator as well as the bridge: left on auto-detect the
 * bridge is there before any game is found, and a lap is filed under the
 * simulator it was driven in.
 *
 * Under Le Mans Ultimate a track with no elevation yet is first offered
 * the one in a TinyPedal track map of the same name, if the user has one;
 * the first clean lap replaces it.
 */
export const setupTrackProfileRecording = ({
  store: profiles,
  getBridge,
  getSimulator,
  onBridgeChanged,
  onSimulatorChanged,
  lifecycle,
  isLive,
  onLiveChanged,
  findElevation = (trackName) =>
    findTinyPedalElevation(trackName, tinyPedalTrackMapDirectories()),
  metrics,
  logInfo,
  logError,
}: TrackProfileRecordingOptions): (() => void) => {
  let recorder: TrackProfileRecorder | undefined;
  let replaySource = false;
  /** Tracks an elevation has been looked for in this run. */
  const lookedFor = new Set<string>();

  const live = () => !replaySource && isLive();
  const applyEnabled = () => recorder?.setEnabled(live());

  const offerElevation = (key: TrackProfileKey): void => {
    const id = `${key.simulator}:${key.trackId}:${key.pointsCount}`;
    if (
      trackProfileLapSource(key.simulator) !== 'recorded' ||
      lookedFor.has(id) ||
      !live()
    ) {
      return;
    }
    lookedFor.add(id);
    void (async () => {
      const existing = await profiles.whenLoaded(key.simulator, key.trackId);
      if (existing?.elevationM && existing.pointsCount === key.pointsCount) {
        return;
      }
      const pairs = await findElevation(key.trackName);
      if (pairs && (await profiles.importElevation(key, pairs))) {
        logInfo?.(
          `[TrackProfiles] Took the elevation of ${key.trackName} from a TinyPedal track map`
        );
      }
    })().catch((error: unknown) =>
      logError?.('[TrackProfiles] Could not look for an elevation:', error)
    );
  };

  const disposeWiring = wirePlayerLapRecording({
    getBridge,
    getSimulator,
    onBridgeChanged,
    onSimulatorChanged,
    createRecorder: (simulator) => {
      const source = trackProfileLapSource(simulator);
      const next = new TrackProfileRecorder(
        {
          wants: (key) => profiles.demand(key, source),
          recordLap: (key, lap) => {
            profiles
              .recordLap(key, lap)
              .then((changed) => {
                if (changed) {
                  logInfo?.(
                    `[TrackProfiles] Recorded a lap of ${key.trackName} into its profile`
                  );
                }
              })
              .catch((error: unknown) =>
                logError?.('[TrackProfiles] Could not keep a lap:', error)
              );
          },
        },
        { simulator }
      );
      return {
        recorder: next,
        onSession: (session) => {
          next.onSession(session);
          const key = next.trackKey();
          if (key) offerElevation(key);
        },
        onFrame: (telemetry) => {
          metrics?.markStart('trackProfileRecording');
          next.onFrame(telemetry);
          metrics?.markEnd('trackProfileRecording');
        },
      };
    },
    onRecorderChanged: (next) => {
      recorder = next?.recorder;
      activeRecorder = recorder;
      applyEnabled();
    },
  });
  const unsubscribeEnter = lifecycle.onEnter(({ replay }) => {
    replaySource = replay;
    recorder?.onEnter();
    applyEnabled();
  });
  const unsubscribeDisconnect = lifecycle.onDisconnect(() =>
    recorder?.onDisconnect()
  );
  const unsubscribeLive = onLiveChanged(applyEnabled);

  return () => {
    disposeWiring();
    unsubscribeEnter();
    unsubscribeDisconnect();
    unsubscribeLive?.();
    recorder = undefined;
    activeRecorder = undefined;
  };
};
