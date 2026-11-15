import { describe, expect, it } from 'vitest';
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
import {
  BASELINE_EXCLUDED_FLAGS,
  isCleanLap,
  isCleanSector,
  isPitLap,
  isReferenceLap,
  isUntimedLap,
  isWetLap,
  lapFlagsOf,
  libraryLapFlags,
  sessionFlagLapBits,
  voidFlagIsThisLaps,
  type LapFacts,
} from './lapValidity';

const facts = (overrides: Partial<LapFacts> = {}): LapFacts => ({
  inLap: false,
  outLap: false,
  voided: false,
  incident: false,
  sessionBits: 0,
  wet: false,
  own: true,
  fromStart: false,
  serviced: false,
  ...overrides,
});

describe('lap validity', () => {
  describe('a clean lap', () => {
    it('is one with nothing against it', () => {
      expect(isCleanLap(0)).toBe(true);
    });

    it.each([
      ['an in-lap', LEDGER_LAP_IN_LAP],
      ['an out-lap', LEDGER_LAP_OUT_LAP],
      ['a lap the sim voided', LEDGER_LAP_VOIDED],
      ['a lap with an incident', LEDGER_LAP_INCIDENT],
      ['a lap under caution', LEDGER_LAP_CAUTION],
      ['a lap not driven throughout', LEDGER_LAP_NOT_OWN],
      ['a lap begun on the grid', LEDGER_LAP_FROM_START],
    ])('is not %s', (_name, flag) => {
      expect(isCleanLap(flag)).toBe(false);
      expect(isCleanLap(flag | LEDGER_LAP_WET)).toBe(false);
    });

    it('may have seen a local yellow or a blue flag, be wet, or have had a tyre changed', () => {
      // Facts stored beside the lap; a reader that minds them leaves them
      // out itself.
      expect(
        isCleanLap(
          LEDGER_LAP_YELLOW |
            LEDGER_LAP_BLUE |
            LEDGER_LAP_WET |
            LEDGER_LAP_SERVICED
        )
      ).toBe(true);
    });

    it('is not what a baseline is made of when it was wet', () => {
      expect(LEDGER_LAP_WET & BASELINE_EXCLUDED_FLAGS).not.toBe(0);
      expect(LEDGER_LAP_CAUTION & BASELINE_EXCLUDED_FLAGS).not.toBe(0);
      expect(LEDGER_LAP_YELLOW & BASELINE_EXCLUDED_FLAGS).toBe(0);
    });
  });

  it('calls a lap that touched pit road at either end a pit lap', () => {
    expect(isPitLap(LEDGER_LAP_IN_LAP)).toBe(true);
    expect(isPitLap(LEDGER_LAP_OUT_LAP | LEDGER_LAP_SERVICED)).toBe(true);
    expect(isPitLap(LEDGER_LAP_VOIDED)).toBe(false);
  });

  it('takes a reference lap to be clean, complete and with its curve', () => {
    const lap = { flags: 0, complete: true, hasCurve: true };
    expect(isReferenceLap(lap)).toBe(true);
    expect(isReferenceLap({ ...lap, complete: false })).toBe(false);
    expect(isReferenceLap({ ...lap, hasCurve: false })).toBe(false);
    expect(isReferenceLap({ ...lap, flags: LEDGER_LAP_CAUTION })).toBe(false);
    expect(isReferenceLap({ ...lap, flags: LEDGER_LAP_FROM_START })).toBe(
      false
    );
    expect(isReferenceLap({ ...lap, flags: LEDGER_LAP_YELLOW })).toBe(true);
  });

  it('takes a clean sector to be seen from its start, on track, standing and out of the pits', () => {
    const sector = {
      enteredAtCrossing: true,
      offTrack: false,
      voided: false,
      onPitRoad: false,
    };
    expect(isCleanSector(sector)).toBe(true);
    expect(isCleanSector({ ...sector, enteredAtCrossing: false })).toBe(false);
    expect(isCleanSector({ ...sector, offTrack: true })).toBe(false);
    expect(isCleanSector({ ...sector, voided: true })).toBe(false);
    expect(isCleanSector({ ...sector, onPitRoad: true })).toBe(false);
  });

  it('calls a completed lap untimed when the sim gave it no time', () => {
    expect(isUntimedLap(86.66)).toBe(false);
    expect(isUntimedLap(0)).toBe(true);
    expect(isUntimedLap(-1)).toBe(true);
    expect(isUntimedLap(null)).toBe(true);
    expect(isUntimedLap(undefined)).toBe(true);
    expect(isUntimedLap(Number.NaN)).toBe(true);
  });

  it("reads the void flag as this lap's only once past the line", () => {
    expect(voidFlagIsThisLaps(0.01)).toBe(false);
    expect(voidFlagIsThisLaps(0.05)).toBe(true);
    expect(voidFlagIsThisLaps(0.6)).toBe(true);
  });

  describe('the flags a frame puts on a lap', () => {
    it('reads a full-course yellow as a caution, not as a local yellow', () => {
      // As the LMU mapper raises them: both bits together.
      expect(sessionFlagLapBits(GlobalFlags.Yellow | GlobalFlags.Caution)).toBe(
        LEDGER_LAP_CAUTION
      );
      expect(sessionFlagLapBits(GlobalFlags.CautionWaving)).toBe(
        LEDGER_LAP_CAUTION
      );
    });

    it('reads a stopped session as a caution', () => {
      expect(sessionFlagLapBits(GlobalFlags.Red)).toBe(LEDGER_LAP_CAUTION);
    });

    it('reads a sector yellow and a blue flag for what they are', () => {
      expect(sessionFlagLapBits(GlobalFlags.Yellow)).toBe(LEDGER_LAP_YELLOW);
      expect(sessionFlagLapBits(GlobalFlags.YellowWaving)).toBe(
        LEDGER_LAP_YELLOW
      );
      expect(sessionFlagLapBits(GlobalFlags.Blue | GlobalFlags.Yellow)).toBe(
        LEDGER_LAP_BLUE | LEDGER_LAP_YELLOW
      );
    });

    it('reads nothing into a green track or the chequered flag', () => {
      expect(sessionFlagLapBits(0)).toBe(0);
      expect(sessionFlagLapBits(GlobalFlags.Green)).toBe(0);
      expect(sessionFlagLapBits(GlobalFlags.Checkered)).toBe(0);
    });
  });

  it('calls a lap wet from "very lightly wet", or when declared wet', () => {
    expect(isWetLap(1, false)).toBe(false);
    expect(isWetLap(2, false)).toBe(false);
    expect(isWetLap(3, false)).toBe(true);
    expect(isWetLap(0, true)).toBe(true);
  });

  it('turns the facts of a lap into its bits', () => {
    expect(lapFlagsOf(facts())).toBe(0);
    expect(
      lapFlagsOf(
        facts({
          inLap: true,
          outLap: true,
          voided: true,
          incident: true,
          sessionBits: LEDGER_LAP_CAUTION | LEDGER_LAP_BLUE,
          wet: true,
          own: false,
          fromStart: true,
          serviced: true,
        })
      )
    ).toBe(
      LEDGER_LAP_IN_LAP |
        LEDGER_LAP_OUT_LAP |
        LEDGER_LAP_VOIDED |
        LEDGER_LAP_INCIDENT |
        LEDGER_LAP_CAUTION |
        LEDGER_LAP_BLUE |
        LEDGER_LAP_WET |
        LEDGER_LAP_NOT_OWN |
        LEDGER_LAP_FROM_START |
        LEDGER_LAP_SERVICED
    );
    // Only the three flag bits are taken from what was seen in passing.
    expect(lapFlagsOf(facts({ sessionBits: LEDGER_LAP_VOIDED }))).toBe(0);
  });

  it("reads a lap stored before the ledger from the library's own columns", () => {
    const lap = { pit: false, voided: false, own: true, incidents: null };
    expect(isCleanLap(libraryLapFlags(lap))).toBe(true);
    expect(isCleanLap(libraryLapFlags({ ...lap, incidents: 0 }))).toBe(true);
    expect(libraryLapFlags({ ...lap, pit: true })).toBe(LEDGER_LAP_IN_LAP);
    expect(libraryLapFlags({ ...lap, voided: true })).toBe(LEDGER_LAP_VOIDED);
    expect(libraryLapFlags({ ...lap, own: false })).toBe(LEDGER_LAP_NOT_OWN);
    expect(libraryLapFlags({ ...lap, incidents: 2 })).toBe(LEDGER_LAP_INCIDENT);
  });
});
