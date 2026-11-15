import type {
  LapLibraryLap,
  LedgerLap,
  LedgerRateSource,
} from '@irdashies/types';
import { isCleanLap } from '../../shared/lapValidity';

/**
 * What a lap usually costs, for every forecast made from the ledger: how
 * many laps the tank lasts, when the tyres are done.
 *
 * A rate is the median of the last five clean laps, so one lap spent behind
 * a slower car does not move it much. It is taken from the open stint; when
 * that has no clean lap yet, from the session; and when that has none
 * either, from what this track and car cost before, so that a forecast
 * exists on the first lap of a session. Where a rate came from is published
 * with it.
 *
 * Tread is the exception: it is taken per wheel from the laps on the tyre
 * that is on the car now, which may be older than the stint, and a tyre
 * change empties that wheel's laps. Until the new tyre has a lap, the
 * session's laps on the same compound stand in, then the baseline for the
 * compound; each wheel says which it was.
 */

/** How many clean laps a rate is the median of. */
export const RATE_WINDOW_LAPS = 5;
/** How many clean dry laps of the library a baseline is the median of. */
export const BASELINE_LAPS = 10;

const WHEELS = 4;

/** The middle value, or the mean of the two middle ones; null for none. */
export const medianOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const readings = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

/** What a track and car usually cost, from the lap library. */
export interface LedgerBaseline {
  /** How many laps it was worked out from. */
  laps: number;
  fuel: number | null;
  energy: number | null;
  lapTime: number | null;
  /** Millimetres of disc per lap, per wheel. */
  brake: (number | null)[];
  /** Tread per lap, per wheel, for each compound by name. */
  treadByCompound: Record<string, (number | null)[]>;
}

/**
 * The baseline for a track and car from its latest clean dry laps, newest
 * first as the library hands them over. Null without a lap.
 */
export const baselineFrom = (
  laps: readonly LapLibraryLap[]
): LedgerBaseline | null => {
  const rows = laps
    .filter((lap) => lap.ledger !== null)
    .slice(0, BASELINE_LAPS);
  if (rows.length === 0) return null;
  const compounds = new Set<string>();
  for (const lap of rows) {
    for (const name of lap.ledger?.compounds ?? []) {
      if (name) compounds.add(name);
    }
  }
  const treadByCompound: Record<string, (number | null)[]> = {};
  for (const name of compounds) {
    treadByCompound[name] = Array.from({ length: WHEELS }, (_, wheel) =>
      medianOf(
        readings(
          rows
            .filter((lap) => lap.ledger?.compounds[wheel] === name)
            .map((lap) => lap.ledger?.treadUsed[wheel] ?? null)
        )
      )
    );
  }
  return {
    laps: rows.length,
    fuel: medianOf(readings(rows.map((lap) => lap.fuelUsed))),
    energy: medianOf(readings(rows.map((lap) => lap.energyUsed))),
    lapTime: medianOf(rows.map((lap) => lap.lapTime)),
    brake: Array.from({ length: WHEELS }, (_, wheel) =>
      medianOf(
        readings(rows.map((lap) => lap.ledger?.brakeUsed[wheel] ?? null))
      )
    ),
    treadByCompound,
  };
};

/**
 * Where a wheel's tread per lap was taken from: laps on the tyre now fitted,
 * the session's laps on an earlier set of the same compound, or what the
 * compound cost in earlier sessions.
 */
export type TreadRateSource = 'tyre' | 'session' | 'baseline';

/** Per-lap rates and where they were taken from. */
export interface LedgerRates {
  /** Litres a lap. */
  fuel: number | null;
  /** Virtual energy a lap, as a fraction of the budget. */
  energy: number | null;
  /** Seconds. */
  lapTime: number | null;
  /** Millimetres of disc a lap, per wheel. */
  brake: (number | null)[];
  /** Tread a lap, per wheel. */
  tread: (number | null)[];
  /** Where each wheel's tread was taken from; null beside a null rate. */
  treadSource: (TreadRateSource | null)[];
  /** Where fuel, energy, lap time and the discs were taken from. */
  source: LedgerRateSource | null;
}

export const EMPTY_LEDGER_RATES: LedgerRates = {
  fuel: null,
  energy: null,
  lapTime: null,
  brake: [null, null, null, null],
  tread: [null, null, null, null],
  treadSource: [null, null, null, null],
  source: null,
};

/** The newest clean laps that pass `keep`, at most a rate's window of them. */
const cleanLaps = (
  laps: readonly LedgerLap[],
  keep: (lap: LedgerLap) => boolean
): LedgerLap[] => {
  const kept: LedgerLap[] = [];
  for (const lap of laps) {
    if (!isCleanLap(lap.flags) || !keep(lap)) continue;
    kept.push(lap);
    if (kept.length === RATE_WINDOW_LAPS) break;
  }
  return kept;
};

export class LedgerRateBook {
  private baseline: LedgerBaseline | null = null;
  /** Tread worn on each clean lap on the tyre now fitted, per wheel. */
  private readonly onTyre: number[][] = [[], [], [], []];

  /** Forgets the laps; the baseline goes only when told. */
  reset(): void {
    for (const laps of this.onTyre) laps.length = 0;
  }

  setBaseline(baseline: LedgerBaseline | null): void {
    this.baseline = baseline;
  }

  /** A lap closed. */
  noteLap(lap: LedgerLap): void {
    if (!isCleanLap(lap.flags)) return;
    for (let wheel = 0; wheel < WHEELS; wheel += 1) {
      const used = lap.treadUsed[wheel];
      if (used === null || used === undefined) continue;
      const laps = this.onTyre[wheel];
      laps.push(used);
      if (laps.length > RATE_WINDOW_LAPS) laps.shift();
    }
  }

  /** Wheels were given another tyre: one bit each, LF 1, RF 2, LR 4, RR 8. */
  noteTyreChange(wheels: number): void {
    for (let wheel = 0; wheel < WHEELS; wheel += 1) {
      if ((wheels & (1 << wheel)) !== 0) this.onTyre[wheel].length = 0;
    }
  }

  /**
   * The rates as they stand.
   *
   * @param laps The ledger's rows, newest first.
   * @param stintId The open stint, or '' with none.
   * @param compounds The compound on each wheel by name, for the baseline.
   */
  rates(
    laps: readonly LedgerLap[],
    stintId: string,
    sessionNum: number | null,
    compounds: readonly (string | null)[]
  ): LedgerRates {
    const ofStint =
      stintId === '' ? [] : cleanLaps(laps, (lap) => lap.stintId === stintId);
    const ofSession = cleanLaps(laps, (lap) => lap.sessionNum === sessionNum);
    const rows = ofStint.length > 0 ? ofStint : ofSession;
    const baseline = this.baseline;

    const tread: (number | null)[] = [];
    const treadSource: (TreadRateSource | null)[] = [];
    for (let wheel = 0; wheel < WHEELS; wheel += 1) {
      const name = compounds[wheel];
      const fitted = medianOf(this.onTyre[wheel]);
      // The session's laps on another set stand in only for the same
      // compound: a fresh soft does not wear as the worn medium did. A lap
      // or a wheel that names no compound is taken as it comes.
      const session =
        fitted !== null
          ? null
          : medianOf(
              readings(
                ofSession
                  .filter((lap) => {
                    const driven = lap.compounds?.[wheel];
                    return !name || !driven || driven === name;
                  })
                  .map((lap) => lap.treadUsed[wheel] ?? null)
              )
            );
      const stored =
        fitted === null && session === null && name
          ? (baseline?.treadByCompound[name]?.[wheel] ?? null)
          : null;
      tread.push(fitted ?? session ?? stored);
      treadSource.push(
        fitted !== null
          ? 'tyre'
          : session !== null
            ? 'session'
            : stored !== null
              ? 'baseline'
              : null
      );
    }

    if (rows.length > 0) {
      return {
        fuel: medianOf(readings(rows.map((lap) => lap.fuelUsed))),
        energy: medianOf(readings(rows.map((lap) => lap.energyUsed))),
        lapTime: medianOf(rows.map((lap) => lap.lapTime)),
        brake: Array.from({ length: WHEELS }, (_, wheel) =>
          medianOf(readings(rows.map((lap) => lap.brakeUsed[wheel] ?? null)))
        ),
        tread,
        treadSource,
        source: ofStint.length > 0 ? 'stint' : 'session',
      };
    }
    if (baseline) {
      return {
        fuel: baseline.fuel,
        energy: baseline.energy,
        lapTime: baseline.lapTime,
        brake: [...baseline.brake],
        tread,
        treadSource,
        source: 'baseline',
      };
    }
    return { ...EMPTY_LEDGER_RATES, tread, treadSource };
  }
}
