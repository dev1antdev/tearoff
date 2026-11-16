import { describe, expect, it } from 'vitest';
import type { LedgerLap, PlayerStintSnapshot } from '@irdashies/types';
import {
  EMPTY_PLAYER_STINT,
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
} from '@irdashies/types';
import {
  lapEntries,
  listedStintId,
  liveLapEntry,
  visibleLapEntries,
} from './lapEntries';
import { ENDURANCE_SAMPLE_STINTS, sampleLedger } from './ledgerSample';

const lap = (overrides: Partial<LedgerLap> = {}): LedgerLap => ({
  id: 0,
  stintId: 'run:1',
  sessionNum: 1,
  lapNumber: 1,
  stintLap: 1,
  startTime: 0,
  endTime: 90,
  lapTime: 90,
  simLapTime: null,
  flags: 0,
  incidents: null,
  fuelAtLine: 40,
  fuelUsed: 2.3,
  fuelAdded: 0,
  energyAtLine: 0.4,
  energyUsed: 0.0233,
  energyAdded: 0,
  treadAtLine: [0.97, 0.97, 0.97, 0.97],
  treadUsed: [0.005, 0.0053, 0.005, 0.0048],
  brakeAtLine: [36, 36, 32, 32],
  brakeUsed: [0.002, 0.002, 0.001, 0.001],
  compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
  sectors: [null, null, null],
  wetness: 1,
  rain: 0,
  airTemp: 21,
  trackTemp: 30,
  position: 5,
  classPosition: 2,
  ...overrides,
});

/**
 * The recorded race: the lap from the rolling start, which the sim times
 * from the green flag, and the lap after it. Newest first, as the channel
 * carries them.
 */
const RACE = [
  lap({
    lapNumber: 2,
    stintLap: 2,
    startTime: 232.83,
    endTime: 319.5,
    lapTime: 86.671,
    simLapTime: 86.66,
  }),
  lap({
    lapNumber: 1,
    startTime: 143,
    endTime: 232.83,
    lapTime: 89.83,
    simLapTime: 97.823,
    flags: LEDGER_LAP_FROM_START,
    energyUsed: 0.0224,
  }),
];

const options = { sessionNum: 1, deltaMethod: 'lastlap' } as const;

describe('lapEntries', () => {
  it('makes an entry of each row, newest first', () => {
    const entries = lapEntries(RACE, options);

    expect(entries.map((entry) => entry.lap)).toEqual([2, 1]);
    expect(entries[0]).toMatchObject({
      time: 86.66,
      stintId: 'run:1',
      stintLap: 2,
      fuelUsed: 2.3,
      energyUsed: 0.0233,
    });
  });

  it("shows the sim's time for a lap, and the app's where the sim gave none", () => {
    const [timed, untimed] = lapEntries(
      [
        lap({ lapNumber: 2, lapTime: 86.671, simLapTime: 86.66 }),
        lap({ lapNumber: 1, lapTime: 91.204, simLapTime: null, endTime: 80 }),
      ],
      options
    );

    expect(timed.time).toBe(86.66);
    expect(untimed.time).toBe(91.204);
  });

  it('reads what a lap was driven under from its flags', () => {
    const flagged = (flags: number) => lapEntries([lap({ flags })], options)[0];

    expect(flagged(0)).toMatchObject({
      dirty: false,
      pitted: false,
      caution: false,
      yellow: false,
      wet: false,
      fromStart: false,
    });
    expect(flagged(LEDGER_LAP_VOIDED).dirty).toBe(true);
    expect(flagged(LEDGER_LAP_INCIDENT).dirty).toBe(true);
    expect(flagged(LEDGER_LAP_IN_LAP).pitted).toBe(true);
    expect(flagged(LEDGER_LAP_OUT_LAP | LEDGER_LAP_SERVICED).pitted).toBe(true);
    expect(flagged(LEDGER_LAP_CAUTION).caution).toBe(true);
    expect(flagged(LEDGER_LAP_YELLOW)).toMatchObject({
      yellow: true,
      caution: false,
    });
    expect(flagged(LEDGER_LAP_WET).wet).toBe(true);
    expect(flagged(LEDGER_LAP_FROM_START)).toMatchObject({
      fromStart: true,
      dirty: false,
    });
    // A blue flag says nothing about the lap.
    expect(flagged(LEDGER_LAP_BLUE)).toMatchObject({
      dirty: false,
      yellow: false,
      caution: false,
    });
  });

  it('measures a lap against the lap before it', () => {
    const [second, first] = lapEntries(RACE, options);

    expect(second.delta).toBeCloseTo(-11.163, 3);
    // Nothing before the first.
    expect(first.delta).toBe(0);
  });

  it('measures a lap against the best clean lap before it', () => {
    const laps = [
      lap({ lapNumber: 4, simLapTime: 87.1, endTime: 400 }),
      lap({ lapNumber: 3, simLapTime: 86.2, endTime: 310 }),
      lap({ lapNumber: 2, simLapTime: 86.66, endTime: 220 }),
      lap({ lapNumber: 1, simLapTime: 85.9, flags: LEDGER_LAP_VOIDED }),
    ];

    const deltas = lapEntries(laps, { ...options, deltaMethod: 'bestlap' }).map(
      (entry) => entry.delta
    );

    // The voided lap is quicker than any, and is no lap to be measured by.
    expect(deltas[3]).toBe(0);
    expect(deltas[2]).toBe(0);
    expect(deltas[1]).toBeCloseTo(86.2 - 86.66, 6);
    expect(deltas[0]).toBeCloseTo(87.1 - 86.2, 6);
  });

  it('never measures against the lap from the start of a race', () => {
    const [second, first] = lapEntries(RACE, {
      ...options,
      deltaMethod: 'bestlap',
    });

    expect(first.delta).toBe(0);
    expect(second.delta).toBe(0);
  });

  it('lists the laps of the current session only', () => {
    const laps = [
      lap({ lapNumber: 2, sessionNum: 1, endTime: 200 }),
      lap({ lapNumber: 1, sessionNum: 1, endTime: 100 }),
      lap({ lapNumber: 9, sessionNum: 0, endTime: 900 }),
    ];

    expect(lapEntries(laps, options).map((entry) => entry.lap)).toEqual([2, 1]);
    expect(
      lapEntries(laps, { ...options, sessionNum: 0 }).map((entry) => entry.lap)
    ).toEqual([9]);
    expect(lapEntries(laps, { ...options, sessionNum: null })).toEqual([]);
  });

  it('keeps the laps of one stint when asked for it', () => {
    const laps = [
      lap({ lapNumber: 4, stintId: 'run:2', stintLap: 2, endTime: 400 }),
      lap({ lapNumber: 3, stintId: 'run:2', stintLap: 1, endTime: 310 }),
      lap({ lapNumber: 2, stintId: 'run:1', stintLap: 2, endTime: 180 }),
      lap({ lapNumber: 1, stintId: 'run:1', stintLap: 1, endTime: 90 }),
    ];

    const entries = lapEntries(laps, { ...options, stintId: 'run:2' });

    expect(entries.map((entry) => entry.lap)).toEqual([4, 3]);
    // Still measured against the lap before it, in the stint before.
    expect(entries[1].delta).toBe(0);
    expect(lapEntries(laps, { ...options, stintId: '' })).toEqual([]);
  });

  it('leaves out a lap a team-mate drove any part of', () => {
    const laps = [
      lap({ lapNumber: 3, simLapTime: 88, endTime: 300 }),
      lap({ lapNumber: 2, simLapTime: 84, flags: LEDGER_LAP_NOT_OWN }),
      lap({ lapNumber: 1, simLapTime: 87, endTime: 50 }),
    ];

    const entries = lapEntries(laps, options);

    expect(entries.map((entry) => entry.lap)).toEqual([3, 1]);
    // Measured against the user's own lap before it, not the team-mate's.
    expect(entries[0].delta).toBeCloseTo(1, 6);
  });

  it('drops the laps from before a session was restarted', () => {
    // The clock went back: lap numbers start again in the same session.
    const laps = [
      lap({ lapNumber: 2, startTime: 100, endTime: 190 }),
      lap({ lapNumber: 1, startTime: 10, endTime: 100 }),
      lap({ lapNumber: 2, startTime: 900, endTime: 990 }),
      lap({ lapNumber: 1, startTime: 810, endTime: 900 }),
    ];

    const entries = lapEntries(laps, options);

    expect(entries.map((entry) => entry.lap)).toEqual([2, 1]);
    expect(entries[1].delta).toBe(0);
  });

  it('numbers a lap the sim gave no number after the one before it', () => {
    const laps = [
      lap({ lapNumber: null, endTime: 300 }),
      lap({ lapNumber: 7, endTime: 200 }),
    ];

    expect(lapEntries(laps, options).map((entry) => entry.lap)).toEqual([8, 7]);
  });

  it('gives the wear of the four wheels as their mean, or the worst', () => {
    const [entry] = lapEntries([lap()], options);
    const [worst] = lapEntries([lap()], { ...options, wearMode: 'highest' });
    const [unread] = lapEntries(
      [lap({ treadUsed: [null, null, null, null] })],
      options
    );

    expect(entry.wear).toBeCloseTo(0.005025, 6);
    expect(worst.wear).toBe(0.0053);
    // iRacing reads tread only in the pits: no figure, not a nought.
    expect(unread.wear).toBeNull();
  });
});

describe('visibleLapEntries', () => {
  const { ledger } = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });
  const entries = lapEntries(ledger.laps, {
    sessionNum: ledger.sessionNum,
    deltaMethod: 'bestlap',
  });

  it('shows the newest laps, as many as asked for', () => {
    const shown = visibleLapEntries(entries, { count: 5 });

    expect(shown.map((entry) => entry.lap)).toEqual([41, 40, 39, 38, 37]);
  });

  it('still fills the count when pit laps are hidden', () => {
    // The newest ten laps hold an out-lap and an in-lap.
    expect(
      visibleLapEntries(entries, { count: 10 }).filter((entry) => entry.pitted)
    ).toHaveLength(2);

    const shown = visibleLapEntries(entries, {
      count: 10,
      hidePittedLaps: true,
    });

    expect(shown).toHaveLength(10);
    expect(shown.some((entry) => entry.pitted)).toBe(false);
    expect(shown.map((entry) => entry.lap)).toEqual([
      41, 40, 39, 38, 35, 34, 33, 32, 31, 30,
    ]);
  });

  it('leaves out the laps under a full-course caution', () => {
    const laps = [
      lap({ lapNumber: 3, endTime: 300 }),
      lap({ lapNumber: 2, endTime: 200, flags: LEDGER_LAP_CAUTION }),
      lap({ lapNumber: 1, endTime: 100, flags: LEDGER_LAP_YELLOW }),
    ];

    const shown = visibleLapEntries(lapEntries(laps, options), {
      count: 10,
      hideCautionLaps: true,
    });

    // A local yellow is kept.
    expect(shown.map((entry) => entry.lap)).toEqual([3, 1]);
  });

  it('puts unordered entries newest first', () => {
    const shown = visibleLapEntries(
      [
        { lap: 2, time: 91 },
        { lap: 9, time: 92 },
        { lap: 5, time: 93 },
      ],
      { count: 2 }
    );

    expect(shown.map((entry) => entry.lap)).toEqual([9, 5]);
  });
});

describe('the lap under way', () => {
  const live = (
    overrides: Partial<PlayerStintSnapshot>
  ): PlayerStintSnapshot => ({
    ...EMPTY_PLAYER_STINT,
    available: true,
    sessionNum: 1,
    ...overrides,
  });
  const { live: racing, ledger } = sampleLedger({
    stints: ENDURANCE_SAMPLE_STINTS,
    sessionNum: 1,
  });

  it('is a row of what the lap has used and been driven under so far', () => {
    const entry = liveLapEntry(
      live({
        stint: racing.stint,
        lap: {
          lapNumber: 42,
          stintLap: 6,
          fuelUsed: 1.16,
          energyUsed: 0.0094,
          treadUsed: [0.002, 0.003, 0.002, 0.002],
          flags: LEDGER_LAP_YELLOW | LEDGER_LAP_VOIDED,
        },
      }),
      'highest'
    );

    expect(entry).toMatchObject({
      lap: 42,
      stintLap: 6,
      stintId: racing.stint?.id,
      fuelUsed: 1.16,
      energyUsed: 0.0094,
      wear: 0.003,
      dirty: true,
      yellow: true,
      pitted: false,
    });
  });

  it('has no wear figure where the sim gives none', () => {
    expect(liveLapEntry(live({})).wear).toBeNull();
    expect(
      liveLapEntry(
        live({
          lap: {
            ...EMPTY_PLAYER_STINT.lap,
            treadUsed: [null, null, null, null],
          },
        })
      ).wear
    ).toBeNull();
  });

  it('names the stint under way as the one to list', () => {
    expect(listedStintId(ledger.laps, racing, 1)).toBe(racing.stint?.id);
  });

  it("names the stint of the user's newest lap once none is under way", () => {
    // In the garage after the stint, or with a team-mate at the wheel.
    const newest = ledger.laps[0].stintId;

    expect(listedStintId(ledger.laps, live({ stint: null }), 1)).toBe(newest);
    expect(
      listedStintId(
        ledger.laps,
        live({
          stint: racing.stint && { ...racing.stint, id: 'x:9', own: false },
        }),
        1
      )
    ).toBe(newest);
    expect(listedStintId([], undefined, 1)).toBe('');
  });
});
