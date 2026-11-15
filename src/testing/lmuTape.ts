/**
 * Plays a Le Mans Ultimate tape through the app's own session and telemetry
 * mapping, for the specs and tools that need what the app would have
 * published from a recorded session rather than hand-built frames.
 *
 * Windows only, like the replay addon it loads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Session, Telemetry } from '@irdashies/types';
import type { LmuRawSession, LmuRawTelemetry } from '../app/lmu/native';
import { mapLmuSession } from '../app/lmu/mapSession';
import { mapLmuTelemetry } from '../app/lmu/mapTelemetry';
import { createLmuLapDistanceState } from '../app/lmu/lapDistance';
import { createLmuOpponentLapDistanceState } from '../app/lmu/opponentLapDistance';
import { createLmuEnergyState } from '../app/lmu/fuelEnergy';
import { createLmuSessionIdentity } from '../app/lmu/sessionIdentity';
import { createLmuSessionClockState } from '../app/lmu/sessionClock';
import { createLmuLapStartState } from '../app/lmu/lapStartTiming';
import { lmuSessionSignature } from '../app/lmu/sessionSignature';
import type { LmuGameState } from '../app/lmu/gameState';
import {
  createLmuOwnEntryState,
  lmuOwnEntrySlot,
  observeLmuOwnEntry,
  type LmuOwnEntry,
} from '../app/lmu/ownEntry';
import type { LmuRestCells } from '../app/lmu/rest/state';

export const LMU_TAPE_ADDON_PATH = path.resolve(
  'build/Release/lmu_tape_node.node'
);
export const LMU_CURATED_TAPE_PATH = path.resolve(
  'test-data/telemetry/lmu-session.lmudt'
);

/**
 * Whether a tape can be played here: the addon is built and the tape is the
 * recording itself rather than the Git LFS pointer left in its place.
 */
export const lmuTapeAvailable = (tapePath = LMU_CURATED_TAPE_PATH): boolean =>
  fs.existsSync(LMU_TAPE_ADDON_PATH) &&
  fs.existsSync(tapePath) &&
  fs.statSync(tapePath).size > 1024;

interface LmuTapeSdk {
  start(): boolean;
  stop(): boolean;
  read(): LmuRawTelemetry & { running: boolean };
  readSession(): LmuRawSession;
}

export interface LmuTapeFrame {
  raw: LmuRawTelemetry;
  telemetry: Telemetry;
  /** The session as last rebuilt, which is what the app would be showing. */
  session: Session;
  /** True on the frame a rebuilt session was first published with. */
  sessionChanged: boolean;
  sessionTime: number;
  /**
   * The user's own entry as the bridge would have it: observed on each
   * session snapshot and handed to the frame mapping as its fallback focus.
   */
  ownEntry: LmuOwnEntry;
}

export interface PlayLmuTapeOptions {
  tapePath: string;
  addonPath?: string;
  /** Tape seconds per wall-clock second. Slower reads more of the frames. */
  speed?: number;
  /**
   * Changes each snapshot before it is mapped, for the questions a recording
   * cannot answer as it stands: the same cars and laps as a practice session
   * rather than a race, say. Applied to the session snapshot as well.
   */
  transformRaw?: <T extends LmuRawTelemetry>(raw: T) => T;
  /**
   * Where the sim says the player is, for each frame, as the bridge takes it
   * from GetGameState. Called with the frame after `transformRaw`. Omitted,
   * or returning undefined, the frame is mapped as when LMU's REST API is
   * not answering, which is how every tape was played before this existed.
   */
  gameState?: (raw: LmuRawTelemetry) => LmuGameState | undefined;
  /**
   * The REST cells for each frame, as the bridge's poller would hold them:
   * the camera focus, the pit menu and the rest. Called with the frame after
   * `transformRaw`. Omitted, the channels they feed are absent.
   */
  restCells?: (raw: LmuRawTelemetry) => LmuRestCells | undefined;
  /** Called for every frame. Returning false stops the replay. */
  onFrame: (frame: LmuTapeFrame) => unknown;
}

/**
 * The session-wide fields of a snapshot, which the sim writes with or
 * without a player vehicle. With the per-car arrays, which all begin `veh`
 * and a capital, they are everything it writes at LMU's monitor.
 */
const SESSION_WIDE_FIELDS: ReadonlySet<string> = new Set([
  'running',
  'gameVersion',
  'trackName',
  'playerName',
  'serverName',
  'session',
  'currentET',
  'endET',
  'maxLaps',
  'lapDist',
  'numVehicles',
  'gamePhase',
  'yellowFlagState',
  'sectorFlags',
  'inRealtime',
  'gameMode',
  'isFixedSetup',
  'maxPlayers',
  'sessionTimeRemaining',
  'timeOfDay',
  'sessionStartEvents',
  'sessionEndEvents',
  'scoringUpdates',
  'trackGripLevel',
  'trackLimitsStepsPerPoint',
  'trackLimitsStepsPerPenalty',
  'cloudCoverage',
  'raining',
  'darkCloud',
  'ambientTemp',
  'trackTemp',
  'minPathWetness',
  'maxPathWetness',
  'avgPathWetness',
  'wind',
  'startLight',
  'numRedLights',
  'ffbTorque',
  'playerVehicleIdx',
  'playerHasVehicle',
  'activeVehicles',
  'classes',
  'drivers',
]);

/**
 * A snapshot as the sim writes it when it names no player vehicle: at the
 * monitor while a team-mate drives the car, or spectating.
 *
 * Staged, not recorded. The addon writes every single-car field -- gear,
 * pedals, fuel, the wheels, the player's clock -- only inside its "there is
 * a player vehicle" branch, so those are removed, the slot becomes -1, and
 * the session-wide fields and every per-car array are left as they were.
 * The car that was the player's goes on lapping in its slot, which is what
 * stands in for a team-mate driving it. Scoring's player flags are left
 * alone; a spec that wants them cleared does that itself.
 */
export const lmuRawWithoutPlayerVehicle = <T extends LmuRawTelemetry>(
  raw: T
): T => {
  const staged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SESSION_WIDE_FIELDS.has(key) || /^veh[A-Z]/.test(key)) {
      staged[key] = value;
    }
  }
  staged.playerHasVehicle = false;
  staged.playerVehicleIdx = -1;
  return staged as T;
};

/** Seconds of session time between session snapshots, as in the bridge. */
const SESSION_POLL_SECONDS = 0.5;

/**
 * Plays a tape through the LMU session and telemetry mapping, the way the
 * bridge does: one session identity, lap-distance and energy state for the
 * whole run, and a session rebuilt whenever its signature moves.
 *
 * Without the REST poller and the UI websocket, which need the bridge's
 * timers; the channels they feed are absent, as in a session where LMU's
 * REST API is not answering, unless the caller supplies a game state or
 * REST cells of its own.
 */
export const playLmuTape = async ({
  tapePath,
  addonPath = LMU_TAPE_ADDON_PATH,
  speed = 20,
  transformRaw = (raw) => raw,
  gameState,
  restCells,
  onFrame,
}: PlayLmuTapeOptions): Promise<{ frames: number }> => {
  process.env.IRDASHIES_LMU_REPLAY = path.resolve(tapePath);
  process.env.IRDASHIES_LMU_REPLAY_SPEED = String(speed);
  process.env.IRDASHIES_LMU_REPLAY_LOOP = '0';
  const { LmuSdkNode } = createRequire(import.meta.url)(addonPath) as {
    LmuSdkNode: new () => LmuTapeSdk;
  };
  const sdk = new LmuSdkNode();
  const lapDistanceState = createLmuLapDistanceState();
  const opponentState = createLmuOpponentLapDistanceState();
  const energyState = createLmuEnergyState();
  const sessionIdentity = createLmuSessionIdentity();
  const clockState = createLmuSessionClockState();
  const lapStartState = createLmuLapStartState();
  const ownEntryState = createLmuOwnEntryState();

  let frames = 0;
  let lastClock = Number.NaN;
  let lastSessionAt = Number.NEGATIVE_INFINITY;
  let lastSignature: string | null = null;
  let session: Session | null = null;
  try {
    sdk.start();
    const deadline = performance.now() + 10 * 60_000;
    let ended = false;
    while (performance.now() < deadline && !ended) {
      const read = sdk.read();
      if (!read?.running) {
        if (frames > 0) ended = true;
        else await new Promise((resolve) => setTimeout(resolve, 2));
        continue;
      }
      const raw = transformRaw(read);
      // The player's 100 Hz clock where there is one, scoring's otherwise:
      // the same choice the mapper makes for SessionTime.
      const clock =
        typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
          ? raw.elapsedTime
          : raw.currentET;
      if (clock === lastClock) continue;
      lastClock = clock;
      frames += 1;

      sessionIdentity.observe({
        trackName: raw.trackName,
        session: raw.session,
        serverName: raw.serverName,
        currentET: raw.currentET,
        playerLaps:
          raw.playerHasVehicle && raw.playerVehicleIdx >= 0
            ? raw.vehTotalLaps?.[raw.playerVehicleIdx]
            : undefined,
        playerSlot:
          raw.playerHasVehicle && raw.playerVehicleIdx >= 0
            ? raw.playerVehicleIdx
            : undefined,
        sessionStartEvents: raw.sessionStartEvents,
        sessionEndEvents: raw.sessionEndEvents,
      });
      if (sessionIdentity.lastChange()) lastSignature = null;

      let sessionChanged = false;
      if (
        session === null ||
        clock - lastSessionAt >= SESSION_POLL_SECONDS ||
        clock < lastSessionAt
      ) {
        lastSessionAt = clock;
        const rawSession = transformRaw(sdk.readSession());
        // On every session read, as in the bridge, and before the frame.
        observeLmuOwnEntry(ownEntryState, rawSession);
        const signature = lmuSessionSignature(rawSession);
        if (signature !== lastSignature) {
          lastSignature = signature;
          session = mapLmuSession(
            rawSession,
            null,
            undefined,
            undefined,
            sessionIdentity
          );
          sessionChanged = true;
        }
      }
      if (session === null) continue;

      const telemetry = mapLmuTelemetry(
        raw,
        lapDistanceState,
        opponentState,
        restCells?.(raw),
        sessionIdentity,
        undefined,
        undefined,
        gameState?.(raw),
        energyState,
        clockState,
        lapStartState,
        lmuOwnEntrySlot(ownEntryState)
      );
      const sessionTime = telemetry.SessionTime
        ?.value?.[0] as unknown as number;
      if (
        onFrame({
          raw,
          telemetry,
          session,
          sessionChanged,
          sessionTime,
          ownEntry: ownEntryState.current,
        }) === false
      )
        ended = true;
    }
  } finally {
    sdk.stop();
  }
  return { frames };
};
