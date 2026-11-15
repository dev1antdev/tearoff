import { describe, expect, it } from 'vitest';
import type {
  PitLaneModel,
  PitStopParts,
  PitStopSnapshot,
} from '@irdashies/types';
import { plannedStandingS } from '@irdashies/shared';
import {
  formatPitGap,
  formatPitSeconds,
  pitStopChips,
  pitStopMode,
} from './pitStopDisplay';

const lane = (values: Partial<PitLaneModel> = {}): PitLaneModel => ({
  entryPct: 0.95,
  exitPct: 0.03,
  lengthM: 287.2,
  speedLimitMs: 16.67,
  speedLimitSource: 'assumed',
  driveAtLimitS: 17.2,
  driveMeasuredS: null,
  trackTimeS: 6.9,
  ...values,
});

const parts = (values: Partial<PitStopParts> = {}): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
  ...values,
});

const snapshot = (values: Partial<PitStopSnapshot> = {}): PitStopSnapshot => ({
  phase: 'planning',
  requested: false,
  lane: lane(),
  estimate: {
    source: 'sim',
    standingS: 14.2,
    parts: parts({ fuel: 14.2 }),
    optionalRepairS: null,
    samples: 0,
    penalty: null,
  },
  planned: null,
  timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
  last: null,
  refuel: null,
  rejoin: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

describe('which face the widget wears', () => {
  const finished = snapshot({
    timer: { enteredAt: 100, stoppedAt: null, standingS: 14.6, exitedAt: 142 },
    last: { laneS: 42, standingS: 14.6, plannedStandingS: 14.2, lap: 12 },
  });

  it('is the plan on the circuit and the timer in the pit lane', () => {
    expect(pitStopMode(snapshot(), 50, 10)).toBe('planning');
    expect(pitStopMode(snapshot({ phase: 'lane' }), 50, 10)).toBe('inPits');
    expect(pitStopMode(snapshot({ phase: 'service' }), 50, 10)).toBe('inPits');
    expect(pitStopMode(snapshot({ phase: 'idle' }), 50, 10)).toBe('idle');
  });

  it('holds the finished stop for as long as it is asked to', () => {
    expect(pitStopMode(finished, 145, 10)).toBe('result');
    expect(pitStopMode(finished, 152.1, 10)).toBe('planning');
    expect(pitStopMode(finished, 145, 0)).toBe('planning');
  });
});

describe('what the stop is made of', () => {
  const estimate = (
    values: Partial<PitStopSnapshot['estimate']>
  ): PitStopSnapshot['estimate'] => ({ ...snapshot().estimate, ...values });

  it('gives a chip to each part that takes time and marks the longest', () => {
    expect(
      pitStopChips(
        estimate({
          parts: parts({ fuel: 4.3, energy: 2.5, tyres: 12, damage: 30 }),
        })
      )
    ).toEqual([
      { kind: 'fuel', seconds: 4.3, tone: 'part' },
      { kind: 'energy', seconds: 2.5, tone: 'part' },
      { kind: 'tyres', seconds: 12, tone: 'part' },
      { kind: 'repair', seconds: 30, tone: 'main' },
    ]);
  });

  it('marks one chip when two parts are as long as each other', () => {
    const chips = pitStopChips(
      estimate({ parts: parts({ fuel: 12, tyres: 12 }) })
    );
    expect(chips.map((chip) => chip.tone)).toEqual(['main', 'part']);
  });

  it('shows a penalty served at the stop in its own colour', () => {
    expect(
      pitStopChips(
        estimate({ parts: parts({ fuel: 4.3, penalties: 10 }), penalty: 'SG' })
      )
    ).toEqual([
      { kind: 'fuel', seconds: 4.3, tone: 'main' },
      { kind: 'penalty', seconds: 10, tone: 'penalty' },
    ]);
  });

  it('shows a drive-through alone, and plans a pass with no stop', () => {
    const driveThrough = estimate({
      parts: parts({ fuel: 4.3 }),
      penalty: 'DT',
    });
    expect(pitStopChips(driveThrough)).toEqual([
      { kind: 'driveThrough', seconds: null, tone: 'penalty' },
    ]);
    expect(plannedStandingS(driveThrough)).toBe(0);
    expect(plannedStandingS(estimate({}))).toBe(14.2);
  });

  it("shows iRacing's two repairs", () => {
    expect(
      pitStopChips(
        estimate({
          source: 'learned',
          parts: parts({ damage: 50 }),
          optionalRepairS: 20,
        })
      )
    ).toEqual([
      { kind: 'repair', seconds: 50, tone: 'main' },
      { kind: 'optionalRepair', seconds: 20, tone: 'part' },
    ]);
  });

  it('has no chips for a stop with nothing in it, or no estimate', () => {
    expect(pitStopChips(estimate({ parts: parts() }))).toEqual([]);
    expect(pitStopChips(estimate({ parts: null }))).toEqual([]);
  });
});

describe('the figures as they are written', () => {
  it('writes seconds to a tenth and a missing figure as a dash', () => {
    expect(formatPitSeconds(14.24)).toBe('14.2');
    expect(formatPitSeconds(0)).toBe('0.0');
    expect(formatPitSeconds(null)).toBe('--');
    expect(formatPitSeconds(Number.NaN)).toBe('--');
  });

  it('signs a gap', () => {
    expect(formatPitGap(0.4)).toBe('+0.4');
    expect(formatPitGap(-3.75)).toBe('-3.8');
  });
});
