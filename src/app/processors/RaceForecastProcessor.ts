import type {
  CarPitSnapshot,
  FinishInvalidReason,
  FinishProjectionSnapshot,
  FinishRivalBasis,
  FuelProjectionSnapshot,
  LapTimesSnapshot,
  PitStopSnapshot,
  RaceForecastCar,
  RaceForecastNeighbour,
  RaceForecastPlace,
  RaceForecastRejoin,
  RaceForecastSnapshot,
  RaceForecastStint,
  Session,
  SessionLifecycleEvent,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_LANE,
  RACE_FORECAST_MAX_CARS,
  RACE_FORECAST_MEMORY_LAPS,
  RACE_FORECAST_MEMORY_MIN_LAPS,
} from '@irdashies/types';
import {
  averageOfLastLaps,
  classPositionsByCar,
  forecastDeciders,
  forecastOrder,
  isPitDriveMeasured,
  lastStopLaneTimeS,
  pitLossS,
  pitWindow,
  PlaceMemory,
  plannedStandingS,
  projectRejoin,
  REJOIN_MARGIN_MEASURED_S,
  REJOIN_MARGIN_RECKONED_S,
  remainingPitLossS,
  rivalProjectedGapS,
  stopDueLap,
  type ForecastEntrant,
  type RejoinCar,
} from '@irdashies/shared';
import {
  FinishProjectionProcessor,
  type FinishProjectionDependencies,
  type FinishReckoning,
  type FinishRivalReckoning,
} from './FinishProjectionProcessor';
import type { TelemetryProcessor } from './TelemetryProcessor';

/** Once a second, like the projection it is made from. */
const FORECAST_TICK_HZ = 1;
/** The laps a car's mean pace is taken over. */
const PACE_LAPS = 5;

export type RaceForecastDependencies = FinishProjectionDependencies;

/** Everything published but the session and the version. */
type Forecast = Omit<RaceForecastSnapshot, 'sessionNum' | 'version'>;

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const scalar = (frame: Telemetry, key: string): number | null => {
  const value = (frame as unknown as Cells)[key]?.value?.[0];
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

const lapTimeOrNull = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? round(value, 3)
    : null;

const nothing = (reason: FinishInvalidReason): Forecast => ({
  valid: false,
  reason,
  raceType: 'time',
  timeLeftS: null,
  lapLimit: null,
  sessionTimeS: null,
  flagInS: null,
  ownCarIdx: null,
  ownLap: null,
  ownLastLapS: null,
  ownBestLapS: null,
  cars: [],
  place: null,
  stint: null,
  rejoin: null,
});

const neighbour = (car: RejoinCar | null): RaceForecastNeighbour | null =>
  car ? { carIdx: car.carIdx, gapS: round(car.gapS, 1) } : null;

/** A car on its way into the order: what is published, and what places it. */
interface Entrant extends ForecastEntrant {
  car: RaceForecastCar;
  aheadNow: boolean;
  /** `finishGapS` is a gap the stops could be costed for. */
  costed: boolean;
  basis: FinishRivalBasis | null;
}

/**
 * How the race is heading for the whole class of the car the user is
 * entered in: the forecast finishing order, each car's next stop, and the
 * own entry's stint, pit window and rejoin.
 *
 * It reckons nothing of the race itself. It runs a finish projection of its
 * own over every running car of the class, where the channel's carries
 * three a side, and so stands on the same pace, the same laps left, the
 * same stops owed and the same cost of a stop: the two are one piece of
 * code fed the same five snapshots, and agree car for car. A rejoin is the
 * pit stop widget's own (`projectRejoin`), without the extra time that
 * widget adds from its settings, which no channel carries.
 *
 * What it adds is small. The order the projected gaps put the class in,
 * with the difference in measured pace over the laps left, since "if
 * everything goes on as it has" includes the pace. The lap a stop falls due
 * on and the window before it. And one thing remembered: where the own
 * entry was forecast to finish when it completed each of its last ten laps.
 *
 * Deterministic for a sequence of frames, sessions and lifecycle events
 * given what the five snapshots answer.
 */
export class RaceForecastProcessor implements TelemetryProcessor<
  RaceForecastSnapshot,
  'race-forecast.snapshot'
> {
  readonly channel = 'race-forecast.snapshot';
  readonly tickRateHz = FORECAST_TICK_HZ;

  private readonly finish: FinishProjectionProcessor;
  private readonly fuel: () => FuelProjectionSnapshot | undefined;
  private readonly lapTimes: () => LapTimesSnapshot | undefined;
  private readonly pitStop: () => PitStopSnapshot | undefined;
  private readonly carPit: () => CarPitSnapshot | undefined;
  private readonly standings: () => StandingsSnapshot | undefined;

  /** The own entry's forecast place at each of its last laps. */
  private readonly memory = new PlaceMemory(
    RACE_FORECAST_MEMORY_LAPS,
    RACE_FORECAST_MEMORY_MIN_LAPS
  );
  private lastTime: number | null = null;
  /** What was last published, as text: the cheapest way to see it move. */
  private publishedKey = '';
  private latest: RaceForecastSnapshot = {
    ...nothing('notRace'),
    sessionNum: null,
    version: 0,
  };

  constructor(dependencies: RaceForecastDependencies = {}) {
    // Every class car but the own one, so the cap is the cap of the list.
    this.finish = new FinishProjectionProcessor(
      dependencies,
      RACE_FORECAST_MAX_CARS - 1
    );
    this.fuel = dependencies.fuel ?? (() => undefined);
    this.lapTimes = dependencies.lapTimes ?? (() => undefined);
    this.pitStop = dependencies.pitStop ?? (() => undefined);
    this.carPit = dependencies.carPit ?? (() => undefined);
    this.standings = dependencies.standings ?? (() => undefined);
  }

  init(session: Session): void {
    this.finish.init(session);
  }

  onFrame(frame: Telemetry): void {
    const now = scalar(frame, 'SessionTime');
    if (now === null) return;
    const sessionNum = scalar(frame, 'SessionNum');
    // Another session, or a clock that ran backwards, which is a session
    // started again: a place forecast in the last one is not this one's.
    if (
      (sessionNum !== null &&
        this.latest.sessionNum !== null &&
        sessionNum !== this.latest.sessionNum) ||
      (this.lastTime !== null && now < this.lastTime)
    ) {
      this.memory.clear();
    }
    this.lastTime = now;
    this.finish.onFrame(frame);
    this.publish(this.forecast(frame, now), sessionNum);
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    this.finish.onLifecycle(event);
    this.memory.clear();
    this.lastTime = null;
    this.publish(
      nothing('notRace'),
      event.type === 'sessionNumChange' ? this.latest.sessionNum : null
    );
  }

  snapshot(): RaceForecastSnapshot {
    return this.latest;
  }

  /** Replaces what is published when a figure of it has moved. */
  private publish(forecast: Forecast, sessionNum: number | null): void {
    const key = JSON.stringify(forecast);
    if (key === this.publishedKey && sessionNum === this.latest.sessionNum) {
      return;
    }
    this.publishedKey = key;
    this.latest = {
      ...forecast,
      sessionNum,
      version: this.latest.version + 1,
    };
  }

  private forecast(frame: Telemetry, now: number): Forecast {
    const finish = this.finish.snapshot();
    const reckoning = this.finish.reckoning();
    const player = finish.player;
    if (!finish.valid || !reckoning || !player) {
      return nothing(finish.reason ?? 'notRace');
    }
    const own = reckoning.own;
    const standings = this.standings();
    const carPit = this.carPit();
    const lapTimes = this.lapTimes();
    const positions = standings ? classPositionsByCar(standings) : [];
    const lapsCompleted = Math.floor(player.progress);

    const stint = this.stint(frame, finish, reckoning);
    // The stop as the projected gaps cost it: the lane and the standing
    // time of the stop the pit menu is set to.
    const ownStopLossS =
      finish.laneLossS !== null && finish.plannedStandingS !== null
        ? round(finish.laneLossS + finish.plannedStandingS, 1)
        : null;
    // With nothing read aboard the own entry the projection does not know
    // the stops it owes. A gap or a place made from a count of none would
    // be an invention, so none is published.
    const ownStopsOwed = finish.playerStopsOwed;
    const placeable = ownStopsOwed !== null;

    const pitFigures = (carIdx: number) => {
      const lastStopLap = carPit?.lastStopLap[carIdx] ?? -1;
      const inLane = carPit?.where[carIdx] === CAR_PIT_IN_LANE;
      const since = carPit?.stintLaps[carIdx] ?? -1;
      return {
        inPit: inLane || standings?.carIdxOnPitRoad[carIdx] === true,
        stops: Math.max(0, carPit?.stops[carIdx] ?? 0),
        lastStopLap: lastStopLap >= 0 ? lastStopLap : null,
        // The lane time is that of the last pass, which is the stop's
        // until a later pass down the lane replaces it.
        lastStopLaneS: rounded(lastStopLaneTimeS(carPit, carIdx), 1),
        sinceStopLaps: since >= 0 ? since : null,
        avg5S: rounded(
          averageOfLastLaps(lapTimes?.cleanLapTimeHistory?.[carIdx], PACE_LAPS),
          3
        ),
      };
    };

    const ownCar: RaceForecastCar = {
      carIdx: own,
      own: true,
      classPosition: positions[own] ?? 0,
      gapS: 0,
      paceS: player.paceS,
      progress: player.progress,
      lapsLeft: round(reckoning.playerLapsLeft, 2),
      stopsOwed: ownStopsOwed,
      basis: finish.energy ? 'energy' : null,
      nextStopLap: stint?.window?.closeLap ?? null,
      stintLaps: round(reckoning.playerStintLaps, 2),
      stopLossS: ownStopLossS,
      netGapS: 0,
      finishGapS: 0,
      finishPosition: 0,
      ...pitFigures(own),
    };
    const entrants: Entrant[] = [
      {
        carIdx: own,
        classPosition: ownCar.classPosition,
        finishGapS: 0,
        car: ownCar,
        aheadNow: false,
        costed: true,
        basis: ownCar.basis,
      },
    ];
    for (const entry of nearest(reckoning.rivals)) {
      entrants.push(
        this.entrant(entry, pitFigures(entry.rival.carIdx), placeable)
      );
    }

    return {
      valid: true,
      reason: null,
      raceType: finish.raceType,
      timeLeftS: finish.timeLeftS,
      lapLimit: finish.lapLimit,
      sessionTimeS: Math.floor(now),
      flagInS: round(reckoning.flag.tFlagS, 1),
      ownCarIdx: own,
      ownLap: lapsCompleted + 1,
      ownLastLapS: lapTimeOrNull(standings?.carIdxLastLapTime[own]),
      ownBestLapS: lapTimeOrNull(standings?.carIdxBestLapTime[own]),
      place: placeable ? this.place(entrants, ownCar, lapsCompleted) : null,
      // In the order of the places now: the furthest ahead first.
      cars: entrants
        .filter((entrant) => entrant.aheadNow)
        .reverse()
        .concat(entrants.filter((entrant) => !entrant.aheadNow))
        .map((entrant) => entrant.car),
      stint,
      rejoin: this.rejoin(now),
    };
  }

  /**
   * Puts the class in the order it finishes in, writes each car's place
   * into it, and says where that leaves the own entry.
   */
  private place(
    entrants: readonly Entrant[],
    ownCar: RaceForecastCar,
    lapsCompleted: number
  ): RaceForecastPlace {
    const own = ownCar.carIdx;
    const order = forecastOrder(entrants);
    order.forEach((entrant, index) => {
      entrant.car.finishPosition = index + 1;
    });
    const ownIndex = order.findIndex((entrant) => entrant.carIdx === own);
    const finishPlace = ownIndex + 1;
    const deciders = forecastDeciders(
      order,
      own,
      (entrant) => entrant.aheadNow
    );
    const beside = (entrant: Entrant | undefined) =>
      entrant?.costed
        ? {
            carIdx: entrant.carIdx,
            gapS: round(Math.abs(entrant.finishGapS), 1),
          }
        : null;
    this.memory.note(lapsCompleted, finishPlace);
    return {
      now: ownCar.classPosition,
      finish: finishPlace,
      uncertain: deciders.some(
        (entrant) =>
          !entrant.costed || entrant.basis === 'assumed' || entrant.car.inPit
      ),
      was: this.memory.was(lapsCompleted),
      ahead: beside(order[ownIndex - 1]),
      behind: beside(order[ownIndex + 1]),
    };
  }

  /** A class rival as the forecast carries it. */
  private entrant(
    {
      rival,
      paceS,
      progress,
      stintLaps,
      lapsInHand,
      stintSeen,
    }: FinishRivalReckoning,
    pit: Pick<
      RaceForecastCar,
      | 'inPit'
      | 'stops'
      | 'lastStopLap'
      | 'lastStopLaneS'
      | 'sinceStopLaps'
      | 'avg5S'
    >,
    /** The own entry's stops are known, so a gap to it can be projected. */
    placeable: boolean
  ): Entrant {
    const netGapS = placeable ? rival.projectedGapS : null;
    // The gap the Finish Projection draws with its pace switched on, and
    // no extra time: both cars at the cost reckoned for them.
    const finishGapS =
      netGapS === null ? null : rivalProjectedGapS(rival, 0, 0, true);
    return {
      carIdx: rival.carIdx,
      classPosition: rival.classPosition,
      // Where a stop cannot be costed the car keeps the gap it has, moved
      // by pace alone, and the forecast says it is unsure of it.
      finishGapS: finishGapS ?? rival.gapS + rival.paceDeltaS,
      aheadNow: rival.ahead,
      costed: finishGapS !== null,
      basis: rival.basis,
      car: {
        carIdx: rival.carIdx,
        own: false,
        classPosition: rival.classPosition,
        gapS: rival.gapS,
        paceS: round(paceS, 3),
        progress: round(progress, 3),
        lapsLeft: rival.lapsLeft,
        stopsOwed: rival.stopsOwed,
        basis: rival.basis,
        nextStopLap:
          rival.stopsOwed > 0 && stintSeen
            ? stopDueLap(progress, lapsInHand)
            : null,
        stintLaps: round(stintLaps, 2),
        stopLossS: rival.stopLossS,
        netGapS,
        finishGapS: rounded(finishGapS, 1),
        finishPosition: 0,
        ...pit,
        // The projection's own word on it, which also knows the pit road.
        inPit: rival.inPit,
      },
    };
  }

  /** The own entry's stint, from what the projection read aboard it. */
  private stint(
    frame: Telemetry,
    finish: FinishProjectionSnapshot,
    reckoning: FinishReckoning
  ): RaceForecastStint | null {
    const { energy, player } = finish;
    const budgetLaps = reckoning.playerLapsInHand;
    if (!energy || !player || budgetLaps === null) return null;

    // The tank of a car on virtual energy, where it is read on this frame:
    // the fuel projection holds the last litres through a team-mate's
    // stint, and a stint counted from those would be a stint out.
    const tank = this.fuel()?.tank;
    const tankLaps =
      energy.isVirtualEnergy &&
      tank &&
      tank.perLap > 0 &&
      scalar(frame, 'FuelLevel') !== null
        ? tank.level / tank.perLap
        : null;
    const tankFirst = tankLaps !== null && tankLaps < budgetLaps;
    const lapsLeft = tankFirst ? tankLaps : budgetLaps;

    return {
      isVirtualEnergy: energy.isVirtualEnergy,
      aboard: energy.aboard,
      capacity: energy.capacity,
      perLap: energy.perLap,
      lapsLeft: round(lapsLeft, 1),
      limit: energy.isVirtualEnergy && !tankFirst ? 'energy' : 'fuel',
      tankLapsLeft: rounded(tankLaps, 1),
      window: pitWindow({
        progress: player.progress,
        lapsLeft: reckoning.playerLapsLeft,
        lapsInHand: lapsLeft,
        stintLaps: reckoning.playerStintLaps,
        // Known here: the budget this is made from is what it is counted on.
        stopsOwed: finish.playerStopsOwed ?? 0,
      }),
    };
  }

  /**
   * Where the own entry rejoins in its class if it stops now, as the pit
   * stop widget works it out: against the planned stop out on the circuit,
   * and against what is left of the visit once it is in the pit lane.
   */
  private rejoin(now: number): RaceForecastRejoin | null {
    const pitStop = this.pitStop();
    if (!pitStop || pitStop.phase === 'idle') return null;
    const { lane, estimate } = pitStop;
    const standing = plannedStandingS(estimate);
    const inPits = pitStop.phase !== 'planning';
    // Without a standing time the loss is that of a pass with no stop:
    // not a figure to hang a place on.
    if (!inPits && standing === null) return null;
    const planned = pitLossS(lane, standing, 0);
    const loss = inPits
      ? (remainingPitLossS(pitStop, now, 0) ?? planned)
      : planned;
    // Wider while the lane or the stop is only reckoned.
    const margin =
      isPitDriveMeasured(lane, standing) && estimate.source !== 'learned'
        ? REJOIN_MARGIN_MEASURED_S
        : REJOIN_MARGIN_RECKONED_S;
    const projection = projectRejoin(pitStop.rejoin, loss, 'class', margin);
    if (!projection) return null;
    return {
      position: projection.positionAfter,
      ahead: neighbour(projection.ahead),
      behind: neighbour(projection.behind),
      inPits: projection.inPits,
      closeCall: projection.closeCall,
    };
  }
}

/**
 * The rivals the forecast carries: all of them, or in a class larger than
 * the list the ones nearest the own entry. The reckoning lists each side
 * nearest first.
 */
const nearest = (
  rivals: readonly FinishRivalReckoning[]
): readonly FinishRivalReckoning[] => {
  const limit = RACE_FORECAST_MAX_CARS - 1;
  if (rivals.length <= limit) return rivals;
  const ahead = rivals.filter((entry) => entry.rival.ahead);
  const behind = rivals.filter((entry) => !entry.rival.ahead);
  const perSide = Math.ceil(limit / 2);
  const aheadKept = Math.min(
    ahead.length,
    Math.max(perSide, limit - behind.length)
  );
  return [...ahead.slice(0, aheadKept), ...behind.slice(0, limit - aheadKept)];
};
