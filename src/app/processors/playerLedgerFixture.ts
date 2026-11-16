import type {
  LapInput,
  LapLibraryLap,
  LapSessionInput,
  Session,
  StintInput,
  Telemetry,
} from '@irdashies/types';
import { SessionState, TrackLocation } from '@irdashies/types';
import { ChannelBus } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import {
  PlayerLedgerRuntime,
  type PlayerLedgerPersistence,
  type PlayerLedgerRuntimeOptions,
} from './playerLedgerRuntime';

/**
 * Hand-built sessions and frames for the ledger's specs: a car that is
 * driven round a one-kilometre track a frame at a time, into the pit lane
 * and out of it, with levels that fall as it goes.
 *
 * Test support only; nothing in the app imports it.
 */

export const LEDGER_DRIVER = 'Sergio Test';

interface SessionOptions {
  subSessionId?: number;
  trackId?: number;
  playerCarIdx?: number;
  driver?: string;
  carModel?: string | null;
}

/** One kilometre of track: a lap is 100 points. Session 0 practice, 1 race. */
export const ledgerSession = ({
  subSessionId = 48213,
  trackId = 18,
  playerCarIdx = 0,
  driver = LEDGER_DRIVER,
  carModel = 'Ferrari 296 LMGT3 Evo',
}: SessionOptions = {}): Session =>
  ({
    WeekendInfo: {
      SubSessionID: subSessionId,
      TrackID: trackId,
      TrackName: 'laguna seca',
      TrackDisplayName: 'Laguna Seca',
      TrackConfigName: null,
      TrackLength: '1 km',
    },
    DriverInfo: {
      DriverCarIdx: playerCarIdx,
      Drivers: [
        {
          CarIdx: 0,
          UserName: driver,
          CarPath: '74_26_KESS',
          ...(carModel ? { CarModel: carModel } : {}),
          CarScreenName: 'Kessel Racing #74',
        },
        { CarIdx: 1, UserName: 'Rival', CarPath: 'other', CarModel: 'Other' },
      ],
      DriverTires: [
        { TireIndex: 0, TireCompoundType: 'Medium' },
        { TireIndex: 1, TireCompoundType: 'Hard' },
      ],
    },
    SessionInfo: {
      Sessions: [
        { SessionNum: 0, SessionType: 'Practice', SessionName: 'PRACTICE' },
        { SessionNum: 1, SessionType: 'Race', SessionName: 'RACE' },
      ],
    },
  }) as unknown as Session;

export interface LedgerSimOptions {
  /** Seconds a lap takes at racing speed. */
  lapTime?: number;
  /** Seconds between two frames. */
  step?: number;
  fuelPerLap?: number;
  /** Virtual energy a lap; null for a car that runs on fuel. */
  energyPerLap?: number | null;
  treadPerLap?: number;
  /** Millimetres of disc a lap; null for a sim that reads none. */
  brakePerLap?: number | null;
}

const TRACK_M = 1000;

/** A car, its levels and where it is, turned into a frame on every step. */
export class LedgerSim {
  time = 100;
  /** Laps completed plus the fraction of the one under way. */
  progress = 0.5004;
  sessionNum = 0;
  sessionState = SessionState.Racing;
  sessionFlags = 0;
  hasCar = true;
  onPitRoad = false;
  inGarage = false;
  isOnTrack = true;
  /** LMU holding the car at a lap fraction of exactly 0. */
  heldAtLine = false;
  voided = false;
  incidents = 0;
  wetness = 1;
  rain = 0;
  fuel: number | null = 50;
  energy: number | null;
  tread: (number | null)[] = [1, 1, 1, 1];
  brake: (number | null)[];
  compound = [0, 0, 0, 0];
  battery: number | null = null;
  driversSoFar: number | null = null;
  pitStopEstimate: number | null = null;
  /** What the sim says the last lap took; -1 before the first. */
  lastLapTime = -1;
  /** Seconds after the line that the sim's lap time appears. */
  simLapDelay = 0;
  speed = 0;
  /** More cells for the frame, by key, for what the car has no field for. */
  extra: Record<string, unknown[]> = {};

  readonly lapTime: number;
  readonly step: number;
  private readonly fuelPerLap: number;
  private readonly energyPerLap: number | null;
  private readonly treadPerLap: number;
  private readonly brakePerLap: number | null;
  private lapStartedAt = this.time;
  private dueLapTimes: { at: number; lapTime: number }[] = [];

  constructor(
    private readonly feed: (frame: Telemetry) => void,
    options: LedgerSimOptions = {}
  ) {
    this.lapTime = options.lapTime ?? 60;
    this.step = options.step ?? 0.5;
    this.fuelPerLap = options.fuelPerLap ?? 2.4;
    this.energyPerLap =
      options.energyPerLap === undefined ? 0.02 : options.energyPerLap;
    this.treadPerLap = options.treadPerLap ?? 0.005;
    this.brakePerLap =
      options.brakePerLap === undefined ? 0.002 : options.brakePerLap;
    this.energy = this.energyPerLap === null ? null : 0.9;
    this.brake = this.brakePerLap === null ? [] : [36, 36, 32, 32];
  }

  get pct(): number {
    return this.progress - Math.floor(this.progress);
  }

  get lapsCompleted(): number {
    return Math.floor(this.progress);
  }

  /** Sends the car's state as it stands, without moving it. */
  emit(): void {
    this.feed(this.frame());
  }

  /** Drives for a while at racing speed, or at `speedMs`. */
  drive(seconds: number, speedMs = TRACK_M / this.lapTime): void {
    const steps = Math.round(seconds / this.step);
    for (let index = 0; index < steps; index += 1) this.advance(speedMs);
  }

  driveLaps(laps: number): void {
    this.drive(laps * this.lapTime);
  }

  /** Drives on at racing speed until the lap fraction passes `pct`. */
  driveTo(pct: number, speedMs = TRACK_M / this.lapTime): void {
    const ahead = (pct - this.pct + 1) % 1;
    this.drive((ahead * TRACK_M) / speedMs + this.step, speedMs);
  }

  /** Stands still; `eachStep` may change the car as the seconds pass. */
  stand(seconds: number, eachStep?: (dt: number) => void): void {
    const steps = Math.round(seconds / this.step);
    for (let index = 0; index < steps; index += 1) {
      eachStep?.(this.step);
      this.advance(0);
    }
  }

  private advance(speedMs: number): void {
    const before = this.lapsCompleted;
    const share = (speedMs * this.step) / TRACK_M;
    this.time += this.step;
    this.speed = speedMs;
    if (!this.heldAtLine) this.progress += share;
    if (this.fuel !== null) this.fuel -= this.fuelPerLap * share;
    if (this.energy !== null && this.energyPerLap !== null) {
      this.energy -= this.energyPerLap * share;
    }
    if (!this.onPitRoad && !this.inGarage) {
      this.tread = this.tread.map((value) =>
        value === null ? null : value - this.treadPerLap * share
      );
      const disc = this.brakePerLap;
      if (disc !== null) {
        this.brake = this.brake.map((value) =>
          value === null ? null : value - disc * share
        );
      }
    }
    if (this.lapsCompleted > before) {
      this.dueLapTimes.push({
        at: this.time + this.simLapDelay,
        lapTime: this.time - this.lapStartedAt,
      });
      this.lapStartedAt = this.time;
    }
    while (this.dueLapTimes.length > 0 && this.dueLapTimes[0].at <= this.time) {
      this.lastLapTime = this.dueLapTimes[0].lapTime;
      this.dueLapTimes.shift();
    }
    this.emit();
  }

  frame(): Telemetry {
    // Exactly 0 is what LMU reports for a car held at the line, and nothing
    // else: a step that lands on the line is nudged off it.
    const pct = this.heldAtLine ? 0 : this.pct || 1e-9;
    const surface = !this.hasCar
      ? TrackLocation.NotInWorld
      : this.onPitRoad || this.inGarage
        ? TrackLocation.InPitStall
        : TrackLocation.OnTrack;
    return {
      SessionTime: { value: [this.time] },
      SessionNum: { value: [this.sessionNum] },
      SessionState: { value: [this.sessionState] },
      SessionFlags: { value: [this.sessionFlags] },
      PlayerCarIdx: { value: [this.hasCar ? 0 : -1] },
      PlayerTrackSurface: { value: [surface] },
      CarIdxLapDistPct: { value: [this.hasCar ? pct : -1, 0.5] },
      CarIdxOnPitRoad: { value: [this.onPitRoad, false] },
      OnPitRoad: { value: [this.onPitRoad] },
      IsInGarage: { value: [this.inGarage] },
      IsOnTrack: { value: [this.isOnTrack && this.hasCar] },
      Speed: { value: [this.speed] },
      Lap: { value: [this.lapsCompleted + 1] },
      LapCompleted: { value: [this.lapsCompleted] },
      LapLastLapTime: { value: [this.lastLapTime] },
      LmuLapInvalidated: { value: [this.voided] },
      PlayerCarMyIncidentCount: { value: [this.incidents] },
      TrackWetness: { value: [this.wetness] },
      Precipitation: { value: [this.rain] },
      WeatherDeclaredWet: { value: [this.rain > 0] },
      AirTemp: { value: [21] },
      TrackTempCrew: { value: [30] },
      PlayerCarPosition: { value: [4] },
      CarIdxClassPosition: { value: [2, 1] },
      LmuCarIdxWheelCompounds: { value: [...this.compound, 1, 1, 1, 1] },
      LFwearM: { value: [this.tread[0]] },
      RFwearM: { value: [this.tread[1]] },
      LRwearM: { value: [this.tread[2]] },
      RRwearM: { value: [this.tread[3]] },
      ...(this.fuel === null || !this.hasCar
        ? {}
        : { FuelLevel: { value: [this.fuel] } }),
      ...(this.energy === null
        ? {}
        : {
            LmuCarIdxEnergyRemaining: { value: [this.energy, 0.5] },
            LmuCarIdxEnergyIsVirtual: { value: [true, false] },
          }),
      ...(this.brake.length === 0
        ? {}
        : { LmuBrakeThickness: { value: [...this.brake] } }),
      ...(this.battery === null
        ? {}
        : { LmuBatteryCharge: { value: [this.battery] } }),
      ...(this.driversSoFar === null
        ? {}
        : { DCDriversSoFar: { value: [this.driversSoFar] } }),
      ...(this.pitStopEstimate === null
        ? {}
        : { LmuPitStopTime: { value: [this.pitStopEstimate] } }),
      ...Object.fromEntries(
        Object.entries(this.extra).map(([key, value]) => [key, { value }])
      ),
    } as unknown as Telemetry;
  }
}

export interface LedgerHarnessOptions extends LedgerSimOptions {
  simulator?: string;
  /** What the lap library holds for the track and car, for a baseline. */
  baseline?: LapLibraryLap[];
  /** Leave the session for the spec to send. */
  withoutSession?: boolean;
  /** What the wear forecast is given from outside; nothing without. */
  wear?: PlayerLedgerRuntimeOptions['wear'];
}

/** A runtime on a real bus and lifecycle, storage that only takes notes. */
export const createLedgerHarness = (options: LedgerHarnessOptions = {}) => {
  const bus = new ChannelBus();
  const lifecycle = createSessionLifecycle();
  const stored = {
    laps: [] as { session: LapSessionInput; lap: LapInput }[],
    stints: [] as { session: LapSessionInput; input: StintInput }[],
    baselineAsked: 0,
  };
  const persistence: PlayerLedgerPersistence = {
    recordLap: (session, lap) => {
      stored.laps.push({ session, lap });
      return Promise.resolve(stored.laps.length);
    },
    upsertStint: (session, input) => {
      stored.stints.push({ session, input });
    },
    recentLedgerLaps: () => {
      stored.baselineAsked += 1;
      return Promise.resolve(options.baseline ?? []);
    },
  };
  const logs: string[] = [];
  let clock = Date.UTC(2026, 10, 15, 12, 0, 0);
  const runtime = new PlayerLedgerRuntime(
    bus,
    lifecycle,
    { markStart: () => undefined, markEnd: () => undefined },
    persistence,
    {
      simulator: options.simulator ?? 'lmu',
      bootId: 'boot',
      now: () => (clock += 1000),
      log: (message) => logs.push(message),
      wear: options.wear,
    }
  );
  const sim = new LedgerSim((frame) => runtime.onFrame(frame), options);
  if (!options.withoutSession) runtime.onSession(ledgerSession());
  return { runtime, bus, lifecycle, stored, logs, sim };
};
