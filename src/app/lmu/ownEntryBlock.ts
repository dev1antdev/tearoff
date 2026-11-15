import { lmuPlayerSlot } from './aiControl';

/**
 * The telemetry block of the user's own entry while somebody else drives it.
 *
 * The pedals, the steering, the gear, the revs, the brake temperatures, the
 * tyre wear and the fuel in litres exist nowhere but in a car's telemetry
 * block, and the addon reads the block of the player's vehicle. With a
 * team-mate at the wheel the sim names no player vehicle, so those fields
 * were absent and every widget made of them had nothing to show. The sim
 * writes a block for every car, though, and the addon can be asked for the
 * one in a given slot. This module holds the three rules that go with that:
 *
 * 1. **Which block is asked for** (`lmuBlockSlotToRead`): the own entry's,
 *    and only while the sim names no player vehicle. Never the car the
 *    camera is on. The single-car keys describe the own entry and nothing
 *    else; a rival's pedals under those keys would be mixed with the team
 *    car's lap and fuel by everything that reads them together.
 * 2. **What is taken from it** (`lmuPublishedBlock`): a block the user is
 *    not driving is not the block of the player's car with another name on
 *    it. On the recorded race every AI car's block carries speed, gear,
 *    revs, the rev limit, the pedals, the steering, the fuel and its
 *    capacity, the brake temperatures and the tyre wear, and carries zeros
 *    for the tyre temperatures and pressures, the brake pressures, the water
 *    and oil temperatures, the dials with their maxima, the ABS and traction
 *    control lights, camber and toe. So the fields the sim is known to write
 *    are passed on and every other one is dropped, which leaves its frame
 *    key absent: a zero there would read as a cold tyre, a flat one or a
 *    dial switched off.
 * 3. **What is not known**: what LMU sends for a car a person is driving
 *    on another machine. Reports say fuel is withheld online and wear reads
 *    100 %. Until a recording of a real driver change shows otherwise, fuel
 *    and wear are passed on only for a car simulated on this machine, which
 *    scoring's control state says: the user's own car handed to the AI is
 *    one, a team-mate's stint online is not. Whether the sim fills in the
 *    pedals and the revs of such a car is not known either; a block it has
 *    not filled in is recognised by its rev limit, and nothing is taken from
 *    it.
 *
 * `IsOnTrack` is not touched by any of this. It stays "the user is at the
 * wheel", which is what keeps a lap driven by a team-mate from being stored
 * as the user's own.
 */

type Raw = import('./native').LmuRawTelemetry;
type Frame = Record<string, { value: unknown[] }>;

/**
 * The slot whose telemetry block the next read should ask the addon for, or
 * undefined for the player's own, which is what a read with no argument
 * gives.
 *
 * `playerHasVehicle` is the sim's word on the snapshot the frame is built
 * from. The caller knows it only once that snapshot is read, so it asks by
 * what the last one said and reads again when the answer turns out to have
 * changed.
 */
export const lmuBlockSlotToRead = (
  playerHasVehicle: boolean,
  ownEntrySlot: number
): number | undefined =>
  !playerHasVehicle && Number.isInteger(ownEntrySlot) && ownEntrySlot >= 0
    ? ownEntrySlot
    : undefined;

/**
 * The fields a snapshot carries with or without a car: the session, the
 * weather, the sim's word on the player, and on a session read the grid.
 * With the per-car arrays, which all begin `veh` and a capital, they are
 * everything the addon writes outside its single-car branch.
 *
 * Pinned against the addon itself in native/lmu-tape-block.spec.ts: a read
 * that asks for an empty slot comes back with exactly these.
 */
const SESSION_FIELDS: ReadonlySet<string> = new Set([
  'running',
  'gameVersion',
  'sessionStartEvents',
  'sessionEndEvents',
  'scoringUpdates',
  'trackName',
  'playerName',
  'serverName',
  'session',
  'currentET',
  'endET',
  'maxLaps',
  'lapDist',
  'numVehicles',
  'gamePhase',
  'yellowFlagState',
  'sectorFlags',
  'inRealtime',
  'gameMode',
  'isFixedSetup',
  'maxPlayers',
  'sessionTimeRemaining',
  'timeOfDay',
  'trackGripLevel',
  'trackLimitsStepsPerPoint',
  'trackLimitsStepsPerPenalty',
  'cloudCoverage',
  'raining',
  'darkCloud',
  'ambientTemp',
  'trackTemp',
  'minPathWetness',
  'maxPathWetness',
  'avgPathWetness',
  'wind',
  'startLight',
  'numRedLights',
  'ffbTorque',
  'playerVehicleIdx',
  'playerHasVehicle',
  'activeVehicles',
  'blockSlot',
  'classes',
  'drivers',
]);

const isPerCarArray = (key: string): boolean => /^veh[A-Z]/.test(key);

/**
 * What is passed on from the block of a car the user is not driving,
 * whoever is: the pedals as pressed and as the car received them, the
 * steering and the two ranges it is scaled by, the gear and how many there
 * are, the revs and the rev limit the shift lights are worked out from, the
 * speed and the brake temperatures.
 */
const CAR_FIELDS = [
  'gear',
  'maxGears',
  'engineRPM',
  'engineMaxRPM',
  'unfilteredThrottle',
  'unfilteredBrake',
  'unfilteredClutch',
  'unfilteredSteering',
  'filteredThrottle',
  'filteredBrake',
  'filteredClutch',
  'filteredSteering',
  'visualSteeringWheelRange',
  'physicalSteeringWheelRange',
  'speed',
  'brakeTemperatureRaw',
] as const satisfies readonly (keyof Raw)[];

/** scoring's mControl for a car driven on this machine: by the player, by the AI. */
const LMU_CONTROL_PLAYER = 0;
const LMU_CONTROL_AI = 1;

const positive = (value: number | undefined): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Whether any entry of a per-wheel array reads above zero. */
const hasPositive = (values: Iterable<number> | undefined): boolean => {
  if (!values) return false;
  for (const value of values) {
    if (positive(value)) return true;
  }
  return false;
};

/**
 * Whether a slot holds a car on this snapshot. The lap fraction is the one
 * per-car array the addon fills with -1, so an empty slot reads below 0.
 */
const isOccupied = (raw: Raw, slot: number): boolean =>
  (raw.vehLapDistPct?.[slot] ?? -1) >= 0;

/**
 * Whether the car in a slot is simulated on this machine: driven by the
 * player here or by the AI here. Not a car somebody is driving on another
 * machine, nor a replay, nor one whose control the snapshot does not state.
 */
const isSimulatedHere = (raw: Raw, slot: number): boolean => {
  const control = raw.vehControl?.[slot];
  return control === LMU_CONTROL_PLAYER || control === LMU_CONTROL_AI;
};

/**
 * Whether a snapshot's single-car fields are the own entry's telemetry
 * block, read in place of a player vehicle the sim does not name.
 *
 * True only of a snapshot `lmuPublishedBlock` has been through: of one
 * straight from the addon it says no more than that a block was read for
 * some slot.
 */
export const lmuHasOwnEntryBlock = (raw: Raw): boolean =>
  lmuPlayerSlot(raw) < 0 &&
  typeof raw.blockSlot === 'number' &&
  raw.blockSlot >= 0;

/**
 * A snapshot as the mappers read it: unchanged where its single-car fields
 * are the player's own or absent, and otherwise holding only what may be
 * published from them.
 *
 * - The block of the own entry, with no player vehicle: the fields the sim
 *   is known to write for a car the user is not driving, and nothing else.
 *   Fuel, with its capacity, only for a car simulated on this machine whose
 *   block states a capacity; wear only for such a car whose block states
 *   any. A block whose rev limit is not set is one the sim has not filled
 *   in, and nothing is taken from it: an engine has a rev limit, so a zero
 *   there is an unwritten struct, and its pedals and revs would be zeros of
 *   the same kind.
 * - A block that is neither the player's nor the own entry's: nothing. The
 *   caller never asks for one; if one arrives it is not published under
 *   the own entry's keys.
 *
 * `ownEntrySlot` is the slot the caller resolved, -1 for none. It was
 * resolved on a session snapshot, up to half a second ago, so the slot has
 * to hold a car on this one, as for the keys built from the per-car arrays
 * (see ownEntryKeys.ts).
 */
export const lmuPublishedBlock = <T extends Raw>(
  raw: T,
  ownEntrySlot: number
): T => {
  const blockSlot = raw.blockSlot;
  // An addon from before a block could be asked for, or no block at all.
  if (typeof blockSlot !== 'number' || blockSlot < 0) return raw;
  const playerSlot = lmuPlayerSlot(raw);
  if (playerSlot >= 0 && blockSlot === playerSlot) return raw;

  const source = raw as unknown as Record<string, unknown>;
  const published: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (SESSION_FIELDS.has(key) || isPerCarArray(key)) {
      published[key] = source[key];
    }
  }
  published.blockSlot = -1;

  const isOwnEntry =
    playerSlot < 0 && blockSlot === ownEntrySlot && isOccupied(raw, blockSlot);
  if (!isOwnEntry || !positive(raw.engineMaxRPM)) return published as T;

  published.blockSlot = blockSlot;
  for (const field of CAR_FIELDS) {
    if (source[field] !== undefined) published[field] = source[field];
  }
  if (isSimulatedHere(raw, blockSlot)) {
    if (typeof raw.fuel === 'number' && positive(raw.fuelCapacity)) {
      published.fuel = raw.fuel;
      published.fuelCapacity = raw.fuelCapacity;
    }
    if (hasPositive(raw.tyreWear)) published.tyreWear = raw.tyreWear;
  }
  return published as T;
};

/**
 * Finishes a frame built from the own entry's telemetry block: says so, and
 * takes out the keys the mapper fills with a zero or a false where the sim
 * wrote nothing for the car.
 *
 * `raw` is the snapshot the frame was built from, after `lmuPublishedBlock`.
 * A frame built from the player's own block, or from none, is left exactly
 * as it was.
 */
export function writeLmuOwnEntryBlockKeys(frame: Frame, raw: Raw): void {
  if (!lmuHasOwnEntryBlock(raw)) return;

  // What tells a widget made of these keys that they are live for the car
  // being watched, and not the zeros of a car with no block.
  frame.LmuOwnEntryTelemetry = { value: [true] };
  // The sim writes neither temperature for a car the user is not in, nor
  // whether its ABS is cutting in.
  delete frame.WaterTemp;
  delete frame.OilTemp;
  delete frame.BrakeABSactive;
  // A fraction of a tank nothing states the size of, or of fuel nothing
  // states at all.
  if (raw.fuel === undefined) delete frame.FuelLevelPct;
}

/**
 * What a read that asked for the own entry's block came back with, as one
 * number that is cheap to compare on every frame: -1 when no block was
 * asked for, and otherwise a different number for each slot, for each of
 * "no block", "a block the sim has not filled in" and "a block", and for
 * each control state of the car. The caller logs `describeLmuOwnEntryBlock`
 * when it changes.
 *
 * `raw` is the snapshot as the addon returned it and `askedSlot` the slot
 * the read asked for, undefined for none.
 */
export const lmuOwnEntryBlockStatus = (
  raw: Raw,
  askedSlot: number | undefined
): number => {
  if (askedSlot === undefined) return -1;
  const kind =
    raw.blockSlot !== askedSlot ? 0 : positive(raw.engineMaxRPM) ? 2 : 1;
  const control = raw.vehControl?.[askedSlot];
  const controlCode =
    typeof control === 'number' && control >= 0 && control < 4 ? control : 4;
  return (askedSlot * 3 + kind) * 5 + controlCode;
};

const fixed = (value: number | undefined, decimals: number): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(decimals)
    : 'none';

const perWheel = (
  values: ArrayLike<number> | undefined,
  decimals: number
): string =>
  values && values.length > 0
    ? Array.from(values, (value) => fixed(value, decimals)).join(' ')
    : 'none';

const CONTROL_DESCRIPTIONS = [
  'the player here',
  'the AI here',
  'another machine',
  'a replay',
];

/**
 * One line for the log about the own entry's telemetry block while somebody
 * else drives the car: whether the sim sent one, who scoring says is
 * driving, and what the block holds, as the sim wrote it and before
 * anything is left out of it.
 *
 * It is there because nothing else records it, and it is what is not known
 * about a team-mate's stint online: whether the sim fills in the pedals and
 * the revs of a car driven on another machine, and whether the fuel and the
 * wear it gives for one are real. Three of the fields the sim leaves at zero
 * for the AI's cars -- tyre temperature, tyre pressure, water temperature
 * -- and the top of the traction control scale are in the line too, in case
 * it does write them for a team car. Temperatures are in the sim's Kelvin.
 */
export const describeLmuOwnEntryBlock = (
  raw: Raw,
  askedSlot: number
): string => {
  const control = raw.vehControl?.[askedSlot];
  const driver =
    typeof control === 'number'
      ? `control=${control} (${CONTROL_DESCRIPTIONS[control] ?? 'unknown'})`
      : 'control not stated';
  if (raw.blockSlot !== askedSlot) {
    return (
      `Own entry telemetry block: none for slot ${askedSlot}; ${driver}. ` +
      'The pedals, revs and brakes of the car are not being read'
    );
  }
  return (
    `Own entry telemetry block: slot ${askedSlot}; ${driver}; ` +
    `rev limit ${fixed(raw.engineMaxRPM, 0)}` +
    (positive(raw.engineMaxRPM) ? '' : ' (not filled in, so not read)') +
    `, revs ${fixed(raw.engineRPM, 0)}, gear ${fixed(raw.gear, 0)}, ` +
    `throttle ${fixed(raw.filteredThrottle, 2)}, ` +
    `brake ${fixed(raw.filteredBrake, 2)}, ` +
    `steering ${fixed(raw.filteredSteering, 2)}; ` +
    `fuel ${fixed(raw.fuel, 1)} of ${fixed(raw.fuelCapacity, 1)} L; ` +
    `virtual energy ${fixed(raw.virtualEnergy, 3)}; ` +
    `tyre wear ${perWheel(raw.tyreWear, 3)}; ` +
    `brake temp ${perWheel(raw.brakeTemperatureRaw, 0)}; ` +
    `tyre carcass temp ${perWheel(raw.tyreCarcassTemperatureRaw, 0)}; ` +
    `tyre pressure ${perWheel(raw.tyrePressure, 0)}; ` +
    `water ${fixed(raw.engineWaterTemp, 0)}; TC max ${fixed(raw.tcMax, 0)}`
  );
};
