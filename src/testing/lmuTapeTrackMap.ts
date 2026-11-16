/**
 * Plays a Le Mans Ultimate tape through what the Track Map reads, and places
 * every car at each update as the widget does.
 *
 * The map has no processor of its own. It is drawn in the renderer from the
 * outline the session carries, the session's driver list, the lap fractions
 * `track-state.snapshot` publishes and the sector starts of
 * `track-profile.snapshot`, by pure functions; a tape can only be played in
 * the main process's test project, and main-process code may not import the
 * renderer's. This is where the two meet for a spec, as `lmuTapeRivals` is
 * for the rivals box.
 *
 * The outline is found as the bridge finds it for a circuit with nothing
 * stored: the one bundled with the app. Beside it the app's own recorder is
 * run over the same frames, which is how a circuit with no bundled map gets
 * one, so a spec can hold the two against each other. The track profile is
 * recorded and published by the app's own recorder, merge rules and
 * processor, held in memory where the store would hold it.
 *
 * Windows only, like the replay addon the tape is read with.
 */
import type {
  LmuTrackMap,
  Session,
  Telemetry,
  TrackProfile,
  TrackStateSnapshot,
} from '@irdashies/types';
import {
  findBundledLmuTrackMap,
  LmuTrackMapRecorder,
} from '../app/lmu/trackMap';
import {
  sessionSecondsFrameClock,
  takeTick,
  type TickSchedule,
} from '../app/processors/ProcessorHost';
import {
  indexLag,
  PositionHistory,
  simSectorStartedAt,
} from '../app/processors/sectorIndexLag';
import { TrackProfileProcessor } from '../app/processors/TrackProfileProcessor';
import { TrackProfileRecorder } from '../app/processors/TrackProfileRecorder';
import { TrackStateProcessor } from '../app/processors/TrackStateProcessor';
import { mergeProfileLap, profileDemand } from '../app/storage/trackProfiles';
import { lmuTrackDrawing } from '../frontend/domain/track/lmuTrackOutline';
import type { TrackDrawing } from '../frontend/domain/track/trackDrawing';
import { learnedSectorStarts } from '../frontend/domain/track/trackSectors';
import { progressToTrackPoint } from '../frontend/domain/track/useProgressAnimation';
import { LMU_CURATED_TAPE_PATH, playLmuTape } from './lmuTape';

/** One car as the map draws it. */
export interface LmuTapeMapCar {
  carIdx: number;
  /** The lap fraction the widget read for it. */
  progress: number;
  /** Where the widget puts it, in the drawing's own units. */
  x: number;
  y: number;
  onPitRoad: boolean;
  /** The car the map marks as the user's. */
  isFocus: boolean;
}

export interface LmuTapeMapTick {
  sessionTime: number;
  /** Every car the widget would draw on this update. */
  cars: LmuTapeMapCar[];
  /** Cars in the session's driver list, the pace car left out. */
  entered: number;
  /**
   * Where the map would draw the sectors' starts on this update: null while
   * the profile has not learned them.
   */
  sectorStarts: readonly number[] | null;
}

/** The sim moving the player's car into its next sector. */
export interface LmuTapeSectorEntry {
  sessionTime: number;
  /** The sector entered: 1 or 2. The line is not a learned start. */
  sectorIdx: number;
  /** The car's lap fraction on the frame the sim's index moved. */
  reportedAt: number;
  /**
   * Its lap fraction at the moment it crossed: the same reading taken back
   * by the time the index trailed the crossing, as the profile takes it.
   */
  crossedAt: number;
  /** How long the index trailed the crossing, seconds. */
  lagSeconds: number;
}

export interface LmuTapeTrackMap {
  frames: number;
  trackName: string;
  /** The bundled outline as the widget draws from it; null where none is. */
  drawing: TrackDrawing | null;
  /** The bundled map itself. */
  bundled: LmuTrackMap | null;
  /**
   * The map the app's own recorder made of the first lap of the player's it
   * took on the tape; null where the tape holds none.
   */
  recorded: LmuTrackMap | null;
  ticks: LmuTapeMapTick[];
  /** Every move of the player's car into its second or third sector. */
  sectorEntries: LmuTapeSectorEntry[];
}

/**
 * The cars the Track Map draws and where, for one update of the channel.
 *
 * Chosen as `useDriverProgress` chooses them: every driver of the session
 * but the pace car, with the lap fraction the channel has for its slot, left
 * out where that is negative: a slot with no car on the circuit. Placed as
 * `TrackCanvas` places them once a position has settled.
 */
export const placeTrackMapCars = (
  session: Session,
  trackState: TrackStateSnapshot,
  drawing: TrackDrawing
): LmuTapeMapCar[] => {
  const points = drawing.active.trackPathPoints;
  const totalLength = drawing.active.totalLength;
  const startLength = drawing.startFinish.point?.length;
  if (!points || !totalLength || startLength === undefined) return [];
  const paceCarIdx = session.DriverInfo?.PaceCarIdx ?? -1;
  const focusCarIdx =
    trackState.focusCarIdx !== null && trackState.focusCarIdx >= 0
      ? trackState.focusCarIdx
      : session.DriverInfo?.DriverCarIdx;

  const cars: LmuTapeMapCar[] = [];
  for (const driver of session.DriverInfo?.Drivers ?? []) {
    if (driver.CarIdx === paceCarIdx) continue;
    const progress = trackState.carIdxLapDistPct[driver.CarIdx] ?? -1;
    if (!(progress > -1)) continue;
    const point = { x: 0, y: 0 };
    progressToTrackPoint(
      progress,
      points,
      totalLength,
      startLength,
      drawing.startFinish.direction,
      point
    );
    cars.push({
      carIdx: driver.CarIdx,
      progress,
      x: point.x,
      y: point.y,
      onPitRoad: trackState.carIdxOnPitRoad[driver.CarIdx] === true,
      isFocus: driver.CarIdx === focusCarIdx,
    });
  }
  return cars;
};

const numberOf = (frame: Telemetry, key: keyof Telemetry): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * The track state sees a frame twenty-five times a second, as the host runs
 * its channel, and the cars are placed on each update of it. The two
 * recorders and the profile's processor see every frame, as in the app.
 */
export const playLmuTapeTrackMap = async ({
  tapePath = LMU_CURATED_TAPE_PATH,
}: { tapePath?: string } = {}): Promise<LmuTapeTrackMap> => {
  const trackState = new TrackStateProcessor();
  trackState.onLifecycle({ type: 'enter', replay: false });
  const mapRecorder = new LmuTrackMapRecorder();
  const schedule: TickSchedule = {};

  // The profile, held in memory where the store would hold it.
  let profile: TrackProfile | null = null;
  let revision = 0;
  const profileRecorder = new TrackProfileRecorder(
    {
      wants: (key) => profileDemand(profile, key, 'recorded'),
      recordLap: (key, lap) => {
        const next = mergeProfileLap(profile, key, lap, 1_700_000_000_000);
        if (!next) return;
        profile = next;
        revision += 1;
      },
    },
    { simulator: 'lmu' }
  );
  profileRecorder.onEnter();
  const profiles = new TrackProfileProcessor(
    {
      load: (_simulator, trackId, pointsCount) =>
        profile?.trackId === trackId && profile.pointsCount === pointsCount
          ? profile
          : null,
      revision: () => revision,
      recordingProgress: () => profileRecorder.progress(),
    },
    'lmu'
  );
  profiles.onLifecycle({ type: 'enter', replay: false });

  let session: Session | null = null;
  let trackName = '';
  let bundled: LmuTrackMap | null = null;
  let drawing: TrackDrawing | null = null;
  let recorded: LmuTrackMap | null = null;
  let lastVersion = -1;
  const ticks: LmuTapeMapTick[] = [];

  const history = new PositionHistory();
  let sectorIdx: number | null = null;
  const sectorEntries: LmuTapeSectorEntry[] = [];

  const { frames } = await playLmuTape({
    tapePath,
    onFrame: (frame) => {
      const { telemetry } = frame;
      if (frame.sessionChanged) {
        session = frame.session;
        trackState.init(session);
        profileRecorder.onSession(session);
        profiles.init(session);
        const name = session.WeekendInfo?.TrackName ?? '';
        if (name !== trackName) {
          trackName = name;
          bundled = findBundledLmuTrackMap(name);
          drawing = lmuTrackDrawing(bundled);
        }
      }
      profileRecorder.onFrame(telemetry);
      profiles.onFrame(telemetry);
      // The bridge stops recording once a circuit has a map; here the first
      // one is kept and the rest of the tape is left alone, to the same end.
      recorded ??= mapRecorder.update(
        frame.raw,
        numberOf(telemetry, 'LapDistPct') ?? undefined
      );

      // Every move into the next sector, placed as the profile places it.
      const lapDistPct = numberOf(telemetry, 'LapDistPct');
      const reportedIdx = numberOf(telemetry, 'LmuSectorIdx');
      if (lapDistPct !== null) history.remember(frame.sessionTime, lapDistPct);
      if (
        lapDistPct !== null &&
        reportedIdx !== null &&
        sectorIdx !== null &&
        reportedIdx === sectorIdx + 1
      ) {
        const lagSeconds = indexLag(
          numberOf(telemetry, 'LapCurrentLapTime'),
          simSectorStartedAt(
            telemetry.LmuCurrentSectorTimes?.value,
            reportedIdx
          )
        );
        sectorEntries.push({
          sessionTime: frame.sessionTime,
          sectorIdx: reportedIdx,
          reportedAt: lapDistPct,
          crossedAt:
            history.positionAt(frame.sessionTime - lagSeconds) ?? lapDistPct,
          lagSeconds,
        });
      }
      sectorIdx = reportedIdx;

      if (!takeTick(schedule, 25, sessionSecondsFrameClock(telemetry))) return;
      trackState.onFrame(telemetry);
      const state = trackState.snapshot();
      if (state.version === lastVersion || !session || !drawing) return;
      lastVersion = state.version;
      const paceCarIdx = session.DriverInfo?.PaceCarIdx ?? -1;
      ticks.push({
        sessionTime: frame.sessionTime,
        cars: placeTrackMapCars(session, state, drawing),
        entered: (session.DriverInfo?.Drivers ?? []).filter(
          (driver) => driver.CarIdx !== paceCarIdx
        ).length,
        sectorStarts: learnedSectorStarts(profiles.snapshot()),
      });
    },
  });

  return {
    frames,
    trackName,
    drawing,
    bundled,
    recorded,
    ticks,
    sectorEntries,
  };
};
