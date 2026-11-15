import { describe, expect, it } from 'vitest';
import type { LmuRawSession, LmuRawTelemetry } from './native';
import type { LmuRestCells } from './rest/state';
import {
  LMU_CURATED_TAPE_PATH,
  lmuRawWithoutPlayerVehicle,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { StandingsProcessor } from '../processors/StandingsProcessor';
import { TrackStateProcessor } from '../processors/TrackStateProcessor';

/**
 * A team-mate's stint, STAGED on a recorded Le Mans Ultimate race.
 *
 * No recording of a real spell at the monitor exists yet, so this is not
 * one. The recording is an offline race the player drives from start to
 * end. A minute in, every snapshot is rewritten to what the sim is known to
 * write when it names no player vehicle: the slot becomes -1 and the
 * single-car fields go, as in the addon's own branch for it, while the
 * session-wide fields and the per-car arrays stay. The car that was the
 * player's goes on lapping in its slot, which stands in for a team-mate
 * driving it. The game state and the camera focus are supplied by the spec,
 * as LMU's REST API would, and for the last half minute the car is put in
 * its garage stall.
 *
 * What it shows is that the app's own chain holds together over real cars
 * and real laps: the own entry is remembered, the focus stays on it, the
 * frame says watching and never says driving, and the processors keep their
 * focus car. What LMU really writes during a team-mate's stint -- what its
 * focus endpoint answers, what scoring says of the team car, whether the
 * slot is stable -- is exactly what this cannot show.
 *
 * Windows only, like the other tape specs.
 */

/** Seconds of the recording driven before the player's vehicle goes. */
const DRIVEN_SECONDS = 60;
/**
 * How long the game state goes on saying "driving" after that. It is polled
 * once a second, and in an eight-hour race it trailed shared memory by 0.7
 * to 1.6 s at each driver change.
 */
const STATE_LAG_SECONDS = 1.2;
/** How long each answer of the focus endpoint is held, in turn. */
const FOCUS_PHASE_SECONDS = 40;
/** When, after the vehicle goes, the car is put in its garage stall. */
const GARAGE_AFTER_SECONDS = 150;

type FocusPhase =
  | 'notAnswering'
  | 'nothingFocused'
  | 'rival'
  | 'backToNone'
  /** The last of it: the car that was the player's, parked in its garage. */
  | 'inGarage';

const focusPhase = (sinceRemoval: number): FocusPhase => {
  if (sinceRemoval < FOCUS_PHASE_SECONDS) return 'notAnswering';
  if (sinceRemoval < 2 * FOCUS_PHASE_SECONDS) return 'nothingFocused';
  if (sinceRemoval < 3 * FOCUS_PHASE_SECONDS) return 'rival';
  return sinceRemoval < GARAGE_AFTER_SECONDS ? 'backToNone' : 'inGarage';
};

const NOTHING_FOCUSED: LmuRestCells = { focusCarIdx: { value: [-1] } };

interface Tally {
  frames: number;
  /** Frames on which the frame said the user was at the wheel. */
  onTrack: number;
  /** Frames on which the frame said the user was watching. */
  watching: number;
  /** Frames whose focus was not the car expected for the phase. */
  wrongFocus: number;
}

const tally = (): Tally => ({
  frames: 0,
  onTrack: 0,
  watching: 0,
  wrongFocus: 0,
});

const playStint = async (clearPlayerFlags: boolean) => {
  const trackState = new TrackStateProcessor();
  const standings = new StandingsProcessor();
  trackState.onLifecycle({ type: 'enter', replay: false });
  standings.onLifecycle({ type: 'enter', replay: false });

  let startET: number | null = null;
  /** The slot the player drove, read from the recording. */
  let playerSlot = -1;
  let rivalSlot = -1;
  let lastSessionTime = Number.NEGATIVE_INFINITY;
  let worstClockStep = 0;
  let driverCarIdxAtEnd: number | undefined;
  let ownEntryAtEnd = { slot: -1, source: 'none' };
  /** Frames after the removal whose own entry was not the player's slot. */
  let lostOwnEntry = 0;
  /** Frames after the removal that still named a player slot. */
  let namedPlayer = 0;
  /** Frames on which a processor's focus was not the frame's. */
  let processorsOffFocus = 0;
  /** Frames on which the track state did not say what the frame said. */
  let snapshotDisagreed = 0;
  /** Watching frames whose watched car was in its garage, which is none. */
  let watchingInGarage = 0;
  const driven = tally();
  const phases: Record<FocusPhase, Tally> = {
    notAnswering: tally(),
    nothingFocused: tally(),
    rival: tally(),
    backToNone: tally(),
    inGarage: tally(),
  };
  /** The frames between the vehicle going and the game state saying so. */
  const lag = tally();

  const sinceRemoval = (raw: LmuRawTelemetry): number =>
    raw.currentET - ((startET ?? raw.currentET) + DRIVEN_SECONDS);

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 40,
    // Frames and session snapshots both pass through here.
    transformRaw: (raw) => {
      startET ??= raw.currentET;
      if (sinceRemoval(raw) < 0) {
        if (raw.playerHasVehicle) playerSlot = raw.playerVehicleIdx;
        return raw;
      }
      let staged = lmuRawWithoutPlayerVehicle(raw);
      if (focusPhase(sinceRemoval(raw)) === 'inGarage') {
        // Parked: what the same car looks like once the stint is over.
        staged = {
          ...staged,
          vehInGarageStall: Uint8Array.from(
            staged.vehInGarageStall,
            (inStall, slot) => (slot === playerSlot ? 1 : inStall)
          ),
        };
      }
      if (!clearPlayerFlags) return staged;
      // The variant in which scoring drops its player flag too, which is
      // one of the things a real stint may do.
      const cleared = {
        ...staged,
        vehIsPlayer: new Uint8Array(staged.vehIsPlayer.length),
      };
      if ('drivers' in cleared) {
        const session = cleared as unknown as LmuRawSession;
        session.drivers = session.drivers.map((driver) => ({
          ...driver,
          isPlayer: false,
        }));
      }
      return cleared;
    },
    gameState: (raw) =>
      raw.playerHasVehicle || sinceRemoval(raw) < STATE_LAG_SECONDS
        ? 'driving'
        : 'monitor',
    restCells: (raw) => {
      if (raw.playerHasVehicle) return undefined;
      const phase = focusPhase(sinceRemoval(raw));
      if (phase === 'notAnswering') return undefined;
      if (phase !== 'rival') return NOTHING_FOCUSED;
      // Any other car that is out on the circuit.
      if (rivalSlot < 0) {
        rivalSlot = Array.from(raw.vehLapDistPct).findIndex(
          (pct, slot) =>
            slot !== playerSlot && pct >= 0 && !raw.vehInGarageStall[slot]
        );
      }
      return { focusCarIdx: { value: [rivalSlot] } };
    },
    onFrame: ({
      raw,
      telemetry,
      session,
      sessionChanged,
      sessionTime,
      ownEntry,
    }) => {
      if (sessionChanged) {
        trackState.init(session);
        standings.init(session);
      }
      trackState.onFrame(telemetry);
      standings.onFrame(telemetry);

      if (Number.isFinite(lastSessionTime)) {
        worstClockStep = Math.min(
          worstClockStep,
          sessionTime - lastSessionTime
        );
      }
      lastSessionTime = sessionTime;

      const isOnTrack = telemetry.IsOnTrack?.value[0] === true;
      const isWatching = telemetry.LmuWatching?.value[0] === true;
      const focus = telemetry.CamCarIdx?.value[0] as unknown as number;
      const snapshot = trackState.snapshot();
      if (
        snapshot.watching !== isWatching ||
        snapshot.isOnTrack !== isOnTrack
      ) {
        snapshotDisagreed += 1;
      }
      if (
        snapshot.focusCarIdx !== focus ||
        standings.snapshot().focusCarIdx !== focus
      ) {
        processorsOffFocus += 1;
      }
      if (isWatching && raw.vehInGarageStall[focus]) watchingInGarage += 1;

      const since = sinceRemoval(raw);
      const removed = !raw.playerHasVehicle;
      const count = !removed
        ? driven
        : since < STATE_LAG_SECONDS
          ? lag
          : phases[focusPhase(since)];
      const expectedFocus =
        removed && focusPhase(since) === 'rival' ? rivalSlot : playerSlot;
      count.frames += 1;
      if (isOnTrack) count.onTrack += 1;
      if (isWatching) count.watching += 1;
      if (focus !== expectedFocus) count.wrongFocus += 1;

      if (removed) {
        if (ownEntry.slot !== playerSlot) lostOwnEntry += 1;
        if ((telemetry.PlayerCarIdx?.value[0] as number) !== -1) {
          namedPlayer += 1;
        }
      }
      driverCarIdxAtEnd = session.DriverInfo?.DriverCarIdx;
      ownEntryAtEnd = ownEntry;
    },
  });

  return {
    playerSlot,
    rivalSlot,
    worstClockStep,
    driverCarIdxAtEnd,
    ownEntryAtEnd,
    lostOwnEntry,
    namedPlayer,
    processorsOffFocus,
    snapshotDisagreed,
    watchingInGarage,
    driven,
    lag,
    phases,
  };
};

describe.skipIf(!lmuTapeAvailable())(
  'a team-mate’s stint staged on a recorded LMU race',
  () => {
    describe.each([
      ['scoring keeps its player flag on the car', false],
      ['scoring drops its player flag too', true],
    ])('when %s', (_name, clearPlayerFlags) => {
      it('keeps the focus on the car that was the player’s, watching and never driving', async () => {
        const stint = await playStint(clearPlayerFlags);
        const { driven, lag, phases } = stint;

        // The recording itself: driven for the first minute.
        expect(stint.playerSlot).toBeGreaterThanOrEqual(0);
        expect(driven.frames).toBeGreaterThan(1_000);
        expect(driven.onTrack).toBe(driven.frames);
        expect(driven.watching).toBe(0);
        expect(driven.wrongFocus).toBe(0);

        // The own entry is the slot the player drove, remembered from then,
        // for every frame after the sim stopped naming it.
        expect(stint.lostOwnEntry).toBe(0);
        expect(stint.ownEntryAtEnd).toMatchObject({
          slot: stint.playerSlot,
          source: 'remembered',
        });
        // Nothing else names it: the frame has no player slot, and in this
        // variant the session has none either.
        expect(stint.namedPlayer).toBe(0);
        expect(stint.driverCarIdxAtEnd).toBe(
          clearPlayerFlags ? -1 : stint.playerSlot
        );

        // The second in which the game state has not caught up: no vehicle,
        // the sim still saying driving. Watching already, so no widget
        // blinks off at the change.
        expect(lag.frames).toBeGreaterThan(0);
        expect(lag.onTrack).toBe(0);
        expect(lag.watching).toBe(lag.frames);
        expect(lag.wrongFocus).toBe(0);

        // At the monitor, whatever the focus endpoint says: the focus is on
        // the car expected, and the user is never at the wheel.
        for (const phase of Object.values(phases)) {
          expect(phase.frames).toBeGreaterThan(100);
          expect(phase.onTrack).toBe(0);
          expect(phase.wrongFocus).toBe(0);
        }
        // Watching for as long as that car is out of its garage, and not a
        // frame longer once it is parked.
        const { inGarage, ...onCircuit } = phases;
        for (const phase of Object.values(onCircuit)) {
          expect(phase.watching).toBe(phase.frames);
        }
        expect(inGarage.watching).toBe(0);
        // The camera on another car is followed, and that is a car.
        expect(stint.rivalSlot).toBeGreaterThanOrEqual(0);
        expect(stint.rivalSlot).not.toBe(stint.playerSlot);

        // Watching is only ever of a car that is out of its garage, and
        // the track state and the standings follow the frame throughout.
        expect(stint.watchingInGarage).toBe(0);
        expect(stint.snapshotDisagreed).toBe(0);
        expect(stint.processorsOffFocus).toBe(0);

        // And the session clock does not step back when the player's own
        // clock goes, which every processor would read as a new session.
        expect(stint.worstClockStep).toBeGreaterThanOrEqual(0);
      }, 90_000);
    });
  }
);
