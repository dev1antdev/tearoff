/**
 * Plays a Le Mans Ultimate tape through everything the rivals box reads,
 * and builds the box at each tick as the renderer does.
 *
 * The box has no processor of its own: it is made in the renderer, by a
 * pure function, from the standings, the per-car pit tracker, the lap
 * history and the relative gaps. A tape can only be played in the main
 * process's test project, and main-process code may not import the
 * renderer's; this is where the two meet for a spec, as `renderWithFixture`
 * is for a fixture.
 *
 * Windows only, like the replay addon the tape is read with.
 */
import type { Session, StandingsSnapshot } from '@irdashies/types';
import type { LmuRawTelemetry } from '../app/lmu/native';
import { CarPitProcessor } from '../app/processors/CarPitProcessor';
import { LapHistoryProcessor } from '../app/processors/LapHistoryProcessor';
import { RelativeGapProcessor } from '../app/processors/RelativeGapProcessor';
import { StandingsProcessor } from '../app/processors/StandingsProcessor';
import {
  buildClassRivals,
  type ClassRivals,
} from '../frontend/domain/standings/classRivals';
import { LMU_CURATED_TAPE_PATH, playLmuTape } from './lmuTape';

/** The grid rules the session bar's position change item applies. */
export {
  classGridChange,
  overallGridChange,
} from '../frontend/domain/standings/classRivals';
export type { ClassRivals } from '../frontend/domain/standings/classRivals';

/** Changes each snapshot before it is mapped: see `playLmuTape`. */
export type LmuTapeStage = <T extends LmuRawTelemetry>(raw: T) => T;

export interface LmuTapeRivalsTick {
  sessionTime: number;
  /** The box as the renderer would have built it at this tick. */
  rivals: ClassRivals;
  /** The snapshot it was built from. Live: read it, do not keep it. */
  standings: StandingsSnapshot;
  /** The frame as the sim recorded it, before any staging. */
  recorded: LmuRawTelemetry;
}

export interface PlayLmuTapeRivalsOptions {
  tapePath?: string;
  /** The user's own car, which the pit estimate's penalty describes. */
  ownCarIdx?: number;
  /** Seconds between ticks. The widget reads the standings five a second. */
  tickSeconds?: number;
  stage?: LmuTapeStage;
  onTick: (tick: LmuTapeRivalsTick) => void;
}

/**
 * The standings, the lap history and the relative gaps see every frame, as
 * the host feeds them (a line crossing is timed by the frame it is seen
 * in); the pit tracker and the box itself are read at each tick.
 */
export const playLmuTapeRivals = async ({
  tapePath = LMU_CURATED_TAPE_PATH,
  ownCarIdx = 0,
  tickSeconds = 0.2,
  stage,
  onTick,
}: PlayLmuTapeRivalsOptions): Promise<{
  frames: number;
  ticks: number;
  last: LmuTapeRivalsTick | null;
}> => {
  const standings = new StandingsProcessor();
  const carPit = new CarPitProcessor();
  const lapHistory = new LapHistoryProcessor();
  // No reference laps, as early in a session: the relative falls back to
  // the sim's estimated times.
  const relativeGaps = new RelativeGapProcessor({
    snapshot: () => ({
      bestLaps: [],
      persistedLaps: [],
      sessionNum: null,
      version: 0,
    }),
  });
  for (const processor of [standings, carPit, lapHistory, relativeGaps]) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }

  let session: Session | null = null;
  let recorded: LmuRawTelemetry | null = null;
  let frames = 0;
  let ticks = 0;
  let lastTick = Number.NEGATIVE_INFINITY;
  let last: LmuTapeRivalsTick | null = null;
  await playLmuTape({
    tapePath,
    speed: 20,
    transformRaw: (raw) => {
      // Session snapshots pass through here too; only a frame is kept.
      if (!('drivers' in raw)) recorded = raw;
      return stage ? stage(raw) : raw;
    },
    onFrame: (frame) => {
      frames += 1;
      if (frame.sessionChanged) {
        session = frame.session;
        standings.init(session);
        carPit.init(session);
        lapHistory.init(session);
        relativeGaps.init?.(session);
      }
      standings.onFrame(frame.telemetry);
      lapHistory.onFrame(frame.telemetry);
      relativeGaps.onFrame(frame.telemetry);
      if (frame.sessionTime - lastTick < tickSeconds) return;
      lastTick = frame.sessionTime;
      carPit.onFrame(frame.telemetry);
      if (!session || !recorded) return;
      ticks += 1;
      last = {
        sessionTime: frame.sessionTime,
        standings: standings.snapshot(),
        recorded,
        rivals: buildClassRivals({
          standings: standings.snapshot(),
          drivers: session.DriverInfo?.Drivers,
          isRace:
            session.SessionInfo?.Sessions?.find(
              (entry) => entry.SessionNum === standings.snapshot().sessionNum
            )?.SessionType === 'Race',
          ownCarIdx,
          qualifyingResults: session.QualifyResultsInfo?.Results ?? undefined,
          carPit: carPit.snapshot(),
          lapHistory: lapHistory.snapshot(),
          relativeGaps: relativeGaps.snapshot(),
          decimalPlaces: 2,
        }),
      };
      onTick(last);
    },
  });
  return { frames, ticks, last };
};
