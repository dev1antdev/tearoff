import type {
  LedgerPass,
  LedgerStint,
  LedgerStop,
  StintClosedBy,
  StintOpenedBy,
} from '@irdashies/types';
import { isCleanLap } from '../../shared/lapValidity';
import { stintPace } from '../../shared/stintPace';
import type { LapCostMeter } from './LapCostMeter';
import { Standstill } from './pitVisit';

// The standstill is the one definition of standing the pit trackers share;
// it is still reached from here by what was written against this module.
export { Standstill };

/**
 * Follows the player's car from one service to the next.
 *
 * A stint is what the tank and the tyres last for. It opens when the car
 * leaves the pit lane, or at the green flag of a race, and closes when the
 * car is serviced -- fuel or energy in or out, a tyre changed, another
 * driver -- or goes back to its garage, or the session ends. A visit to the
 * pit lane that services nothing, such as a drive-through, a stop-and-go or
 * repairs only, closes nothing: it is noted on the stint as a pass. That is
 * on purpose where TinyPedal ends a stint after three seconds at a
 * standstill in the pits: a penalty changes neither the tank nor the tyres.
 *
 * Pure: it reads the frame facts it is handed and the meter's levels, and
 * says what happened through its listener.
 */

/** The most pit lane visits kept on a stint; the latest are the ones kept. */
const MAX_PASSES = 10;
/**
 * How long the sim may name no car for the player before the stint is over.
 * A moment without one is the sim changing its mind at a driver change;
 * longer, and somebody else has the car or it is back in its garage.
 */
const CAR_GONE_SECONDS = 3;

/** One frame as the tracker reads it. Reused by its owner. */
export interface StintFrame {
  sessionTime: number;
  sessionNum: number | null;
  /** The player has a car in the world. */
  hasCar: boolean;
  onPitRoad: boolean;
  inGarage: boolean;
  /** A race session that has not been given its green flag yet. */
  beforeGreen: boolean;
  /** Metres per second. */
  speed: number | null;
  /** Laps the car has completed. */
  lapCompleted: number;
  /** Who the session says is driving the player's car. */
  driver: string | null;
  /** The local player is at the wheel. */
  atWheel: boolean;
  /** How many drivers the car has had so far, where the sim counts. */
  driversSoFar: number | null;
  /** Seconds: the sim's estimate for the next stop, where it gives one. */
  simEstimate: number | null;
  /** A frame the sim has stopped writing, or a pause. */
  frozen: boolean;
}

export const createStintFrame = (): StintFrame => ({
  sessionTime: 0,
  sessionNum: null,
  hasCar: false,
  onPitRoad: false,
  inGarage: false,
  beforeGreen: false,
  speed: null,
  lapCompleted: 0,
  driver: null,
  atWheel: false,
  driversSoFar: null,
  simEstimate: null,
  frozen: false,
});

export type StintState = 'idle' | 'running' | 'inPits';

export interface StintListener {
  /** A stint opened. The record is a copy and stays as it was then. */
  onStintOpened(stint: LedgerStint): void;
  /** A stint with at least one lap ended. */
  onStintClosed(stint: LedgerStint): void;
  /** A stint ended without a lap: it is not kept. */
  onStintDiscarded(stint: LedgerStint): void;
}

export interface StintTrackerOptions {
  /** The lap library's token for the session a stint opening now is in. */
  sessionToken: () => string;
  /** The compound fitted to each wheel, by name. */
  compoundNames: () => (string | null)[];
}

type Wheels = (number | null)[];

/** The levels at one moment: a stint's start, its end, or a candidate. */
interface Levels {
  time: number;
  lap: number;
  fuel: number | null;
  energy: number | null;
  tread: Wheels;
  brake: Wheels;
}

const emptyLevels = (): Levels => ({
  time: 0,
  lap: 0,
  fuel: null,
  energy: null,
  tread: [null, null, null, null],
  brake: [null, null, null, null],
});

/** A stint record that can still be written to. */
type OpenStint = { -readonly [Key in keyof LedgerStint]: LedgerStint[Key] } & {
  passes: LedgerPass[];
};

export class StintTracker {
  private stateNow: StintState = 'idle';
  private open: OpenStint | null = null;
  private ordinal = 0;
  private ordinalToken = '';
  private sessionNum: number | null = null;

  /** Nothing with a car in it has been seen since the last reset. */
  private first = true;
  /** The frame before had the car on track, waiting for the green. */
  private heldForGreen = false;
  private driver: string | null = null;
  private driversSoFar: number | null = null;
  /** When the sim stopped naming a car for the player; null while it does. */
  private goneSince: number | null = null;

  /** The levels of the last frame on track. */
  private readonly last = emptyLevels();
  /** The levels at pit entry: the stint's end, if the visit ends it. */
  private readonly entry = emptyLevels();
  private readonly standstill = new Standstill();
  private visitDriverChanged = false;
  private visitEstimate: number | null = null;

  /** The sum of the open stint's clean lap times. */
  private cleanSum = 0;

  constructor(
    private readonly meter: LapCostMeter,
    private readonly listener: StintListener,
    private readonly options: StintTrackerOptions
  ) {}

  state(): StintState {
    return this.stateNow;
  }

  /** The id of the open stint, or '' with none. */
  openStintId(): string {
    return this.open?.id ?? '';
  }

  /** The open stint's ordinal in its session, from 1; 0 with none. */
  openStintOrdinal(): number {
    return this.open?.ordinal ?? 0;
  }

  /** How many line crossings the open stint has seen. */
  openStintLaps(): number {
    return this.open?.laps ?? 0;
  }

  /**
   * The open stint as it stands, its end fields holding the present values;
   * null with none. A copy.
   */
  present(frame: StintFrame): LedgerStint | null {
    const stint = this.open;
    if (!stint) return null;
    // In the pit lane the stint's running ended at pit entry.
    const end = this.stateNow === 'inPits' ? this.entry : this.last;
    return {
      ...stint,
      endTime: this.stateNow === 'inPits' ? end.time : frame.sessionTime,
      endLap: this.stateNow === 'inPits' ? end.lap : frame.lapCompleted,
      endFuel: end.fuel,
      endEnergy: end.energy,
      startTread: [...stint.startTread],
      endTread: [...end.tread],
      startBrake: [...stint.startBrake],
      endBrake: [...end.brake],
      compounds: [...stint.compounds],
      passes: stint.passes.map((pass) => ({ ...pass })),
    };
  }

  /** The open stint exactly as it is recorded: open, with no end. A copy. */
  record(): LedgerStint | null {
    return this.open ? copyOf(this.open) : null;
  }

  /** Forgets everything: a new connection, track or car. */
  reset(): void {
    this.stateNow = 'idle';
    this.open = null;
    this.sessionNum = null;
    this.first = true;
    this.heldForGreen = false;
    this.driver = null;
    this.driversSoFar = null;
    this.goneSince = null;
    this.standstill.reset();
    this.visitDriverChanged = false;
    this.visitEstimate = null;
    this.cleanSum = 0;
  }

  /** Ends the open stint from outside: the session is over, or the sim gone. */
  end(reason: 'session' | 'disconnect'): void {
    this.close(reason, this.endLevels(), null);
    this.stateNow = 'idle';
    this.first = true;
    this.heldForGreen = false;
    this.goneSince = null;
  }

  /**
   * A lap closed at the line. Returns the stint it belongs to and which lap
   * of that stint it is; '' and 0 for a lap driven outside any stint.
   */
  noteLap(
    flags: number,
    lapTime: number
  ): { stintId: string; stintLap: number } {
    const stint = this.open;
    if (!stint) return { stintId: '', stintLap: 0 };
    stint.laps += 1;
    if (isCleanLap(flags)) {
      stint.cleanLaps += 1;
      this.cleanSum += lapTime;
      stint.bestLap =
        stint.bestLap === null ? lapTime : Math.min(stint.bestLap, lapTime);
      stint.avgLap = this.cleanSum / stint.cleanLaps;
      const pace = stintPace(stint.bestLap, stint.avgLap, stint.cleanLaps);
      stint.paceDelta = pace.paceDelta;
      stint.consistency = pace.consistency;
    }
    return { stintId: stint.id, stintLap: stint.laps };
  }

  /** The car crossed the line without a lap closing there. */
  noteCrossing(): void {
    if (this.open) this.open.laps += 1;
  }

  /** Takes one frame. Call after the meter has taken it. */
  update(frame: StintFrame): void {
    if (frame.frozen) return;
    if (this.sessionNum !== null && frame.sessionNum !== this.sessionNum) {
      this.end('session');
    }
    this.sessionNum = frame.sessionNum;

    if (!frame.hasCar) {
      this.withoutCar(frame);
      return;
    }
    this.goneSince = null;
    const wasFirst = this.first;
    this.first = false;
    const inPits = frame.onPitRoad || frame.inGarage;
    const driverChanged = this.noteDriver(frame);

    if (this.stateNow === 'running' && driverChanged) {
      // Another driver without a visit to the pit lane.
      this.close('driver', this.last, null);
      this.stateNow = 'idle';
    }

    if (this.stateNow === 'idle') {
      const held = !inPits && frame.beforeGreen;
      if (!inPits && !frame.beforeGreen) {
        const by: StintOpenedBy =
          wasFirst || driverChanged
            ? 'joined'
            : this.heldForGreen
              ? 'green'
              : 'pitExit';
        this.start(by, frame);
      }
      this.heldForGreen = held;
      return;
    }

    if (this.stateNow === 'running') {
      if (frame.inGarage) {
        this.close('garage', this.last, null);
        this.stateNow = 'idle';
      } else if (frame.onPitRoad) {
        this.enterPits(frame);
      } else {
        this.capture(this.last, frame);
        this.fillStartBrake();
      }
      return;
    }

    // In the pit lane with a stint open.
    if (driverChanged) this.visitDriverChanged = true;
    if (frame.inGarage) {
      this.close('garage', this.entry, null);
      this.stateNow = 'idle';
      return;
    }
    if (frame.onPitRoad) {
      this.standstill.update(frame.speed, frame.sessionTime);
      return;
    }
    this.leavePits(frame);
  }

  private withoutCar(frame: StintFrame): void {
    if (!this.open) {
      this.stateNow = 'idle';
      this.heldForGreen = false;
      return;
    }
    if (this.goneSince === null) {
      this.goneSince = frame.sessionTime;
      return;
    }
    const gone = frame.sessionTime - this.goneSince;
    if (gone >= 0 && gone <= CAR_GONE_SECONDS) return;
    if (this.stateNow === 'inPits') {
      // Handed over at a stop: the far end of the visit was never seen.
      this.close('service', this.entry, this.stop(null, true));
    } else {
      this.close('garage', this.last, null);
    }
    this.stateNow = 'idle';
    this.heldForGreen = false;
    this.goneSince = null;
  }

  /** Whether the car has another driver than on the frame before. */
  private noteDriver(frame: StintFrame): boolean {
    let changed = false;
    if (frame.driver !== null) {
      if (this.driver !== null && frame.driver !== this.driver) changed = true;
      this.driver = frame.driver;
    }
    if (frame.driversSoFar !== null) {
      if (
        this.driversSoFar !== null &&
        frame.driversSoFar > this.driversSoFar
      ) {
        changed = true;
      }
      this.driversSoFar = frame.driversSoFar;
    }
    return changed;
  }

  private enterPits(frame: StintFrame): void {
    this.capture(this.entry, frame);
    this.meter.beginVisit();
    this.standstill.reset();
    this.standstill.update(frame.speed, frame.sessionTime);
    this.visitDriverChanged = false;
    this.visitEstimate = frame.simEstimate;
    this.stateNow = 'inPits';
  }

  private leavePits(frame: StintFrame): void {
    const service = this.meter.visit();
    const pitLaneTime = frame.sessionTime - this.entry.time;
    const serviced =
      service.fuelAdded !== 0 ||
      service.energyAdded !== 0 ||
      service.tyresChanged !== 0 ||
      this.visitDriverChanged;
    if (serviced) {
      this.close(
        'service',
        this.entry,
        this.stop(pitLaneTime, this.visitDriverChanged)
      );
      this.start('pitExit', frame);
      return;
    }
    const stint = this.open;
    if (stint) {
      stint.passes.push({
        pitLaneTime,
        stationaryTime: this.standstill.seconds,
      });
      if (stint.passes.length > MAX_PASSES) stint.passes.shift();
    }
    this.capture(this.last, frame);
    this.stateNow = 'running';
  }

  private stop(pitLaneTime: number | null, driverChanged: boolean): LedgerStop {
    const service = this.meter.visit();
    return {
      pitLaneTime,
      stationaryTime: this.standstill.seconds,
      fuelAdded: service.fuelAdded,
      energyAdded: service.energyAdded,
      tyresChanged: service.tyresChanged,
      brakesChanged: service.brakesChanged,
      driverChanged,
      simEstimate: this.visitEstimate,
    };
  }

  private start(by: StintOpenedBy, frame: StintFrame): void {
    const token = this.options.sessionToken();
    if (token !== this.ordinalToken) {
      this.ordinalToken = token;
      this.ordinal = 0;
    }
    this.ordinal += 1;
    this.capture(this.last, frame);
    const stint: OpenStint = {
      id: `${token}:${this.ordinal}`,
      ordinal: this.ordinal,
      sessionNum: frame.sessionNum,
      driver: frame.driver ?? this.driver,
      own: frame.atWheel,
      openedBy: by,
      closedBy: null,
      startTime: frame.sessionTime,
      endTime: null,
      startLap: frame.lapCompleted,
      endLap: null,
      laps: 0,
      startFuel: this.last.fuel,
      endFuel: null,
      startEnergy: this.last.energy,
      endEnergy: null,
      startTread: [...this.last.tread],
      endTread: [null, null, null, null],
      startBrake: [...this.last.brake],
      endBrake: [null, null, null, null],
      compounds: this.options.compoundNames(),
      bestLap: null,
      avgLap: null,
      cleanLaps: 0,
      paceDelta: null,
      consistency: null,
      passes: [],
      stop: null,
    };
    this.open = stint;
    this.cleanSum = 0;
    this.stateNow = 'running';
    this.listener.onStintOpened(copyOf(stint));
  }

  private close(by: StintClosedBy, end: Levels, stop: LedgerStop | null): void {
    const stint = this.open;
    if (!stint) return;
    this.open = null;
    stint.closedBy = by;
    stint.endTime = end.time;
    stint.endLap = end.lap;
    stint.endFuel = end.fuel;
    stint.endEnergy = end.energy;
    stint.endTread = [...end.tread];
    stint.endBrake = [...end.brake];
    stint.stop = stop;
    if (stint.laps > 0) this.listener.onStintClosed(copyOf(stint));
    else this.listener.onStintDiscarded(copyOf(stint));
  }

  /**
   * A disc with no reading when the stint opened takes the first one that
   * comes. Their thickness is the one level that arrives late by design:
   * it is polled from the sim's REST API, seconds after a stint that opens
   * as the app joins a session. A disc loses a few micrometres a lap, so
   * the first reading is the start to within what can be measured.
   */
  private fillStartBrake(): void {
    const stint = this.open;
    if (!stint) return;
    const start = stint.startBrake as (number | null)[];
    for (let wheel = 0; wheel < start.length; wheel += 1) {
      if (start[wheel] === null) start[wheel] = this.last.brake[wheel];
    }
  }

  /** Where a stint ended from outside stops: pit entry, or the last frame. */
  private endLevels(): Levels {
    return this.stateNow === 'inPits' ? this.entry : this.last;
  }

  private capture(target: Levels, frame: StintFrame): void {
    target.time = frame.sessionTime;
    target.lap = frame.lapCompleted;
    target.fuel = this.meter.fuelLevel();
    target.energy = this.meter.energyLevel();
    this.meter.readWheels(target.tread, target.brake);
  }
}

const copyOf = (stint: LedgerStint): LedgerStint => ({
  ...stint,
  startTread: [...stint.startTread],
  endTread: [...stint.endTread],
  startBrake: [...stint.startBrake],
  endBrake: [...stint.endBrake],
  compounds: [...stint.compounds],
  passes: stint.passes.map((pass) => ({ ...pass })),
  stop: stint.stop ? { ...stint.stop } : null,
});
