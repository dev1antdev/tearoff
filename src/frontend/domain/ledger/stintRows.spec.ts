import { describe, expect, it } from 'vitest';
import type {
  LedgerLap,
  LedgerStint,
  LedgerStop,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
} from '@irdashies/types';
import { EMPTY_PLAYER_STINT, LEDGER_LAP_VOIDED } from '@irdashies/types';
import { isCleanLap } from '@irdashies/shared';
import { ENDURANCE_SAMPLE_STINTS, sampleLedger } from './ledgerSample';
import { formatStintTime, stintRows, type StintRowSettings } from './stintRows';

const settings = (
  overrides: Partial<StintRowSettings> = {}
): StintRowSettings => ({
  historyCount: 3,
  showCurrent: true,
  thisSessionOnly: true,
  minLaps: 1,
  newestFirst: true,
  wearMode: 'average',
  fuelUnits: 'L',
  ...overrides,
});

const stint = (overrides: Partial<LedgerStint> = {}): LedgerStint => ({
  id: 'run:1',
  ordinal: 1,
  sessionNum: 2,
  driver: 'Alex Morgan',
  own: true,
  openedBy: 'pitExit',
  closedBy: 'service',
  startTime: 1000,
  endTime: 2800,
  startLap: 10,
  endLap: 27,
  laps: 17,
  startFuel: 60,
  endFuel: 12.5,
  startEnergy: null,
  endEnergy: null,
  startTread: [1, 1, 1, 1],
  endTread: [0.9, 0.88, 0.93, 0.95],
  startBrake: [36, 36, 32, 32],
  endBrake: [35.9, 35.9, 31.96, 31.96],
  compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
  bestLap: 104.311,
  avgLap: 104.9,
  cleanLaps: 15,
  paceDelta: 0.63,
  consistency: 0.994,
  passes: [],
  stop: null,
  ...overrides,
});

const stop = (overrides: Partial<LedgerStop> = {}): LedgerStop => ({
  pitLaneTime: 41.23,
  stationaryTime: 28,
  fuelAdded: 0,
  energyAdded: 0,
  tyresChanged: 0,
  brakesChanged: false,
  driverChanged: false,
  simEstimate: null,
  ...overrides,
});

const ledgerOf = (
  stints: LedgerStint[],
  laps: LedgerLap[] = []
): PlayerLedgerSnapshot => ({ laps, stints, sessionNum: 2, version: 1 });

const liveOf = (
  open: LedgerStint | null,
  overrides: Partial<PlayerStintSnapshot> = {}
): PlayerStintSnapshot => ({
  ...EMPTY_PLAYER_STINT,
  available: true,
  state: open ? 'running' : 'idle',
  stint: open,
  sessionNum: 2,
  ...overrides,
});

describe('stintRows', () => {
  it('draws the stint under way from its start and present levels', () => {
    const open = stint({
      id: 'run:4',
      ordinal: 4,
      closedBy: null,
      startTime: 5000,
      endTime: 5432,
      laps: 5,
      startEnergy: 0.8,
      endEnergy: 0.685,
    });

    const [row] = stintRows(ledgerOf([]), liveOf(open), settings());

    expect(row).toMatchObject({
      id: 'run:4',
      current: true,
      ordinal: '4',
      laps: '5',
      time: '7:12',
      budget: 'virtualEnergy',
      used: '11.5',
      end: null,
      stopTime: '',
    });
  });

  it('marks what the stop that ended a stint did', () => {
    const [row] = stintRows(
      ledgerOf([
        stint({
          stop: stop({ fuelAdded: 62, tyresChanged: 15 }),
        }),
      ]),
      undefined,
      settings()
    );

    expect(row).toMatchObject({
      current: false,
      end: 'service',
      stopTime: '41.2',
      added: '62',
      tyresChanged: true,
      brakesChanged: false,
      driverChanged: false,
    });
  });

  it('counts what an energy car took on in percent of its budget', () => {
    const [row] = stintRows(
      ledgerOf([
        stint({
          startEnergy: 0.98,
          endEnergy: 0.07,
          stop: stop({
            fuelAdded: 48,
            energyAdded: 0.62,
            driverChanged: true,
            brakesChanged: true,
          }),
        }),
      ]),
      undefined,
      settings()
    );

    expect(row).toMatchObject({
      budget: 'virtualEnergy',
      used: '91.0',
      added: '62',
      tyresChanged: false,
      brakesChanged: true,
      driverChanged: true,
    });
  });

  it('shows no amount for a stop that put nothing in', () => {
    const [row] = stintRows(
      ledgerOf([stint({ stop: stop({ tyresChanged: 0b0011 }) })]),
      undefined,
      settings()
    );

    expect(row).toMatchObject({ added: '', tyresChanged: true });
  });

  it('says how a stint ended that no stop ended', () => {
    const rows = stintRows(
      ledgerOf([
        stint({ id: 'run:3', closedBy: 'session' }),
        stint({ id: 'run:2', closedBy: 'garage' }),
        stint({ id: 'run:1', closedBy: 'driver' }),
      ]),
      undefined,
      settings()
    );

    expect(rows.map((row) => [row.end, row.stopTime])).toEqual([
      ['session', ''],
      ['garage', ''],
      ['driver', ''],
    ]);
  });

  it('leaves out the stints of earlier sessions unless asked for them', () => {
    const ledger = ledgerOf([
      stint({ id: 'race:1', sessionNum: 2 }),
      stint({ id: 'quali:1', sessionNum: 1 }),
    ]);

    expect(
      stintRows(ledger, undefined, settings()).map((row) => row.id)
    ).toEqual(['race:1']);
    expect(
      stintRows(ledger, undefined, settings({ thisSessionOnly: false })).map(
        (row) => row.id
      )
    ).toEqual(['race:1', 'quali:1']);
  });

  it('leaves out a finished stint shorter than the fewest laps asked for', () => {
    const ledger = ledgerOf([
      stint({ id: 'run:2', laps: 1 }),
      stint({ id: 'run:1', laps: 2 }),
    ]);

    expect(
      stintRows(ledger, undefined, settings({ minLaps: 2 })).map(
        (row) => row.id
      )
    ).toEqual(['run:1']);
    expect(stintRows(ledger, undefined, settings())).toHaveLength(2);
  });

  it('shows a fuel car in litres, or in gallons', () => {
    const ledger = ledgerOf([stint({ stop: stop({ fuelAdded: 47.5 }) })]);

    expect(stintRows(ledger, undefined, settings())[0]).toMatchObject({
      budget: 'fuel',
      used: '47.5',
      usedPerLap: '2.79',
      added: '48',
    });
    expect(
      stintRows(ledger, undefined, settings({ fuelUnits: 'gal' }))[0]
    ).toMatchObject({ used: '12.5', usedPerLap: '0.74', added: '13' });
  });

  it('gives the wear as the mean of the wheels, or the worst of them', () => {
    const ledger = ledgerOf([stint()]);

    expect(stintRows(ledger, undefined, settings())[0].wear).toBe('8.5');
    expect(
      stintRows(ledger, undefined, settings({ wearMode: 'highest' }))[0].wear
    ).toBe('12.0');
  });

  it('turns the wear amber and red by the wheel that lost the most', () => {
    const tones = stintRows(
      ledgerOf([
        stint({ id: 'a', endTread: [0.9, 0.9, 0.9, 0.9] }),
        stint({ id: 'b', endTread: [0.9, 0.69, 0.9, 0.9] }),
        stint({ id: 'c', endTread: [0.49, 0.9, 0.9, 0.9] }),
      ]),
      undefined,
      settings()
    ).map((row) => row.wearTone);

    // The mean of the second is under 30 points; one wheel is not.
    expect(tones).toEqual(['none', 'caution', 'bad']);
  });

  it('has no wear figure where the tread reads the same at both ends', () => {
    // iRacing refreshes tread only in the pits, and reads no brake discs.
    const [row] = stintRows(
      ledgerOf([
        stint({
          endTread: [1, 1, 1, 1],
          startBrake: [null, null, null, null],
          endBrake: [null, null, null, null],
        }),
      ]),
      undefined,
      settings()
    );

    expect(row).toMatchObject({ wear: '--', wearTone: 'none', brakes: '--' });
  });

  it('gives the brake discs worn in millimetres', () => {
    const [row] = stintRows(ledgerOf([stint()]), undefined, settings());

    expect(row.brakes).toBe('0.07');
  });

  it('writes a stint of an hour or more with its hours', () => {
    expect(formatStintTime(432)).toBe('7:12');
    expect(formatStintTime(3599.9)).toBe('59:59');
    expect(formatStintTime(3725)).toBe('1:02:05');
    expect(formatStintTime(null)).toBe('--');
  });

  it("lists the user's own stints, and none a team-mate drove", () => {
    const ledger = ledgerOf([
      stint({ id: 'run:3', ordinal: 3, own: false, driver: 'Jamie Taylor' }),
      stint({ id: 'run:2', ordinal: 2 }),
    ]);
    // A team-mate is at the wheel: their stint is under way, not the user's.
    const live = liveOf(
      stint({ id: 'run:4', ordinal: 4, own: false, closedBy: null })
    );

    const rows = stintRows(ledger, live, settings());

    expect(rows.map((row) => row.id)).toEqual(['run:2']);
    expect(rows[0]).toMatchObject({ current: false, driver: 'Morgan' });
  });

  it('shows as many finished stints as asked for, newest first or last', () => {
    const { ledger, live } = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

    expect(
      stintRows(ledger, live, settings()).map((row) => row.ordinal)
    ).toEqual(['4', '3', '2', '1']);
    expect(
      stintRows(ledger, live, settings({ historyCount: 2 })).map(
        (row) => row.ordinal
      )
    ).toEqual(['4', '3', '2']);
    expect(
      stintRows(ledger, live, settings({ newestFirst: false })).map(
        (row) => row.ordinal
      )
    ).toEqual(['1', '2', '3', '4']);
    expect(
      stintRows(ledger, live, settings({ showCurrent: false })).map(
        (row) => row.current
      )
    ).toEqual([false, false, false]);
  });

  it('takes the per-lap use of the stint under way from its clean laps', () => {
    const { ledger, live } = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

    const [current, finished] = stintRows(ledger, live, settings());

    // 2.35 % a lap, though the total holds a part of a sixth lap.
    expect(current.usedPerLap).toBe('2.35');
    expect(Number(current.used) / 5).toBeGreaterThan(2.5);
    // A finished stint: what it used over the laps it completed.
    expect(finished.usedPerLap).toBe('2.35');
    // Until the stint has a clean lap of its own, no figure.
    expect(
      stintRows(
        ledger,
        { ...live, rates: { ...live.rates, source: 'session' } },
        settings()
      )[0].usedPerLap
    ).toBe('--');
  });

  it("shows a stint's best lap as the sim timed it, from its rows", () => {
    const rows: LedgerLap[] = [
      {
        ...sampleLedger({ stints: [{ laps: 1 }] }).ledger.laps[0],
        stintId: 'run:1',
        lapTime: 86.671,
        simLapTime: 86.66,
        flags: 0,
      },
    ];
    const one = stint({ bestLap: 86.671, cleanLaps: 1 });

    expect(
      stintRows(ledgerOf([one], rows), undefined, settings())[0].best
    ).toBe('1:26.660');
    // Rows that have left the ledger: the record's own best stands in.
    expect(
      stintRows(
        ledgerOf([stint({ bestLap: 86.671, cleanLaps: 9 })], rows),
        undefined,
        settings()
      )[0].best
    ).toBe('1:26.671');
    expect(
      stintRows(
        ledgerOf([stint({ bestLap: null, cleanLaps: 0 })]),
        undefined,
        settings()
      )[0].best
    ).toBe('--');
  });

  it("marks the stint that holds the user's best lap of the session", () => {
    const { ledger, live } = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

    const rows = stintRows(ledger, live, settings());

    expect(rows.filter((row) => row.sessionBest)).toHaveLength(1);
    const quickest = Math.min(
      ...ledger.laps
        .filter((lap) => isCleanLap(lap.flags))
        .map((lap) => lap.simLapTime ?? lap.lapTime)
    );
    const holder = ledger.laps.find((lap) => lap.simLapTime === quickest);
    expect(rows.find((row) => row.sessionBest)?.id).toBe(holder?.stintId);
  });

  it('does not count a voided lap as a best', () => {
    const base = sampleLedger({ stints: [{ laps: 1 }] }).ledger.laps[0];
    const rows: LedgerLap[] = [
      { ...base, stintId: 'run:1', simLapTime: 84, flags: LEDGER_LAP_VOIDED },
      {
        ...base,
        stintId: 'run:1',
        simLapTime: 86.66,
        lapTime: 86.671,
        flags: 0,
      },
    ];

    expect(
      stintRows(
        ledgerOf([stint({ bestLap: 86.671, cleanLaps: 1 })], rows),
        undefined,
        settings()
      )[0].best
    ).toBe('1:26.660');
  });

  it('is empty with no stint of the user at all', () => {
    expect(stintRows(undefined, undefined, settings())).toEqual([]);
    expect(stintRows(ledgerOf([]), liveOf(null), settings())).toEqual([]);
  });

  it('does not show a stint under way that belongs to another session', () => {
    const open = stint({ closedBy: null, sessionNum: 1 });

    expect(stintRows(ledgerOf([]), liveOf(open), settings())).toEqual([]);
  });
});
