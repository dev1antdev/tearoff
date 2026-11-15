import { describe, expect, it } from 'vitest';
import {
  EMPTY_FLAG_STATE,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_BLUE_TRAFFIC,
  FLAG_ACTIVE_FCY_PHASE_SHIFT,
  FLAG_ACTIVE_FULL_COURSE_YELLOW,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_GREEN_RESTART,
  FLAG_ACTIVE_GREEN_START,
  FLAG_ACTIVE_PENALTY,
  FLAG_ACTIVE_START,
  FLAG_ACTIVE_WARNING,
  FLAG_ACTIVE_WHITE,
  FLAG_ACTIVE_YELLOW,
  FLAG_ACTIVE_YELLOW_NEAR,
  LMU_PENALTY_CODE,
  type FlagBlueCar,
  type FlagStateSnapshot,
} from '@irdashies/types';
import { resolveFlagState } from './resolveFlag';

const state = (overrides: Partial<FlagStateSnapshot>): FlagStateSnapshot => ({
  ...EMPTY_FLAG_STATE,
  ...overrides,
});

const lapping: FlagBlueCar = {
  carIdx: 3,
  distanceM: 60,
  gapS: 1.2,
  closingMs: 4,
  lapsAhead: 1,
  fasterClass: false,
  confirmed: true,
  othersCount: 0,
};

describe('resolveFlagState', () => {
  it('shows what the processor ranked first when nothing is switched off', () => {
    const snapshot = state({
      kind: 'blue',
      detail: 'blueLapping',
      active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      blue: lapping,
    });

    expect(resolveFlagState(snapshot)).toEqual({
      kind: 'blue',
      detail: 'blueLapping',
    });
    expect(resolveFlagState(snapshot, { showPenalty: false })).toEqual({
      kind: 'blue',
      detail: 'blueLapping',
    });
  });

  it('falls through to green when the penalty is switched off', () => {
    const snapshot = state({
      kind: 'penalty',
      detail: 'driveThrough',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.driveThrough, seconds: null },
    });

    expect(resolveFlagState(snapshot, { showPenalty: false })).toEqual({
      kind: 'green',
      detail: 'trackClear',
    });
  });

  it('names the green it falls through to as the announcement it is', () => {
    const start = state({
      kind: 'white',
      detail: 'lastLap',
      active: FLAG_ACTIVE_WHITE | FLAG_ACTIVE_GREEN | FLAG_ACTIVE_GREEN_START,
    });
    const restart = state({
      ...start,
      active: FLAG_ACTIVE_WHITE | FLAG_ACTIVE_GREEN | FLAG_ACTIVE_GREEN_RESTART,
    });

    expect(resolveFlagState(start, { showLastLap: false }).detail).toBe(
      'greenStart'
    );
    expect(resolveFlagState(restart, { showLastLap: false }).detail).toBe(
      'greenRestart'
    );
  });

  it('shows the penalty under the start when the start states are off', () => {
    const snapshot = state({
      kind: 'start',
      detail: 'formationLap',
      active: FLAG_ACTIVE_START | FLAG_ACTIVE_PENALTY,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.stopGo, seconds: 10 },
    });

    expect(resolveFlagState(snapshot, { showStart: false })).toEqual({
      kind: 'penalty',
      detail: 'stopGo',
    });
  });

  it('keeps the sub-phase of a full-course yellow it falls through to', () => {
    // iRacing's parade laps carry the caution bits.
    const snapshot = state({
      kind: 'start',
      detail: 'formationLap',
      active:
        FLAG_ACTIVE_START |
        FLAG_ACTIVE_FULL_COURSE_YELLOW |
        (5 << FLAG_ACTIVE_FCY_PHASE_SHIFT),
    });

    expect(resolveFlagState(snapshot, { showStart: false })).toEqual({
      kind: 'fullCourseYellow',
      detail: 'fcyLastLap',
    });
  });

  it('has no flag left when the only one out is switched off', () => {
    const snapshot = state({
      kind: 'start',
      detail: 'grid',
      active: FLAG_ACTIVE_START,
    });

    expect(resolveFlagState(snapshot, { showStart: false })).toEqual({
      kind: 'none',
      detail: 'noSession',
    });
  });

  describe('a race-only blue outside a race', () => {
    it('gives way to a yellow elsewhere, which it had outranked', () => {
      const snapshot = state({
        kind: 'blue',
        detail: 'blueTraffic',
        active:
          FLAG_ACTIVE_BLUE |
          FLAG_ACTIVE_BLUE_TRAFFIC |
          FLAG_ACTIVE_YELLOW |
          FLAG_ACTIVE_GREEN,
        blue: lapping,
      });

      expect(resolveFlagState(snapshot, { showBlue: false })).toEqual({
        kind: 'yellow',
        detail: 'yellowElsewhere',
      });
    });
  });

  describe('race-only yellows outside a race', () => {
    const near = state({
      kind: 'yellow',
      detail: 'yellowAhead',
      active:
        FLAG_ACTIVE_YELLOW |
        FLAG_ACTIVE_YELLOW_NEAR |
        FLAG_ACTIVE_BLUE |
        FLAG_ACTIVE_BLUE_TRAFFIC |
        FLAG_ACTIVE_GREEN,
      incidentDistM: 300,
      blue: lapping,
    });

    it('leave out the near yellow and the yellow elsewhere alike', () => {
      expect(resolveFlagState(near, { showYellow: false })).toEqual({
        kind: 'blue',
        detail: 'blueTraffic',
      });
      expect(
        resolveFlagState(near, { showYellow: false, showBlue: false })
      ).toEqual({ kind: 'green', detail: 'trackClear' });
    });

    it('never leave out a full-course yellow', () => {
      const fullCourse = state({
        kind: 'fullCourseYellow',
        detail: 'fcyPitsClosed',
        active:
          FLAG_ACTIVE_FULL_COURSE_YELLOW | (2 << FLAG_ACTIVE_FCY_PHASE_SHIFT),
      });

      expect(resolveFlagState(fullCourse, { showYellow: false })).toEqual({
        kind: 'fullCourseYellow',
        detail: 'fcyPitsClosed',
      });
    });
  });

  describe('the detail of a blue it falls through to', () => {
    const under = (
      active: number,
      blue: FlagBlueCar | null
    ): FlagStateSnapshot =>
      state({
        kind: 'start',
        detail: 'grid',
        active: FLAG_ACTIVE_START | FLAG_ACTIVE_BLUE | active,
        blue,
      });

    it('is a car to let by in a race', () => {
      expect(
        resolveFlagState(under(0, lapping), { showStart: false }).detail
      ).toBe('blueLapping');
      expect(
        resolveFlagState(under(0, null), { showStart: false }).detail
      ).toBe('blueLapping');
    });

    it('is a faster class when the car is not a lap ahead', () => {
      const fasterClass = { ...lapping, lapsAhead: 0, fasterClass: true };

      expect(
        resolveFlagState(under(0, fasterClass), { showStart: false }).detail
      ).toBe('blueFasterClass');
    });

    it('is traffic outside a race and in the pit lane', () => {
      expect(
        resolveFlagState(under(FLAG_ACTIVE_BLUE_TRAFFIC, lapping), {
          showStart: false,
        }).detail
      ).toBe('blueTraffic');
    });
  });

  describe('the detail of a penalty it falls through to', () => {
    const under = (
      active: number,
      penalty: FlagStateSnapshot['penalty']
    ): FlagStateSnapshot =>
      state({
        kind: 'start',
        detail: 'grid',
        active: FLAG_ACTIVE_START | FLAG_ACTIVE_PENALTY | active,
        penalty,
      });
    const detailOf = (snapshot: FlagStateSnapshot) =>
      resolveFlagState(snapshot, { showStart: false }).detail;

    it('names the kind the sim has stated', () => {
      const penalty = (kind: number) => ({ count: 1, kind, seconds: null });

      expect(detailOf(under(0, penalty(LMU_PENALTY_CODE.driveThrough)))).toBe(
        'driveThrough'
      );
      expect(detailOf(under(0, penalty(LMU_PENALTY_CODE.stopGo)))).toBe(
        'stopGo'
      );
      expect(detailOf(under(0, penalty(LMU_PENALTY_CODE.time)))).toBe(
        'timePenalty'
      );
      expect(detailOf(under(0, penalty(LMU_PENALTY_CODE.none)))).toBe(
        'penaltyUnknown'
      );
      // A code from a build that knows more kinds than this one.
      expect(detailOf(under(0, penalty(9)))).toBe('penaltyUnknown');
    });

    it('is a black flag or a warning where the sim counts no penalties', () => {
      expect(detailOf(under(0, null))).toBe('blackFlag');
      expect(detailOf(under(FLAG_ACTIVE_WARNING, null))).toBe('slowDown');
    });
  });
});
