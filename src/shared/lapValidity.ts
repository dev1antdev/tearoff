import { GlobalFlags } from '../types/enum';
import {
  LEDGER_LAP_BLUE,
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_INCIDENT,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_NOT_OWN,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
  LEDGER_LAP_YELLOW,
} from '../types/ledger';

/**
 * One definition of a clean lap, a clean sector and an untimed lap.
 *
 * The facts about a lap are gathered once, by the player's ledger, and kept
 * as `LEDGER_LAP_*` bits. Everything that asks "does this lap count?" asks
 * it here, of those bits, so that a fuel rate, a stint's pace, a wear
 * forecast and a best lap never disagree about which laps they were made
 * from. Main and renderer both import this.
 *
 * Nothing here reads telemetry. The functions that turn a reading into a
 * fact (`sessionFlagLapBits`, `voidFlagIsThisLaps`, `isWetLap`) are the
 * rules the ledger gathers by, exported so another gatherer uses the same.
 */

/** Every fact that stops a lap being clean. */
export const UNCLEAN_LAP_FLAGS =
  LEDGER_LAP_IN_LAP |
  LEDGER_LAP_OUT_LAP |
  LEDGER_LAP_VOIDED |
  LEDGER_LAP_INCIDENT |
  LEDGER_LAP_CAUTION |
  LEDGER_LAP_NOT_OWN |
  LEDGER_LAP_FROM_START;

/** The lap touched pit road: at its start, or during it. */
export const PIT_LAP_FLAGS = LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP;

/**
 * What a per-lap baseline for a track and car leaves out: the unclean laps
 * and the wet ones.
 */
export const BASELINE_EXCLUDED_FLAGS = UNCLEAN_LAP_FLAGS | LEDGER_LAP_WET;

/**
 * A lap driven from line to line by the player, at racing speed, that the
 * sim let stand: not an in-lap or an out-lap, not voided, without an
 * incident, not under a full-course caution or a stopped session, with the
 * player at the wheel throughout, and not the lap that began on the grid.
 *
 * What per-lap fuel, energy, tread and brake rates, a stint's pace and the
 * session and stint bests are taken from. A local yellow, a blue flag and a
 * wet track do not make a lap unclean: they are stored beside it for a
 * reader that wants to leave them out as well.
 */
export const isCleanLap = (flags: number): boolean =>
  (flags & UNCLEAN_LAP_FLAGS) === 0;

/** An in-lap or an out-lap. */
export const isPitLap = (flags: number): boolean =>
  (flags & PIT_LAP_FLAGS) !== 0;

/** What `isReferenceLap` reads of a lap. */
export interface ReferenceLapFacts {
  /** LEDGER_LAP_* bits. */
  flags: number;
  /** A point in every ten metres was sampled. */
  complete: boolean;
  /** The curve was kept. */
  hasCurve: boolean;
}

/**
 * A lap fit to measure another against: clean, and with its whole curve.
 *
 * The lap library's stored `eligible` is this without the caution and
 * from-start exclusions; those two are applied where a reference is chosen.
 */
export const isReferenceLap = (lap: ReferenceLapFacts): boolean =>
  isCleanLap(lap.flags) && lap.complete && lap.hasCurve;

/** What is known of one sector of a lap. */
export interface SectorFacts {
  /** The sector was entered at a boundary the timer saw the car cross. */
  enteredAtCrossing: boolean;
  /** The car left the track, or the player the car, during it. */
  offTrack: boolean;
  /** The sim had voided the lap by the end of it. */
  voided: boolean;
  /** The car was on pit road during it. */
  onPitRoad: boolean;
}

/** A sector time fit to be an all-time best. */
export const isCleanSector = (sector: SectorFacts): boolean =>
  sector.enteredAtCrossing &&
  !sector.offTrack &&
  !sector.voided &&
  !sector.onPitRoad;

/**
 * Whether the sim gave a completed lap no time.
 *
 * The sim's own statement, not a verdict, and wider than "voided": an
 * out-lap in practice or qualifying is untimed too. Under Le Mans Ultimate
 * it is the scoring lap time not being above 0; iRacing states nothing of
 * the kind. Only ask it of a lap that was completed: before a car's first
 * lap the sim reports no time as well.
 */
export const isUntimedLap = (simLapTime: number | null | undefined): boolean =>
  !(typeof simLapTime === 'number' && simLapTime > 0);

/**
 * How far round the lap Le Mans Ultimate's void flag is the lap's own. It
 * stays up for the rest of a voided lap and lingers at the line, so before
 * this it may still be the previous lap's; a cut early in the lap is caught
 * once past it.
 */
export const VOID_FLAG_START_PCT = 0.05;

/** Whether a raised void flag at this lap fraction belongs to this lap. */
export const voidFlagIsThisLaps = (trackPct: number): boolean =>
  trackPct >= VOID_FLAG_START_PCT;

const CAUTION_SESSION_FLAGS =
  GlobalFlags.Caution | GlobalFlags.CautionWaving | GlobalFlags.Red;
const YELLOW_SESSION_FLAGS = GlobalFlags.Yellow | GlobalFlags.YellowWaving;

/**
 * The flag bits a frame's `SessionFlags` puts on the lap being driven.
 *
 * A full-course yellow or safety car is a caution, and so is a stopped
 * session: nobody laps at racing speed under a red flag. Under Le Mans
 * Ultimate the mapper raises the yellow bit together with the caution bit
 * for a full-course yellow, so a yellow counts as local only without it.
 */
export const sessionFlagLapBits = (sessionFlags: number): number => {
  let bits = 0;
  if ((sessionFlags & CAUTION_SESSION_FLAGS) !== 0) {
    bits |= LEDGER_LAP_CAUTION;
  } else if ((sessionFlags & YELLOW_SESSION_FLAGS) !== 0) {
    bits |= LEDGER_LAP_YELLOW;
  }
  if ((sessionFlags & GlobalFlags.Blue) !== 0) bits |= LEDGER_LAP_BLUE;
  return bits;
};

/** The first `TrackWetness` level that counts as wet: "very lightly wet". */
export const WET_TRACK_WETNESS = 3;

/** Whether a lap with this wetness, or declared wet, is a wet lap. */
export const isWetLap = (wetness: number, declaredWet: boolean): boolean =>
  declaredWet || wetness >= WET_TRACK_WETNESS;

/** The facts of a lap, as whoever watched it gathered them. */
export interface LapFacts {
  /** The car went onto pit road during the lap. */
  inLap: boolean;
  /** The lap began on pit road. */
  outLap: boolean;
  voided: boolean;
  /** Incident points, an off-track or a tow. */
  incident: boolean;
  /** LEDGER_LAP_YELLOW, CAUTION and BLUE bits seen during the lap. */
  sessionBits: number;
  wet: boolean;
  /** The player was at the wheel for all of it. */
  own: boolean;
  /** Opened by leaving the grid, not at a crossing. */
  fromStart: boolean;
  /** Fuel, energy or tyres changed during it. */
  serviced: boolean;
}

/** The facts of a lap as LEDGER_LAP_* bits. */
export const lapFlagsOf = (facts: LapFacts): number => {
  let flags =
    facts.sessionBits &
    (LEDGER_LAP_YELLOW | LEDGER_LAP_CAUTION | LEDGER_LAP_BLUE);
  if (facts.inLap) flags |= LEDGER_LAP_IN_LAP;
  if (facts.outLap) flags |= LEDGER_LAP_OUT_LAP;
  if (facts.voided) flags |= LEDGER_LAP_VOIDED;
  if (facts.incident) flags |= LEDGER_LAP_INCIDENT;
  if (facts.wet) flags |= LEDGER_LAP_WET;
  if (!facts.own) flags |= LEDGER_LAP_NOT_OWN;
  if (facts.fromStart) flags |= LEDGER_LAP_FROM_START;
  if (facts.serviced) flags |= LEDGER_LAP_SERVICED;
  return flags;
};

/** What the lap library's own columns say of a lap. */
export interface LibraryLapFacts {
  pit: boolean;
  voided: boolean;
  own: boolean;
  incidents: number | null;
}

/**
 * The bits that follow from the lap library's own columns, for a lap stored
 * without a ledger row: every lap from before the ledger existed. Its `pit`
 * does not say which end of the lap touched pit road, so it reads as an
 * in-lap; either way the lap is not clean.
 */
export const libraryLapFlags = (lap: LibraryLapFacts): number => {
  let flags = 0;
  if (lap.pit) flags |= LEDGER_LAP_IN_LAP;
  if (lap.voided) flags |= LEDGER_LAP_VOIDED;
  if (!lap.own) flags |= LEDGER_LAP_NOT_OWN;
  if (lap.incidents !== null && lap.incidents > 0) {
    flags |= LEDGER_LAP_INCIDENT;
  }
  return flags;
};
