import { LMU_DIAL_KEYS } from '@irdashies/types';

/** The fields of a shared-memory read the dials are built from. */
export interface LmuDialSource {
  abs?: number;
  absMax?: number;
  tc?: number;
  tcMax?: number;
  tcSlip?: number;
  tcSlipMax?: number;
  tcCut?: number;
  tcCutMax?: number;
  migration?: number;
  migrationMax?: number;
  motorMap?: number;
  motorMapMax?: number;
  frontAntiSway?: number;
  frontAntiSwayMax?: number;
  rearAntiSway?: number;
  rearAntiSwayMax?: number;
  wiperState?: number;
  tcActive?: boolean | number;
}

type DialField = Exclude<keyof LmuDialSource, 'wiperState' | 'tcActive'>;

/**
 * Where each dial's position and the top of its scale are read from.
 *
 * Keyed by frame key, so a dial added to LMU_DIAL_KEYS without a source here
 * does not compile.
 */
const DIAL_SOURCES: Readonly<
  Record<(typeof LMU_DIAL_KEYS)[number], readonly [DialField, DialField]>
> = {
  dcABS: ['abs', 'absMax'],
  dcTractionControl: ['tc', 'tcMax'],
  LmuTcSlip: ['tcSlip', 'tcSlipMax'],
  LmuTcCut: ['tcCut', 'tcCutMax'],
  LmuBrakeMigration: ['migration', 'migrationMax'],
  LmuMotorMap: ['motorMap', 'motorMapMax'],
  dcAntiRollFront: ['frontAntiSway', 'frontAntiSwayMax'],
  dcAntiRollRear: ['rearAntiSway', 'rearAntiSwayMax'],
};

/**
 * The maxima as last published. Held across frames so that a frame allocates
 * nothing for them: they are fixed per car, and the cell is replaced only
 * when one of them changes.
 */
let heldMaxima: { value: number[] } | undefined;

/**
 * Writes the player's driver-adjustable dials onto a telemetry frame.
 *
 * LMU publishes each as a position plus the top of its own scale, and a car
 * without the control reports 0 for both, so the maximum is the only thing
 * that separates "ABS turned off" from "no ABS fitted". A dial is published
 * only when its maximum is above 0, because CarSystemsProcessor discovers
 * rows by which keys a frame carries and keeps them for the session:
 * publishing a flat 0 would give every car a row for every control, each
 * reading "off".
 *
 * Every dial has a key of its own. The three traction dials used to be
 * packed in order into iRacing's two generic slots, so a car's slip dial was
 * shown as Traction Control on one car and Traction Control 2 on another,
 * and the third dial was dropped: on the recorded LMGT3, which has all
 * three, that was the power cut. The level is dcTractionControl and nothing
 * else is; slip, cut, brake migration and the map are LMU's own keys.
 *
 * With no player car the sim writes none of this and nothing is published.
 */
export function writeLmuDials(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuDialSource
): void {
  let hasCar = false;
  let maximaMoved = heldMaxima === undefined;
  for (let index = 0; index < LMU_DIAL_KEYS.length; index += 1) {
    const key = LMU_DIAL_KEYS[index];
    const [valueField, maxField] = DIAL_SOURCES[key];
    const max = raw[maxField];
    if (max !== undefined) hasCar = true;
    const top = max ?? 0;
    if (heldMaxima?.value[index] !== top) maximaMoved = true;
    if (top > 0) frame[key] = { value: [raw[valueField] ?? 0] };
  }

  if (hasCar) {
    if (maximaMoved) {
      heldMaxima = {
        value: LMU_DIAL_KEYS.map((key) => raw[DIAL_SOURCES[key][1]] ?? 0),
      };
    }
    if (heldMaxima) frame.LmuDialMax = heldMaxima;
  }

  // Not a dial with a scale: a mode, published whenever the sim states one.
  if (raw.wiperState !== undefined) {
    frame.LmuWiper = { value: [raw.wiperState] };
  }
  // The light that goes with the traction dials. The brake's is
  // BrakeABSactive, which iRacing has too.
  if (raw.tcActive !== undefined) {
    frame.LmuTcActive = { value: [Boolean(raw.tcActive)] };
  }
}
