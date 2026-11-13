/**
 * What a car has left to run on, as one figure.
 *
 * LMU reports two budgets and which one matters depends on the car. A
 * Hypercar, an LMDh or an LMGT3 is energy-limited: its stint ends when virtual
 * energy runs out, and its fuel figure is not the number that decides the
 * race. An LMP2 or LMP3 is fuel-limited and has no virtual energy at all. A
 * column showing both would be half empty whichever grid it faced, so this
 * picks.
 *
 * Virtual energy where the car has it, fuel otherwise. Both TinyPedal and
 * LMUTraceHUB arrive at the same precedence from the same two fields, which is
 * as close to a settled convention as this sim has.
 *
 * Scales, measured on a recorded ELMS session rather than assumed:
 *
 * - `mVirtualEnergy` is a fraction of the stint's budget: the LMGT3 in the
 *   recording read 0.45 with 44.9 of 120 litres aboard, and fell with every
 *   lap. The LMP2 and LMP3 in the same grid read exactly 0 throughout.
 * - `mFuelFraction` is the tank fraction over 255: the same car's byte read
 *   95, and 95 / 255 is the 0.37 its litres give.
 *
 * So both are normalised to 0..1 here and the renderer never has to convert,
 * only to know which of the two it was given.
 */

/** A car with neither budget readable. Distinct from an empty tank. */
export const ENERGY_UNAVAILABLE = -1;

/** The divisor the sim quantises `mFuelFraction` by. */
const FUEL_FRACTION_SCALE = 255;

const asFraction = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 1)
    : undefined;

/** Fuel from the raw byte, or undefined when there is no usable reading. */
export const lmuFuelFraction = (
  raw: number | undefined
): number | undefined => {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return undefined;
  }
  return Math.min(raw / FUEL_FRACTION_SCALE, 1);
};

/**
 * Which cars have been seen running on virtual energy, and what each last
 * read.
 *
 * A fuel-limited car reports a virtual energy of 0 rather than nothing, so 0
 * on its own cannot say "this car has run out": it is also what every LMP2
 * reads all race. Having once seen a car above 0 settles it. Without that
 * memory a Hypercar drained to exactly 0 was handed its fuel figure instead,
 * and showed a healthy percentage at the one moment the number mattered.
 *
 * Owned by the caller, because it has to outlive a frame, and reset by it when
 * the session changes: car slots are reused between sessions.
 */
export interface LmuEnergyState {
  usesVirtualEnergy: boolean[];
  lastVirtualEnergy: number[];
}

export const createLmuEnergyState = (): LmuEnergyState => ({
  usesVirtualEnergy: [],
  lastVirtualEnergy: [],
});

export const resetLmuEnergyState = (state: LmuEnergyState): void => {
  state.usesVirtualEnergy.length = 0;
  state.lastVirtualEnergy.length = 0;
};

export interface LmuEnergyReading {
  /** 0..1, or ENERGY_UNAVAILABLE when neither budget reads. */
  remaining: number;
  /** True when `remaining` is virtual energy, false when it is fuel. */
  isVirtual: boolean;
}

/**
 * One car's remaining budget and which budget it is.
 *
 * Without a state this is a pure function of the two fields, and a car at
 * exactly 0 virtual energy is taken for a fuel-limited one, as it always was.
 * With one, a car once seen above 0 stays an energy car: 0 then reads as 0,
 * and a frame with no telemetry block for it (the sim writes -1) holds its
 * last reading rather than flipping to fuel and back.
 */
export const lmuEnergyReading = (
  fuelRaw: number | undefined,
  virtualEnergy: number | undefined,
  state?: LmuEnergyState,
  carIdx = 0
): LmuEnergyReading => {
  const energy = asFraction(virtualEnergy);
  if (energy !== undefined && energy > 0) {
    if (state) {
      state.usesVirtualEnergy[carIdx] = true;
      state.lastVirtualEnergy[carIdx] = energy;
    }
    return { remaining: energy, isVirtual: true };
  }
  if (state?.usesVirtualEnergy[carIdx]) {
    // Known to run on energy. A real 0 is an empty budget; no reading at all
    // is a dropped frame, and the last value is the best there is.
    const held = energy ?? state.lastVirtualEnergy[carIdx] ?? 0;
    state.lastVirtualEnergy[carIdx] = held;
    return { remaining: held, isVirtual: true };
  }
  const fuel = lmuFuelFraction(fuelRaw);
  if (fuel !== undefined && fuel > 0) {
    return { remaining: fuel, isVirtual: false };
  }
  return { remaining: ENERGY_UNAVAILABLE, isVirtual: false };
};

/**
 * One car's remaining budget, or the unavailable sentinel.
 *
 * The stateless reading: kept for callers that only want the figure.
 */
export const lmuEnergyRemaining = (
  fuelRaw: number | undefined,
  virtualEnergy: number | undefined
): number => lmuEnergyReading(fuelRaw, virtualEnergy).remaining;

export interface LmuEnergyChannels {
  /** Per car slot: 0..1, or ENERGY_UNAVAILABLE. */
  remaining: number[];
  /** Per car slot: whether that figure is virtual energy rather than fuel. */
  isVirtual: boolean[];
}

/**
 * The two per-car channels, one entry per slot.
 *
 * Sized from whichever array is longer, so a slot present in one and not the
 * other still gets a reading rather than being dropped.
 */
export const lmuEnergyChannels = (
  fuel: ArrayLike<number> | undefined,
  virtualEnergy: ArrayLike<number> | undefined,
  state?: LmuEnergyState
): LmuEnergyChannels => {
  const cars = Math.max(fuel?.length ?? 0, virtualEnergy?.length ?? 0);
  const remaining = new Array<number>(cars);
  const isVirtual = new Array<boolean>(cars);
  for (let carIdx = 0; carIdx < cars; carIdx += 1) {
    const reading = lmuEnergyReading(
      fuel?.[carIdx],
      virtualEnergy?.[carIdx],
      state,
      carIdx
    );
    remaining[carIdx] = reading.remaining;
    isVirtual[carIdx] = reading.isVirtual;
  }
  return { remaining, isVirtual };
};
