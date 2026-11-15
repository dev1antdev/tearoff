import { createHeldCell, holdCell } from './heldCell';

/**
 * Where each car is with its pit stop, from the sim's scoring block.
 *
 * iRacing's shape has two things to say about a car and the pits: whether it
 * is on pit road, and a track surface that folds the garage and the pit box
 * into one "in pit stall". LMU says more -- the stop has been asked for, the
 * car is on its way in, it is stationary, it is on its way out; how many
 * stops it has made; whether it is in its garage rather than its box -- and
 * this publishes that as it stands.
 *
 * Scoring writes these for every car on the grid, at 5 Hz, and they move a
 * few times a race: the cells are held between frames and replaced on a
 * change, so a frame allocates nothing for them.
 */

/** The fields of a shared-memory read the pit channels are built from. */
export interface LmuCarPitSource {
  vehPitState?: ArrayLike<number>;
  vehNumPitstops?: ArrayLike<number>;
  vehInGarageStall?: ArrayLike<number>;
  /** Lap fraction per car. Negative marks a slot with no car in it. */
  vehLapDistPct?: ArrayLike<number>;
}

/**
 * What a slot with no car in it reads in the two numeric channels. Not 0:
 * that is a car with no stop asked for, and a car that has made none.
 */
export const LMU_NO_CAR = -1;

type LapDistPcts = ArrayLike<number> | undefined;

/**
 * The addon sizes its arrays to the highest slot id and writes only the cars
 * in scoring, so a gap in the ids keeps the zero it was created with. The lap
 * fraction is the one array it fills with -1, which is what tells a gap from
 * a car.
 */
const hasCar = (lapDistPcts: LapDistPcts, carIdx: number): boolean =>
  (lapDistPcts?.[carIdx] ?? -1) >= 0;

const whereThereIsACar = (
  raw: number,
  carIdx: number,
  lapDistPcts: LapDistPcts
): number => (hasCar(lapDistPcts, carIdx) ? raw : LMU_NO_CAR);

const inGarage = (
  raw: number,
  carIdx: number,
  lapDistPcts: LapDistPcts
): boolean => raw !== 0 && hasCar(lapDistPcts, carIdx);

const heldPitState = createHeldCell<number>();
const heldPitStops = createHeldCell<number>();
const heldInGarage = createHeldCell<boolean>();

/**
 * Writes the per-car pit channels onto a telemetry frame, one entry per slot.
 *
 * - LmuCarIdxPitState: 0 none, 1 stop requested, 2 entering, 3 stopped,
 *   4 exiting; -1 for an empty slot.
 * - LmuCarIdxPitStops: stops made so far; -1 for an empty slot.
 * - LmuCarIdxInGarage: whether the car is in its garage stall, which the
 *   track surface cannot tell from a stop at the box.
 *
 * Each is left out when the read does not carry its source.
 */
export function writeLmuCarPitState(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuCarPitSource
): void {
  const lapDistPcts = raw.vehLapDistPct;
  if (raw.vehPitState) {
    frame.LmuCarIdxPitState = holdCell(
      heldPitState,
      raw.vehPitState,
      raw.vehPitState.length,
      whereThereIsACar,
      lapDistPcts
    );
  }
  if (raw.vehNumPitstops) {
    frame.LmuCarIdxPitStops = holdCell(
      heldPitStops,
      raw.vehNumPitstops,
      raw.vehNumPitstops.length,
      whereThereIsACar,
      lapDistPcts
    );
  }
  if (raw.vehInGarageStall) {
    frame.LmuCarIdxInGarage = holdCell(
      heldInGarage,
      raw.vehInGarageStall,
      raw.vehInGarageStall.length,
      inGarage,
      lapDistPcts
    );
  }
}
