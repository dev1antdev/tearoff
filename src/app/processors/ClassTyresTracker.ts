import type {
  ClassTyresSnapshot,
  ClassTyresTuning,
  LmuPitService,
  RaceLap,
  RaceStint,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  RACE_HISTORY_MAX_CARS,
  TREAD_ESTIMATE,
  TREAD_ESTIMATE_MIN_OWN_LAPS,
  TREAD_MEASURED,
  TREAD_NONE,
  TYRE_SET_AT_LEAST,
  TYRE_SET_LIKELY,
  TYRE_SET_SEEN,
  TYRE_SET_UNKNOWN,
} from '@irdashies/types';
import {
  energyRefuelLines,
  fuelRefuelLine,
  refuelStandingS,
  tyreSetOf,
  type TyreSet,
  type TyreSetSure,
  type TyreStopRules,
  type TyreWatch,
} from '@irdashies/shared';
import type { TreadCost } from './ledgerRates';
import type { OwnTyresSource } from './ownTyres';

/**
 * For every car of the class the user is entered in: the compounds it is
 * on, how long it has run on the set and what is left of the tread.
 *
 * It measures nothing of the race itself. The laps on a set are the rule of
 * `src/shared/tyreSet/` run over what the race history holds of the car,
 * so they are the same after a restart as before it: the stints and laps
 * are read back from the file, and the rule is run over them again. What a
 * refill takes is costed with the hoses the finish projection costs our own
 * stops with. What a lap costs the tread is our own car's, from the
 * player's ledger.
 *
 * One thing it watches for itself: where the sim publishes every car's
 * wear, which Le Mans Ultimate does offline, a reading that goes back up in
 * the pits is a set of tyres seen to go on, and the reading is the tread.
 * A reading is taken for the car's own only once it has been seen to fall:
 * online a rival's reads 100 % all race, and says nothing.
 *
 * Pure: handed the session and the frames, it keeps its figures and says
 * when they changed through `version`. It looks at the cars once a second,
 * and allocates nothing on the frames between.
 */

/** A car's figures move at a line crossing and at a stop: once a second. */
const TICK_SECONDS = 1;
/**
 * A pause between two looks after which what the wear did in between is
 * not known: the race was not being recorded, or the sim was away.
 */
const WATCH_GAP_SECONDS = 5;
/** Tread rising by more than this in the pits is another tyre. */
const TREAD_CHANGE_RISE = 0.005;
const WHEEL_COUNT = 4;
const NO_WATCH = Number.NaN;

const SURE_CODE: Record<TyreSetSure, number> = {
  atLeast: TYRE_SET_AT_LEAST,
  likely: TYRE_SET_LIKELY,
  seen: TYRE_SET_SEEN,
};

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const list = (
  frame: Telemetry,
  key: string
): readonly unknown[] | undefined => {
  const value = (frame as unknown as Cells)[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const scalar = (frame: Telemetry, key: string): number | null => {
  const value = (frame as unknown as Cells)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const numberAt = (
  values: readonly unknown[] | undefined,
  index: number,
  fallback: number
): number => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const flagAt = (
  values: readonly unknown[] | undefined,
  index: number
): boolean => values?.[index] === true || values?.[index] === 1;

/** Writes one entry of a published array; true when it moved. */
const put = (target: number[], index: number, value: number): boolean => {
  if (target[index] === value) return false;
  target[index] = value;
  return true;
};

/** What the race history holds of the race in hand. */
export interface ClassTyresHistory {
  /** Names the race the records are of; '' while none is being recorded. */
  raceToken(): string;
  /** Goes up whenever anything kept of the car changes. */
  revision(carIdx: number): number;
  /** The car's laps, in the order driven. */
  laps(carIdx: number): readonly RaceLap[];
  /** Its stints, oldest first, the one under way last. */
  stints(carIdx: number): readonly RaceStint[];
}

export interface ClassTyresSources {
  history: ClassTyresHistory;
  /** The tyres on our own car, from the player's ledger. */
  own: OwnTyresSource;
  /** What four tyres take, from the current dashboard. */
  tuning: () => ClassTyresTuning;
}

/** What is kept about one car of the class. Made once, changed in place. */
interface Car {
  /** The wear the sim publishes for it, as last read, and whether it was. */
  wear: number[];
  hasWear: boolean;
  /** The reading has been seen to fall: it is the car's own. */
  live: boolean;
  watch: TyreWatch;
  /** The compounds on it now, as the frame reads them. */
  compounds: number[];
  compoundsRead: boolean;
  /** What the set was last worked out from, and what came of it. */
  setKey: string;
  set: TyreSet | null;
}

const newCar = (): Car => ({
  wear: [0, 0, 0, 0],
  hasWear: false,
  live: false,
  watch: { since: NO_WATCH, changedAt: NO_WATCH, changeLap: -1 },
  compounds: [-1, -1, -1, -1],
  compoundsRead: false,
  setKey: '',
  set: null,
});

type MutableSnapshot = {
  -readonly [
    Key in keyof ClassTyresSnapshot
  ]: ClassTyresSnapshot[Key] extends readonly number[]
    ? number[]
    : ClassTyresSnapshot[Key];
};

export class ClassTyresTracker {
  private ownCarIdx = -1;
  private classIdByCar: (number | undefined)[] = [];
  private tyreNames = new Map<number, string>();
  private pitService: LmuPitService | undefined;
  private tankLitres: number | null = null;

  private readonly cars = new Map<number, Car>();
  private raceToken = '';
  private tickedAt = Number.NEGATIVE_INFINITY;
  private rulesKey = '';
  private rules: TyreStopRules | null = null;
  private rulesVersion = 0;

  private readonly latest: MutableSnapshot = {
    ownCarIdx: -1,
    compounds: [],
    setLaps: [],
    sure: [],
    treadPct: [],
    treadSource: [],
    sessionNum: null,
    version: 0,
  };

  constructor(private readonly sources: ClassTyresSources) {}

  /** Reads who is in which class, the tyre list and what pit work costs. */
  onSession(session: Session): void {
    const driverInfo = session?.DriverInfo;
    this.ownCarIdx =
      typeof driverInfo?.DriverCarIdx === 'number'
        ? driverInfo.DriverCarIdx
        : -1;
    this.classIdByCar = [];
    for (const driver of driverInfo?.Drivers ?? []) {
      const carIdx = driver?.CarIdx;
      if (
        typeof carIdx !== 'number' ||
        carIdx < 0 ||
        carIdx >= RACE_HISTORY_MAX_CARS ||
        driver.CarIsPaceCar === 1 ||
        driver.IsSpectator === 1 ||
        typeof driver.CarClassID !== 'number'
      ) {
        continue;
      }
      this.classIdByCar[carIdx] = driver.CarClassID;
    }
    this.tyreNames = new Map();
    for (const tyre of driverInfo?.DriverTires ?? []) {
      if (
        typeof tyre?.TireIndex === 'number' &&
        typeof tyre.TireCompoundType === 'string'
      ) {
        this.tyreNames.set(tyre.TireIndex, tyre.TireCompoundType);
      }
    }
    this.pitService = session?.LmuRest?.pitService;
    const tank = driverInfo?.DriverCarFuelMaxLtr;
    const share = driverInfo?.DriverCarMaxFuelPct;
    this.tankLitres =
      typeof tank === 'number' && tank > 0
        ? tank * (typeof share === 'number' && share > 0 ? share : 1)
        : null;
  }

  /** Takes a frame; looks at the cars when a second has passed. */
  onFrame(frame: Telemetry): void {
    const now = scalar(frame, 'SessionTime');
    if (now === null) return;
    const since = now - this.tickedAt;
    if (since >= 0 && since < TICK_SECONDS) return;
    // A clock that went back is another session; a long pause is a stretch
    // nobody watched. Either way the wear is read afresh.
    if (since < 0 || since > WATCH_GAP_SECONDS) this.loseSight();
    this.tickedAt = now;
    this.tick(frame, now);
  }

  /**
   * Forgets what was watched of every car's wear, and keeps the rest. Call
   * it when frames stop being handed over: what goes on a car meanwhile is
   * not seen.
   */
  loseSight(): void {
    for (const car of this.cars.values()) {
      car.hasWear = false;
      car.watch.since = NO_WATCH;
    }
  }

  /** Forgets everything: the sim went away, or another connection began. */
  reset(): void {
    this.cars.clear();
    this.raceToken = '';
    this.tickedAt = Number.NEGATIVE_INFINITY;
    this.ownCarIdx = -1;
    this.classIdByCar = [];
    this.pitService = undefined;
    this.tankLitres = null;
    this.clearSnapshot(null);
  }

  /** The figures as they stand. The same object, written in place. */
  snapshot(): ClassTyresSnapshot {
    return this.latest;
  }

  private clearSnapshot(sessionNum: number | null): void {
    const out = this.latest;
    const had =
      out.ownCarIdx !== -1 ||
      out.setLaps.length > 0 ||
      out.sessionNum !== sessionNum;
    out.ownCarIdx = -1;
    out.compounds.length = 0;
    out.setLaps.length = 0;
    out.sure.length = 0;
    out.treadPct.length = 0;
    out.treadSource.length = 0;
    out.sessionNum = sessionNum;
    if (had) out.version += 1;
  }

  private tick(frame: Telemetry, now: number): void {
    const sessionNum = scalar(frame, 'SessionNum');
    const { history } = this.sources;
    const token = history.raceToken();
    if (token !== this.raceToken) {
      // Another race: what was watched and worked out is the last one's.
      this.raceToken = token;
      this.cars.clear();
    }
    const playerCarIdx = scalar(frame, 'PlayerCarIdx');
    const own =
      this.ownCarIdx >= 0
        ? this.ownCarIdx
        : playerCarIdx !== null && playerCarIdx >= 0
          ? playerCarIdx
          : -1;
    const classId = own >= 0 ? this.classIdByCar[own] : undefined;
    if (token === '' || classId === undefined) {
      this.clearSnapshot(sessionNum);
      return;
    }

    const rules = this.rulesFor(frame);
    const ownTyres = this.sources.own();
    const lapNumbers = list(frame, 'CarIdxLap');
    const wheelCompounds = list(frame, 'LmuCarIdxWheelCompounds');
    const carCompounds = list(frame, 'CarIdxTireCompound');
    const wheelWear = list(frame, 'LmuCarIdxWheelWear');
    const onPitRoad = list(frame, 'CarIdxOnPitRoad');
    const inGarage = list(frame, 'LmuCarIdxInGarage');

    const out = this.latest;
    const slots = this.classIdByCar.length;
    let moved = out.ownCarIdx !== own || out.sessionNum !== sessionNum;
    out.ownCarIdx = own;
    out.sessionNum = sessionNum;
    if (out.setLaps.length !== slots) {
      moved = true;
      resize(out.setLaps, slots, -1);
      resize(out.sure, slots, TYRE_SET_UNKNOWN);
      resize(out.treadPct, slots, -1);
      resize(out.treadSource, slots, TREAD_NONE);
      resize(out.compounds, slots * WHEEL_COUNT, -1);
    }

    for (let carIdx = 0; carIdx < slots; carIdx += 1) {
      if (this.classIdByCar[carIdx] !== classId) {
        // Another class, or no car: nothing is said of it.
        moved = this.write(out, carIdx, null, -1, -1, TREAD_NONE) || moved;
        continue;
      }
      let car = this.cars.get(carIdx);
      if (!car) {
        car = newCar();
        this.cars.set(carIdx, car);
      }
      const laps = history.laps(carIdx);
      const stints = history.stints(carIdx);
      const lapNow = Math.trunc(numberAt(lapNumbers, carIdx, -1));
      const lapsCompleted = Math.max(
        lapNow - 1,
        laps[laps.length - 1]?.lap ?? 0,
        0
      );

      this.readCompounds(car, carIdx, wheelCompounds, carCompounds, laps);
      this.watchWear(
        car,
        carIdx,
        wheelWear,
        flagAt(onPitRoad, carIdx) || flagAt(inGarage, carIdx),
        now,
        lapsCompleted
      );

      // Our own car's tyres are watched by the ledger, whoever looks at
      // this; another car's only here, and only once its wear is its own.
      const watch =
        carIdx === own && ownTyres
          ? ownTyres.watch
          : car.live
            ? car.watch
            : undefined;
      const key =
        `${history.revision(carIdx)}|${this.rulesVersion}|${lapsCompleted}|` +
        `${car.compoundsRead ? car.compounds.join(',') : ''}|` +
        `${watch ? `${watch.since}|${watch.changedAt}|${watch.changeLap}` : ''}`;
      if (key !== car.setKey) {
        car.setKey = key;
        car.set = tyreSetOf(
          stints,
          laps,
          rules,
          {
            lapsCompleted,
            compounds: car.compoundsRead ? car.compounds : undefined,
          },
          watch
        );
      }
      const set = car.set;
      const setLaps = set ? Math.max(0, lapsCompleted - set.sinceLap) : -1;

      const ownTread = carIdx === own ? meanOf(ownTyres?.tread) : null;
      const measured =
        ownTread ?? (car.live && car.hasWear ? meanOf(car.wear) : null);
      let treadPct = -1;
      let treadSource = TREAD_NONE;
      if (measured !== null) {
        treadPct = Math.round(measured * 100);
        treadSource = TREAD_MEASURED;
      } else if (set && ownTyres) {
        const estimate = this.estimate(car.compounds, ownTyres.costs, setLaps);
        if (estimate !== null) {
          treadPct = Math.round(estimate * 100);
          treadSource = TREAD_ESTIMATE;
        }
      }
      moved =
        this.write(out, carIdx, car, setLaps, treadPct, treadSource) || moved;
    }
    if (moved) out.version += 1;
  }

  /** Writes one car's figures; true when one of them moved. */
  private write(
    out: MutableSnapshot,
    carIdx: number,
    car: Car | null,
    setLaps: number,
    treadPct: number,
    treadSource: number
  ): boolean {
    let moved = put(out.setLaps, carIdx, setLaps);
    moved =
      put(
        out.sure,
        carIdx,
        car?.set ? SURE_CODE[car.set.sure] : TYRE_SET_UNKNOWN
      ) || moved;
    moved = put(out.treadPct, carIdx, treadPct) || moved;
    moved = put(out.treadSource, carIdx, treadSource) || moved;
    const base = carIdx * WHEEL_COUNT;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      moved =
        put(out.compounds, base + wheel, car ? car.compounds[wheel] : -1) ||
        moved;
    }
    return moved;
  }

  /**
   * The compounds on a car: each wheel's where the sim gives them per
   * wheel, the car's one compound otherwise, and what its last lap was
   * completed on while the car is out of the world.
   */
  private readCompounds(
    car: Car,
    carIdx: number,
    wheels: readonly unknown[] | undefined,
    single: readonly unknown[] | undefined,
    laps: readonly RaceLap[]
  ): void {
    const one = numberAt(single, carIdx, -1);
    let read = true;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const compound = numberAt(wheels, carIdx * WHEEL_COUNT + wheel, one);
      if (compound >= 0) car.compounds[wheel] = compound;
      else read = false;
    }
    car.compoundsRead = read;
    if (read) return;
    const last = laps[laps.length - 1]?.compounds;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      car.compounds[wheel] = last?.[wheel] ?? -1;
    }
  }

  /**
   * One look at the wear the sim publishes for a car. A reading that falls
   * is the car's own from then on; one that goes up in the pits is another
   * tyre.
   */
  private watchWear(
    car: Car,
    carIdx: number,
    wear: readonly unknown[] | undefined,
    inPits: boolean,
    now: number,
    lapsCompleted: number
  ): void {
    const base = carIdx * WHEEL_COUNT;
    let valid = wear !== undefined;
    for (let wheel = 0; valid && wheel < WHEEL_COUNT; wheel += 1) {
      const value = numberAt(wear, base + wheel, -1);
      if (!(value > 0 && value <= 1)) valid = false;
    }
    if (!valid) {
      // No block for the car on this frame: out of the world, or a sim
      // that publishes none. What it comes back on is not known.
      car.hasWear = false;
      car.watch.since = NO_WATCH;
      return;
    }
    let rose = false;
    let fell = false;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const value = numberAt(wear, base + wheel, -1);
      if (car.hasWear) {
        const moved = value - car.wear[wheel];
        if (moved > TREAD_CHANGE_RISE) rose = true;
        else if (moved < 0) fell = true;
      }
      car.wear[wheel] = value;
    }
    car.hasWear = true;
    if (fell) car.live = true;
    if (!car.live) return;
    if (Number.isNaN(car.watch.since)) car.watch.since = now;
    if (rose && inPits) {
      car.watch.changedAt = now;
      car.watch.changeLap = lapsCompleted;
    }
  }

  /**
   * Tread left on a car after `setLaps` on its set, 0..1, at what a lap
   * costs our own car on the same compounds. Null where our car has not
   * run one of them for long enough to say.
   */
  private estimate(
    compounds: readonly number[],
    costs: ReadonlyMap<string, TreadCost>,
    setLaps: number
  ): number | null {
    if (setLaps < 0) return null;
    let perLap = 0;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const name = this.tyreNames.get(compounds[wheel]);
      const cost = name === undefined ? undefined : costs.get(name);
      const wheelCost = cost?.perLap[wheel];
      if (
        cost === undefined ||
        wheelCost === null ||
        wheelCost === undefined ||
        cost.laps[wheel] < TREAD_ESTIMATE_MIN_OWN_LAPS
      ) {
        return null;
      }
      perLap += wheelCost;
    }
    return Math.max(0, 1 - (perLap / WHEEL_COUNT) * setLaps);
  }

  /**
   * What a stop's length is held against: the hoses and the times the
   * session states for our own car, which stand for its class. Made again
   * only when one of them has moved.
   */
  private rulesFor(frame: Telemetry): TyreStopRules {
    const service = this.pitService;
    const tuned = this.sources.tuning().tyreChangeSeconds;
    const ratio = scalar(frame, 'LmuRefuelRatio');
    const tank = this.tankLitres;
    const key = `${tuned}|${ratio}|${tank}|${service ? JSON.stringify(service) : ''}`;
    if (this.rules && key === this.rulesKey) return this.rules;
    this.rulesKey = key;
    this.rulesVersion += 1;

    const fuelLine = fuelRefuelLine(service);
    const fuelLines = fuelLine ? [fuelLine] : null;
    // A class-mate's tank is not read: its fuel is taken to have gone with
    // its energy, at the litres to the percent our own car is set to.
    const energyLines = energyRefuelLines(service, ratio, 0);
    this.rules = {
      tyreChangeS:
        tuned > 0 ? tuned : (positive(service?.fourTireChange) ?? null),
      tyresAlongside: service?.tireTimeConcurrent === 1,
      refillS: (gain, isVirtual) => {
        if (isVirtual) {
          return energyLines ? refuelStandingS(energyLines, gain * 100) : null;
        }
        return fuelLines && tank !== null
          ? refuelStandingS(fuelLines, gain * tank)
          : null;
      },
      driverChangeS: positive(service?.driverChange) ?? null,
      // As rFactor 2 has it where the session does not say.
      driverAlongside: service?.driverConcurrent !== 0,
    };
    return this.rules;
  }
}

const positive = (value: number | undefined): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;

/** The mean of four readings; null where one is missing. */
const meanOf = (
  values: readonly (number | null)[] | null | undefined
): number | null => {
  if (!values || values.length < WHEEL_COUNT) return null;
  let sum = 0;
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const value = values[wheel];
    if (value === null || !Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / WHEEL_COUNT;
};

/** Brings a published array to a length, filling it afresh. */
const resize = (target: number[], length: number, fill: number): void => {
  target.length = length;
  target.fill(fill);
};
