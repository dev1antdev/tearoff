import type {
  FuelBudget,
  LapInput,
  LapLedgerInput,
  LapLibraryLap,
  LapSessionInput,
  LedgerLap,
  LedgerStint,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
  Session,
  StintInput,
  Telemetry,
} from '@irdashies/types';
import {
  EMPTY_PLAYER_STINT,
  PLAYER_LEDGER_MAX_LAPS,
  PLAYER_LEDGER_MAX_STINTS,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import {
  BASELINE_EXCLUDED_FLAGS,
  isWetLap,
  lapFlagsOf,
  sessionFlagLapBits,
  voidFlagIsThisLaps,
} from '../../shared/lapValidity';
import { LEDGER_LAP_CAUTION } from '../../types/ledger';
import type { ChannelBus } from '../bridge/channelBus';
import type { SessionLifecycle } from '../sessionLifecycle';
import {
  createMeterReading,
  LapCostMeter,
  WHEEL_COUNT,
  type LapCost,
  type WearCurves,
} from './LapCostMeter';
import type { PerformanceSections } from './lapHistoryRuntime';
import { bucketIndex } from './lapTiming';
import {
  BASELINE_LAPS,
  baselineFrom,
  LedgerRateBook,
  type LedgerRates,
} from './ledgerRates';
import { PlayerLapRecorder, type ClosedLap } from './PlayerLapRecorder';
import { createStintFrame, StintTracker } from './StintTracker';

/**
 * The player's ledger: what every lap cost and which stint it belongs to,
 * kept whether or not a widget is on screen.
 *
 * It is not a processor under the ProcessorHost, because a processor runs
 * only while a window wants its channel, and a record with a hole for every
 * minute no ledger widget was showing would be no record. Like the lap
 * history it is hosted beside the host: pure classes inside -- the lap
 * recorder for where a lap begins and ends, the meter for what it cost, the
 * tracker for the stints -- with the channel bus and the storage handed in.
 *
 * One lap boundary for everything: the recorder decides it and tells this
 * through its hooks, so a ledger row and the lap library's row are the same
 * lap by construction.
 *
 * Two channels come out of it. `player-ledger.snapshot` is the laps and the
 * stints that are over; `player-stint.snapshot` is the stint under way. A
 * window that subscribes late is sent both as they stand, so a widget shown
 * in the middle of a stint still sees all of it.
 */

/** Where the ledger's laps and stints are kept: the lap library. */
export interface PlayerLedgerPersistence {
  /** Stores a lap; settles with its row id, or null when it was not stored. */
  recordLap(session: LapSessionInput, lap: LapInput): Promise<number | null>;
  /** Stores a stint or brings the stored one up to date. */
  upsertStint(session: LapSessionInput, stint: StintInput): void;
  /** The latest laps with a ledger row for a track and car, newest first. */
  recentLedgerLaps(
    simulator: string,
    trackId: number,
    carKey: string,
    limit: number,
    withoutFlags?: number
  ): Promise<LapLibraryLap[]>;
}

export interface PlayerLedgerRuntimeOptions {
  /** 'iracing' or 'lmu'. */
  simulator: string;
  /** Wall-clock time in Unix milliseconds. */
  now: () => number;
  /** Distinguishes one run of the app from the next. */
  bootId: string;
  /** Where the line about a stint opening or closing goes. */
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

const LEDGER_CHANNEL = 'player-ledger.snapshot';
const STINT_CHANNEL = 'player-stint.snapshot';

/**
 * How long after the line the sim's own lap time is read. It can arrive a
 * moment before the app's crossing under Le Mans Ultimate and up to about
 * two and a half seconds after it under iRacing.
 */
const SIM_LAP_TIME_DELAY_S = 3;
/** The sim's time is the same lap's when it is this close to the app's. */
const SIM_LAP_TIME_MATCH_S = 0.5;
/** The stint under way is looked at this often, in session seconds. */
const STINT_REFRESH_S = 0.2;

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const numberAt = (cells: Cells, key: string, index = 0): number | null => {
  const value = cells[key]?.value?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const flagAt = (cells: Cells, key: string, index = 0): boolean => {
  const value = cells[key]?.value?.[index];
  return value === true || value === 1;
};

const TREAD_KEYS = ['LFwearM', 'RFwearM', 'LRwearM', 'RRwearM'] as const;
const TYRES_USED_KEYS = [
  'LFTiresUsed',
  'RFTiresUsed',
  'LRTiresUsed',
  'RRTiresUsed',
] as const;

/** Rounds to a number of decimals, as a value that prints with that many. */
const roundTo = (value: number | null, decimals: number): number | null => {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const roundWheels = (
  values: readonly (number | null)[],
  decimals: number
): (number | null)[] => values.map((value) => roundTo(value, decimals));

/** A lap that has closed and is waiting for the sim's own time for it. */
interface PendingRow {
  row: LedgerLap;
  /** Session time from which the sim's lap time is read. */
  dueAt: number;
  /** What `LapLastLapTime` held before this lap could have changed it. */
  simBefore: number | null;
  /** What is to be stored, when laps are being stored. */
  write: { session: LapSessionInput; lap: LapInput } | null;
}

/** What is gathered about the lap under way, frame by frame. */
interface LapWatch {
  open: boolean;
  /** Opened by the car being let go from the line, not at a crossing. */
  fromStart: boolean;
  outLap: boolean;
  inLap: boolean;
  onPitRoad: boolean;
  voided: boolean;
  own: boolean;
  incident: boolean;
  sessionBits: number;
  wetness: number;
  rain: number;
  declaredWet: boolean;
  /** When `LapLastLapTime` is read as "before this lap": the lap before's. */
  simBeforeAt: number;
  simBefore: number | null;
  /** Session time at the line and at each sector boundary passed since. */
  sectorTimes: number[];
  prevPct: number;
  prevTime: number;
}

export class PlayerLedgerRuntime {
  private readonly recorder: PlayerLapRecorder;
  private readonly meter: LapCostMeter;
  private readonly tracker: StintTracker;
  private readonly rateBook = new LedgerRateBook();
  private readonly reading = createMeterReading();
  private readonly stintFrame = createStintFrame();
  private readonly disconnects: (() => void)[];

  /** Newest first. */
  private laps: LedgerLap[] = [];
  /** Closed stints, newest first. */
  private stints: LedgerStint[] = [];
  private ledgerVersion = 0;
  private publishedLedgerVersion = -1;
  private ledger: PlayerLedgerSnapshot = {
    laps: [],
    stints: [],
    sessionNum: null,
    version: 0,
  };

  private stint: PlayerStintSnapshot = EMPTY_PLAYER_STINT;
  private stintSignature = '';
  private stintVersion = 0;
  private publishedStintVersion = -1;
  private stintRefreshedAt = Number.NEGATIVE_INFINITY;
  private stintDirty = true;
  private ledgerSubscribers = 0;
  private stintSubscribers = 0;

  private pending: PendingRow | null = null;
  /** Moves on every reset, so an answer from storage for the old state is dropped. */
  private generation = 0;

  private persisting = true;
  private paused = false;
  private sessionNum: number | null = null;
  private sessionTime = 0;
  private lapNumber: number | null = null;
  private budget: FuelBudget = 'fuel';
  private hasCar = false;
  private rates: LedgerRates | null = null;

  private readonly sessionTypes = new Map<number, string>();
  private readonly tyreNames = new Map<number, string>();
  private sectorStarts: number[] = [];
  private driver: string | null = null;
  private baselineKey = '';

  /** The session the open stint is filed under, and when it opened. */
  private stintSession: LapSessionInput | null = null;
  private stintStartedAt = 0;
  private lastClosed: StintInput | null = null;

  private readonly watch: LapWatch = {
    open: false,
    fromStart: false,
    outLap: false,
    inLap: false,
    onPitRoad: false,
    voided: false,
    own: true,
    incident: false,
    sessionBits: 0,
    wetness: 0,
    rain: 0,
    declaredWet: false,
    simBeforeAt: 0,
    simBefore: null,
    sectorTimes: [],
    prevPct: -1,
    prevTime: 0,
  };
  /** A lap closed on this frame, before the one that opened on it. */
  private closedOnFrame = false;

  constructor(
    private readonly bus: ChannelBus,
    lifecycle: Pick<SessionLifecycle, 'onEnter' | 'onDisconnect'>,
    private readonly metrics: PerformanceSections,
    private readonly persistence: PlayerLedgerPersistence,
    private readonly options: PlayerLedgerRuntimeOptions
  ) {
    this.meter = new LapCostMeter({
      liveTread: options.simulator !== 'iracing',
    });
    this.tracker = new StintTracker(
      this.meter,
      {
        onStintOpened: (stint) => this.onStintOpened(stint),
        onStintClosed: (stint) => this.onStintClosed(stint),
        onStintDiscarded: (stint) => this.onStintDiscarded(stint),
      },
      {
        sessionToken: () => this.recorder.sessionToken(),
        compoundNames: () => this.compoundNames(),
      }
    );
    this.recorder = new PlayerLapRecorder(
      { record: (session, lap) => this.onLapRecorded(session, lap) },
      {
        simulator: options.simulator,
        bootId: options.bootId,
        now: options.now,
        hooks: {
          onLapOpened: (startTime, frame, fromStart) =>
            this.onLapOpened(startTime, frame, fromStart),
          onLapClosed: (closed, frame) => this.onLapClosed(closed, frame),
          onLapAbandoned: () => this.onLapAbandoned(),
        },
      }
    );
    this.disconnects = [
      lifecycle.onEnter(() => this.onEnter()),
      lifecycle.onDisconnect(() => this.onDisconnect()),
      bus.onSubscriberCountChanged((channel, count) => {
        // The bus drops what it holds when the last window leaves, and
        // neither channel says anything again until something changes: a
        // window that arrives is sent what there is.
        if (channel === LEDGER_CHANNEL) {
          const gained = count > 0 && this.ledgerSubscribers === 0;
          this.ledgerSubscribers = count;
          if (gained) this.publishLedger(true);
        }
        if (channel === STINT_CHANNEL) {
          const gained = count > 0 && this.stintSubscribers === 0;
          this.stintSubscribers = count;
          if (gained) {
            this.refreshStint();
            this.publishStint(true);
          }
        }
      }),
    ];
  }

  /**
   * Whether laps and stints are stored. Off for a tape, a replay source and
   * demo mode: everything is still measured and published, nothing written.
   */
  setPersisting(persisting: boolean): void {
    this.persisting = persisting;
    this.recorder.setPersisting(persisting);
  }

  /**
   * Stops everything while an iRacing replay file is loaded: scrubbing is
   * not driving. What was under way is closed as a lost connection would.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.recorder.setEnabled(!paused);
    this.tracker.end('disconnect');
    this.settlePending(null);
    this.meter.reset();
    this.tracker.reset();
    this.hasCar = false;
    this.stintDirty = true;
    this.publish();
  }

  onSession(session: Session): void {
    const identity = this.recorder.identityKey();
    this.recorder.onSession(session);
    if (this.recorder.identityKey() !== identity && identity !== '') {
      // Another event, track or car with the sim still connected.
      this.tracker.end('session');
      this.settlePending(null);
      this.clear();
    }

    this.sessionTypes.clear();
    for (const entry of session.SessionInfo?.Sessions ?? []) {
      if (entry?.SessionNum != null && entry.SessionType) {
        this.sessionTypes.set(entry.SessionNum, entry.SessionType);
      }
    }
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = session.DriverInfo?.Drivers?.find(
      (driver) => driver?.CarIdx === playerCarIdx
    );
    this.driver = player?.UserName || null;
    this.tyreNames.clear();
    for (const tyre of session.DriverInfo?.DriverTires ?? []) {
      if (tyre && typeof tyre.TireCompoundType === 'string') {
        this.tyreNames.set(tyre.TireIndex, tyre.TireCompoundType);
      }
    }
    // Sector times of its own only where the sim states none and the track
    // has the three sectors a row has room for.
    const sectors = [...(session.SplitTimeInfo?.Sectors ?? [])]
      .map((sector) => sector?.SectorStartPct)
      .filter((pct): pct is number => typeof pct === 'number')
      .sort((a, b) => a - b);
    this.sectorStarts =
      this.options.simulator !== 'lmu' && sectors.length === 3
        ? sectors.slice(1)
        : [];

    this.meter.setCurvePoints(this.recorder.curvePoints());
    this.requestBaseline();
  }

  onFrame(frame: Telemetry): void {
    if (this.paused) return;
    this.metrics.markStart('playerLedgerProcessing');
    this.process(frame);
    this.metrics.markEnd('playerLedgerProcessing');
    this.publish();
  }

  /** The laps and the stints that are over, as last built. */
  ledgerSnapshot(): PlayerLedgerSnapshot {
    this.buildLedger();
    return this.ledger;
  }

  /** The stint under way, as it stands now. */
  stintSnapshot(): PlayerStintSnapshot {
    this.refreshStint();
    return this.stint;
  }

  /** Per-lap rates with the wheels, for the forecasts that want them. */
  currentRates(): LedgerRates {
    return this.currentLedgerRates();
  }

  /** The wear curve of the last lap fit to be one, for the wear forecast. */
  referenceWearCurves(): WearCurves | null {
    return this.meter.referenceCurves();
  }

  /**
   * Lets go of everything, storing what is still in hand first. Called when
   * the app quits and when another simulator takes over: for the record
   * that is the connection ending, so the open stint is closed as one, with
   * the levels it had, and the lap waiting for its time goes as it is.
   *
   * Only a crash leaves a stint open in the library; a reader then rebuilds
   * its end from its last lap.
   */
  dispose(): void {
    this.tracker.end('disconnect');
    this.settlePending(null);
    this.disconnects.forEach((disconnect) => disconnect());
    this.disconnects.length = 0;
  }

  private onEnter(): void {
    // A connection that was never seen to end still ended.
    this.tracker.end('disconnect');
    this.settlePending(null);
    this.recorder.onEnter();
    this.clear();
    this.baselineKey = '';
    this.requestBaseline();
    this.publish();
  }

  private onDisconnect(): void {
    this.recorder.onDisconnect();
    this.tracker.end('disconnect');
    this.settlePending(null);
    this.clear();
    this.publish();
  }

  /** Empties the rings and everything measured: as a new connection. */
  private clear(): void {
    this.generation += 1;
    this.laps = [];
    this.stints = [];
    this.ledgerVersion += 1;
    this.pending = null;
    this.lastClosed = null;
    this.meter.reset();
    this.tracker.reset();
    this.rateBook.reset();
    this.rates = null;
    this.watch.open = false;
    this.sessionNum = null;
    this.lapNumber = null;
    this.hasCar = false;
    this.stintDirty = true;
  }

  private process(frame: Telemetry): void {
    const cells = frame as unknown as Cells;
    const sessionTime = numberAt(cells, 'SessionTime');
    if (sessionTime === null) return;
    const sessionNum = numberAt(cells, 'SessionNum');
    if (this.sessionNum !== null && sessionNum !== this.sessionNum) {
      // Practice to qualifying to race: the stint ends with its session and
      // the lap in hand is stored under it. The rings are kept.
      this.tracker.end('session');
      this.settlePending(null);
      this.stintDirty = true;
    }
    if (sessionNum !== this.sessionNum) {
      this.sessionNum = sessionNum;
      this.ledgerVersion += 1;
      // The session's own laps are what a rate falls back to.
      this.rates = null;
      this.stintDirty = true;
    }
    this.sessionTime = sessionTime;

    const player = this.recorder.playerSlot();
    const playerIdx = numberAt(cells, 'PlayerCarIdx');
    const surface = numberAt(cells, 'PlayerTrackSurface');
    const hasCar =
      this.recorder.hasPlayer() &&
      (playerIdx === null || playerIdx >= 0) &&
      surface !== TrackLocation.NotInWorld;
    if (hasCar !== this.hasCar) {
      this.hasCar = hasCar;
      this.stintDirty = true;
    }
    const frozen = flagAt(cells, 'LmuDataStale');
    const onPitRoad =
      hasCar &&
      (flagAt(cells, 'OnPitRoad') || flagAt(cells, 'CarIdxOnPitRoad', player));
    const inGarage =
      hasCar &&
      (flagAt(cells, 'IsInGarage') ||
        flagAt(cells, 'LmuCarIdxInGarage', player));
    const speed = numberAt(cells, 'Speed');
    const pct = hasCar ? numberAt(cells, 'CarIdxLapDistPct', player) : null;
    const sessionState = numberAt(cells, 'SessionState') ?? 0;
    const isRace =
      sessionNum !== null && this.sessionTypes.get(sessionNum) === 'Race';
    const beforeGreen = isRace && sessionState < SessionState.Racing;

    // The meter first, so that a lap closing on this frame is read at it.
    const reading = this.reading;
    reading.sessionTime = sessionTime;
    reading.speed = speed;
    reading.inPits = onPitRoad || inGarage;
    reading.frozen = frozen || !hasCar;
    if (hasCar) {
      reading.fuel = numberAt(cells, 'FuelLevel');
      const virtual = flagAt(cells, 'LmuCarIdxEnergyIsVirtual', player);
      const energy = virtual
        ? numberAt(cells, 'LmuCarIdxEnergyRemaining', player)
        : null;
      reading.energy = energy !== null && energy >= 0 ? energy : null;
      this.budget = reading.energy !== null ? 'virtualEnergy' : 'fuel';
      const single = numberAt(cells, 'PlayerTireCompound');
      for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
        reading.tread[wheel] = numberAt(cells, TREAD_KEYS[wheel]);
        const disc = numberAt(cells, 'LmuBrakeThickness', wheel);
        reading.brake[wheel] = disc !== null && disc > 0 ? disc : null;
        reading.compound[wheel] =
          numberAt(cells, 'LmuCarIdxWheelCompounds', player * 4 + wheel) ??
          single ??
          -1;
        reading.tyresUsed[wheel] =
          this.options.simulator === 'iracing'
            ? numberAt(cells, TYRES_USED_KEYS[wheel])
            : null;
      }
      reading.battery = numberAt(cells, 'LmuBatteryCharge');
      const points = this.recorder.curvePoints();
      reading.bucket =
        this.watch.open && pct !== null && pct > 0 && pct <= 1 && points > 0
          ? bucketIndex(pct, points)
          : -1;
      this.meter.update(reading);
      const changed = this.meter.takeTyreChanges();
      if (changed !== 0) {
        this.rateBook.noteTyreChange(changed);
        this.rates = null;
      }
    }

    // The lap under way, before the recorder may close it on this frame.
    const watch = this.watch;
    if (watch.open && hasCar && !frozen) {
      if (onPitRoad && !watch.onPitRoad) watch.inLap = true;
      watch.onPitRoad = onPitRoad;
      watch.sessionBits |= sessionFlagLapBits(
        numberAt(cells, 'SessionFlags') ?? 0
      );
      // A lap of a race driven before its green flag is not driven at
      // racing speed any more than one behind a safety car.
      if (beforeGreen) watch.sessionBits |= LEDGER_LAP_CAUTION;
      const wetness = numberAt(cells, 'TrackWetness') ?? 0;
      if (wetness > watch.wetness) watch.wetness = wetness;
      const rain = numberAt(cells, 'Precipitation') ?? 0;
      if (rain > watch.rain) watch.rain = rain;
      if (flagAt(cells, 'WeatherDeclaredWet')) watch.declaredWet = true;
      if (
        flagAt(cells, 'LmuLapInvalidated') &&
        pct !== null &&
        voidFlagIsThisLaps(pct)
      ) {
        watch.voided = true;
      }
      if (!flagAt(cells, 'IsOnTrack')) watch.own = false;
      if (
        this.options.simulator === 'iracing' &&
        (surface === TrackLocation.OffTrack ||
          (numberAt(cells, 'PlayerCarTowTime') ?? 0) > 0)
      ) {
        watch.incident = true;
      }
      if (watch.simBefore === null && sessionTime >= watch.simBeforeAt) {
        watch.simBefore = numberAt(cells, 'LapLastLapTime') ?? -1;
      }
      this.timeSectors(pct, sessionTime);
    }

    this.closedOnFrame = false;
    this.recorder.onFrame(frame);

    const stintFrame = this.stintFrame;
    stintFrame.sessionTime = sessionTime;
    stintFrame.sessionNum = sessionNum;
    stintFrame.hasCar = hasCar;
    stintFrame.onPitRoad = onPitRoad;
    stintFrame.inGarage = inGarage;
    stintFrame.beforeGreen = beforeGreen;
    stintFrame.speed = speed;
    stintFrame.lapCompleted = numberAt(cells, 'LapCompleted') ?? 0;
    stintFrame.driver = this.driver;
    stintFrame.atWheel = flagAt(cells, 'IsOnTrack');
    stintFrame.driversSoFar = numberAt(cells, 'DCDriversSoFar');
    const estimate = numberAt(cells, 'LmuPitStopTime');
    stintFrame.simEstimate =
      estimate !== null && estimate > 0 ? estimate : null;
    stintFrame.frozen = frozen;
    const stateBefore = this.tracker.state();
    this.tracker.update(stintFrame);
    if (this.tracker.state() !== stateBefore) this.stintDirty = true;

    this.lapNumber = hasCar ? numberAt(cells, 'Lap') : null;
    const pending = this.pending;
    if (pending && sessionTime >= pending.dueAt) this.settlePending(cells);
    if (pending && sessionTime < pending.row.endTime) this.settlePending(null);
  }

  /**
   * Times the sectors of the lap under way where the sim gives none: the
   * moment the car passes each of the session's sector boundaries, placed
   * between the two frames either side of it.
   */
  private timeSectors(pct: number | null, sessionTime: number): void {
    const watch = this.watch;
    if (this.sectorStarts.length > 0 && pct !== null && watch.prevPct >= 0) {
      const boundary = this.sectorStarts[watch.sectorTimes.length - 1];
      if (
        boundary !== undefined &&
        watch.prevPct < boundary &&
        pct >= boundary &&
        pct - watch.prevPct < 0.25
      ) {
        const span = pct - watch.prevPct;
        const share = span > 0 ? (boundary - watch.prevPct) / span : 1;
        watch.sectorTimes.push(
          watch.prevTime + share * (sessionTime - watch.prevTime)
        );
      }
    }
    watch.prevPct = pct ?? -1;
    watch.prevTime = sessionTime;
  }

  private onLapOpened(
    startTime: number,
    frame: Telemetry,
    fromStart: boolean
  ): void {
    const cells = frame as unknown as Cells;
    const player = this.recorder.playerSlot();
    const onPitRoad =
      flagAt(cells, 'OnPitRoad') || flagAt(cells, 'CarIdxOnPitRoad', player);
    const watch = this.watch;
    watch.open = true;
    watch.fromStart = fromStart;
    watch.outLap = onPitRoad;
    watch.inLap = false;
    watch.onPitRoad = onPitRoad;
    watch.voided = false;
    watch.own = flagAt(cells, 'IsOnTrack');
    watch.incident = false;
    watch.sessionBits = 0;
    watch.wetness = numberAt(cells, 'TrackWetness') ?? 0;
    watch.rain = numberAt(cells, 'Precipitation') ?? 0;
    watch.declaredWet = flagAt(cells, 'WeatherDeclaredWet');
    watch.simBeforeAt = startTime + SIM_LAP_TIME_DELAY_S;
    watch.simBefore = null;
    watch.sectorTimes = [startTime];
    watch.prevPct = numberAt(cells, 'CarIdxLapDistPct', player) ?? -1;
    watch.prevTime = this.sessionTime;
    this.meter.openLap();
    // A crossing that ended no lap is still a lap of the stint: the stretch
    // from the pit exit, or from joining, to the line.
    if (!fromStart && !this.closedOnFrame) this.tracker.noteCrossing();
    this.stintDirty = true;
  }

  private onLapClosed(closed: ClosedLap, frame: Telemetry): void {
    const cells = frame as unknown as Cells;
    const watch = this.watch;
    const { lap } = closed;
    const pitLap = watch.inLap || watch.outLap;
    const cost = this.meter.closeLap(!pitLap && lap.own);
    const flags = lapFlagsOf({
      inLap: watch.inLap,
      outLap: watch.outLap,
      voided: lap.voided,
      incident: watch.incident || (lap.incidents !== null && lap.incidents > 0),
      sessionBits: watch.sessionBits,
      wet: isWetLap(watch.wetness, watch.declaredWet),
      own: lap.own,
      fromStart: closed.fromStart,
      serviced: cost.serviced,
    });
    // A lap in hand is settled before the next takes its place.
    this.settlePending(null);
    const { stintId, stintLap } = this.tracker.noteLap(flags, lap.lapTime);
    const player = this.recorder.playerSlot();
    const position = numberAt(cells, 'PlayerCarPosition');
    const classPosition =
      numberAt(cells, 'CarIdxClassPosition', player) ??
      numberAt(cells, 'PlayerCarClassPosition');
    const row: LedgerLap = {
      id: 0,
      stintId,
      sessionNum: this.sessionNum,
      lapNumber: lap.lapNumber,
      stintLap,
      startTime: closed.startTime,
      endTime: closed.endTime,
      lapTime: lap.lapTime,
      simLapTime: null,
      flags,
      // Le Mans Ultimate keeps no incident count; its 0 is not a clean lap.
      incidents: this.options.simulator === 'lmu' ? null : lap.incidents,
      ...costFields(cost),
      compounds: this.compoundNames(),
      sectors: this.ownSectors(closed.endTime),
      wetness: watch.wetness,
      rain: watch.rain,
      airTemp: lap.airTemp,
      trackTemp: lap.trackTemp,
      position: position !== null && position > 0 ? position : null,
      classPosition:
        classPosition !== null && classPosition > 0 ? classPosition : null,
    };
    watch.open = false;
    this.closedOnFrame = true;
    this.laps.unshift(row);
    if (this.laps.length > PLAYER_LEDGER_MAX_LAPS) {
      this.laps.length = PLAYER_LEDGER_MAX_LAPS;
    }
    this.rateBook.noteLap(row);
    this.rates = null;
    this.ledgerVersion += 1;
    this.stintDirty = true;
    this.pending = {
      row,
      dueAt: closed.endTime + SIM_LAP_TIME_DELAY_S,
      simBefore: watch.simBefore,
      write: null,
    };
  }

  /** The recorder hands the lap over to be stored: held with its row. */
  private onLapRecorded(session: LapSessionInput, lap: LapInput): void {
    if (this.pending) this.pending.write = { session, lap };
  }

  private onLapAbandoned(): void {
    this.watch.open = false;
    this.meter.abandonLap();
    this.stintDirty = true;
  }

  /** S1, S2 and S3 as timed here, where the sim's own are not to come. */
  private ownSectors(endTime: number): (number | null)[] {
    const times = this.watch.sectorTimes;
    if (this.sectorStarts.length !== 2 || times.length !== 3) {
      return [null, null, null];
    }
    return [times[1] - times[0], times[2] - times[1], endTime - times[2]];
  }

  /**
   * Gives the lap in hand the sim's own time and sectors, and stores it.
   *
   * @param cells The frame to read them from, three seconds after the line;
   *   null when the lap cannot wait that long, and goes as it is.
   */
  private settlePending(cells: Cells | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    let row = pending.row;
    if (cells) {
      const simLapTime = this.simLapTime(cells, pending);
      const sectors =
        this.options.simulator === 'lmu' ? simSectors(cells) : null;
      if (simLapTime !== null || sectors) {
        row = this.patchRow(row, {
          simLapTime,
          ...(sectors ? { sectors } : {}),
        });
      }
    }
    const write = pending.write;
    if (!write) return;
    const generation = this.generation;
    this.persistence
      .recordLap(write.session, {
        ...write.lap,
        // The refuel-corrected figures, where the recorder's own are the
        // plain difference between the two ends.
        fuelUsed: row.fuelUsed,
        energyUsed: row.energyUsed,
        ledger: this.ledgerInput(row),
      })
      .then((lapId) => {
        if (lapId === null || generation !== this.generation) return;
        this.patchRow(row, { id: lapId });
        this.publishLedger(false);
      })
      .catch((error: unknown) => {
        this.options.logError?.('[Ledger] Could not store a lap:', error);
      });
  }

  /**
   * The sim's time for the lap, read once it has had time to arrive: taken
   * when it is a time at all, and either moved since the lap before or is
   * within half a second of the app's own.
   */
  private simLapTime(cells: Cells, pending: PendingRow): number | null {
    const value = numberAt(cells, 'LapLastLapTime');
    if (value === null || !(value > 0)) return null;
    const moved = pending.simBefore === null || value !== pending.simBefore;
    const close = Math.abs(value - pending.row.lapTime) <= SIM_LAP_TIME_MATCH_S;
    return moved || close ? value : null;
  }

  /** Replaces a row of the ring with a changed copy, and says it moved. */
  private patchRow(row: LedgerLap, change: Partial<LedgerLap>): LedgerLap {
    const index = this.laps.indexOf(row);
    const patched = { ...row, ...change };
    if (index < 0) return patched;
    this.laps[index] = patched;
    this.ledgerVersion += 1;
    return patched;
  }

  /** The ledger's half of a lap on its way into the library. */
  private ledgerInput(row: LedgerLap): LapLedgerInput {
    return {
      sessionNum: row.sessionNum,
      stintLap: row.stintLap,
      startTime: row.startTime,
      endTime: row.endTime,
      simLapTime: row.simLapTime,
      flags: row.flags,
      fuelAtLine: row.fuelAtLine,
      fuelAdded: row.fuelAdded,
      energyAtLine: row.energyAtLine,
      energyAdded: row.energyAdded,
      treadAtLine: row.treadAtLine,
      treadUsed: row.treadUsed,
      brakeAtLine: row.brakeAtLine,
      brakeUsed: row.brakeUsed,
      compounds: row.compounds,
      sectors: row.sectors,
      wetness: row.wetness,
      rain: row.rain,
      position: row.position,
      classPosition: row.classPosition,
      batteryDrainPct: row.batteryDrainPct,
      batteryRegenPct: row.batteryRegenPct,
      stint: this.stintInput(row.stintId),
    };
  }

  /** A stint as it stands now, for the library: open, or just closed. */
  private stintInput(stintId: string): StintInput | null {
    if (stintId === '') return null;
    if (this.tracker.openStintId() === stintId) {
      const stint = this.tracker.present(this.stintFrame);
      return stint
        ? { stint, startedAt: this.stintStartedAt, endedAt: null }
        : null;
    }
    return this.lastClosed?.stint.id === stintId ? this.lastClosed : null;
  }

  private onStintOpened(stint: LedgerStint): void {
    this.stintSession = this.recorder.currentSession();
    this.stintStartedAt = this.options.now();
    this.rates = null;
    this.stintDirty = true;
    this.options.log?.(
      `[Ledger] Stint ${stint.ordinal} opened (${stint.openedBy}) at ` +
        `${stint.startTime.toFixed(1)} s, lap ${stint.startLap}: ` +
        `${levelText(stint.startFuel, stint.startEnergy)}, ` +
        `${stint.own ? 'own' : 'not own'}`
    );
    if (this.persisting && this.stintSession) {
      this.persistence.upsertStint(this.stintSession, {
        stint,
        startedAt: this.stintStartedAt,
        endedAt: null,
      });
    }
  }

  private onStintClosed(stint: LedgerStint): void {
    const input: StintInput = {
      stint,
      startedAt: this.stintStartedAt,
      endedAt: this.options.now(),
    };
    this.lastClosed = input;
    this.stints.unshift(stint);
    if (this.stints.length > PLAYER_LEDGER_MAX_STINTS) {
      this.stints.length = PLAYER_LEDGER_MAX_STINTS;
    }
    this.ledgerVersion += 1;
    this.rates = null;
    this.stintDirty = true;
    this.options.log?.(closedText(stint));
    if (this.persisting && this.stintSession) {
      this.persistence.upsertStint(this.stintSession, input);
    }
  }

  private onStintDiscarded(stint: LedgerStint): void {
    this.stintDirty = true;
    this.options.log?.(
      `[Ledger] Stint ${stint.ordinal} ended (${stint.closedBy}) without a lap: not kept`
    );
    // If the library took it when it opened, this is what drops it there.
    if (this.persisting && this.stintSession) {
      this.persistence.upsertStint(this.stintSession, {
        stint,
        startedAt: this.stintStartedAt,
        endedAt: this.options.now(),
      });
    }
  }

  private compoundNames(): (string | null)[] {
    return this.meter
      .compoundIndices()
      .map((index) => this.tyreNames.get(index) ?? null);
  }

  /** Asks the library what this track and car usually cost, once per key. */
  private requestBaseline(): void {
    const session = this.recorder.currentSession();
    if (!session || !this.persisting) return;
    const key = `${session.simulator}|${session.trackId}|${session.carKey}`;
    if (key === this.baselineKey) return;
    this.baselineKey = key;
    this.rateBook.setBaseline(null);
    this.persistence
      .recentLedgerLaps(
        session.simulator,
        session.trackId,
        session.carKey,
        BASELINE_LAPS,
        BASELINE_EXCLUDED_FLAGS
      )
      .then((laps) => {
        if (key !== this.baselineKey) return;
        this.rateBook.setBaseline(baselineFrom(laps));
        this.rates = null;
        this.stintDirty = true;
      })
      .catch((error: unknown) => {
        this.options.logError?.('[Ledger] Could not read a baseline:', error);
      });
  }

  private currentLedgerRates(): LedgerRates {
    this.rates ??= this.rateBook.rates(
      this.laps,
      this.tracker.openStintId(),
      this.sessionNum,
      this.compoundNames()
    );
    return this.rates;
  }

  private publish(): void {
    this.publishLedger(false);
    // The stint under way is only put together while a window reads it; the
    // stint itself is followed all the same.
    if (this.stintSubscribers === 0) return;
    if (
      this.stintDirty ||
      this.sessionTime - this.stintRefreshedAt >= STINT_REFRESH_S ||
      this.sessionTime < this.stintRefreshedAt
    ) {
      this.refreshStint();
    }
    this.publishStint(false);
  }

  private buildLedger(): void {
    if (this.ledger.version === this.ledgerVersion) return;
    this.ledger = {
      laps: this.laps.slice(),
      stints: this.stints.slice(),
      sessionNum: this.sessionNum,
      version: this.ledgerVersion,
    };
  }

  private publishLedger(force: boolean): void {
    if (!force && this.ledgerVersion === this.publishedLedgerVersion) return;
    this.buildLedger();
    this.publishedLedgerVersion = this.ledgerVersion;
    this.metrics.markStart('playerLedgerPublication');
    this.bus.publish(LEDGER_CHANNEL, this.ledger);
    this.metrics.markEnd('playerLedgerPublication');
  }

  private publishStint(force: boolean): void {
    if (!force && this.stintVersion === this.publishedStintVersion) return;
    this.publishedStintVersion = this.stintVersion;
    this.metrics.markStart('playerLedgerPublication');
    this.bus.publish(STINT_CHANNEL, this.stint);
    this.metrics.markEnd('playerLedgerPublication');
  }

  /**
   * Rebuilds the stint under way with its figures rounded -- time to whole
   * seconds, litres to 0.01, energy to 0.0001, tread to 0.001 -- and moves
   * the version only when one of them moved.
   */
  private refreshStint(): void {
    this.stintRefreshedAt = this.sessionTime;
    this.stintDirty = false;
    const present = this.tracker.present(this.stintFrame);
    const stint: LedgerStint | null = present && {
      ...present,
      endTime: present.endTime === null ? null : Math.floor(present.endTime),
      endFuel: roundTo(present.endFuel, 2),
      endEnergy: roundTo(present.endEnergy, 4),
      endTread: roundWheels(present.endTread, 3),
      endBrake: roundWheels(present.endBrake, 4),
    };
    const rates = this.currentLedgerRates();
    const fuel = this.meter.fuelLevel();
    const energy = this.meter.energyLevel();
    const lapsOnFuel =
      fuel !== null && rates.fuel !== null && rates.fuel > 0
        ? fuel / rates.fuel
        : null;
    const lapsOnEnergy =
      energy !== null && rates.energy !== null && rates.energy > 0
        ? energy / rates.energy
        : null;
    const lapsLeft =
      lapsOnFuel !== null && lapsOnEnergy !== null
        ? Math.min(lapsOnFuel, lapsOnEnergy)
        : (lapsOnFuel ?? lapsOnEnergy);
    const watch = this.watch;
    const body: Omit<PlayerStintSnapshot, 'version'> = {
      available: this.hasCar,
      state: this.tracker.state(),
      budget: this.budget,
      stint,
      lap: {
        lapNumber: this.lapNumber,
        stintLap: this.tracker.openStintLaps() + 1,
        fuelUsed: roundTo(this.meter.lapFuelUsed(), 2),
        energyUsed: roundTo(this.meter.lapEnergyUsed(), 4),
        flags: watch.open
          ? lapFlagsOf({
              inLap: watch.inLap,
              outLap: watch.outLap,
              voided: watch.voided,
              incident: watch.incident,
              sessionBits: watch.sessionBits,
              wet: isWetLap(watch.wetness, watch.declaredWet),
              own: watch.own,
              fromStart: watch.fromStart,
              serviced: this.meter.lapWasServiced(),
            })
          : 0,
      },
      rates: {
        fuel: roundTo(rates.fuel, 3),
        energy: roundTo(rates.energy, 5),
        lapTime: roundTo(rates.lapTime, 3),
        source: rates.source,
      },
      budgetLapsLeft: roundTo(lapsLeft, 1),
      sessionNum: this.sessionNum,
    };
    const signature = JSON.stringify(body);
    if (signature === this.stintSignature) return;
    this.stintSignature = signature;
    this.stintVersion += 1;
    this.stint = { ...body, version: this.stintVersion };
  }
}

const costFields = (
  cost: LapCost
): Pick<
  LedgerLap,
  | 'fuelAtLine'
  | 'fuelUsed'
  | 'fuelAdded'
  | 'energyAtLine'
  | 'energyUsed'
  | 'energyAdded'
  | 'treadAtLine'
  | 'treadUsed'
  | 'brakeAtLine'
  | 'brakeUsed'
  | 'batteryDrainPct'
  | 'batteryRegenPct'
> => ({
  fuelAtLine: cost.fuelAtLine,
  fuelUsed: cost.fuelUsed,
  fuelAdded: cost.fuelAdded,
  energyAtLine: cost.energyAtLine,
  energyUsed: cost.energyUsed,
  energyAdded: cost.energyAdded,
  treadAtLine: cost.treadAtLine,
  treadUsed: cost.treadUsed,
  brakeAtLine: cost.brakeAtLine,
  brakeUsed: cost.brakeUsed,
  batteryDrainPct: cost.batteryDrainPct,
  batteryRegenPct: cost.batteryRegenPct,
});

/** The sim's sector times for the lap just driven, where it states them. */
const simSectors = (cells: Cells): (number | null)[] | null => {
  const values = cells.LmuLastSectorTimes?.value;
  if (!values || values.length < 3) return null;
  const sectors = [0, 1, 2].map((index) => {
    const value = values[index];
    return typeof value === 'number' && value > 0 ? value : null;
  });
  return sectors.some((value) => value !== null) ? sectors : null;
};

const levelText = (fuel: number | null, energy: number | null): string =>
  [
    fuel === null ? null : `fuel ${fuel.toFixed(2)} L`,
    energy === null ? null : `energy ${(energy * 100).toFixed(1)} %`,
  ]
    .filter((part) => part !== null)
    .join(', ') || 'no levels';

const usedText = (start: number | null, end: number | null): number | null =>
  start !== null && end !== null ? start - end : null;

const WHEEL_NAMES = ['LF', 'RF', 'LR', 'RR'] as const;

/** The line the log gets when a stint ends: what it was and how it ended. */
const closedText = (stint: LedgerStint): string => {
  const seconds = stint.endTime === null ? 0 : stint.endTime - stint.startTime;
  const stop = stint.stop;
  const tyres = stop
    ? WHEEL_NAMES.filter((_, wheel) => (stop.tyresChanged & (1 << wheel)) !== 0)
    : [];
  const parts = [
    `[Ledger] Stint ${stint.ordinal} closed (${stint.closedBy}): ` +
      `${stint.laps} ${stint.laps === 1 ? 'lap' : 'laps'} in ` +
      `${seconds.toFixed(0)} s`,
    `used ${levelText(
      usedText(stint.startFuel, stint.endFuel),
      usedText(stint.startEnergy, stint.endEnergy)
    )}`,
    stint.bestLap === null ? null : `best ${stint.bestLap.toFixed(3)} s`,
    stint.passes.length > 0
      ? `${stint.passes.length} pit lane visit(s) without service`
      : null,
    stop
      ? `stop ${stop.stationaryTime.toFixed(1)} s standing: ` +
        `${levelText(
          stop.fuelAdded,
          // Only for a car that has an energy budget to add to.
          stint.startEnergy === null ? null : stop.energyAdded
        )} added` +
        (tyres.length > 0 ? `, tyres ${tyres.join(' ')}` : '') +
        (stop.brakesChanged ? ', brakes' : '') +
        (stop.driverChanged ? ', driver' : '')
      : null,
  ];
  return parts.filter((part) => part !== null).join('; ');
};
