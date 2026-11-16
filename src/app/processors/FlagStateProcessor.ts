import type {
  FlagBlueCar,
  FlagDetail,
  FlagProcessorTuning,
  FlagStateSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import {
  DEFAULT_FLAG_TUNING,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_BLUE_TRAFFIC,
  FLAG_ACTIVE_CHEQUERED,
  FLAG_ACTIVE_DEBRIS,
  FLAG_ACTIVE_DISQUALIFIED,
  FLAG_ACTIVE_FCY_PHASE_SHIFT,
  FLAG_ACTIVE_FULL_COURSE_YELLOW,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_GREEN_RESTART,
  FLAG_ACTIVE_GREEN_START,
  FLAG_ACTIVE_MEATBALL,
  FLAG_ACTIVE_PENALTY,
  FLAG_ACTIVE_RED,
  FLAG_ACTIVE_START,
  FLAG_ACTIVE_WARNING,
  FLAG_ACTIVE_WHITE,
  FLAG_ACTIVE_YELLOW,
  FLAG_ACTIVE_YELLOW_NEAR,
  GlobalFlags,
  LMU_FINISH_STATUS,
  SessionState,
  TIMED_SESSION_LAPS,
  flagDetailFor,
  lmuPenaltyBadge,
  lmuPenaltyCode,
  rankFlagKind,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { parseTrackLength } from './RadarProcessor';
import { wrapDelta } from './radarMath';
import { carClassesFrom, type CarClassEntry } from './carClass';
import {
  TRAFFIC_QUEUE_GAP_S,
  TRAFFIC_SEARCH_M,
  TrafficQueue,
  isOnRacingSurface,
  relativeTimeGap,
  speedOf,
  type TrafficField,
} from './trafficRules';

/**
 * How far behind the player a car is still looked at for a blue, metres, and
 * how many seconds behind a queued car still counts. The rules themselves,
 * and the hand-over from one car to the next, are in trafficRules, which the
 * traffic widget's processor reads too.
 */
export const BLUE_SEARCH_M = TRAFFIC_SEARCH_M;
export const BLUE_QUEUE_GAP_S = TRAFFIC_QUEUE_GAP_S;
/** With no car meeting the lapping rule, the nearest one this close is named. */
const BLUE_FALLBACK_M = 150;
/** LMU's flag is a 5 Hz value and flickers at the edge of a blue. */
const BLUE_HOLD_S = 1;
/** How long the green is announced after the start or after a yellow. */
const GREEN_ANNOUNCE_S = 5;
/** TinyPedal's rule: a car slower than this on the track is the incident. */
const INCIDENT_SPEED_MS = 8;
/**
 * Seconds the smoothed speed of a car needs after LMU lets its lap fraction
 * go: the average is taken over half a second of movement, and the samples
 * from while the fraction was held read as standing still.
 */
const SPEED_SETTLE_S = 0.7;

const FLAG_TICK_HZ = 10;

/** LMU's mGamePhase, as the rFactor 2 header numbers it. */
const PHASE_BEFORE_SESSION = 0;
const PHASE_COUNTDOWN = 4;
const PHASE_GREEN = 5;
const PHASE_FULL_COURSE_YELLOW = 6;
const PHASE_STOPPED = 7;
const PHASE_OVER = 8;
/** A heartbeat while the sim is paused: it says nothing about the session. */
const PHASE_PAUSED = 9;

/** mYellowFlagState: 2 is pits closed, 3 open to cars on the lead lap. */
const YELLOW_STATE_PITS_CLOSED = 2;
const YELLOW_STATE_PIT_LEAD_LAP = 3;
/** iRacing says one lap to green; rFactor 2 calls that sub-phase 5. */
const YELLOW_STATE_LAST_LAP = 5;

const LMU_START_DETAILS: readonly FlagDetail[] = [
  'beforeSession',
  'recon',
  'grid',
  'formationLap',
  'lights',
];

const NO_VALUES: readonly unknown[] = [];

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const valuesOf = (cells: Cells, key: string): readonly unknown[] =>
  cells[key]?.value ?? NO_VALUES;

const finiteAt = (
  values: readonly unknown[],
  index: number
): number | undefined => {
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const scalarOf = (cells: Cells, key: string): number | undefined =>
  finiteAt(valuesOf(cells, key), 0);

const round1 = (value: number): number => Math.round(value * 10) / 10;

export interface FlagStateDependencies {
  /**
   * Smoothed speed per car in km/h, from car-speeds.snapshot. Empty when that
   * channel has nothing, as during a replay: no car is then judged slow or
   * closing.
   */
  carSpeeds?: () => readonly number[];
  /** The yellow ranges from the flag panel's settings; defaults without. */
  tuning?: () => FlagProcessorTuning;
}

const NO_SPEEDS: readonly number[] = [];

const emptySnapshot = (): FlagStateSnapshot => ({
  kind: 'none',
  detail: 'noSession',
  active: 0,
  since: 0,
  yellowSectors: [],
  playerSector: null,
  incidentDistM: null,
  incidentCarIdx: null,
  blue: null,
  penalty: null,
  startLights: null,
  pitLaneClosed: false,
  sessionNum: null,
  version: 0,
});

/**
 * Resolves the flag that applies to the player, and the car a blue is for.
 *
 * Both sims are read here. A frame that carries `LmuGamePhase` is LMU's and
 * the session phase, the yellow sub-phase and the sector flags are read from
 * it; without it the bits of `SessionFlags` are read as iRacing's. Flags are
 * addressed to the driver, so this follows the player's own car, not the car
 * the camera is on.
 *
 * It publishes facts and ranks them with fixed rules. What a widget chooses
 * not to show is the renderer's business: `active` carries every condition
 * that holds so that it can rank again without the one it has switched off.
 *
 * Nothing is kept between sessions and nothing is aggregated, so it runs the
 * same over a replay.
 */
export class FlagStateProcessor implements TelemetryProcessor<
  FlagStateSnapshot,
  'flag-state.snapshot'
> {
  readonly channel = 'flag-state.snapshot';
  readonly tickRateHz = FLAG_TICK_HZ;

  private readonly carSpeeds: () => readonly number[];
  private readonly tuning: () => FlagProcessorTuning;

  private trackLength = 0;
  private readonly sessionTypes = new Map<number, string>();
  /** The pace car and spectators: never an incident, never a blue. */
  private readonly excluded = new Set<number>();
  private classes: CarClassEntry[] = [];

  private readonly latest: FlagStateSnapshot = emptySnapshot();
  /** The one blue car object, attached to the snapshot while there is one. */
  private readonly blueCar: FlagBlueCar = {
    carIdx: -1,
    distanceM: 0,
    gapS: null,
    closingMs: null,
    lapsAhead: 0,
    fasterClass: false,
    confirmed: false,
    othersCount: 0,
  };

  private lastTime: number | null = null;
  /** The last phase LMU stated that was not the pause heartbeat. */
  private lastPhase = -1;
  /** What the previous frame held, for the two green announcements. */
  private hadFrame = false;
  private wasStart = false;
  private wasYellow = false;
  private greenUntil = Number.NEGATIVE_INFINITY;
  private greenReason = FLAG_ACTIVE_GREEN_START;

  /** SessionTime the sim last showed the blue. */
  private blueSeenAt = Number.NEGATIVE_INFINITY;
  private blueOut = false;
  /** A car has met the lapping rule since this blue came out. */
  private blueQualified = false;

  /** What was last published, to tell a change from a recomputation. */
  private publishedActive = 0;
  private publishedIncidentDistM: number | null = null;

  /** Metres to the car `findIncident` returned; signed, positive is ahead. */
  private incidentDist = 0;

  /** Whether `findBlueCar` changed a published field of the blue car. */
  private blueCarChanged = false;

  /**
   * Session time from which each car's smoothed speed can be read again,
   * after LMU held its lap fraction at 0. Indexed by car slot.
   */
  private readonly speedSettlesAt: number[] = [];

  /** The cars behind, the lapping rule and who holds the plate. */
  private readonly queue = new TrafficQueue();
  /** The field as the queue reads it; refilled every tick, never replaced. */
  private readonly field: TrafficField = {
    pcts: NO_VALUES,
    laps: NO_VALUES,
    surfaces: NO_VALUES,
    onPitRoad: NO_VALUES,
    speedsKmh: NO_SPEEDS,
    player: -1,
    playerPct: -1,
    trackLength: 0,
    raceRule: false,
    isLmu: false,
    classes: [],
    excluded: this.excluded,
  };

  constructor(dependencies: FlagStateDependencies = {}) {
    this.carSpeeds = dependencies.carSpeeds ?? (() => NO_SPEEDS);
    this.tuning = dependencies.tuning ?? (() => DEFAULT_FLAG_TUNING);
  }

  init(session: Session): void {
    this.trackLength = parseTrackLength(session?.WeekendInfo?.TrackLength);
    this.sessionTypes.clear();
    for (const entry of session?.SessionInfo?.Sessions ?? []) {
      this.sessionTypes.set(entry.SessionNum, entry.SessionType);
    }
    this.excluded.clear();
    const paceCarIdx = session?.DriverInfo?.PaceCarIdx ?? -1;
    if (paceCarIdx >= 0) this.excluded.add(paceCarIdx);
    for (const driver of session?.DriverInfo?.Drivers ?? []) {
      if (driver.CarIsPaceCar === 1 || driver.IsSpectator === 1) {
        this.excluded.add(driver.CarIdx);
      }
    }
    this.classes = carClassesFrom(session);
  }

  onFrame(frame: Telemetry): void {
    const cells = frame as unknown as Cells;
    const latest = this.latest;
    let changed = false;

    const sessionNum = scalarOf(cells, 'SessionNum') ?? null;
    if (latest.sessionNum !== null && sessionNum !== latest.sessionNum) {
      this.resetTracking();
    }
    const time = scalarOf(cells, 'SessionTime') ?? this.lastTime ?? 0;
    // A clock that steps back is a new session or a replay being scrubbed:
    // nothing timed against the old clock means anything now.
    if (this.lastTime !== null && time < this.lastTime) this.resetTracking();
    this.lastTime = time;

    const player = scalarOf(cells, 'PlayerCarIdx') ?? -1;
    const hasPlayer = player >= 0;
    const pcts = valuesOf(cells, 'CarIdxLapDistPct');
    const playerPct = hasPlayer ? (finiteAt(pcts, player) ?? -1) : -1;
    const laps = valuesOf(cells, 'CarIdxLapCompleted');
    const sessionFlags = scalarOf(cells, 'SessionFlags') ?? 0;
    const sessionState = scalarOf(cells, 'SessionState') ?? 0;
    const isRace =
      sessionNum !== null && this.sessionTypes.get(sessionNum) === 'Race';
    const playerOnPitRoad =
      hasPlayer &&
      (valuesOf(cells, 'OnPitRoad')[0] === true ||
        valuesOf(cells, 'CarIdxOnPitRoad')[player] === true);

    let active = 0;
    let startDetail: FlagDetail = 'beforeSession';
    let chequeredDetail: FlagDetail = 'sessionOver';
    let simBlue = false;
    let pitLaneClosed = false;
    let lit = -1;
    let lightsTotal = 0;
    let penaltyCount = 0;
    let penaltyKind = 0;
    let penaltySeconds: number | null = null;
    let yellowSectors: readonly unknown[] = NO_VALUES;
    let playerSector: number | null = null;
    /** iRacing shows its own green for a while; that is an announcement. */
    let simGreen = false;

    const lmuPhase = scalarOf(cells, 'LmuGamePhase');
    const isLmu = lmuPhase !== undefined;
    if (isLmu) {
      let phase = lmuPhase;
      if (phase === PHASE_PAUSED) {
        phase = this.lastPhase >= 0 ? this.lastPhase : PHASE_GREEN;
      } else {
        this.lastPhase = phase;
      }
      // A frame the sim has stopped writing, or one from no session at all,
      // flags nothing.
      const live =
        valuesOf(cells, 'LmuDataStale')[0] !== true &&
        valuesOf(cells, 'LmuNotInSession')[0] !== true;
      if (live) {
        const yellowState = scalarOf(cells, 'LmuYellowFlagState') ?? 0;
        const fullCourse =
          phase === PHASE_FULL_COURSE_YELLOW ||
          (yellowState >= 1 && yellowState <= 6);
        const finish = hasPlayer
          ? (finiteAt(valuesOf(cells, 'LmuCarIdxFinishStatus'), player) ?? 0)
          : 0;
        yellowSectors = valuesOf(cells, 'LmuSectorYellow');
        if (hasPlayer) {
          playerSector = scalarOf(cells, 'LmuSectorIdx') ?? null;
        }

        if (finish === LMU_FINISH_STATUS.dq) active |= FLAG_ACTIVE_DISQUALIFIED;
        if (phase === PHASE_STOPPED) active |= FLAG_ACTIVE_RED;
        if (phase === PHASE_OVER || finish === LMU_FINISH_STATUS.finished) {
          active |= FLAG_ACTIVE_CHEQUERED;
          chequeredDetail = !isRace
            ? 'sessionOver'
            : finish === LMU_FINISH_STATUS.finished
              ? 'finished'
              : 'finishLap';
        }
        // Before a race every phase up to the lights is the start. Outside
        // one only phase 0 is: practice and qualifying have no grid.
        const beforeGreen = phase >= 1 && phase <= PHASE_COUNTDOWN;
        if (phase === PHASE_BEFORE_SESSION || (isRace && beforeGreen)) {
          active |= FLAG_ACTIVE_START;
          startDetail = LMU_START_DETAILS[phase] ?? 'beforeSession';
          if (phase === PHASE_COUNTDOWN) {
            lightsTotal = scalarOf(cells, 'LmuNumRedLights') ?? 0;
            lit = scalarOf(cells, 'LmuStartLight') ?? -1;
          }
        }
        if (fullCourse) {
          active |= FLAG_ACTIVE_FULL_COURSE_YELLOW;
          if (yellowState >= 1 && yellowState <= 6) {
            active |= yellowState << FLAG_ACTIVE_FCY_PHASE_SHIFT;
          }
        } else if (yellowSectors.includes(true)) {
          active |= FLAG_ACTIVE_YELLOW;
        }
        simBlue = hasPlayer && (sessionFlags & GlobalFlags.Blue) !== 0;
        if (hasPlayer) {
          penaltyCount =
            finiteAt(valuesOf(cells, 'LmuCarIdxPenalties'), player) ?? 0;
        }
        if (penaltyCount > 0) {
          active |= FLAG_ACTIVE_PENALTY;
          const stopSeconds = scalarOf(cells, 'LmuPenaltySeconds');
          const kind = lmuPenaltyBadge(
            finiteAt(valuesOf(cells, 'LmuCarIdxPenaltyKind'), player),
            true,
            penaltyCount,
            stopSeconds
          );
          penaltyKind = lmuPenaltyCode(kind);
          // A time penalty's seconds are what it adds to the race; a
          // stop-go's are what the stop holds the car for.
          const seconds =
            kind === 'TIME'
              ? finiteAt(valuesOf(cells, 'LmuCarIdxPenaltySeconds'), player)
              : kind === 'SG'
                ? stopSeconds
                : undefined;
          penaltySeconds =
            seconds !== undefined && seconds > 0 ? Math.round(seconds) : null;
        }
        const running =
          phase === PHASE_GREEN || (!isRace && beforeGreen && !fullCourse);
        if (running && !fullCourse) active |= FLAG_ACTIVE_GREEN;

        const leaderProgress = this.leaderProgress(pcts, laps, time);
        if (
          isRace &&
          phase === PHASE_GREEN &&
          hasPlayer &&
          finish === LMU_FINISH_STATUS.none &&
          this.isLastLap(cells, leaderProgress)
        ) {
          active |= FLAG_ACTIVE_WHITE;
        }
        pitLaneClosed =
          phase === PHASE_BEFORE_SESSION ||
          yellowState === YELLOW_STATE_PITS_CLOSED ||
          (yellowState === YELLOW_STATE_PIT_LEAD_LAP &&
            hasPlayer &&
            playerPct >= 0 &&
            Math.round(
              leaderProgress - ((finiteAt(laps, player) ?? 0) + playerPct)
            ) >= 1);
      }
    } else if (sessionState !== SessionState.Invalid) {
      const has = (bits: number): boolean => (sessionFlags & bits) !== 0;
      const fullCourse = has(GlobalFlags.Caution | GlobalFlags.CautionWaving);
      const beforeGreen =
        sessionState === SessionState.GetInCar ||
        sessionState === SessionState.Warmup ||
        sessionState === SessionState.ParadeLaps;

      if (has(GlobalFlags.Disqualify)) active |= FLAG_ACTIVE_DISQUALIFIED;
      if (has(GlobalFlags.Red)) active |= FLAG_ACTIVE_RED;
      if (
        has(GlobalFlags.Checkered) ||
        sessionState === SessionState.Checkered ||
        sessionState === SessionState.CoolDown
      ) {
        active |= FLAG_ACTIVE_CHEQUERED;
        chequeredDetail = !isRace
          ? 'sessionOver'
          : sessionState === SessionState.CoolDown
            ? 'finished'
            : 'finishLap';
      }
      const lightsOn = has(GlobalFlags.StartReady | GlobalFlags.StartSet);
      if (isRace && (beforeGreen || lightsOn)) {
        active |= FLAG_ACTIVE_START;
        startDetail = has(GlobalFlags.StartSet)
          ? 'set'
          : has(GlobalFlags.StartReady)
            ? 'ready'
            : sessionState === SessionState.ParadeLaps
              ? 'formationLap'
              : 'grid';
      }
      if (fullCourse) {
        active |= FLAG_ACTIVE_FULL_COURSE_YELLOW;
        if (has(GlobalFlags.OneLapToGreen)) {
          active |= YELLOW_STATE_LAST_LAP << FLAG_ACTIVE_FCY_PHASE_SHIFT;
        }
      } else if (has(GlobalFlags.Yellow | GlobalFlags.YellowWaving)) {
        active |= FLAG_ACTIVE_YELLOW;
      }
      if (has(GlobalFlags.Debris)) active |= FLAG_ACTIVE_DEBRIS;
      simBlue = hasPlayer && has(GlobalFlags.Blue);
      if (has(GlobalFlags.Black)) {
        active |= FLAG_ACTIVE_PENALTY;
      } else if (has(GlobalFlags.Furled)) {
        active |= FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_WARNING;
      }
      const meatball = GlobalFlags.Servicible | GlobalFlags.Repair;
      if ((sessionFlags & meatball) === meatball) {
        active |= FLAG_ACTIVE_MEATBALL;
      }
      if (has(GlobalFlags.White)) active |= FLAG_ACTIVE_WHITE;
      const running =
        sessionState === SessionState.Racing || (!isRace && beforeGreen);
      if (running && !fullCourse) active |= FLAG_ACTIVE_GREEN;
      simGreen = has(GlobalFlags.Green | GlobalFlags.StartGo);
      pitLaneClosed =
        sessionState === SessionState.Racing &&
        valuesOf(cells, 'PitsOpen')[0] === false;
    }

    // The two green announcements: after the lights, and after a yellow.
    const isStart = (active & FLAG_ACTIVE_START) !== 0;
    const isYellow =
      (active & (FLAG_ACTIVE_FULL_COURSE_YELLOW | FLAG_ACTIVE_YELLOW)) !== 0;
    const isGreen = (active & FLAG_ACTIVE_GREEN) !== 0;
    if (this.hadFrame && isGreen && !isStart && !isYellow) {
      if (this.wasStart) {
        this.greenReason = FLAG_ACTIVE_GREEN_START;
        this.greenUntil = time + GREEN_ANNOUNCE_S;
      } else if (this.wasYellow) {
        this.greenReason = FLAG_ACTIVE_GREEN_RESTART;
        this.greenUntil = time + GREEN_ANNOUNCE_S;
      }
    }
    this.hadFrame = true;
    this.wasStart = isStart;
    this.wasYellow = isYellow;
    if (isGreen && (time < this.greenUntil || simGreen)) {
      active |= this.greenReason;
    }

    // The blue, held through the flicker at its edge.
    if (simBlue) this.blueSeenAt = time;
    const blueOut =
      hasPlayer &&
      (simBlue || (this.blueOut && time - this.blueSeenAt <= BLUE_HOLD_S));
    if (blueOut !== this.blueOut) {
      this.blueOut = blueOut;
      this.queue.drop();
      this.blueQualified = false;
    }
    // LMU holds a car's lap fraction at exactly 0 until it first reaches the
    // line, as at a rolling start: until then where it is on the lap is not
    // known, and nothing can be measured from it.
    const onTrack =
      hasPlayer &&
      playerPct >= 0 &&
      !(isLmu && playerPct === 0) &&
      this.trackLength > 0;
    const raceRule =
      isRace &&
      (sessionState === SessionState.Racing ||
        sessionState === SessionState.Checkered);
    if (blueOut) {
      active |= FLAG_ACTIVE_BLUE;
      if (!raceRule || playerOnPitRoad) active |= FLAG_ACTIVE_BLUE_TRAFFIC;
    }

    // The incident a local yellow is for. Not looked for under a full-course
    // yellow or before the start, when everyone is slow.
    let incidentDistM: number | null = null;
    let incidentCarIdx: number | null = null;
    if ((active & FLAG_ACTIVE_YELLOW) !== 0 && !isStart) {
      const tuning = this.tuning();
      if (onTrack) {
        const found = this.findIncident(
          cells,
          pcts,
          player,
          playerPct,
          tuning,
          time
        );
        if (found >= 0) {
          incidentCarIdx = found;
          incidentDistM = this.incidentDist;
        }
      }
      const ownSector =
        tuning.yellowInOwnSector &&
        playerSector !== null &&
        yellowSectors[playerSector] === true;
      if (incidentDistM !== null || ownSector) {
        active |= FLAG_ACTIVE_YELLOW_NEAR;
      }
    }

    // The car the blue is for.
    let blueChanged = false;
    let hasBlueCar = false;
    if (blueOut && onTrack) {
      hasBlueCar = this.findBlueCar(
        cells,
        pcts,
        laps,
        player,
        playerPct,
        raceRule,
        isLmu
      );
      blueChanged = this.blueCarChanged;
    }
    const blue = hasBlueCar ? this.blueCar : null;
    if (blue !== latest.blue || blueChanged) {
      latest.blue = blue;
      changed = true;
    }

    // The player's penalty. Under iRacing the black flag has no count.
    const hasPenalty = isLmu && penaltyCount > 0;
    const penalty = latest.penalty;
    if (!hasPenalty) {
      if (penalty !== null) {
        latest.penalty = null;
        changed = true;
      }
    } else if (
      penalty === null ||
      penalty.count !== penaltyCount ||
      penalty.kind !== penaltyKind ||
      penalty.seconds !== penaltySeconds
    ) {
      latest.penalty = {
        count: penaltyCount,
        kind: penaltyKind,
        seconds: penaltySeconds,
      };
      changed = true;
    }

    const hasLights = lightsTotal > 0 && lit >= 0;
    const litNow = hasLights ? Math.min(lit, lightsTotal) : 0;
    const lights = latest.startLights;
    if (!hasLights) {
      if (lights !== null) {
        latest.startLights = null;
        changed = true;
      }
    } else if (
      lights === null ||
      lights.lit !== litNow ||
      lights.total !== lightsTotal
    ) {
      latest.startLights = { lit: litNow, total: lightsTotal };
      changed = true;
    }

    if (!this.sameSectors(latest.yellowSectors, yellowSectors)) {
      latest.yellowSectors = yellowSectors.map((value) => value === true);
      changed = true;
    }

    // Rank. The start and the chequered flag have details only known here.
    const kind = rankFlagKind(active);
    latest.active = active;
    latest.incidentDistM = incidentDistM;
    const detail =
      kind === 'start'
        ? startDetail
        : kind === 'chequered'
          ? chequeredDetail
          : flagDetailFor(kind, latest);

    if (kind !== latest.kind) {
      latest.kind = kind;
      latest.detail = detail;
      latest.since = time;
      changed = true;
    } else if (detail !== latest.detail) {
      latest.detail = detail;
      // A blue handed from one car to the next is the same blue.
      if (kind !== 'blue') latest.since = time;
      changed = true;
    }
    if (active !== this.publishedActive) {
      this.publishedActive = active;
      changed = true;
    }
    if (incidentDistM !== this.publishedIncidentDistM) {
      this.publishedIncidentDistM = incidentDistM;
      changed = true;
    }
    if (incidentCarIdx !== latest.incidentCarIdx) {
      latest.incidentCarIdx = incidentCarIdx;
      changed = true;
    }
    if (playerSector !== latest.playerSector) {
      latest.playerSector = playerSector;
      changed = true;
    }
    if (pitLaneClosed !== latest.pitLaneClosed) {
      latest.pitLaneClosed = pitLaneClosed;
      changed = true;
    }
    if (sessionNum !== latest.sessionNum) {
      latest.sessionNum = sessionNum;
      changed = true;
    }

    if (changed) latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // Nothing here is aggregated, so a replay is read like a live session and
    // every lifecycle event simply starts over.
    void event;
    this.resetTracking();
    const latest = this.latest;
    latest.kind = 'none';
    latest.detail = 'noSession';
    latest.active = 0;
    latest.since = 0;
    latest.yellowSectors = [];
    latest.playerSector = null;
    latest.incidentDistM = null;
    latest.incidentCarIdx = null;
    latest.blue = null;
    latest.penalty = null;
    latest.startLights = null;
    latest.pitLaneClosed = false;
    latest.sessionNum = null;
    this.publishedActive = 0;
    this.publishedIncidentDistM = null;
    latest.version += 1;
  }

  snapshot(): FlagStateSnapshot {
    return this.latest;
  }

  /** The timers and the chosen blue car; the snapshot is left to the caller. */
  private resetTracking(): void {
    this.lastTime = null;
    this.lastPhase = -1;
    this.hadFrame = false;
    this.wasStart = false;
    this.wasYellow = false;
    this.greenUntil = Number.NEGATIVE_INFINITY;
    this.greenReason = FLAG_ACTIVE_GREEN_START;
    this.blueSeenAt = Number.NEGATIVE_INFINITY;
    this.blueOut = false;
    this.queue.drop();
    this.blueQualified = false;
    this.speedSettlesAt.length = 0;
  }

  private sameSectors(
    published: readonly boolean[],
    next: readonly unknown[]
  ): boolean {
    if (published.length !== next.length) return false;
    for (let index = 0; index < next.length; index += 1) {
      if (published[index] !== (next[index] === true)) return false;
    }
    return true;
  }

  /**
   * Race progress of the car furthest on under LMU: laps completed plus lap
   * fraction. The same pass notes which cars the sim still holds at a lap
   * fraction of exactly 0, as before a rolling start reaches the line: their
   * speed, worked out from how the fraction moves, reads as standing still
   * until a little after it is let go.
   */
  private leaderProgress(
    pcts: readonly unknown[],
    laps: readonly unknown[],
    time: number
  ): number {
    let leader = 0;
    for (let carIdx = 0; carIdx < pcts.length; carIdx += 1) {
      if (this.excluded.has(carIdx)) continue;
      const pct = finiteAt(pcts, carIdx);
      if (pct === 0) this.speedSettlesAt[carIdx] = time + SPEED_SETTLE_S;
      const completed = finiteAt(laps, carIdx);
      if (pct === undefined || pct < 0 || completed === undefined) continue;
      if (completed < 0) continue;
      const progress = completed + pct;
      if (progress > leader) leader = progress;
    }
    return leader;
  }

  /**
   * LMU has no white flag, so the last lap is worked out: in a race run to
   * laps the leader has one lap left; in a timed one the clock has run out.
   */
  private isLastLap(cells: Cells, leaderProgress: number): boolean {
    const lapsTotal = scalarOf(cells, 'SessionLapsTotal') ?? 0;
    if (lapsTotal > 0 && lapsTotal < TIMED_SESSION_LAPS) {
      return Math.floor(leaderProgress) >= lapsTotal - 1;
    }
    const remain = scalarOf(cells, 'SessionTimeRemain');
    const total = scalarOf(cells, 'SessionTimeTotal') ?? 0;
    return remain !== undefined && total > 0 && remain <= 0;
  }

  /**
   * The stopped or crawling car a local yellow is for: the nearest ahead
   * within the range ahead, else the nearest behind within the range behind.
   * Returns its slot, or -1.
   *
   * A car on pit road is left out, which TinyPedal does not do: a car
   * standing in its pit box is not what a yellow is waved for. The player's
   * own car counts, at no distance, as it does there.
   */
  private findIncident(
    cells: Cells,
    pcts: readonly unknown[],
    player: number,
    playerPct: number,
    tuning: FlagProcessorTuning,
    time: number
  ): number {
    const speeds = this.carSpeeds();
    const surfaces = valuesOf(cells, 'CarIdxTrackSurface');
    const onPitRoad = valuesOf(cells, 'CarIdxOnPitRoad');
    let aheadM = Number.POSITIVE_INFINITY;
    let aheadIdx = -1;
    let behindM = Number.POSITIVE_INFINITY;
    let behindIdx = -1;
    let anyMoving = false;

    for (let carIdx = 0; carIdx < pcts.length; carIdx += 1) {
      const speed = speedOf(speeds, carIdx);
      if (speed === undefined) continue;
      if (speed > 0) anyMoving = true;
      if (speed >= INCIDENT_SPEED_MS) continue;
      const pct = finiteAt(pcts, carIdx);
      if (pct === undefined || pct < 0) continue;
      // A car LMU holds at the line, or has only just let go, has not moved
      // on the lap as far as the speeds can tell. That is not standing still.
      if (time < (this.speedSettlesAt[carIdx] ?? 0)) continue;
      if (!isOnRacingSurface(carIdx, surfaces, onPitRoad, this.excluded)) {
        continue;
      }
      const metres =
        carIdx === player ? 0 : wrapDelta(pct, playerPct) * this.trackLength;
      if (metres >= 0) {
        if (metres < aheadM) {
          aheadM = metres;
          aheadIdx = carIdx;
        }
      } else if (-metres < behindM) {
        behindM = -metres;
        behindIdx = carIdx;
      }
    }

    // Speeds that all read 0 are an average that has not started yet, not a
    // field of stopped cars.
    if (!anyMoving) return -1;
    if (aheadIdx >= 0 && aheadM <= tuning.yellowRangeAheadM) {
      this.incidentDist = Math.round(aheadM);
      return aheadIdx;
    }
    if (behindIdx >= 0 && behindM <= tuning.yellowRangeBehindM) {
      // `|| 0` keeps a car half a metre behind from reading as -0.
      this.incidentDist = -Math.round(behindM) || 0;
      return behindIdx;
    }
    return -1;
  }

  /**
   * Finds the car the blue is for and fills `blueCar` with it. Returns false
   * when there is no car to name.
   *
   * Who is behind, who of them meets the lapping rule, their order and the
   * hand-over are the shared traffic rules. What is the flag's own is the
   * fallback: a blue the sim has raised names somebody even when no car
   * meets the rule.
   */
  private findBlueCar(
    cells: Cells,
    pcts: readonly unknown[],
    laps: readonly unknown[],
    player: number,
    playerPct: number,
    raceRule: boolean,
    isLmu: boolean
  ): boolean {
    const speeds = this.carSpeeds();
    const { queue, field } = this;
    field.pcts = pcts;
    field.laps = laps;
    field.surfaces = valuesOf(cells, 'CarIdxTrackSurface');
    field.onPitRoad = valuesOf(cells, 'CarIdxOnPitRoad');
    field.speedsKmh = speeds;
    field.player = player;
    field.playerPct = playerPct;
    field.trackLength = this.trackLength;
    field.raceRule = raceRule;
    field.isLmu = isLmu;
    field.classes = this.classes;
    this.blueCarChanged = false;

    // In a race: a car lapping the player, or one of a faster class.
    // Outside one every car behind qualifies, and a closing one counts.
    queue.scan(field);
    const { candidates, listed, distOf } = queue;

    // Outside a race, with nobody closing, the nearest car behind is it.
    let confirmed = listed.length > 0;
    let pool = listed;
    if (!confirmed) {
      pool = candidates;
      if (raceRule) {
        // The fallback: only while no car has met the rule in this blue,
        // and only a car close enough to be the one meant.
        if (this.blueQualified) return this.dropHolder();
        for (let index = pool.length - 1; index >= 0; index -= 1) {
          if (distOf[pool[index]] > BLUE_FALLBACK_M) pool.splice(index, 1);
        }
      } else {
        confirmed = true;
      }
    }
    if (pool.length === 0) return this.dropHolder();
    if (confirmed) this.blueQualified = true;

    // The holder keeps the plate until another car is clearly nearer.
    const holder = queue.settle(pool);
    const dist = distOf[holder];
    const speed = speedOf(speeds, holder);
    const playerSpeed = queue.playerSpeed;
    const othersCount =
      confirmed && pool === listed ? queue.queuedBehind(field, holder) : 0;
    const gapS = relativeTimeGap(dist, speed, playerSpeed);
    const closingMs =
      speed !== undefined && playerSpeed !== undefined
        ? round1(speed - playerSpeed)
        : null;

    const car = this.blueCar;
    const distanceM = Math.round(dist);
    const lapsAhead = Math.max(0, queue.lapsOf[holder]);
    const fasterClass = queue.fasterOf[holder];
    if (
      car.carIdx !== holder ||
      car.distanceM !== distanceM ||
      car.gapS !== gapS ||
      car.closingMs !== closingMs ||
      car.lapsAhead !== lapsAhead ||
      car.fasterClass !== fasterClass ||
      car.confirmed !== confirmed ||
      car.othersCount !== othersCount
    ) {
      car.carIdx = holder;
      car.distanceM = distanceM;
      car.gapS = gapS;
      car.closingMs = closingMs;
      car.lapsAhead = lapsAhead;
      car.fasterClass = fasterClass;
      car.confirmed = confirmed;
      car.othersCount = othersCount;
      this.blueCarChanged = true;
    }
    return true;
  }

  private dropHolder(): false {
    this.queue.drop();
    return false;
  }
}
