import type {
  CarPitSnapshot,
  FinishCar,
  FinishInvalidReason,
  FinishProjectionSnapshot,
  FinishRefuelLine,
  FinishRival,
  FinishRivalBasis,
  FuelProjectionSnapshot,
  FuelRaceInputs,
  LapTimesSnapshot,
  LmuPitService,
  PitStopParts,
  PitStopSnapshot,
  Session,
  SessionLifecycleEvent,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_LANE,
  FINISH_RIVALS_PER_SIDE,
  lmuFinishStateFromCode,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import {
  averageLapUsage,
  carFinish,
  classIdsByCar,
  classNeighbourhood,
  classPositionsByCar,
  flagTime,
  leaderFinish,
  pitDriveTimeS,
  plannedStandingS,
  stopsOwedFor,
  type FinishRunner,
  type FlagTime,
  type RaceEnd,
} from '@irdashies/shared';
import { lapStarted } from './FuelProjectionProcessor';
import { median } from './pitLaneModel';
import { STOP_SECONDS } from './pitVisit';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isAwayFromWheel } from './watchedCar';

/**
 * Laps to a finish that is minutes or hours away: once a second is as often
 * as any of it moves.
 */
const FINISH_TICK_HZ = 1;
/** A full budget of virtual energy, in the percent it is counted in. */
const ENERGY_PERCENT = 100;
/**
 * A standing time that stands for "a stop that stands" where only the kind
 * of visit matters: the lane is then driven as the player's own stops were.
 */
const A_STOP_THAT_STANDS_S = 1;
/**
 * Laps a car needs behind it before its own measured pace is used. With
 * fewer, `lap-times.snapshot` filters nothing and its figure is half the
 * lap from the start: on the recorded race five seconds a lap slow two laps
 * in, which put a rival two seconds behind the player a lap down at the
 * flag. Until then a class rival is counted at the pace of the class.
 */
const OWN_PACE_MIN_LAPS = 3;

export interface FinishProjectionDependencies {
  /** The race as `fuel.projection` projects it, and the player's budget. */
  fuel?: () => FuelProjectionSnapshot | undefined;
  /** Every car's measured pace. */
  lapTimes?: () => LapTimesSnapshot | undefined;
  /** The pit lane of the track and the stop the pit menu is set to. */
  pitStop?: () => PitStopSnapshot | undefined;
  /** Every car's pit visits, stints and usage per lap. */
  carPit?: () => CarPitSnapshot | undefined;
  /** The class order, the race gaps and what each car has left. */
  standings?: () => StandingsSnapshot | undefined;
}

/** Everything published but the session and the version. */
type Projection = Omit<FinishProjectionSnapshot, 'sessionNum' | 'version'>;

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
  index: number
): number | null => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

// The `+ 0` turns a rounded -0 into 0, which is another value to a
// comparison and to JSON.
const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale + 0;
};

const rounded = (value: number | null, decimals: number): number | null =>
  value === null ? null : round(value, decimals);

const nothing = (reason: FinishInvalidReason): Projection => ({
  valid: false,
  reason,
  raceType: 'time',
  timeLeftS: null,
  lapLimit: null,
  leader: null,
  player: null,
  lapsToGo: null,
  energy: null,
  laneLossS: null,
  plannedStandingS: null,
  refuelLines: null,
  separateS: 0,
  overlapS: 0,
  playerStopsOwed: 0,
  rivals: [],
});

/** A hose on and off again, or null where the sim does not state both. */
const hoseS = (
  insert: number | undefined,
  remove: number | undefined
): number | null =>
  typeof insert === 'number' && typeof remove === 'number'
    ? insert + remove
    : null;

/**
 * Whether a kind of pit work may run alongside refuelling, as the session
 * states it: 1 is taken to mean it may, as in rFactor 2. Where the session
 * says nothing the stand-in is rFactor 2's own: a driver change may, the
 * rest may not.
 */
const overlaps = (stated: number | undefined, standIn: boolean): boolean =>
  typeof stated === 'number' ? stated === 1 : standIn;

/** What is known of the pit lane and of the stop the pit menu is set to. */
interface PitFigures {
  /** What a visit costs before any standing, s. */
  laneLossS: number | null;
  /** The player's planned standing time, s. */
  standingS: number | null;
  /** The lane's stretch on the racing line at the player's pace, s. */
  trackTimeS: number | null;
}

/**
 * How the race ends for the car the user is entered in, and how its class
 * neighbours come out once everyone has made the stops they still owe.
 *
 * It measures nothing itself. The leader's and the player's pace and
 * progress are the ones `fuel.projection` projects the race from; the pit
 * lane and the planned stop are `pit-stop.snapshot`'s; every car's stints,
 * pit visits and usage per lap are `car-pit.snapshot`'s; the class order
 * and the race gaps are `standings.snapshot`'s. What it adds is the
 * arithmetic of `src/shared/finishProjection/` for the rivals, and the
 * rates a refuelling stop is costed with.
 *
 * A rival's remaining stops are reckoned from the best evidence there is:
 * what the sim says it has left and what a lap costs it; failing that the
 * longest stint it has been seen to drive; failing that the longest seen in
 * its class, or the player's own. What a rival takes on at a stop, its
 * tyres and drivers, a penalty still to serve and a neutralisation are not
 * knowable, and none is guessed at.
 *
 * It keeps no history: the one thing it remembers is that the session has
 * had a race clock, so that a race run to laps and time is still read as
 * one after the clock has run out. Deterministic for a sequence of frames,
 * sessions and lifecycle events given what the five snapshots answer.
 */
export class FinishProjectionProcessor implements TelemetryProcessor<
  FinishProjectionSnapshot,
  'finish-projection.snapshot'
> {
  readonly channel = 'finish-projection.snapshot';
  readonly tickRateHz = FINISH_TICK_HZ;

  private readonly fuel: () => FuelProjectionSnapshot | undefined;
  private readonly lapTimes: () => LapTimesSnapshot | undefined;
  private readonly pitStop: () => PitStopSnapshot | undefined;
  private readonly carPit: () => CarPitSnapshot | undefined;
  private readonly standings: () => StandingsSnapshot | undefined;

  private driverCarIdx = -1;
  private classIdByCar: (number | undefined)[] = [];
  private pitService: LmuPitService | undefined;

  private lastTime: number | null = null;
  /** The race clock has been seen running in this session. */
  private hadClock = false;
  /** What was last published, as text: the cheapest way to see it move. */
  private publishedKey = '';
  private latest: FinishProjectionSnapshot = {
    ...nothing('notRace'),
    sessionNum: null,
    version: 0,
  };

  constructor(dependencies: FinishProjectionDependencies = {}) {
    this.fuel = dependencies.fuel ?? (() => undefined);
    this.lapTimes = dependencies.lapTimes ?? (() => undefined);
    this.pitStop = dependencies.pitStop ?? (() => undefined);
    this.carPit = dependencies.carPit ?? (() => undefined);
    this.standings = dependencies.standings ?? (() => undefined);
  }

  init(session: Session): void {
    const driverInfo = session?.DriverInfo;
    this.driverCarIdx =
      typeof driverInfo?.DriverCarIdx === 'number'
        ? driverInfo.DriverCarIdx
        : -1;
    this.classIdByCar = classIdsByCar(driverInfo?.Drivers);
    this.pitService = session?.LmuRest?.pitService;
  }

  onFrame(frame: Telemetry): void {
    const now = scalar(frame, 'SessionTime');
    if (now === null) return;
    const sessionNum = scalar(frame, 'SessionNum');
    // Another session, or a clock that ran backwards, which is a session
    // started again: what the last one's clock did is not this one's.
    if (
      (sessionNum !== null &&
        this.latest.sessionNum !== null &&
        sessionNum !== this.latest.sessionNum) ||
      (this.lastTime !== null && now < this.lastTime)
    ) {
      this.hadClock = false;
    }
    this.lastTime = now;
    this.publish(this.project(frame), sessionNum);
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    this.hadClock = false;
    this.lastTime = null;
    if (event.type === 'disconnect') {
      this.driverCarIdx = -1;
      this.classIdByCar = [];
      this.pitService = undefined;
    }
    this.publish(
      nothing('notRace'),
      event.type === 'sessionNumChange' ? this.latest.sessionNum : null
    );
  }

  snapshot(): FinishProjectionSnapshot {
    return this.latest;
  }

  /** Replaces what is published when a figure of it has moved. */
  private publish(projection: Projection, sessionNum: number | null): void {
    const key = JSON.stringify(projection);
    if (key === this.publishedKey && sessionNum === this.latest.sessionNum) {
      return;
    }
    this.publishedKey = key;
    this.latest = {
      ...projection,
      sessionNum,
      version: this.latest.version + 1,
    };
  }

  private project(frame: Telemetry): Projection {
    const fuel = this.fuel();
    const race = fuel?.race;
    // The block is there in a race and nowhere else.
    if (!fuel || !race) return nothing('notRace');
    if (race.timeRemainingS > 0) this.hadClock = true;
    if (fuel.sessionState < SessionState.Racing) return nothing('notStarted');
    if (fuel.sessionState > SessionState.Racing) return nothing('finished');

    const playerCarIdx = scalar(frame, 'PlayerCarIdx');
    const own =
      playerCarIdx !== null && playerCarIdx >= 0
        ? playerCarIdx
        : this.driverCarIdx;
    if (own < 0) return nothing('noCar');
    // The projection follows the camera. On another car its "player" is
    // that car, and what is aboard is still the user's own.
    if (race.playerCarIdx !== own) return nothing('otherCar');

    const standings = this.standings();
    if (lmuFinishStateFromCode(standings?.carIdxFinishStatus[own])) {
      return nothing('finished');
    }

    const hasLeader = race.leaderCarIdx >= 0 && race.leaderCarIdx !== own;
    if (!(race.playerPaceS > 0) || (hasLeader && !(race.leaderPaceS > 0))) {
      return nothing('noPace');
    }

    const lapLimit = race.lapLimit > 0 ? race.lapLimit : null;
    // A race with no lap limit is run to the clock, running or run out. One
    // with a limit has a clock as well only if it has been seen.
    const hasClock = lapLimit === null || this.hadClock;
    const end: RaceEnd = {
      timeLeftS: hasClock ? Math.max(0, race.timeRemainingS) : null,
      lapLimit,
    };

    const player: FinishRunner = {
      paceS: race.playerPaceS,
      progress: race.playerProgress,
    };
    const leader: FinishRunner | null = hasLeader
      ? { paceS: race.leaderPaceS, progress: race.leaderProgress }
      : null;

    const pitStop = this.pitStop();
    const carPit = this.carPit();
    const pit = this.pitFigures(pitStop);
    const { separateS, overlapS } = this.standingParts(
      pitStop?.estimate.parts ?? null
    );

    const perLap = averageLapUsage(fuel.completedLaps);
    const capacity =
      fuel.fuelTankCapacity !== undefined && fuel.fuelTankCapacity > 0
        ? fuel.fuelTankCapacity
        : null;
    // What is aboard is as good as its reading. With somebody else at the
    // wheel the fuel projection says whether the sim goes on writing the
    // budget for the car; where it does not, its level is the last one
    // read, a stint old, or for a car on fuel nothing at all.
    const budgetRead = !isAwayFromWheel(frame) || fuel.watched === true;
    const energy =
      perLap > 0 && budgetRead
        ? {
            isVirtualEnergy: fuel.budget === 'virtualEnergy',
            perLap,
            aboard: fuel.fuelLevel,
            capacity,
          }
        : null;

    // The flag with nobody stopping again, which is what a car's laps left
    // are counted to.
    const flag = flagTime(leader ?? player, end);
    const ownFinish = !flag
      ? null
      : leader
        ? carFinish(player, flag.tFlagS, 0, lapLimit)
        : leaderFinish(player, flag);
    const published =
      fuel.hasValidRaceEstimate && fuel.estimatedLapsRemaining > 0
        ? fuel.estimatedLapsRemaining
        : null;
    const playerLapsLeft = published ?? ownFinish?.lapsToGo ?? 0;
    const playerStintLaps = energy && capacity ? capacity / energy.perLap : 0;
    const playerStopsOwed = energy
      ? stopsOwedFor(
          playerLapsLeft,
          energy.aboard / energy.perLap,
          playerStintLaps
        )
      : 0;

    const lastStopLossS = (carIdx: number, paceS: number): number => {
      const laneS = carPit?.laneTimeS[carIdx] ?? 0;
      if (!(laneS > 0) || pit.trackTimeS === null) return 0;
      // The stretch on the racing line is the player's; a quicker car
      // covers it in its own share of that.
      return round(
        Math.max(0, laneS - pit.trackTimeS * (paceS / player.paceS)),
        1
      );
    };
    const car = (carIdx: number, runner: FinishRunner): FinishCar => ({
      carIdx,
      paceS: round(runner.paceS, 3),
      progress: round(runner.progress, 3),
      lastStopLossS: lastStopLossS(carIdx, runner.paceS),
    });

    return {
      valid: true,
      reason: null,
      raceType: lapLimit === null ? 'time' : hasClock ? 'lapsAndTime' : 'laps',
      timeLeftS: rounded(end.timeLeftS, 1),
      lapLimit,
      leader: leader ? car(race.leaderCarIdx, leader) : null,
      player: car(own, player),
      lapsToGo: rounded(published, 2),
      energy: energy && {
        isVirtualEnergy: energy.isVirtualEnergy,
        perLap: round(energy.perLap, 3),
        aboard: round(energy.aboard, 2),
        capacity: rounded(energy.capacity, 1),
      },
      laneLossS: rounded(pit.laneLossS, 1),
      plannedStandingS: rounded(pit.standingS, 1),
      refuelLines: this.refuelLines(frame, fuel),
      separateS: round(separateS, 1),
      overlapS: round(overlapS, 1),
      playerStopsOwed,
      rivals:
        standings && flag
          ? this.rivals(frame, {
              own,
              race,
              standings,
              carPit,
              flag,
              lapLimit,
              pit,
              playerLapsLeft,
              playerStopsOwed,
              playerStintLaps,
            })
          : [],
    };
  }

  private pitFigures(pitStop: PitStopSnapshot | undefined): PitFigures {
    if (!pitStop) return { laneLossS: null, standingS: null, trackTimeS: null };
    const { lane, estimate } = pitStop;
    const driveS = pitDriveTimeS(lane, A_STOP_THAT_STANDS_S);
    return {
      laneLossS:
        driveS !== null && lane.trackTimeS !== null
          ? Math.max(0, driveS - lane.trackTimeS)
          : null,
      standingS: plannedStandingS(estimate),
      trackTimeS: lane.trackTimeS,
    };
  }

  /**
   * The planned stop's work besides refuelling, split by whether it may
   * run alongside it: the longest of what may, and the sum of what may not.
   */
  private standingParts(parts: PitStopParts | null): {
    separateS: number;
    overlapS: number;
  } {
    if (!parts) return { separateS: 0, overlapS: 0 };
    const service = this.pitService;
    // The ducts have no flag of their own, and a penalty is served before
    // anything is touched.
    let separateS = parts.brakeDucts + parts.penalties;
    let overlapS = 0;
    const add = (seconds: number, alongside: boolean): void => {
      if (alongside) overlapS = Math.max(overlapS, seconds);
      else separateS += seconds;
    };
    add(parts.tyres, overlaps(service?.tireTimeConcurrent, false));
    add(parts.damage, overlaps(service?.fixTimeConcurrent, false));
    add(parts.driverSwap, overlaps(service?.driverConcurrent, true));
    add(parts.brakes, overlaps(service?.brakeTimeConcurrent, false));
    return { separateS, overlapS };
  }

  /**
   * How long each hose takes for an amount of the budget, from the rates
   * the session states. Null where one of them is missing: a column costed
   * without a hose would be a stop too short.
   *
   * A car on virtual energy takes fuel with it, in the litres to the
   * percent the pit menu is set to, so the fuel hose runs for what the new
   * energy level calls for less what is in the tank. That needs the tank
   * read on this frame, which the sim does for a car the user is in: the
   * fuel projection holds an energy car's last litres through a team-mate's
   * stint, and a hose costed from those would be a stint out.
   */
  private refuelLines(
    frame: Telemetry,
    fuel: FuelProjectionSnapshot
  ): FinishRefuelLine[] | null {
    const service = this.pitService;
    const fuelRate = service?.fuelFillRate;
    const fuelHoseS = hoseS(service?.fuelInsert, service?.fuelRemove);
    if (!service || !(fuelRate && fuelRate > 0) || fuelHoseS === null) {
      return null;
    }
    if (fuel.budget !== 'virtualEnergy') {
      return [
        { fixedS: round(fuelHoseS, 2), perUnitS: round(1 / fuelRate, 4) },
      ];
    }
    const energyRate = service.virtualEnergyFillRate;
    const energyHoseS = hoseS(
      service.virtualEnergyInsert,
      service.virtualEnergyRemove
    );
    const ratio = scalar(frame, 'LmuRefuelRatio');
    const litres = fuel.tank?.level;
    if (
      !(energyRate && energyRate > 0) ||
      energyHoseS === null ||
      ratio === null ||
      !(ratio > 0) ||
      litres === undefined ||
      scalar(frame, 'FuelLevel') === null
    ) {
      return null;
    }
    return [
      {
        fixedS: round(energyHoseS, 2),
        perUnitS: round(1 / (energyRate * ENERGY_PERCENT), 4),
      },
      {
        fixedS: round(
          fuelHoseS + (fuel.fuelLevel * ratio - litres) / fuelRate,
          2
        ),
        perUnitS: round(ratio / fuelRate, 4),
      },
    ];
  }

  /** A car's race progress, counted as `fuel.projection` counts it. */
  private progressOf(frame: Telemetry, carIdx: number): number | null {
    const pct = numberAt(list(frame, 'CarIdxLapDistPct'), carIdx);
    if (pct === null || pct < 0) return null;
    const lap = numberAt(list(frame, 'CarIdxLap'), carIdx) ?? 0;
    const completed = list(frame, 'CarIdxLapCompleted')?.[carIdx];
    return Math.max(0, lapStarted(lap, completed) - 1) + pct;
  }

  /** The class cars around the player, and what each still owes. */
  private rivals(
    frame: Telemetry,
    {
      own,
      race,
      standings,
      carPit,
      flag,
      lapLimit,
      pit,
      playerLapsLeft,
      playerStopsOwed,
      playerStintLaps,
    }: {
      own: number;
      race: FuelRaceInputs;
      standings: StandingsSnapshot;
      carPit: CarPitSnapshot | undefined;
      flag: FlagTime;
      lapLimit: number | null;
      pit: PitFigures;
      playerLapsLeft: number;
      playerStopsOwed: number;
      playerStintLaps: number;
    }
  ): FinishRival[] {
    const ownGap = standings.carIdxF2Time[own];
    if (!Number.isFinite(ownGap)) return [];
    const positions = classPositionsByCar(standings);
    const isRunning = (carIdx: number): boolean => {
      const surface = standings.carIdxTrackSurface[carIdx];
      return (
        surface !== undefined &&
        surface !== TrackLocation.NotInWorld &&
        standings.carIdxInGarage[carIdx] !== true &&
        !lmuFinishStateFromCode(standings.carIdxFinishStatus[carIdx])
      );
    };
    const around = classNeighbourhood(own, this.classIdByCar, positions, {
      ahead: FINISH_RIVALS_PER_SIDE,
      behind: FINISH_RIVALS_PER_SIDE,
      isRunning,
    });
    if (around.ahead.length === 0 && around.behind.length === 0) return [];

    // What the class has been seen to do, for a car that has shown nothing
    // of its own.
    const classId = this.classIdByCar[own];
    let classLongestStint = 0;
    const classStandings: number[] = [];
    for (let carIdx = 0; carIdx < this.classIdByCar.length; carIdx += 1) {
      if (this.classIdByCar[carIdx] !== classId || carIdx === own) continue;
      classLongestStint = Math.max(
        classLongestStint,
        carPit?.longestStintLaps[carIdx] ?? 0
      );
      const stood = this.finishedStandingS(carPit, carIdx);
      if (stood !== null) classStandings.push(stood);
    }
    const classStandingS = median(classStandings);

    const lapTimes = this.lapTimes();
    const measuredPaceS = (carIdx: number): number =>
      (lapTimes?.lapTimeHistory[carIdx]?.length ?? 0) >= OWN_PACE_MIN_LAPS
        ? (lapTimes?.lapTimes[carIdx] ?? 0)
        : 0;
    const ownMeasuredS = measuredPaceS(own);
    const playerStopLossS =
      pit.laneLossS !== null && pit.standingS !== null
        ? pit.laneLossS + pit.standingS
        : null;
    const playerPartS =
      playerStopsOwed === 0
        ? 0
        : playerStopLossS === null
          ? null
          : playerStopsOwed * playerStopLossS;

    const rivals: FinishRival[] = [];
    const add = (carIdx: number, ahead: boolean): void => {
      const gap = standings.carIdxF2Time[carIdx];
      const progress = this.progressOf(frame, carIdx);
      if (!Number.isFinite(gap) || progress === null) return;
      const measuredS = measuredPaceS(carIdx);
      // The overall leader finishes on the flag's own lap; any other car at
      // its next crossing after it, at its own pace or failing one the
      // class's, which is the pace the player is projected at.
      const finish =
        carIdx === race.leaderCarIdx
          ? leaderFinish(
              { paceS: race.leaderPaceS, progress: race.leaderProgress },
              flag
            )
          : carFinish(
              {
                paceS: measuredS > 0 ? measuredS : race.playerPaceS,
                progress,
              },
              flag.tFlagS,
              0,
              lapLimit
            );
      if (!finish) return;
      const lapsLeft = finish.lapsToGo;

      const remaining = standings.carIdxEnergyRemaining[carIdx] ?? -1;
      const usage = carPit?.usedAverage[carIdx] ?? -1;
      const longestStint = carPit?.longestStintLaps[carIdx] ?? 0;
      // Not known for a car that had stopped before it was first seen:
      // counted as a stint just begun, which owes the fewest stops.
      const stintLapsDone = Math.max(0, carPit?.stintLaps[carIdx] ?? 0);
      let basis: FinishRivalBasis;
      let stintLaps: number;
      let lapsInHand: number;
      if (remaining >= 0 && usage > 0) {
        basis = 'energy';
        stintLaps = 1 / usage;
        lapsInHand = remaining / usage;
      } else {
        basis = longestStint > 0 ? 'observed' : 'assumed';
        stintLaps =
          longestStint > 0
            ? longestStint
            : classLongestStint > 0
              ? classLongestStint
              : playerStintLaps;
        lapsInHand = Math.max(0, stintLaps - stintLapsDone);
      }
      const stopsOwed = stopsOwedFor(lapsLeft, lapsInHand, stintLaps);

      const standingS =
        this.finishedStandingS(carPit, carIdx) ??
        classStandingS ??
        pit.standingS;
      const stopLossS =
        pit.laneLossS !== null && standingS !== null
          ? pit.laneLossS + standingS
          : null;
      const rivalPartS =
        stopsOwed === 0 ? 0 : stopLossS === null ? null : stopsOwed * stopLossS;
      const gapS = gap - ownGap;

      rivals.push({
        carIdx,
        classPosition: positions[carIdx] ?? 0,
        ahead,
        gapS: round(gapS, 1),
        lapsLeft: round(lapsLeft, 2),
        stopsOwed,
        stopLossS: rounded(stopLossS, 1),
        basis,
        projectedGapS:
          rivalPartS === null || playerPartS === null
            ? null
            : round(gapS + rivalPartS - playerPartS, 1),
        paceDeltaS:
          measuredS > 0 && ownMeasuredS > 0
            ? round(
                (measuredS - ownMeasuredS) * Math.min(lapsLeft, playerLapsLeft),
                1
              )
            : 0,
        inPit:
          carPit?.where[carIdx] === CAR_PIT_IN_LANE ||
          standings.carIdxOnPitRoad[carIdx] === true,
      });
    };
    for (const carIdx of around.ahead) add(carIdx, true);
    for (const carIdx of around.behind) add(carIdx, false);
    return rivals;
  }

  /**
   * How long a car stood on its last stop, s. Null before it has made one,
   * and while it is in the pit lane, where the figure is still running.
   */
  private finishedStandingS(
    carPit: CarPitSnapshot | undefined,
    carIdx: number
  ): number | null {
    const stood = carPit?.standingS[carIdx] ?? 0;
    return stood > STOP_SECONDS && carPit?.where[carIdx] !== CAR_PIT_IN_LANE
      ? stood
      : null;
  }
}
