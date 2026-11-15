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
import { lmuSessionSignature } from '../app/lmu/sessionSignature';

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
  /** Called for every frame. Returning false stops the replay. */
  onFrame: (frame: LmuTapeFrame) => unknown;
}

/** Seconds of session time between session snapshots, as in the bridge. */
const SESSION_POLL_SECONDS = 0.5;

/**
 * Plays a tape through the LMU session and telemetry mapping, the way the
 * bridge does: one session identity, lap-distance and energy state for the
 * whole run, and a session rebuilt whenever its signature moves.
 *
 * Without the REST answers and the UI websocket, which need the bridge's
 * timers; the channels they feed are absent, as in a session where LMU's
 * REST API is not answering.
 */
export const playLmuTape = async ({
  tapePath,
  addonPath = LMU_TAPE_ADDON_PATH,
  speed = 20,
  transformRaw = (raw) => raw,
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
        undefined,
        sessionIdentity,
        undefined,
        undefined,
        undefined,
        energyState,
        clockState
      );
      const sessionTime = telemetry.SessionTime
        ?.value?.[0] as unknown as number;
      if (
        onFrame({ raw, telemetry, session, sessionChanged, sessionTime }) ===
        false
      )
        ended = true;
    }
  } finally {
    sdk.stop();
  }
  return { frames };
};
