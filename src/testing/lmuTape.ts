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
import { lmuBlockSlotToRead } from '../app/lmu/ownEntryBlock';
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
  read(blockSlot?: number): LmuRawTelemetry & { running: boolean };
  readSession(blockSlot?: number): LmuRawSession;
  readRest(path: string): string | null;
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
  /**
   * No longer changes anything, and is kept for the specs that pass it. It
   * was the pace the addon was asked to play at, lowered so that fewer
   * frames were lost; none is lost now at any pace, so the tape is always
   * asked for as fast as the addon will play it.
   */
  speed?: number;
  /**
   * Changes each snapshot before it is mapped, for the questions a recording
   * cannot answer as it stands: the same cars and laps as a practice session
   * rather than a race, say. Applied to the session snapshot as well.
   *
   * `blockSlot` is the slot whose telemetry block the read asked for, -1
   * when it asked for the player's own. The replay asks as the bridge does:
   * for the own entry's block, while the snapshot before this one, as this
   * callback left it, named no player vehicle.
   */
  transformRaw?: <T extends LmuRawTelemetry>(raw: T, blockSlot: number) => T;
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
   *
   * `readRest` gives the body the recording holds for a REST path as of this
   * frame, or null where it has none yet, for a caller that wants the cells
   * the sim's own answers would have made.
   */
  restCells?: (
    raw: LmuRawTelemetry,
    readRest: (path: string) => string | null
  ) => LmuRestCells | undefined;
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
  'blockSlot',
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
 *
 * `blockSlot` is the slot the read asked the addon for, as `transformRaw`
 * is given it. Where the snapshot's single-car fields are that slot's
 * telemetry block they stay, as the addon leaves them when it names no
 * player: the block was asked for by slot, and is there whoever drives the
 * car. On a recording that block is still the one the player's own car
 * had, with the tyre temperatures and the dials the sim writes for no other
 * car in it.
 */
export const lmuRawWithoutPlayerVehicle = <T extends LmuRawTelemetry>(
  raw: T,
  blockSlot = -1
): T => {
  const keepsBlock = blockSlot >= 0 && raw.blockSlot === blockSlot;
  const staged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (keepsBlock || SESSION_WIDE_FIELDS.has(key) || /^veh[A-Z]/.test(key)) {
      staged[key] = value;
    }
  }
  staged.playerHasVehicle = false;
  staged.playerVehicleIdx = -1;
  if (!keepsBlock) staged.blockSlot = -1;
  return staged as T;
};

/** Seconds of session time between session snapshots, as in the bridge. */
const SESSION_POLL_SECONDS = 0.5;

/** The pace range the replay addon accepts, in tape seconds per second. */
const ADDON_SLOWEST_SPEED = 0.25;
const ADDON_FASTEST_SPEED = 100;
/** Milliseconds past the moment a snapshot falls due before it is asked for. */
const DUE_MARGIN_MS = 10;
/** A replay still reading after this long is one that will never end. */
const GIVE_UP_AFTER_MS = 10 * 60_000;

/** The sizes and offsets of a tape's headers; see `replay/lmu_tape.h`. */
const TAPE_FILE_HEADER_BYTES = 80;
const TAPE_RECORD_HEADER_BYTES = 32;
const TAPE_RECORD_PAYLOAD_SIZE_AT = 8;
const TAPE_RECORD_ELAPSED_MICROS_AT = 16;
const TAPE_KEYFRAME = 1;
const TAPE_DELTA = 2;
/** REST answers come first on a tape; the second snapshot is not far in. */
const TAPE_RECORDS_SEARCHED = 1000;

/**
 * How long after its start a tape stamps its second snapshot, in
 * microseconds, read from the tape's own record headers. 0 for a file that
 * is not a tape or holds fewer than two.
 */
const secondSnapshotMicros = (tapePath: string): number => {
  const header = Buffer.alloc(TAPE_RECORD_HEADER_BYTES);
  let file: number;
  try {
    file = fs.openSync(tapePath, 'r');
  } catch {
    return 0;
  }
  try {
    let position = TAPE_FILE_HEADER_BYTES;
    let snapshots = 0;
    for (let record = 0; record < TAPE_RECORDS_SEARCHED; record += 1) {
      const read = fs.readSync(file, header, 0, header.length, position);
      if (read < header.length) return 0;
      const kind = header.readUInt32LE(0);
      if (kind === TAPE_KEYFRAME || kind === TAPE_DELTA) {
        snapshots += 1;
        if (snapshots === 2) {
          return Number(header.readBigUInt64LE(TAPE_RECORD_ELAPSED_MICROS_AT));
        }
      }
      position +=
        header.length + header.readUInt32LE(TAPE_RECORD_PAYLOAD_SIZE_AT);
    }
    return 0;
  } finally {
    fs.closeSync(file);
  }
};

/**
 * A session snapshot as the frame it also is: what `read` would have given
 * for the same snapshot, without the drivers and the classes.
 */
const frameOf = (snapshot: LmuRawSession): LmuRawTelemetry => {
  const frame: Partial<LmuRawSession> = { ...snapshot };
  delete frame.classes;
  delete frame.drivers;
  return frame as LmuRawTelemetry;
};

/**
 * Plays a tape through the LMU session and telemetry mapping, the way the
 * bridge does: one session identity, lap-distance and energy state for the
 * whole run, and a session rebuilt whenever its signature moves.
 *
 * Every snapshot of the recording reaches `onFrame`, in order, however busy
 * the machine is, so a run is the same run every time. The addon plays a
 * tape against the wall clock: a read hands over the next snapshot once its
 * recorded moment has come round, and the last one again until then. Each
 * read is therefore taken as a frame, the session's included: the snapshot a
 * session is rebuilt from is read as `readSession`, which is `read` with the
 * drivers added, and is the frame the session is published with. Read
 * beside the frame, as it was, a session took a snapshot of its own whenever
 * one had fallen due, and a reader slower than the tape lost a frame at
 * every session poll: of the curated tape's 15,430 frames an idle machine
 * read 15,395 on one run and 15,398 on the next, and a busy one 14,952.
 *
 * The one snapshot not delivered is the first, stamped at the tape's start:
 * the addon's own `start()` takes it. The first read is held back until the
 * second has fallen due, so that it is the first frame of every run rather
 * than of the runs that were quick off the mark. That leaves 15,429 frames
 * of the curated tape, the same ones every time.
 *
 * A snapshot whose session clock is the one before's is not a frame, as
 * before: that is how a snapshot handed over twice is told from a new one,
 * and five recorded ones on the curated tape share their clock too.
 *
 * Without the REST poller and the UI websocket, which need the bridge's
 * timers; the channels they feed are absent, as in a session where LMU's
 * REST API is not answering, unless the caller supplies a game state or
 * REST cells of its own.
 */
export const playLmuTape = async ({
  tapePath,
  addonPath = LMU_TAPE_ADDON_PATH,
  transformRaw = (raw) => raw,
  gameState,
  restCells,
  onFrame,
}: PlayLmuTapeOptions): Promise<{ frames: number }> => {
  process.env.IRDASHIES_LMU_REPLAY = path.resolve(tapePath);
  // Nothing is lost at any pace, so there is no reason to wait for the tape.
  process.env.IRDASHIES_LMU_REPLAY_SPEED = String(ADDON_FASTEST_SPEED);
  process.env.IRDASHIES_LMU_REPLAY_LOOP = '0';
  const { LmuSdkNode } = createRequire(import.meta.url)(addonPath) as {
    LmuSdkNode: new () => LmuTapeSdk;
  };
  const sdk = new LmuSdkNode();
  const readRest = (restPath: string) => sdk.readRest(restPath);
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
  let lastOwnEntrySlot = -1;
  let session: Session | null = null;
  // The next snapshot is to be read with its drivers, and the session
  // rebuilt from it. True of the first, which nothing can be mapped without.
  let sessionDue = true;
  // Whether the last snapshot, as staged, named a player vehicle: what the
  // bridge decides which telemetry block to ask for by.
  let playerHadVehicle = true;
  try {
    sdk.start();
    // The second snapshot is due by now at the slowest pace the addon has,
    // whichever pace this process's first replay left it with.
    const firstReadAt =
      performance.now() +
      secondSnapshotMicros(tapePath) / 1000 / ADDON_SLOWEST_SPEED +
      DUE_MARGIN_MS;
    while (performance.now() < firstReadAt) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const deadline = performance.now() + GIVE_UP_AFTER_MS;
    let ended = false;
    while (!ended) {
      if (performance.now() >= deadline) {
        throw new Error(
          `The tape was still playing after ${GIVE_UP_AFTER_MS / 60_000} minutes: ${tapePath}`
        );
      }
      const blockSlot = lmuBlockSlotToRead(
        playerHadVehicle,
        lmuOwnEntrySlot(ownEntryState)
      );
      // One read for one snapshot, whichever kind: nothing else may ask the
      // addon for one, or the snapshot it is handed is a frame never seen.
      const sessionRead = sessionDue ? sdk.readSession(blockSlot) : null;
      const read = sessionRead ? frameOf(sessionRead) : sdk.read(blockSlot);
      if (!read?.running) {
        if (frames > 0) ended = true;
        else await new Promise((resolve) => setTimeout(resolve, 2));
        continue;
      }
      // The player's 100 Hz clock where there is one, scoring's otherwise:
      // the same choice the mapper makes for SessionTime. Read from the
      // recording itself, before anything a spec has staged over it: this
      // clock is what tells one recorded frame from the next, and a frame
      // staged without the player's vehicle is still a frame. Told apart by
      // what was left of it, a stint staged that way was played at
      // scoring's five frames a second, where the bridge maps every read.
      // A read that asked for another car's block carries that car's clock
      // in its place, which the sim advances less often: the player's is
      // then taken from the per-car array, which holds it for every car.
      const recordedClock =
        blockSlot === undefined
          ? read.elapsedTime
          : read.vehElapsedTime?.[read.playerVehicleIdx];
      const clock =
        typeof recordedClock === 'number' && recordedClock >= 0
          ? recordedClock
          : read.currentET;
      // The snapshot before, handed over again while the next is not due.
      if (clock === lastClock) continue;
      lastClock = clock;
      frames += 1;
      const raw = transformRaw(read, blockSlot ?? -1);
      playerHadVehicle = raw.playerHasVehicle;

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
      if (sessionRead) {
        sessionDue = false;
        if (session === null) lastSessionAt = clock;
        // The same snapshot as the frame, with its drivers: staged on its
        // own, after the frame, as when the two were read apart.
        const rawSession = transformRaw(sessionRead, blockSlot ?? -1);
        // On every session read, as in the bridge, and before the frame.
        const ownEntry = observeLmuOwnEntry(ownEntryState, rawSession);
        // The session names the own entry, which its signature does not see.
        if (ownEntry.slot !== lastOwnEntrySlot) {
          lastOwnEntrySlot = ownEntry.slot;
          lastSignature = null;
        }
        const signature = lmuSessionSignature(rawSession);
        if (signature !== lastSignature) {
          lastSignature = signature;
          session = mapLmuSession(
            rawSession,
            null,
            undefined,
            undefined,
            sessionIdentity,
            ownEntry.slot
          );
          sessionChanged = true;
        }
      } else if (
        clock - lastSessionAt >= SESSION_POLL_SECONDS ||
        clock < lastSessionAt
      ) {
        // Half a second since the session was last asked for: the snapshot
        // after this one is read with its drivers.
        lastSessionAt = clock;
        sessionDue = true;
      }
      if (session === null) continue;

      const telemetry = mapLmuTelemetry(
        raw,
        lapDistanceState,
        opponentState,
        restCells?.(raw, readRest),
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
