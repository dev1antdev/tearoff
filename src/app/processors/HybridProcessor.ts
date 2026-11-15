import type {
  HybridMotorReadings,
  HybridSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { parseTrackLength } from './RadarProcessor';
import { HybridLapAccount } from './hybrid/hybridLap';

type Cell = { value?: unknown[] } | undefined;

const cell = (frame: Telemetry, key: string): Cell =>
  (frame as Record<string, Cell>)[key];

const number = (frame: Telemetry, key: string): number | undefined => {
  const value = cell(frame, key)?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const boolean = (frame: Telemetry, key: string): boolean =>
  cell(frame, key)?.value?.[0] === true;

/**
 * Rounds to the precision the widget shows. A snapshot is only republished
 * when a rounded value moves, so a battery sitting still wakes nobody.
 */
const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  // Adding 0 turns the -0 a small negative rounds to into 0.
  return Math.round(value * scale) / scale + 0;
};

const rounded = (value: number | undefined | null, decimals: number) =>
  value === undefined || value === null ? null : round(value, decimals);

const CHARGE_DECIMALS = 2;
const SECONDS_DECIMALS = 1;
const MOTOR_DECIMALS = 1;
const STATE_OF_CHARGE_DECIMALS = 3;

/** The lap clock is only carried this far: see HybridSnapshot.lapElapsedS. */
const LAP_ELAPSED_CAP_S = 30;

/** Kilowatts from newton metres times revolutions per minute. */
const KW_PER_NM_RPM = 1 / 9549.3;

/**
 * Above this a motor temperature is taken to be Kelvin. A motor at rest
 * reads 20 to 40 if the sim writes Celsius and about 300 if it writes
 * Kelvin, and none runs at 200 C, so the rule is right either way. To be
 * replaced by a fixed one as soon as a recording of a hybrid car shows
 * which the sim writes.
 */
const KELVIN_ABOVE = 200;
const KELVIN_OFFSET = 273.15;

/** A motor temperature in Celsius, or null where the sim wrote none. */
export const hybridTemperatureC = (raw: number | undefined): number | null => {
  // Exactly 0 is what the sim leaves in a field it does not fill: a unit
  // with no coolant circuit, for one.
  if (raw === undefined || raw === 0) return null;
  return round(raw > KELVIN_ABOVE ? raw - KELVIN_OFFSET : raw, MOTOR_DECIMALS);
};

/** Power at the motor in kilowatts; 0 while it is not driving the car. */
export const hybridPowerKw = (
  torqueNm: number | undefined,
  rpm: number | undefined
): number | null => {
  if (torqueNm === undefined || rpm === undefined) return null;
  return torqueNm > 0
    ? round(torqueNm * rpm * KW_PER_NM_RPM, MOTOR_DECIMALS)
    : 0;
};

const blankMotor = (): HybridMotorReadings => ({
  torqueNm: null,
  rpm: null,
  powerKw: null,
  motorTempC: null,
  coolantTempC: null,
  regenKw: null,
});

/**
 * Publishes the hybrid battery and motor of the player's car.
 *
 * Whether the car has the system at all is read from the car, never from a
 * table of classes: `available` latches on the first frame from inside the
 * car that shows a motor state other than 0, or a charge above 0 that has
 * moved. Until then nothing is written and the version does not move, so a
 * GT3 or an LMP2 publishes one blank snapshot and no more.
 *
 * The charge has to move because a charge alone proves little. The recorded
 * GT3 reads exactly 0 throughout, but that is one car in one build of the
 * sim, and a car with no battery that reported a constant, a full one say,
 * would otherwise be given a widget that reads 100 % for ever. A real
 * battery moves in the first braking zone.
 *
 * Le Mans Ultimate only. iRacing's EnergyERSBatteryPct is not read: its name
 * and scale wait for a capture of a hybrid car, and the widget is held back
 * under that sim until then.
 *
 * None of this has run against a real hybrid car. The one recording there
 * is holds a GT3, so the lap accounting is built from the specification and
 * pinned on hand-built frames; see hybrid/hybridLap.ts.
 */
export class HybridProcessor implements TelemetryProcessor<HybridSnapshot> {
  readonly channel = 'hybrid.snapshot';
  // The charge moves through a braking zone in tenths of a second. The
  // channel itself is delivered at 10 Hz by default.
  readonly tickRateHz = 25;

  private enabled = true;
  private readonly lap = new HybridLapAccount();
  private trackLengthM = 0;
  private wasInGarage = false;
  private playerCarIdx: number | null = null;
  /** Kept apart from the snapshot's, which is blank until the car shows. */
  private sessionNum: number | null = null;
  /** The first charge read in the car, to tell one that moves from one set. */
  private firstChargePct: number | null = null;
  private readonly motor: HybridMotorReadings = blankMotor();
  private readonly latest: HybridSnapshot = {
    available: false,
    chargePct: null,
    motorState: 0,
    motorStateInferred: false,
    drainLapPct: 0,
    regenLapPct: 0,
    drainLastLapPct: null,
    regenLastLapPct: null,
    netLapEstimatePct: null,
    deployTimeLapS: 0,
    sinceDeployS: null,
    lapElapsedS: LAP_ELAPSED_CAP_S,
    motor: this.motor,
    stateOfCharge: null,
    sessionNum: null,
    version: 0,
  };

  /**
   * The track length is all this takes from the session. Called on every
   * session publish, so it must not clear anything a frame built up.
   */
  init(session: Session): void {
    const trackLengthM = parseTrackLength(session?.WeekendInfo?.TrackLength);
    if (trackLengthM === this.trackLengthM) return;
    this.trackLengthM = trackLengthM;
    this.lap.setTrackLength(trackLengthM);
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;

    // A frame that omits SessionNum says nothing about which session this
    // is, so only a stated change is one.
    const sessionNum = number(frame, 'SessionNum');
    if (sessionNum !== undefined) {
      if (this.sessionNum !== null && sessionNum !== this.sessionNum) {
        this.resetAll();
      }
      this.sessionNum = sessionNum;
    }

    // Back in the garage, or in another car: the laps so far are not this
    // run's, as TinyPedal's reset has it.
    const inGarage = boolean(frame, 'IsInGarage');
    const playerCarIdx = number(frame, 'PlayerCarIdx');
    const changedCar =
      playerCarIdx !== undefined &&
      playerCarIdx >= 0 &&
      this.playerCarIdx !== null &&
      playerCarIdx !== this.playerCarIdx;
    if (playerCarIdx !== undefined && playerCarIdx >= 0) {
      this.playerCarIdx = playerCarIdx;
    }
    if ((inGarage && !this.wasInGarage) || changedCar) this.resetLaps();
    this.wasInGarage = inGarage;

    // In the car as CarSystemsProcessor has it: on track, in the pit lane
    // or in the box, and not in the garage, a replay or at LMU's monitor.
    const inCar =
      (boolean(frame, 'IsOnTrack') ||
        boolean(frame, 'PlayerCarInPitStall') ||
        boolean(frame, 'OnPitRoad')) &&
      !inGarage &&
      !boolean(frame, 'IsReplayPlaying') &&
      !boolean(frame, 'LmuOutOfCar');
    // A paused or stale frame is the last one again: nothing to add, and
    // the first one after it is a new baseline.
    if (
      !inCar ||
      boolean(frame, 'LmuGamePaused') ||
      boolean(frame, 'LmuDataStale')
    ) {
      this.lap.interrupt();
      return;
    }

    const charge = number(frame, 'LmuBatteryCharge');
    const simState = number(frame, 'LmuMotorState') ?? 0;
    const hasMotor = simState === 1 || simState === 2 || simState === 3;
    const sessionTime = number(frame, 'SessionTime');
    if (charge === undefined || sessionTime === undefined) {
      // No reading: what was published stands. A motor that states what it
      // is doing is a hybrid all the same.
      this.lap.interrupt();
      if (!this.latest.available && hasMotor) {
        this.latest.available = true;
        this.latest.version += 1;
      }
      return;
    }

    // The account runs from the first reading, shown or not, so that the
    // step which shows the car to have a battery is booked like any other.
    const lapDistPct = number(frame, 'LapDistPct');
    const chargePct = Math.min(100, Math.max(0, charge * 100));
    this.lap.step({
      sessionTime,
      chargePct,
      simState,
      lapCompleted: number(frame, 'LapCompleted') ?? 0,
      lapDistM:
        lapDistPct !== undefined && lapDistPct >= 0 && this.trackLengthM > 0
          ? lapDistPct * this.trackLengthM
          : -1,
      onPitRoad: boolean(frame, 'OnPitRoad'),
    });

    let changed = false;
    if (!this.latest.available) {
      if (this.firstChargePct === null) this.firstChargePct = chargePct;
      const hasBattery = chargePct > 0 && chargePct !== this.firstChargePct;
      if (!hasMotor && !hasBattery) return;
      this.latest.available = true;
      changed = true;
    }

    changed = this.set('sessionNum', this.sessionNum) || changed;
    changed =
      this.set('chargePct', round(chargePct, CHARGE_DECIMALS)) || changed;
    changed = this.publishLaps() || changed;
    // From the line this processor saw, so that the totals and the clock
    // they are frozen by turn over on the same tick. Before one, the sim's.
    const lapElapsed =
      this.lap.lapStartTime !== null
        ? sessionTime - this.lap.lapStartTime
        : (number(frame, 'LapCurrentLapTime') ?? LAP_ELAPSED_CAP_S);
    changed =
      this.set(
        'lapElapsedS',
        Math.min(LAP_ELAPSED_CAP_S, Math.max(0, Math.floor(lapElapsed)))
      ) || changed;

    const torque = number(frame, 'LmuMotorTorque');
    const rpm = number(frame, 'LmuMotorRPM');
    changed =
      this.setMotor('torqueNm', rounded(torque, MOTOR_DECIMALS)) || changed;
    changed = this.setMotor('rpm', rounded(rpm, 0)) || changed;
    changed = this.setMotor('powerKw', hybridPowerKw(torque, rpm)) || changed;
    changed =
      this.setMotor(
        'motorTempC',
        hybridTemperatureC(number(frame, 'LmuMotorTemp'))
      ) || changed;
    changed =
      this.setMotor(
        'coolantTempC',
        hybridTemperatureC(number(frame, 'LmuMotorCoolantTemp'))
      ) || changed;
    changed =
      this.setMotor(
        'regenKw',
        rounded(number(frame, 'LmuRegen'), MOTOR_DECIMALS)
      ) || changed;
    changed =
      this.set(
        'stateOfCharge',
        rounded(number(frame, 'LmuStateOfCharge'), STATE_OF_CHARGE_DECIMALS)
      ) || changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      // A replay plays back whatever car its camera follows, and scrubbing
      // it would run the laps backwards. Nothing is kept from one.
      this.enabled = !event.replay;
      if (event.replay) this.resetAll();
    } else {
      this.resetAll();
    }
  }

  snapshot(): HybridSnapshot {
    return this.latest;
  }

  /** Copies the lap account into the snapshot at display precision. */
  private publishLaps(): boolean {
    const { lap } = this;
    let changed = false;
    changed = this.set('motorState', lap.motorState) || changed;
    changed = this.set('motorStateInferred', lap.motorStateInferred) || changed;
    changed =
      this.set('drainLapPct', round(lap.drainLapPct, CHARGE_DECIMALS)) ||
      changed;
    changed =
      this.set('regenLapPct', round(lap.regenLapPct, CHARGE_DECIMALS)) ||
      changed;
    changed =
      this.set(
        'drainLastLapPct',
        rounded(lap.drainLastLapPct, CHARGE_DECIMALS)
      ) || changed;
    changed =
      this.set(
        'regenLastLapPct',
        rounded(lap.regenLastLapPct, CHARGE_DECIMALS)
      ) || changed;
    changed =
      this.set(
        'netLapEstimatePct',
        rounded(lap.netLapEstimatePct, CHARGE_DECIMALS)
      ) || changed;
    changed =
      this.set('deployTimeLapS', round(lap.deployTimeLapS, SECONDS_DECIMALS)) ||
      changed;
    changed =
      this.set('sinceDeployS', rounded(lap.sinceDeployS, SECONDS_DECIMALS)) ||
      changed;
    return changed;
  }

  /**
   * Clears what the laps built up: the totals, the timers and the reference
   * lap. The charge and the motor's readings stand, and so does `available`:
   * the car has not stopped having a battery.
   */
  private resetLaps(): void {
    this.lap.reset();
    if (!this.latest.available) return;
    let changed = this.publishLaps();
    changed = this.set('lapElapsedS', LAP_ELAPSED_CAP_S) || changed;
    if (changed) this.latest.version += 1;
  }

  /** Back to a car that has shown nothing. */
  private resetAll(): void {
    this.lap.reset();
    this.wasInGarage = false;
    this.playerCarIdx = null;
    this.sessionNum = null;
    this.firstChargePct = null;
    // A car that never showed the system has had nothing written for it,
    // so there is nothing to take back and nothing to publish.
    if (!this.latest.available) return;
    Object.assign(this.motor, blankMotor());
    this.latest.available = false;
    this.latest.chargePct = null;
    this.latest.stateOfCharge = null;
    this.latest.sessionNum = null;
    this.latest.lapElapsedS = LAP_ELAPSED_CAP_S;
    this.publishLaps();
    this.latest.version += 1;
  }

  private set<K extends Exclude<keyof HybridSnapshot, 'version' | 'motor'>>(
    key: K,
    value: HybridSnapshot[K]
  ): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }

  private setMotor<K extends keyof HybridMotorReadings>(
    key: K,
    value: HybridMotorReadings[K]
  ): boolean {
    if (this.motor[key] === value) return false;
    this.motor[key] = value;
    return true;
  }
}
