/**
 * The level bookkeeping behind the player's ledger: what a lap cost in fuel,
 * virtual energy, tread, brake disc and battery, and what a pit stop put
 * back.
 *
 * It sees every frame, because a refuel is seconds long and the line is one
 * frame: a lap's fuel is the level at its opening, plus what went in during
 * it, less the level at the line. Wear is the sum of what each reading lost
 * on track, so a tyre or a disc changed in the pits never shows up as wear.
 *
 * Pure: no I/O, no clock of its own, the same figures from the same frames.
 * Its buffers are allocated once per track.
 */

/** Wheels, always in the order LF, RF, LR, RR. */
export const WHEEL_COUNT = 4;

/** Below this the car is standing: what the level does is service. */
const SERVICE_SPEED_MS = 1;
/** A stop's rises count once they total this: litres, and energy fraction. */
const FUEL_RISE_GATE_L = 0.05;
const ENERGY_RISE_GATE = 0.001;
/** A fall faster than this at a standstill in the pits is being taken out. */
const FUEL_DRAIN_L_PER_S = 0.5;
const ENERGY_DRAIN_PER_S = 0.005;
/** Tread rising by more than this in the pits is another tyre. */
const TREAD_CHANGE_RISE = 0.005;
/** Tread falling by more than this in one reading there is a used tyre. */
const TREAD_CHANGE_FALL = 0.01;
/** A disc reading rising by more than this, millimetres, is another disc. */
const BRAKE_CHANGE_RISE_MM = 0.1;
/** Two battery readings further apart than this are not neighbours. */
const BATTERY_MAX_STEP_S = 1;

/** One frame as the meter reads it. Reused by its owner from frame to frame. */
export interface MeterReading {
  sessionTime: number;
  /** Metres per second, or null where the sim gives none. */
  speed: number | null;
  /** On pit road or in the garage. */
  inPits: boolean;
  /** Litres in the tank. */
  fuel: number | null;
  /** Virtual energy, 0..1; null for a car that runs on fuel. */
  energy: number | null;
  /** Tread remaining per wheel, 0..1. */
  tread: (number | null)[];
  /** Disc thickness per wheel, millimetres. */
  brake: (number | null)[];
  /** Compound index per wheel; -1 when unknown. */
  compound: number[];
  /** How many tyres each corner has used, where the sim counts (iRacing). */
  tyresUsed: (number | null)[];
  /** Hybrid battery charge, 0..1; null for a car without one. */
  battery: number | null;
  /** The ten-metre point of the lap under way the car is in, or -1. */
  bucket: number;
  /** A frame the sim has stopped writing, or a pause: nothing is measured. */
  frozen: boolean;
}

export const createMeterReading = (): MeterReading => ({
  sessionTime: 0,
  speed: null,
  inPits: false,
  fuel: null,
  energy: null,
  tread: [null, null, null, null],
  brake: [null, null, null, null],
  compound: [-1, -1, -1, -1],
  tyresUsed: [null, null, null, null],
  battery: null,
  bucket: -1,
  frozen: false,
});

/** What a lap cost, read at the line. */
export interface LapCost {
  fuelAtLine: number | null;
  fuelUsed: number | null;
  fuelAdded: number;
  energyAtLine: number | null;
  energyUsed: number | null;
  energyAdded: number;
  treadAtLine: (number | null)[];
  treadUsed: (number | null)[];
  brakeAtLine: (number | null)[];
  brakeUsed: (number | null)[];
  /** Fuel, energy or tyres changed during the lap. */
  serviced: boolean;
  /** Percentage points of charge; null for a car without a battery. */
  batteryDrainPct: number | null;
  batteryRegenPct: number | null;
}

/** What a pit lane visit did to the car. */
export interface VisitService {
  /** Litres put in; negative when fuel was taken out. */
  fuelAdded: number;
  /** Virtual energy put in, as a fraction of the budget. */
  energyAdded: number;
  /** One bit per wheel changed: LF 1, RF 2, LR 4, RR 8. */
  tyresChanged: number;
  brakesChanged: boolean;
}

/** Cumulative wear along a lap, a point every ten metres, per wheel. */
export interface WearCurves {
  points: number;
  /** `wheel * points + point`: tread worn since the line, 0..1. */
  tread: Float32Array;
  /** The same for the discs, millimetres. */
  brake: Float32Array;
  /** 1 where the point was sampled. */
  sampled: Uint8Array;
}

export interface LapCostMeterOptions {
  /**
   * Whether tread is read live. iRacing refreshes it only in the pits: wear
   * per lap cannot be told there, and a reading that falls in the pits is
   * the refresh, not a used tyre being fitted.
   */
  liveTread: boolean;
}

/** One budget the car runs on: the tank, or virtual energy. */
class Level {
  /** The last reading. */
  current: number | null = null;
  /** The reading at the opening of the lap under way. */
  private lapOpen: number | null = null;
  lapAdded = 0;
  visitAdded = 0;
  /** Rises of this stop not yet over the gate. */
  private pendingRise = 0;
  private gateOpen = false;
  /** When the reading last moved, for the rate of a fall. */
  private movedAt: number | null = null;

  constructor(
    private readonly riseGate: number,
    private readonly drainRate: number
  ) {}

  reset(): void {
    this.current = null;
    this.lapOpen = null;
    this.lapAdded = 0;
    this.visitAdded = 0;
    this.pendingRise = 0;
    this.gateOpen = false;
    this.movedAt = null;
  }

  /** Takes a reading. True when it was fuel or energy going in or out. */
  update(
    level: number | null,
    time: number,
    inPits: boolean,
    standing: boolean
  ): boolean {
    if (!inPits) {
      // Whatever did not reach the gate was noise.
      this.pendingRise = 0;
      this.gateOpen = false;
    }
    if (level === null) {
      this.current = null;
      this.movedAt = null;
      return false;
    }
    const previous = this.current;
    this.current = level;
    if (previous === null || level === previous) {
      if (previous === null) this.movedAt = time;
      return false;
    }
    const delta = level - previous;
    const since = this.movedAt === null ? 0 : time - this.movedAt;
    this.movedAt = time;
    if (!inPits || !standing) return false;
    if (delta > 0) {
      this.pendingRise += delta;
      if (!this.gateOpen && this.pendingRise < this.riseGate) return false;
      this.gateOpen = true;
      this.add(this.pendingRise);
      this.pendingRise = 0;
      return true;
    }
    if (since > 0 && -delta / since > this.drainRate) {
      this.add(delta);
      return true;
    }
    return false;
  }

  openLap(): void {
    this.lapOpen = this.current;
    this.lapAdded = 0;
  }

  closeVisit(): void {
    this.visitAdded = 0;
    this.pendingRise = 0;
    this.gateOpen = false;
  }

  /** Burned on the lap up to the last reading; null without both ends. */
  lapUsed(): number | null {
    if (this.lapOpen === null || this.current === null) return null;
    return this.lapOpen + this.lapAdded - this.current;
  }

  private add(amount: number): void {
    this.lapAdded += amount;
    this.visitAdded += amount;
  }
}

const copyOf = (values: readonly (number | null)[]): (number | null)[] =>
  values.slice(0, WHEEL_COUNT);

export class LapCostMeter {
  private readonly fuel = new Level(FUEL_RISE_GATE_L, FUEL_DRAIN_L_PER_S);
  private readonly energy = new Level(ENERGY_RISE_GATE, ENERGY_DRAIN_PER_S);

  private readonly tread: (number | null)[] = [null, null, null, null];
  private readonly brake: (number | null)[] = [null, null, null, null];
  private readonly compound: number[] = [-1, -1, -1, -1];
  private readonly tyresUsed: (number | null)[] = [null, null, null, null];
  /** Worn on track since the lap opened. */
  private readonly treadUsed = new Float64Array(WHEEL_COUNT);
  private readonly brakeUsed = new Float64Array(WHEEL_COUNT);
  /** Whether each wheel had a reading at the lap's opening. */
  private readonly treadAtOpen: boolean[] = [false, false, false, false];
  private readonly brakeAtOpen: boolean[] = [false, false, false, false];

  private battery: number | null = null;
  private batteryAt: number | null = null;
  private batteryDrain = 0;
  private batteryRegen = 0;
  private hasBattery = false;

  private lapOpen = false;
  private lapServiced = false;
  private visitTyres = 0;
  private visitBrakes = false;
  /** Wheels changed since `takeTyreChanges` was last called. */
  private tyreChanges = 0;

  private points = 0;
  private curve: WearCurves | null = null;
  private reference: WearCurves | null = null;
  private hasReference = false;

  constructor(private readonly options: LapCostMeterOptions) {}

  /** Forgets everything: a new connection, track or car. */
  reset(): void {
    this.fuel.reset();
    this.energy.reset();
    this.tread.fill(null);
    this.brake.fill(null);
    this.compound.fill(-1);
    this.tyresUsed.fill(null);
    this.treadUsed.fill(0);
    this.brakeUsed.fill(0);
    this.treadAtOpen.fill(false);
    this.brakeAtOpen.fill(false);
    this.battery = null;
    this.batteryAt = null;
    this.batteryDrain = 0;
    this.batteryRegen = 0;
    this.hasBattery = false;
    this.lapOpen = false;
    this.lapServiced = false;
    this.visitTyres = 0;
    this.visitBrakes = false;
    this.tyreChanges = 0;
    this.hasReference = false;
  }

  /** Sizes the wear curves for a track: a point every ten metres. */
  setCurvePoints(points: number): void {
    if (points === this.points) return;
    this.points = points;
    const make = (): WearCurves => ({
      points,
      tread: new Float32Array(points * WHEEL_COUNT),
      brake: new Float32Array(points * WHEEL_COUNT),
      sampled: new Uint8Array(points),
    });
    this.curve = points > 0 ? make() : null;
    this.reference = points > 0 ? make() : null;
    this.hasReference = false;
  }

  /** Takes one frame. Called for every frame, lap or no lap. */
  update(reading: MeterReading): void {
    if (reading.frozen) return;
    const standing =
      reading.speed !== null && Math.abs(reading.speed) < SERVICE_SPEED_MS;
    const time = reading.sessionTime;
    const refuelled = this.fuel.update(
      reading.fuel,
      time,
      reading.inPits,
      standing
    );
    const recharged = this.energy.update(
      reading.energy,
      time,
      reading.inPits,
      standing
    );
    if (refuelled || recharged) this.lapServiced = true;

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.updateTread(wheel, reading);
      this.updateBrake(wheel, reading);
    }
    this.updateBattery(reading);
    this.sampleCurve(reading.bucket);
  }

  /** A lap opened: its accounts start from the levels as they stand. */
  openLap(): void {
    this.fuel.openLap();
    this.energy.openLap();
    this.treadUsed.fill(0);
    this.brakeUsed.fill(0);
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.treadAtOpen[wheel] = this.tread[wheel] !== null;
      this.brakeAtOpen[wheel] = this.brake[wheel] !== null;
    }
    this.batteryDrain = 0;
    this.batteryRegen = 0;
    this.lapServiced = false;
    this.lapOpen = true;
    this.curve?.sampled.fill(0);
  }

  /**
   * The lap ended at the line: what it cost.
   *
   * @param keepCurve Whether its wear curve becomes the reference: a lap
   *   that touched no pit road and that the player drove.
   */
  closeLap(keepCurve: boolean): LapCost {
    const live = this.options.liveTread;
    const cost: LapCost = {
      fuelAtLine: this.fuel.current,
      fuelUsed: this.fuel.lapUsed(),
      fuelAdded: this.fuel.lapAdded,
      energyAtLine: this.energy.current,
      energyUsed: this.energy.lapUsed(),
      energyAdded: this.energy.lapAdded,
      treadAtLine: copyOf(this.tread),
      treadUsed: this.tread.map((now, wheel) =>
        live && now !== null && this.treadAtOpen[wheel]
          ? this.treadUsed[wheel]
          : null
      ),
      brakeAtLine: copyOf(this.brake),
      brakeUsed: this.brake.map((now, wheel) =>
        now !== null && this.brakeAtOpen[wheel] ? this.brakeUsed[wheel] : null
      ),
      serviced: this.lapServiced,
      batteryDrainPct: this.hasBattery ? this.batteryDrain * 100 : null,
      batteryRegenPct: this.hasBattery ? this.batteryRegen * 100 : null,
    };
    if (keepCurve && this.curve && this.reference) {
      const kept = this.curve;
      this.curve = this.reference;
      this.reference = kept;
      this.hasReference = true;
    }
    this.lapOpen = false;
    return cost;
  }

  /** The lap under way was given up. */
  abandonLap(): void {
    this.lapOpen = false;
  }

  /** The car went onto pit road: what follows is counted to this visit. */
  beginVisit(): void {
    this.fuel.closeVisit();
    this.energy.closeVisit();
    this.visitTyres = 0;
    this.visitBrakes = false;
  }

  /** What the visit under way has done so far. */
  visit(): VisitService {
    return {
      fuelAdded: this.fuel.visitAdded,
      energyAdded: this.energy.visitAdded,
      tyresChanged: this.visitTyres,
      brakesChanged: this.visitBrakes,
    };
  }

  /** The wheels changed since this was last asked, as bits; then none. */
  takeTyreChanges(): number {
    const changed = this.tyreChanges;
    this.tyreChanges = 0;
    return changed;
  }

  fuelLevel(): number | null {
    return this.fuel.current;
  }

  energyLevel(): number | null {
    return this.energy.current;
  }

  /** Tread remaining per wheel, as last read. A copy. */
  treadLevels(): (number | null)[] {
    return copyOf(this.tread);
  }

  /** Disc thickness per wheel, as last read. A copy. */
  brakeLevels(): (number | null)[] {
    return copyOf(this.brake);
  }

  /** Writes the tread and disc readings into lists the caller keeps. */
  readWheels(tread: (number | null)[], brake: (number | null)[]): void {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      tread[wheel] = this.tread[wheel];
      brake[wheel] = this.brake[wheel];
    }
  }

  /** Compound index per wheel, as last read; -1 when unknown. */
  compoundIndices(): readonly number[] {
    return this.compound;
  }

  /** Burned so far on the lap under way; null without one, or a reading. */
  lapFuelUsed(): number | null {
    return this.lapOpen ? this.fuel.lapUsed() : null;
  }

  lapEnergyUsed(): number | null {
    return this.lapOpen ? this.energy.lapUsed() : null;
  }

  /** Fuel, energy or tyres have changed during the lap under way. */
  lapWasServiced(): boolean {
    return this.lapOpen && this.lapServiced;
  }

  /** Tread worn so far on the lap under way, per wheel. Not a copy. */
  lapTreadUsed(): Float64Array {
    return this.treadUsed;
  }

  /** Disc worn so far on the lap under way, per wheel. Not a copy. */
  lapBrakeUsed(): Float64Array {
    return this.brakeUsed;
  }

  /**
   * The wear curve of the last lap that touched no pit road and that the
   * player drove, or null before there is one.
   */
  referenceCurves(): WearCurves | null {
    return this.hasReference ? this.reference : null;
  }

  private updateTread(wheel: number, reading: MeterReading): void {
    const now = reading.tread[wheel];
    const before = this.tread[wheel];
    if (now !== null) {
      if (before !== null) {
        const delta = now - before;
        if (reading.inPits) {
          if (
            delta > TREAD_CHANGE_RISE ||
            (this.options.liveTread && delta < -TREAD_CHANGE_FALL)
          ) {
            this.markTyre(wheel);
          }
        } else if (delta < 0) {
          this.treadUsed[wheel] -= delta;
        }
      }
      this.tread[wheel] = now;
    }

    const compound = reading.compound[wheel];
    if (compound >= 0) {
      const fitted = this.compound[wheel];
      if (fitted >= 0 && fitted !== compound && reading.inPits) {
        this.markTyre(wheel);
      }
      this.compound[wheel] = compound;
    }

    const used = reading.tyresUsed[wheel];
    if (used !== null) {
      const counted = this.tyresUsed[wheel];
      if (counted !== null && used > counted && reading.inPits) {
        this.markTyre(wheel);
      }
      this.tyresUsed[wheel] = used;
    }
  }

  private updateBrake(wheel: number, reading: MeterReading): void {
    const now = reading.brake[wheel];
    if (now === null) return;
    const before = this.brake[wheel];
    if (before !== null) {
      const delta = now - before;
      if (reading.inPits) {
        if (delta > BRAKE_CHANGE_RISE_MM) this.visitBrakes = true;
      } else if (delta < 0) {
        this.brakeUsed[wheel] -= delta;
      }
    }
    this.brake[wheel] = now;
  }

  /**
   * Battery spent and recovered, by TinyPedal's rule: every fall is drain
   * and every rise is regeneration, except a step from a reading of exactly
   * 0, a fall that lands on 0 and a rise that lands on full, which are the
   * sim resetting the figure rather than the car using it.
   */
  private updateBattery(reading: MeterReading): void {
    const now = reading.battery;
    if (now === null) {
      this.battery = null;
      this.batteryAt = null;
      return;
    }
    this.hasBattery = true;
    const before = this.battery;
    const elapsed =
      this.batteryAt === null ? 0 : reading.sessionTime - this.batteryAt;
    this.battery = now;
    this.batteryAt = reading.sessionTime;
    if (before === null || before === 0) return;
    if (!(elapsed > 0) || elapsed > BATTERY_MAX_STEP_S) return;
    if (now < before && now !== 0) this.batteryDrain += before - now;
    else if (now > before && now < 1) this.batteryRegen += now - before;
  }

  private markTyre(wheel: number): void {
    const bit = 1 << wheel;
    this.visitTyres |= bit;
    this.tyreChanges |= bit;
    this.lapServiced = true;
  }

  private sampleCurve(bucket: number): void {
    const curve = this.curve;
    if (!this.lapOpen || !curve || bucket < 0 || bucket >= curve.points) {
      return;
    }
    if (curve.sampled[bucket] === 1) return;
    curve.sampled[bucket] = 1;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const index = wheel * curve.points + bucket;
      curve.tread[index] = this.treadUsed[wheel];
      curve.brake[index] = this.brakeUsed[wheel];
    }
  }
}
