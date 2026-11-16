import type {
  FuelBudget,
  LedgerLap,
  LedgerStint,
  LedgerStop,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
  StintClosedBy,
  StintOpenedBy,
} from '@irdashies/types';
import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
  LEDGER_LAP_YELLOW,
} from '@irdashies/types';
import { isCleanLap, stintPace } from '@irdashies/shared';

/**
 * A made-up ledger: a car driven through a few stints, with the rows and the
 * stint records the two channels would carry for it. What the ledger widgets
 * draw in demo mode, and what their stories and specs are fed.
 *
 * The figures hang together the way the real ones do -- a stint's totals are
 * its start levels less its end levels, a lap after a stop carries what the
 * stop put in -- but nothing here is measured.
 */

/** One stint of the sample. */
export interface SampleStint {
  /** Laps completed in it. */
  laps: number;
  /** Extra LEDGER_LAP_* bits by the lap's number within the stint, from 1. */
  flags?: Readonly<Record<number, number>>;
  /** How it ended; left out for the stint still under way. */
  closedBy?: StintClosedBy;
  /** The stop that ended it, where a service did. */
  stop?: Partial<LedgerStop>;
  /** Compound per wheel; the one before carries on when left out. */
  compounds?: readonly (string | null)[];
  driver?: string;
  /** False for a stint a team-mate drove. */
  own?: boolean;
}

export interface SampleLedgerOptions {
  stints: readonly SampleStint[];
  budget?: FuelBudget;
  sessionNum?: number;
  /** Seconds a green lap takes. */
  lapTime?: number;
  /** Litres a lap. */
  fuelPerLap?: number;
  /** Share of the virtual energy budget a lap. */
  energyPerLap?: number;
  /** Tread a lap, 0..1; null for a sim that reads tread only in the pits. */
  treadPerLap?: number | null;
  /** Millimetres of disc a lap; null for a sim that reads none. */
  brakePerLap?: number | null;
  /** How much of the lap under way has been driven, 0..1. */
  lapProgress?: number;
  /** The race began on the grid: the first lap is timed from the green. */
  fromStart?: boolean;
}

export interface SampleLedger {
  ledger: PlayerLedgerSnapshot;
  live: PlayerStintSnapshot;
}

/** Lap to lap, a driver is not a metronome: seconds added to each lap. */
const WOBBLE = [
  0, 0.42, -0.31, 0.18, 0.77, -0.12, 0.05, 0.61, -0.44, 0.29, 0.93, -0.2,
];
/** The front right works hardest, the rears least. */
const WHEEL_SHARE = [1, 1.08, 0.94, 0.9];
const FULL_TANK_L = 62;
const FULL_ENERGY = 0.98;
const DEFAULT_STOP: LedgerStop = {
  pitLaneTime: 41.2,
  stationaryTime: 27.6,
  fuelAdded: 0,
  energyAdded: 0,
  tyresChanged: 0,
  brakesChanged: false,
  driverChanged: false,
  simEstimate: null,
};

const round = (value: number, decimals: number): number =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

export const sampleLedger = ({
  stints,
  budget = 'virtualEnergy',
  sessionNum = 2,
  lapTime = 104.2,
  fuelPerLap = 2.9,
  energyPerLap = 0.0235,
  treadPerLap = 0.006,
  brakePerLap = 0.004,
  lapProgress = 0.4,
  fromStart = true,
}: SampleLedgerOptions): SampleLedger => {
  const energyCar = budget === 'virtualEnergy';
  const rows: LedgerLap[] = [];
  const closed: LedgerStint[] = [];
  let open: LedgerStint | null = null;

  let time = 0;
  let lapNumber = 0;
  let fuel = FULL_TANK_L;
  let energy = FULL_ENERGY;
  let tread = [1, 1, 1, 1];
  let brake = [36, 36, 32, 32];
  let compounds: readonly (string | null)[] = [
    'Medium',
    'Medium',
    'Medium',
    'Medium',
  ];
  let previousStop: LedgerStop | null = null;

  /** Drives a share of a lap: the levels fall, the clock runs. */
  const drive = (share: number, pace: number, burn: number) => {
    time += share * pace;
    fuel -= share * fuelPerLap * burn;
    energy -= share * energyPerLap * burn;
    if (treadPerLap !== null) {
      tread = tread.map(
        (value, wheel) => value - share * treadPerLap * WHEEL_SHARE[wheel]
      );
    }
    if (brakePerLap !== null) {
      brake = brake.map((value) => value - share * brakePerLap * burn);
    }
  };

  stints.forEach((sample, index) => {
    const ordinal = index + 1;
    const id = `sample:${sessionNum}:${ordinal}`;
    const first = index === 0;
    const serviced = previousStop;
    if (serviced) {
      // Out of the pit lane: what the stop put in is aboard, on new tyres
      // where it changed them.
      time += serviced.pitLaneTime ?? 0;
      fuel += serviced.fuelAdded;
      energy += serviced.energyAdded;
      tread = tread.map((value, wheel) =>
        (serviced.tyresChanged & (1 << wheel)) !== 0 ? 1 : value
      );
    }
    compounds = sample.compounds ?? compounds;
    const openedBy: StintOpenedBy = first
      ? fromStart
        ? 'green'
        : 'joined'
      : 'pitExit';
    const start = {
      time,
      lap: lapNumber,
      fuel,
      energy,
      tread: [...tread],
      brake: [...brake],
    };
    const ends = sample.closedBy !== undefined;
    const stop: LedgerStop | null =
      sample.closedBy === 'service'
        ? { ...DEFAULT_STOP, ...sample.stop }
        : null;

    let cleanLaps = 0;
    let cleanSum = 0;
    let bestLap: number | null = null;
    for (let stintLap = 1; stintLap <= sample.laps; stintLap += 1) {
      lapNumber += 1;
      let flags = sample.flags?.[stintLap] ?? 0;
      if (first && fromStart && stintLap === 1) flags |= LEDGER_LAP_FROM_START;
      if (serviced && stintLap === 1) {
        flags |= LEDGER_LAP_OUT_LAP | LEDGER_LAP_SERVICED;
      }
      if (stop && stintLap === sample.laps) flags |= LEDGER_LAP_IN_LAP;

      const caution = (flags & LEDGER_LAP_CAUTION) !== 0;
      // The tyres go off over a stint while the track comes in over the race.
      const seconds =
        lapTime +
        WOBBLE[lapNumber % WOBBLE.length] +
        0.03 * stintLap -
        0.004 * lapNumber +
        ((flags & LEDGER_LAP_FROM_START) !== 0 ? 8.1 : 0) +
        ((flags & LEDGER_LAP_OUT_LAP) !== 0 ? 11.4 : 0) +
        ((flags & LEDGER_LAP_IN_LAP) !== 0 ? 9.7 : 0) +
        ((flags & LEDGER_LAP_WET) !== 0 ? 9.2 : 0) +
        (caution ? lapTime * 0.55 : 0);
      // The app times a lap from line to line; the sim's line is a few
      // metres on, so the two differ by a hundredth.
      const timed = seconds + 0.011;
      const before = {
        time,
        fuel,
        energy,
        tread: [...tread],
        brake: [...brake],
      };
      drive(1, seconds, caution ? 0.6 : 1);

      const wet = (flags & LEDGER_LAP_WET) !== 0;
      const afterStop = serviced && stintLap === 1 ? serviced : null;
      rows.unshift({
        id: 0,
        stintId: id,
        sessionNum,
        lapNumber,
        stintLap,
        startTime: before.time,
        endTime: time,
        lapTime: timed,
        simLapTime: round(seconds, 3),
        flags,
        incidents: null,
        fuelAtLine: round(fuel, 3),
        fuelUsed: before.fuel - fuel,
        fuelAdded: afterStop?.fuelAdded ?? 0,
        energyAtLine: energyCar ? round(energy, 5) : null,
        energyUsed: energyCar ? before.energy - energy : null,
        energyAdded: energyCar ? (afterStop?.energyAdded ?? 0) : 0,
        treadAtLine: tread.map((value) =>
          treadPerLap === null ? null : round(value, 5)
        ),
        treadUsed: tread.map((value, wheel) =>
          treadPerLap === null ? null : before.tread[wheel] - value
        ),
        brakeAtLine: brake.map((value) =>
          brakePerLap === null ? null : round(value, 4)
        ),
        brakeUsed: brake.map((value, wheel) =>
          brakePerLap === null ? null : before.brake[wheel] - value
        ),
        compounds,
        sectors: [seconds * 0.31, seconds * 0.4, seconds * 0.29],
        wetness: wet ? 4 : 1,
        rain: wet ? 0.3 : 0,
        airTemp: 21,
        trackTemp: 30,
        position: 5,
        classPosition: 2,
      });
      if (isCleanLap(flags)) {
        cleanLaps += 1;
        cleanSum += timed;
        bestLap = bestLap === null ? timed : Math.min(bestLap, timed);
      }
    }
    // The stint under way is part of a lap further on.
    if (!ends) drive(lapProgress, lapTime, 1);

    const avgLap = cleanLaps > 0 ? cleanSum / cleanLaps : null;
    const stint: LedgerStint = {
      id,
      ordinal,
      sessionNum,
      driver: sample.driver ?? 'Alex Morgan',
      own: sample.own ?? true,
      openedBy,
      closedBy: sample.closedBy ?? null,
      startTime: start.time,
      endTime: ends ? time : Math.floor(time),
      startLap: start.lap,
      endLap: lapNumber,
      laps: sample.laps,
      startFuel: round(start.fuel, 2),
      endFuel: round(fuel, 2),
      startEnergy: energyCar ? round(start.energy, 4) : null,
      endEnergy: energyCar ? round(energy, 4) : null,
      startTread: start.tread.map((value) => round(value, 3)),
      endTread: tread.map((value) => round(value, 3)),
      startBrake: brakePerLap === null ? [null, null, null, null] : start.brake,
      endBrake:
        brakePerLap === null
          ? [null, null, null, null]
          : brake.map((value) => round(value, 4)),
      compounds,
      bestLap,
      avgLap,
      cleanLaps,
      ...stintPace(bestLap, avgLap, cleanLaps),
      passes: [],
      stop,
    };
    if (ends) closed.unshift(stint);
    else open = stint;
    previousStop = stop;
  });

  const openStint = open as LedgerStint | null;
  const clean = openStint
    ? rows.filter(
        (row) => row.stintId === openStint.id && isCleanLap(row.flags)
      )
    : [];
  const mean = (pick: (row: LedgerLap) => number | null): number | null =>
    clean.length > 0
      ? clean.reduce((sum, row) => sum + (pick(row) ?? 0), 0) / clean.length
      : null;
  const fuelRate = mean((row) => row.fuelUsed);
  const energyRate = energyCar ? mean((row) => row.energyUsed) : null;
  const lapsLeft = energyCar
    ? energyRate && energy / energyRate
    : fuelRate && fuel / fuelRate;

  return {
    ledger: { laps: rows, stints: closed, sessionNum, version: 1 },
    live: {
      available: true,
      state: openStint ? 'running' : 'idle',
      budget,
      stint: openStint,
      lap: {
        lapNumber: lapNumber + 1,
        stintLap: (openStint?.laps ?? 0) + 1,
        fuelUsed: openStint ? round(lapProgress * fuelPerLap, 2) : null,
        energyUsed:
          openStint && energyCar ? round(lapProgress * energyPerLap, 4) : null,
        ...(openStint
          ? {
              treadUsed: WHEEL_SHARE.map((share) =>
                treadPerLap === null
                  ? null
                  : round(lapProgress * treadPerLap * share, 3)
              ),
            }
          : {}),
        flags: 0,
      },
      rates: {
        fuel: fuelRate === null ? null : round(fuelRate, 3),
        energy: energyRate === null ? null : round(energyRate, 5),
        lapTime: mean((row) => row.lapTime),
        source: clean.length > 0 ? 'stint' : null,
      },
      budgetLapsLeft: lapsLeft ? round(lapsLeft, 1) : null,
      sessionNum,
      version: 1,
    },
  };
};

/**
 * An endurance race two stops in: a stint from the start, one on the same
 * tyres with a yellow and a caution in it, one on fresh tyres into the rain,
 * and the stint under way.
 */
export const ENDURANCE_SAMPLE_STINTS: readonly SampleStint[] = [
  {
    laps: 12,
    closedBy: 'service',
    stop: { pitLaneTime: 38.6, fuelAdded: 34.2, energyAdded: 0.28 },
  },
  {
    laps: 13,
    flags: {
      5: LEDGER_LAP_YELLOW,
      8: LEDGER_LAP_CAUTION,
      9: LEDGER_LAP_CAUTION,
    },
    closedBy: 'service',
    stop: {
      pitLaneTime: 52.4,
      stationaryTime: 39.1,
      fuelAdded: 36.9,
      energyAdded: 0.31,
      tyresChanged: 0b1111,
    },
  },
  {
    laps: 11,
    flags: {
      4: LEDGER_LAP_VOIDED,
      9: LEDGER_LAP_WET,
      10: LEDGER_LAP_WET,
      11: LEDGER_LAP_WET,
    },
    closedBy: 'service',
    stop: {
      pitLaneTime: 49.8,
      stationaryTime: 36.4,
      fuelAdded: 31.5,
      energyAdded: 0.26,
      tyresChanged: 0b1111,
    },
  },
  { laps: 5 },
];
