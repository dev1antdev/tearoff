import {
  DAMAGE_BODY_ZONES,
  type DamageLevel,
  type DamageSnapshot,
  type DamageWheel,
  type Session,
  type SessionLifecycleEvent,
  type Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const WHEEL_COUNT = 4;
/** iRacing-shaped corner prefixes, in the sim's wheel order. */
const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
/** Named "cold" after iRacing's channel; LMU fills it with the live kPa. */
const PRESSURE_KEYS = CORNERS.map((corner) => `${corner}coldPressure`);
/** Tread left on each tyre, 1 for a new one. */
const WEAR_KEYS = CORNERS.map((corner) => `${corner}wearM`);

/** The rear of the car in the snapshot's clockwise order. */
const REAR_ZONE = 4;
/** Eight zones at the heaviest dent level, 2: a body with nothing left. */
const BODY_SCALE = DAMAGE_BODY_ZONES * 2;
/** Where the repair sits among the parts of a pit stop: see LmuPitStopParts. */
const REPAIR_PART = 3;
/** A tyre at or below this has no air in it, whatever its flat flag says. */
const PUNCTURE_PRESSURE_KPA = 1;

/** Seconds the last impact stays marked on the diagram. */
export const DAMAGE_IMPACT_HOLD_SECONDS = 15;

/**
 * The lightest impact that is marked, on the sim's own unitless scale.
 *
 * The one recording has five impacts. Three are contact with another car and
 * read 1,233, 1,423 and 3,017; two, 20 ms apart at full speed, read 40 and 63
 * and look like the floor or a kerb. The line is drawn between the two
 * groups, about four times the harder brush and a fifth of the lighter
 * knock. Five impacts are all it rests on.
 */
export const DAMAGE_MIN_IMPACT_MAGNITUDE = 250;

const FULL_TURN = 2 * Math.PI;

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const values = (
  frame: Telemetry,
  key: string
): readonly unknown[] | undefined => (frame as Cells)[key]?.value;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const scalar = (frame: Telemetry, key: string): number | undefined =>
  finite(values(frame, key)?.[0]);

const flag = (frame: Telemetry, key: string): boolean =>
  values(frame, key)?.[0] === true;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Integrities are drawn as whole per cent. */
const INTEGRITY_DECIMALS = 2;
/**
 * Finer than the per cent it is drawn in: the wheel's colour changes at 0.02
 * and 0.15, and a hundredth would move those steps by half of one.
 */
const SUSPENSION_DECIMALS = 3;
const BEARING_DECIMALS = 2;

const integrity = (value: number): number =>
  round(clamp01(value), INTEGRITY_DECIMALS);

/**
 * Which way an impact came from, radians clockwise from the nose seen from
 * above, 0 to a full turn. The position is in the sim's car axes, where
 * forward is minus z and the right-hand side minus x; only the direction is
 * used. Undefined for a position that cannot be read.
 */
export const impactBearingRad = (
  position: readonly unknown[] | undefined
): number | undefined => {
  const x = finite(position?.[0]);
  const z = finite(position?.[2]);
  if (x === undefined || z === undefined) return undefined;
  const turn = (Math.atan2(-x, -z) + FULL_TURN) % FULL_TURN;
  return round(turn, BEARING_DECIMALS);
};

const emptyBody = (): DamageLevel[] =>
  Array.from({ length: DAMAGE_BODY_ZONES }, () => 0 as DamageLevel);

const emptyWheel = (): DamageWheel => ({
  detached: false,
  punctured: false,
  suspensionDamage: null,
});

const emptyWheels = (): DamageWheel[] =>
  Array.from({ length: WHEEL_COUNT }, emptyWheel);

/**
 * Publishes what has happened to the player's car for the damage widget.
 *
 * Reads the damage channels the LMU mapper fills from the player's block of
 * shared memory, and the aero, suspension and repair figures its REST poller
 * lands on the frame. The shared-memory ones are absent whenever the player
 * has no car, at the monitor or spectating, and under a sim that publishes
 * none of this; the snapshot then says `available: false` and carries nothing.
 *
 * It runs on every frame rather than a few times a second, for the one thing
 * here that does not keep: the sim holds only the last impact, and replaces
 * it on the next, so a hit followed 20 ms later by a brush, as recorded, is
 * gone before a slower reader has looked. Everything else is compared and
 * left alone, and a snapshot goes out only when something drawn has changed.
 */
export class DamageProcessor implements TelemetryProcessor<DamageSnapshot> {
  readonly channel = 'damage.snapshot';
  readonly tickRateHz = 'event' as const;

  private readonly latest: DamageSnapshot = {
    available: false,
    body: emptyBody(),
    wheels: emptyWheels(),
    bodyIntegrity: 1,
    aeroIntegrity: null,
    suspensionIntegrity: null,
    tyreIntegrity: null,
    overheating: false,
    impactBearingRad: null,
    repairSeconds: null,
    repairChoice: null,
    sessionNum: null,
    version: 0,
  };

  /** The zones of the frame in hand, so a frame allocates nothing. */
  private readonly zones: DamageLevel[] = emptyBody();
  /** Wheels that are off on the frame in hand. */
  private wheelsDetached = 0;

  /** The sim's last impact as it was when it was last judged. */
  private judgedImpactTime = Number.NaN;
  /** The last impact that is marked: when, on the sim's clock, and where. */
  private markedImpactTime = 0;
  private markedImpactBearing = 0;
  /**
   * How much of the car was dented or missing on the frame before, by shared
   * memory alone; null before the first frame. A rise is new damage.
   */
  private damageMark: number | null = null;

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;

    const sessionNum = scalar(frame, 'SessionNum');
    if (sessionNum !== undefined && sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }

    const dents = values(frame, 'LmuDentSeverity');
    if (dents === undefined || dents.length < DAMAGE_BODY_ZONES) {
      // No car: drop the picture with the flag, so a consumer that ignores
      // the flag still cannot draw the damage of a car the driver has left.
      if (this.latest.available) {
        this.clear();
        changed = true;
      }
      if (changed) this.latest.version += 1;
      return;
    }
    if (!this.latest.available) {
      this.latest.available = true;
      changed = true;
    }

    const bodyDetached = flag(frame, 'LmuBodyDetached');
    const dentTotal = this.readBody(dents, bodyDetached);
    if (!this.sameBody()) {
      this.latest.body = [...this.zones];
      changed = true;
    }
    let bodyLevels = 0;
    for (const level of this.zones) bodyLevels += level;
    changed =
      this.set('bodyIntegrity', integrity(1 - bodyLevels / BODY_SCALE)) ||
      changed;

    if (this.readWheels(frame)) changed = true;

    const aeroDamage = scalar(frame, 'LmuAeroDamage');
    changed =
      this.set(
        'aeroIntegrity',
        aeroDamage === undefined ? null : integrity(1 - aeroDamage)
      ) || changed;
    changed =
      this.set(
        'suspensionIntegrity',
        this.suspensionIntegrity(frame, this.wheelsDetached > 0)
      ) || changed;
    changed = this.set('tyreIntegrity', this.tyreIntegrity(frame)) || changed;
    changed = this.set('overheating', flag(frame, 'LmuOverheating')) || changed;

    const damageMark = dentTotal + (bodyDetached ? 1 : 0) + this.wheelsDetached;
    const worse = this.damageMark !== null && damageMark > this.damageMark;
    this.damageMark = damageMark;
    changed =
      this.set('impactBearingRad', this.impactBearing(frame, worse)) || changed;

    const repair =
      scalar(frame, 'LmuRepairTime') ??
      finite(values(frame, 'LmuPitStopParts')?.[REPAIR_PART]);
    changed =
      this.set(
        'repairSeconds',
        repair === undefined ? null : Math.max(0, Math.round(repair))
      ) || changed;
    const choice = values(frame, 'LmuRepairChoice')?.[0];
    changed =
      this.set(
        'repairChoice',
        typeof choice === 'string' && choice.length > 0 ? choice : null
      ) || changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // LMU has no replay source, and under iRacing there is nothing to read,
    // so there is nothing to switch off on 'enter'.
    if (event.type === 'enter') return;
    this.clear();
    this.latest.sessionNum = null;
    this.latest.version += 1;
  }

  snapshot(): DamageSnapshot {
    return this.latest;
  }

  /** Back to a car with nothing known about it. The session number stays. */
  private clear(): void {
    this.latest.available = false;
    this.latest.body = emptyBody();
    this.latest.wheels = emptyWheels();
    this.latest.bodyIntegrity = 1;
    this.latest.aeroIntegrity = null;
    this.latest.suspensionIntegrity = null;
    this.latest.tyreIntegrity = null;
    this.latest.overheating = false;
    this.latest.impactBearingRad = null;
    this.latest.repairSeconds = null;
    this.latest.repairChoice = null;
    this.judgedImpactTime = Number.NaN;
    this.markedImpactTime = 0;
    this.markedImpactBearing = 0;
    this.damageMark = null;
  }

  /** Writes one figure, and says whether it moved. */
  private set<K extends keyof DamageSnapshot>(
    key: K,
    value: DamageSnapshot[K]
  ): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }

  /**
   * Fills `zones` from the sim's dent levels and returns their total as the
   * sim states them.
   *
   * The sim numbers the body anticlockwise from the nose seen from above:
   * front, front left, left, rear left, rear, rear right, right, front right.
   * The snapshot runs clockwise, so zone i is the sim's (8 - i) mod 8. A
   * level above 2 is drawn as 2; 3 is kept for the rear when the sim says
   * bodywork has come off, which by TinyPedal's reading is the rear wing.
   */
  private readBody(dents: readonly unknown[], bodyDetached: boolean): number {
    let total = 0;
    for (let zone = 0; zone < DAMAGE_BODY_ZONES; zone += 1) {
      const dent =
        finite(dents[(DAMAGE_BODY_ZONES - zone) % DAMAGE_BODY_ZONES]) ?? 0;
      total += Math.max(dent, 0);
      this.zones[zone] = dent >= 2 ? 2 : dent >= 1 ? 1 : 0;
    }
    if (bodyDetached) this.zones[REAR_ZONE] = 3;
    return total;
  }

  private sameBody(): boolean {
    for (let zone = 0; zone < DAMAGE_BODY_ZONES; zone += 1) {
      if (this.zones[zone] !== this.latest.body[zone]) return false;
    }
    return true;
  }

  /**
   * Updates the four wheels and the count of those that are off, and says
   * whether any of them moved.
   */
  private readWheels(frame: Telemetry): boolean {
    const detached = values(frame, 'LmuWheelDetached');
    const flat = values(frame, 'LmuTyreFlat');
    const suspension = values(frame, 'LmuSuspensionDamage');
    let wheels: DamageWheel[] | null = null;
    this.wheelsDetached = 0;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const isDetached = detached?.[wheel] === true;
      if (isDetached) this.wheelsDetached += 1;
      const pressure = scalar(frame, PRESSURE_KEYS[wheel]);
      // A wheel that is not there has no tyre to be flat.
      const punctured =
        !isDetached &&
        (flat?.[wheel] === true ||
          (pressure !== undefined && pressure <= PUNCTURE_PRESSURE_KPA));
      const damage = finite(suspension?.[wheel]);
      const suspensionDamage =
        damage === undefined
          ? null
          : round(clamp01(damage), SUSPENSION_DECIMALS);

      const held = this.latest.wheels[wheel];
      if (
        held.detached === isDetached &&
        held.punctured === punctured &&
        held.suspensionDamage === suspensionDamage
      ) {
        continue;
      }
      wheels ??= [...this.latest.wheels];
      wheels[wheel] = { detached: isDetached, punctured, suspensionDamage };
    }
    if (wheels) this.latest.wheels = wheels;
    return wheels !== null;
  }

  /**
   * 1 minus the worst of the four wheels. Before the REST API has answered
   * there is no figure, except that a car with a wheel off has none left.
   */
  private suspensionIntegrity(
    frame: Telemetry,
    anyDetached: boolean
  ): number | null {
    const suspension = values(frame, 'LmuSuspensionDamage');
    let worst: number | undefined;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const damage = finite(suspension?.[wheel]);
      if (damage === undefined) continue;
      worst = worst === undefined ? damage : Math.max(worst, damage);
    }
    if (worst !== undefined) return integrity(1 - worst);
    return anyDetached ? 0 : null;
  }

  /** The tyre with the least tread left. */
  private tyreIntegrity(frame: Telemetry): number | null {
    let lowest: number | undefined;
    for (const key of WEAR_KEYS) {
      const tread = scalar(frame, key);
      if (tread === undefined) continue;
      lowest = lowest === undefined ? tread : Math.min(lowest, tread);
    }
    return lowest === undefined ? null : integrity(lowest);
  }

  /**
   * Where the car was last hit, while that is worth marking.
   *
   * The sim keeps the time, place and force of its last impact, zeros until
   * the first. Each new one is judged once: it is marked when it is hard
   * enough to be a contact, or when the car is more damaged than it was a
   * frame ago, whatever the force reads. The second rule is for the impact
   * that was overwritten before it was seen: the dent it left arrives on the
   * same frame, and belongs to whatever the sim now calls its last impact. A
   * later impact that is marked restarts the hold; one that is not leaves the
   * mark before it standing.
   */
  private impactBearing(frame: Telemetry, worse: boolean): number | null {
    const impactTime = scalar(frame, 'LmuLastImpactTime');
    if (
      impactTime !== undefined &&
      impactTime > 0 &&
      (worse || impactTime !== this.judgedImpactTime)
    ) {
      this.judgedImpactTime = impactTime;
      // A build that does not export the force marks every impact.
      const magnitude = scalar(frame, 'LmuLastImpactMagnitude');
      if (
        worse ||
        magnitude === undefined ||
        magnitude >= DAMAGE_MIN_IMPACT_MAGNITUDE
      ) {
        const bearing = impactBearingRad(values(frame, 'LmuLastImpactPos'));
        if (bearing !== undefined) {
          this.markedImpactTime = impactTime;
          this.markedImpactBearing = bearing;
        }
      }
    }

    if (this.markedImpactTime <= 0) return null;
    const now = scalar(frame, 'SessionTime');
    if (now === undefined) return null;
    const since = now - this.markedImpactTime;
    return since >= 0 && since <= DAMAGE_IMPACT_HOLD_SECONDS
      ? this.markedImpactBearing
      : null;
  }
}
