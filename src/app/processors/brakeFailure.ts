import type { BrakeFailureSource } from '@irdashies/types';

/**
 * Where a brake disc is finished, and how a failed one is told.
 *
 * Le Mans Ultimate states no failure thickness. It comes, in this order,
 * from the driver's setting, from a thickness a disc of this car was seen to
 * stop wearing at, and from a figure for the class. The class figures are
 * the ones TinyPedal ships; no failure has been recorded under Le Mans
 * Ultimate, so they are a starting point and not a measurement.
 *
 * A failed disc is told by its thickness no longer falling while the car is
 * braked at speed. The thickness comes from the sim's REST API, which can
 * stop answering, and a reading that is not refreshed looks exactly like a
 * disc that has stopped wearing: so time is counted only between answers
 * that arrived.
 */

/** Brake pedal above which a disc is expected to wear. */
export const FAILURE_PEDAL = 0.2;
/** Metres per second above which the wheels are taken to be turning. */
export const FAILURE_SPEED_MS = 5;
/** Seconds of braking on an unchanged disc after which it has failed. */
export const FAILURE_SECONDS = 3;
/** A disc thinner than this, millimetres, did not fail by wearing out. */
const PLAUSIBLE_MIN_MM = 5;
/** Nor did one that still has more than this share of a new disc. */
const PLAUSIBLE_MAX_SHARE = 0.95;
/**
 * A disc seen this far, millimetres, below a learned failure thickness and
 * still wearing shows that the thickness was not one.
 */
export const DISPROVED_BY_MM = 0.05;

const WHEELS = 4;

/** Failure thickness by class, millimetres. */
const CLASS_FAILURE_MM: readonly (readonly [string, number])[] = [
  ['HYPERCAR', 25],
  ['LMP2', 25],
  ['LMGT3', 30],
  ['GT3', 30],
  ['LMGTE', 30],
  ['GTE', 30],
];

/** An abbreviation shorter than this names no class: "LMP" is two of them. */
const ABBREVIATION_MIN_LENGTH = 5;

/**
 * The failure thickness for a class, or null for one without a figure.
 *
 * The session names the class canonically ("Hypercar", "LMGT3"), but the
 * sim's own spellings are taken as well: longer than the class ("LMP2_ELMS")
 * or an abbreviation of it ("Hyper").
 */
export const classBrakeFailureMm = (
  className: string | null | undefined
): number | null => {
  const key = (className ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let longest = 0;
  let found: number | null = null;
  for (const [name, mm] of CLASS_FAILURE_MM) {
    if (key.startsWith(name) && name.length > longest) {
      longest = name.length;
      found = mm;
    }
  }
  if (found !== null || key.length < ABBREVIATION_MIN_LENGTH) return found;
  const abbreviated = new Set(
    CLASS_FAILURE_MM.filter(([name]) => name.startsWith(key)).map(
      ([, mm]) => mm
    )
  );
  return abbreviated.size === 1 ? [...abbreviated][0] : null;
};

/**
 * Whether a disc that stopped wearing at `mm` can have failed there: at
 * least 5 mm thick, and worn to 95 percent of a new one or less. A disc that
 * is all but new has not worn out, whatever its reading does.
 */
export const isPlausibleFailure = (mm: number, newMm: number | null): boolean =>
  mm >= PLAUSIBLE_MIN_MM && newMm !== null && mm <= PLAUSIBLE_MAX_SHARE * newMm;

export interface BrakeFailureThickness {
  mm: number | null;
  source: BrakeFailureSource | null;
}

/**
 * The failure thickness in use for an axle: the setting when above 0, else
 * what was learned, else the class figure, else none.
 *
 * @param newMm Thickness of a new disc. A learned or class figure that is
 *   not below it cannot be this disc's and is passed over; the setting is
 *   the driver's word and is taken as it is.
 */
export const resolveBrakeFailure = (
  setting: number,
  learned: number | null | undefined,
  classMm: number | null,
  newMm: number | null = null
): BrakeFailureThickness => {
  if (Number.isFinite(setting) && setting > 0) {
    return { mm: setting, source: 'setting' };
  }
  const fits = (mm: number) => newMm === null || mm < newMm;
  if (
    typeof learned === 'number' &&
    Number.isFinite(learned) &&
    learned >= PLAUSIBLE_MIN_MM &&
    fits(learned)
  ) {
    return { mm: learned, source: 'learned' };
  }
  if (classMm !== null && fits(classMm)) {
    return { mm: classMm, source: 'class' };
  }
  return { mm: null, source: null };
};

/**
 * Watches each disc for the sign of a failure: braked at speed for three
 * seconds with its thickness unchanged, counted from one answer of the REST
 * API to a later one. No answer, no time: a reading that has gone stale
 * never fails a brake.
 *
 * Pure and allocation-free per frame.
 */
export class BrakeFailureWatch {
  /** The thickness each disc last read; NaN before a reading. */
  private readonly thickness = new Float64Array(WHEELS).fill(Number.NaN);
  /** When the first answer of the unchanged run arrived; NaN before one. */
  private readonly firstAnswerAt = new Float64Array(WHEELS).fill(Number.NaN);
  /** The thickness each disc was judged failed at; NaN while it is sound. */
  private readonly stopped = new Float64Array(WHEELS).fill(Number.NaN);
  private seq: number | null = null;

  reset(): void {
    this.thickness.fill(Number.NaN);
    this.firstAnswerAt.fill(Number.NaN);
    this.stopped.fill(Number.NaN);
    this.seq = null;
  }

  /** Another disc on this wheel, or a failure that was not one. */
  clearWheel(wheel: number): void {
    this.firstAnswerAt[wheel] = Number.NaN;
    this.stopped[wheel] = Number.NaN;
  }

  /** The thickness a disc was judged failed at, or null while it is sound. */
  stoppedAt(wheel: number): number | null {
    const mm = this.stopped[wheel];
    return Number.isNaN(mm) ? null : mm;
  }

  /**
   * Takes one frame.
   *
   * @param seq The REST answer counter of the frame (LmuRestWearablesSeq),
   *   or null when the frame carries none.
   * @param braking The pedal is down and the car is moving.
   * @returns The wheels judged failed on this frame, one bit each.
   */
  update(
    time: number,
    thickness: readonly (number | null)[],
    seq: number | null,
    braking: boolean
  ): number {
    const answered = seq !== null && this.seq !== null && seq !== this.seq;
    this.seq = seq;
    let fired = 0;
    for (let wheel = 0; wheel < WHEELS; wheel += 1) {
      const now = thickness[wheel];
      if (now === null) {
        this.thickness[wheel] = Number.NaN;
        this.firstAnswerAt[wheel] = Number.NaN;
        continue;
      }
      if (now !== this.thickness[wheel]) {
        // Still wearing, or another disc: whatever it was judged, it is
        // not standing still.
        this.thickness[wheel] = now;
        this.firstAnswerAt[wheel] = Number.NaN;
        this.stopped[wheel] = Number.NaN;
        continue;
      }
      const since = this.firstAnswerAt[wheel];
      if (!braking || time < since) {
        this.firstAnswerAt[wheel] = Number.NaN;
        continue;
      }
      if (!answered) continue;
      if (Number.isNaN(since)) {
        this.firstAnswerAt[wheel] = time;
      } else if (
        time - since >= FAILURE_SECONDS &&
        Number.isNaN(this.stopped[wheel])
      ) {
        this.stopped[wheel] = now;
        fired |= 1 << wheel;
      }
    }
    return fired;
  }
}
