// Nothing here is imported through a path alias at run time, so a spec can
// load this file and check what the page's stories are told with.
import {
  EMPTY_FLAG_STATE,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  RACE_LOG_PAGE_EVENTS,
  RACE_LOG_SNAPSHOT_EVENTS,
  type CarPitSnapshot,
  type ChannelPayloads,
  type LmuTrackMap,
  type RaceEvent,
  type RaceHistoryBridge,
  type RaceLap,
  type RaceStint,
  type SectorTimingResultSnapshot,
  type Session,
  type StandingsSnapshot,
  type WeatherForecastNode,
} from '../src/types';
import { isCleanLap } from '../src/shared';
import lmuTrackMaps from '../src/app/lmu/lmu-track-maps.json';
import { LMU_STORY_CLASSES } from './lmuEnduranceGrid';
import {
  RACE_HISTORY_STAGE_CLOCK,
  RACE_HISTORY_STAGE_FOR_CHARTS,
  RACE_HISTORY_STAGE_OWN_CAR,
  raceHistoryStage,
  raceHistoryStageBridge,
  type StagedCarRecord,
} from './raceHistoryStage';
import { strategyStage, type StrategyCar } from './strategyStage';
import { timingTowerStage, type TowerStoryCar } from './timingTowerStage';
import { emptyTrackProfileStorySnapshot } from './trackProfileSnapshot';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * One staged eight-hour race for the stories of the Pit Wall page, told to
 * every panel the page hosts: the Timing Tower, Our Car, Class Rivals, the
 * Stint Timeline, Crew and Stints, Car Laps, the Race Charts, the Race Log,
 * the map, the weather forecast and the page's own header.
 *
 * Each of those panels has a stage of its own for its own stories, and
 * those stages tell different races. Here there is one. The records of
 * `raceHistoryStage.ts` are what happened: every lap of every car, its
 * stints and its stops. Everything else is read off them, or made by the
 * other stages' builders told the same cars:
 *
 * - the standings, with gaps in seconds as the app reckons them under Le
 *   Mans Ultimate: laps of progress at the pace of the class leader;
 * - the lap averages, the sectors, the pit tracker's figures and the tyres
 *   from `timingTowerStage.ts`, told each car's laps as they were driven;
 * - the forecast from `strategyStage.ts`, where the real
 *   `RaceForecastProcessor` is run on those standings, laps and stops;
 * - the log, written out of the same stints, laps and places;
 * - one clock, one time of day and one circuit in all of them.
 *
 * Every name and figure is invented, and no recording stands behind any of
 * it: no recorded race has a pit stop or a driver change.
 */

/** The user, whose car #77 is. */
export const PIT_WALL_RACE_USER = 'Mikhail Ivanov';

/** Laps of our car at the two moments the page is staged at. */
const OWN_LAPS = 162;
const TEAM_MATE_LAPS = 141;

/**
 * The share of its budget a car has used when it stops: nearly all of it.
 * A car then comes in with half a lap in hand, on the last lap what it had
 * aboard would cover, and the stops the forecast counts from that are the
 * stops the records show.
 */
const STINT_BUDGET = 0.983;

const { greenAt: GREEN_AT, cautionFrom, cautionTo } = RACE_HISTORY_STAGE_CLOCK;
const RACE_SECONDS = 8 * 3600;
/** The clock in the sim at the zero of the session clock: green at 14:00. */
const TIME_OF_DAY_AT_ZERO = 14 * 3600 - GREEN_AT;

/**
 * The circuit: one where an LMGT3 laps in a little under two minutes, as
 * the staged cars do, and which both sims have. Le Mans Ultimate draws it
 * from the outline that ships with the app, iRacing from its own drawing.
 */
const CIRCUIT = {
  lengthM: 5891,
  lmu: {
    // LMU's track id is a number made from the name; any one will do here.
    trackId: 1_000_000 + 31,
    name: 'Silverstone Grand Prix Circuit - WEC',
    displayName: 'Silverstone Grand Prix Circuit - WEC',
  },
  iracing: {
    trackId: 341,
    name: 'silverstone 2019 gp',
    displayName: 'Silverstone Circuit',
  },
} as const;

/**
 * Where the three sectors start, as a lap fraction: the shares of a lap the
 * records' sector times are made in.
 */
const SECTOR_STARTS = [0, 0.317, 0.717] as const;

const IN_PIT_STALL = 1;
const ON_TRACK = 3;
const SESSION_RACING = 4;

/** The laps of each car the app is taken to have watched, for its averages. */
const WATCHED_LAPS = 24;
/** The laps a car's pace is the mean of: its last clean ones. */
const PACE_LAPS = 5;

/** The air and the track, Celsius, in the evening the race runs into. */
const AIR_TEMP_C = 17;
const TRACK_TEMP_C = 24;

/**
 * Le Mans Ultimate's forecast: five points at fifths of the race's length
 * from the zero of the session clock. It changed four hours and twenty
 * minutes in, and has had rain at its last point since.
 */
const FORECAST_STEP = RACE_SECONDS / 5;
const FORECAST_CHANGED_AT = 15_600;
const FORECAST_RAIN_CHANCE = 0.6;
const FORECAST_RAIN_AT = 4 * FORECAST_STEP;

/** Tread a lap costs each wheel of our car, percent: LF, RF, LR, RR. */
const TREAD_PER_LAP = {
  // The mean of the mediums is what the class's estimates are made at.
  medium: [0.88, 0.84, 0.76, 0.72],
  hard: [0.66, 0.63, 0.57, 0.54],
} as const;
const HARD = 2;

/** How long a class's fastest lap waits before the log says it, seconds. */
const FASTEST_LAP_SETTLE_S = 15;
/** The lap a class's fastest lap is said from. */
const FASTEST_LAP_FROM_LAP = 3;
/** How far past the line a place has held when the log says it, laps. */
const PLACE_SAID_AFTER_LINE = 0.05;

type CarClass = keyof typeof LMU_STORY_CLASSES;
type Wheels = [number, number, number, number];

const isCarClass = (name: string): name is CarClass =>
  name in LMU_STORY_CLASSES;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/** One car of the race, as its records have it at the staged moment. */
interface RaceCar {
  slot: number;
  number: string;
  /** Who is at the wheel now. */
  driver: string;
  team: string;
  carClass: CarClass;
  record: StagedCarRecord;
  /** Laps completed, and the part of the lap under way. */
  lapsDone: number;
  fraction: number;
  progress: number;
  /** Seconds; -1 before it has one. */
  lastLap: number;
  bestLap: number;
  /** The mean of its last five clean laps, seconds. */
  pace: number;
  stops: number;
  /** Laps completed since the last stop, or the start. */
  sinceStop: number;
  /** Its last stop; the lane and the standing so far while it is still in. */
  lastStop: { lap: number; laneS: number; standingS: number } | null;
  /** In the pit lane now. */
  inLane: boolean;
  /** On the lap it left the pit lane on. */
  outLap: boolean;
  longestStint: number;
  /** What it has left to run on now, 0..1; -1 where the sim does not say. */
  energy: number;
  /** The share of a full budget its last lap cost, and a lap on average. */
  usedLastLap: number;
  usedAverage: number;
  wheels: Wheels;
  /** Another compound went on at its last stop. */
  newCompound: boolean;
}

/** What a lap cost a car, from what it had left at one line and the next. */
const usageOf = (
  laps: readonly RaceLap[]
): { last: number; average: number } => {
  const used: number[] = [];
  for (let index = 1; index < laps.length; index += 1) {
    const before = laps[index - 1].energy;
    const after = laps[index].energy;
    // The lap of a stop ends with the budget filled again.
    if (before === null || after === null) continue;
    if ((laps[index].flags & LEDGER_LAP_IN_LAP) !== 0) continue;
    if (before > after) used.push(before - after);
  }
  if (used.length === 0) return { last: -1, average: -1 };
  return {
    last: round(used[used.length - 1], 4),
    average: round(mean(used.slice(-PACE_LAPS)), 4),
  };
};

/**
 * A car's figures at the staged moment, read off its records. `budgetSaid`
 * is whether the sim says what a car has left, which decides what a car
 * with no lap behind it has: all of it, or nothing known.
 */
const carOf = (
  slot: number,
  entry: { number: string; driver: string; team: string; carClass: string },
  record: StagedCarRecord,
  now: number,
  budgetSaid: boolean
): RaceCar => {
  if (!isCarClass(entry.carClass)) {
    throw new Error(`car ${entry.number} is of no staged class`);
  }
  const { laps, stints } = record;
  const timed = laps.filter((lap) => lap.lapTime !== null);
  const clean = timed.filter((lap) => isCleanLap(lap.flags));
  const cleanTimes = clean.map((lap) => lap.lapTime ?? 0);
  const lastLap = timed[timed.length - 1]?.lapTime ?? -1;
  const lapsDone = laps.length;

  const open = stints[stints.length - 1];
  const stopped = stints.filter((stint) => stint.closedBy === 'stop');
  const last = stopped[stopped.length - 1];
  const inLane = last?.stop?.laneTime === null;
  const usage = usageOf(laps);
  const lineEnergy = laps[laps.length - 1]?.energy ?? null;
  const fraction = record.progress - lapsDone;

  // The compound on the car, and whether its last stop put on another: the
  // laps either side of the stop say.
  const compoundsAt = (lap: number | null | undefined): readonly number[] =>
    laps.find((candidate) => candidate.lap === lap)?.compounds ?? [];
  const wheelsNow = laps[laps.length - 1]?.compounds ?? [1, 1, 1, 1];
  const before = compoundsAt(last?.lastLap);
  const after = compoundsAt(open?.firstLap);

  return {
    slot,
    number: entry.number,
    driver: entry.driver,
    team: entry.team,
    carClass: entry.carClass,
    record,
    lapsDone,
    fraction,
    progress: record.progress,
    lastLap,
    bestLap: cleanTimes.length > 0 ? Math.min(...cleanTimes) : -1,
    pace:
      cleanTimes.length > 0
        ? round(mean(cleanTimes.slice(-PACE_LAPS)), 3)
        : Math.max(0, lastLap),
    stops: stopped.length,
    sinceStop: open?.laps ?? 0,
    lastStop:
      last && last.stop
        ? {
            lap: last.lastLap ?? 0,
            laneS: round(last.stop.laneTime ?? now - (last.endTime ?? now), 1),
            standingS: round(last.stop.standingTime, 1),
          }
        : null,
    inLane,
    // The lap of the stop is the first of its stint; the one after it is
    // driven out of the pit lane.
    outLap: !inLane && stopped.length > 0 && open?.laps === 1,
    longestStint: Math.max(0, ...stopped.map((stint) => stint.laps)),
    // What it had at the line, less what the lap under way has used.
    energy:
      lineEnergy === null
        ? budgetSaid && laps.length === 0
          ? 1
          : -1
        : round(
            Math.max(0, lineEnergy - Math.max(0, usage.average) * fraction),
            3
          ),
    usedLastLap: usage.last,
    usedAverage: usage.average,
    wheels: [wheelsNow[0], wheelsNow[1], wheelsNow[2], wheelsNow[3]],
    newCompound:
      before.length > 0 && after.length > 0 && before[0] !== after[0],
  };
};

/**
 * The race time each car is behind the leader of the race, seconds, as the
 * app works it out under Le Mans Ultimate (`src/app/lmu/raceGap.ts`): a
 * class leader's laps behind the overall leader at the leader's pace, and
 * a car's laps behind its class leader at that leader's.
 */
const gapsToLeader = (cars: readonly RaceCar[]): number[] => {
  const furthest = (field: readonly RaceCar[]): RaceCar =>
    field.reduce((ahead, car) => (car.progress > ahead.progress ? car : ahead));
  const leader = furthest(cars);
  return cars.map((car) => {
    if (car === leader) return 0;
    const head = furthest(
      cars.filter((other) => other.carClass === car.carClass)
    );
    return round(
      (leader.progress - head.progress) * leader.pace +
        (head.progress - car.progress) * head.pace,
      3
    );
  });
};

/** The sectors of a lap as the records hold them. */
const sectorsOf = (lap: RaceLap | undefined): readonly (number | null)[] =>
  lap?.sectors ?? [null, null, null];

/**
 * A car's sector times for the tower: the quickest it has done each, the
 * lap before the last, the last, and what is done of the lap under way.
 * The lap under way is in no record yet: its sectors are what the car has
 * been doing, the middle of its last five clean laps, and for a car on its
 * way out of the pits the first sector of the last lap it left them on.
 */
const towerSectors = (car: RaceCar) => {
  const { laps } = car.record;
  const best = [0, 1, 2].map((sector) => {
    const times = laps
      .map((lap) => lap.sectors[sector])
      .filter((time): time is number => time !== null);
    return times.length > 0 ? Math.min(...times) : null;
  });
  const clean = laps.filter(
    (lap) => lap.lapTime !== null && isCleanLap(lap.flags)
  );
  const typical = (sector: number): number | null => {
    const times = clean
      .slice(-PACE_LAPS)
      .map((lap) => lap.sectors[sector])
      .filter((time): time is number => time !== null);
    return times.length > 0 ? round(median(times), 3) : null;
  };
  const lastWayOut = [...laps]
    .reverse()
    .find((lap) => (lap.flags & LEDGER_LAP_OUT_LAP) !== 0);
  const first = car.outLap && lastWayOut ? lastWayOut.sectors[0] : typical(0);
  return {
    best,
    before: sectorsOf(laps[laps.length - 2]),
    last: sectorsOf(laps[laps.length - 1]),
    current: car.inLane
      ? [null, null, null]
      : [
          car.fraction > SECTOR_STARTS[1] ? first : null,
          car.fraction > SECTOR_STARTS[2] ? typical(1) : null,
          null,
        ],
  };
};

/** The car as the tower's stage is told it. */
const towerCarOf = (car: RaceCar, timed: boolean): TowerStoryCar => {
  const { laps } = car.record;
  // The laps the app has watched. A lap out of the pits is no clean lap,
  // and is one only to somebody who saw the lap before it.
  let from = Math.max(0, laps.length - WATCHED_LAPS);
  if (from > 0 && (laps[from].flags & LEDGER_LAP_OUT_LAP) !== 0) from -= 1;
  const watched = laps.slice(from);
  return {
    number: car.number,
    driver: car.driver,
    team: car.team,
    carClass: car.carClass,
    progress: car.progress,
    lastLap: car.lastLap,
    bestLap: car.bestLap,
    inPits: car.inLane,
    outLap: car.outLap,
    stops: car.stops,
    stintLaps: car.sinceStop,
    energy: car.energy,
    wheels: car.wheels,
    told: {
      lapTimes: watched.map((lap) => lap.lapTime ?? -1),
      inLaps: watched.flatMap((lap, index) =>
        (lap.flags & LEDGER_LAP_IN_LAP) !== 0 ? [index + 1] : []
      ),
      sectors: timed ? towerSectors(car) : null,
      lastStop: car.lastStop,
      longestStint: car.longestStint,
      usedLastLap: car.usedLastLap,
      usedAverage: car.usedAverage,
      newCompound: car.newCompound,
    },
  };
};

/**
 * The tread left on our car's wheels, percent. The records say what
 * compound a car is on and not when a set went on: ours is taken to have
 * gone on at our last stop, which is what the tyre table says of our car.
 */
const ownTreadOf = (car: RaceCar): number[] => {
  const perLap =
    car.wheels[0] === HARD ? TREAD_PER_LAP.hard : TREAD_PER_LAP.medium;
  return perLap.map((cost) =>
    round(Math.max(0, 100 - cost * car.sinceStop), 1)
  );
};

/** An event as it is written, before it is numbered and given its clocks. */
type Unstamped<Event> = Event extends RaceEvent
  ? Omit<Event, 'seq' | 'sessionTime' | 'timeOfDay'> & { at: number }
  : never;
type WrittenEvent = Unstamped<RaceEvent>;

/** Every pit visit of a car: in, and out again with what the stop took. */
const pitEvents = (car: RaceCar): WrittenEvent[] => {
  const { laps, stints } = car.record;
  const events: WrittenEvent[] = [];
  stints.forEach((stint, index) => {
    if (stint.closedBy !== 'stop' || !stint.stop || stint.endTime === null) {
      return;
    }
    events.push({
      at: stint.endTime,
      carIdx: car.slot,
      kind: 'pit-entry',
      // Its place at the last line it crossed before it came in.
      classPosition:
        laps.find((lap) => lap.lap === stint.lastLap)?.classPosition ?? null,
    });
    // Still in the lane: the way out is not an event yet.
    if (stint.stop.laneTime === null) return;
    const next: RaceStint | undefined = stints[index + 1];
    const changed = stint.stop.driverChanged && next !== undefined;
    events.push({
      at: stint.endTime + stint.stop.laneTime,
      carIdx: car.slot,
      kind: 'pit-exit',
      standingTime: stint.stop.standingTime,
      laneTime: stint.stop.laneTime,
      driverFrom: changed ? stint.driver : '',
      driverTo: changed ? next.driver : '',
    });
  });
  return events;
};

/**
 * Each class's fastest laps as they fell, as the log's recorder says them:
 * from the lap a car of the class completes its third on, and each one
 * only once it has stood for a moment, so that a lap quick for the whole
 * class is one line and not one for every car that crossed the line on it.
 */
const fastestLapEvents = (
  cars: readonly RaceCar[],
  now: number
): WrittenEvent[] => {
  interface ClassPace {
    best: number;
    laps: number;
    waiting: { lap: RaceLap; dueAt: number } | null;
  }
  const paces = new Map<CarClass, ClassPace>();
  const events: WrittenEvent[] = [];
  const say = (pace: ClassPace, until: number): void => {
    const { waiting } = pace;
    if (!waiting || waiting.dueAt > until) return;
    if (pace.laps < FASTEST_LAP_FROM_LAP) return;
    pace.waiting = null;
    events.push({
      at: waiting.lap.sessionTime,
      carIdx: waiting.lap.carIdx,
      kind: 'fastest-lap',
      lap: waiting.lap.lap,
      lapTime: waiting.lap.lapTime ?? 0,
      driver: waiting.lap.driver,
    });
  };
  const inOrder = cars
    .flatMap((car) => car.record.laps.map((lap) => ({ car, lap })))
    .sort((a, b) => a.lap.sessionTime - b.lap.sessionTime);
  for (const { car, lap } of inOrder) {
    for (const pace of paces.values()) say(pace, lap.sessionTime);
    const pace = paces.get(car.carClass) ?? {
      best: Number.POSITIVE_INFINITY,
      laps: 0,
      waiting: null,
    };
    paces.set(car.carClass, pace);
    if (pace.laps < lap.lap) {
      const counted = pace.laps >= FASTEST_LAP_FROM_LAP;
      pace.laps = lap.lap;
      // From here it is said: the one the class has by now, once the cars
      // behind this one have had their go at the same lap.
      if (!counted && pace.waiting && lap.lap >= FASTEST_LAP_FROM_LAP) {
        pace.waiting.dueAt = lap.sessionTime + FASTEST_LAP_SETTLE_S;
      }
    }
    if (lap.lapTime === null || lap.lapTime >= pace.best) continue;
    pace.best = lap.lapTime;
    // A lap that betters one still waiting takes its place and its turn.
    pace.waiting = {
      lap,
      dueAt: pace.waiting?.dueAt ?? lap.sessionTime + FASTEST_LAP_SETTLE_S,
    };
  }
  for (const pace of paces.values()) say(pace, now);
  return events;
};

/**
 * Our car's changes of place in its class, as the log's recorder says
 * them: once the car has held the new place from one line to the next, so
 * a place lost and taken back within a lap is not said at all.
 */
const placeEvents = (car: RaceCar): WrittenEvent[] => {
  const events: WrittenEvent[] = [];
  let said = 0;
  let held = 0;
  for (const lap of car.record.laps) {
    const place = lap.classPosition ?? 0;
    if (!(place > 0)) continue;
    if (said === 0) {
      // Where it stands when the race begins.
      said = place;
      continue;
    }
    if (place === said) {
      held = 0;
      continue;
    }
    if (place !== held) {
      held = place;
      continue;
    }
    events.push({
      at: lap.sessionTime + car.pace * PLACE_SAID_AFTER_LINE,
      carIdx: car.slot,
      kind: 'position',
      from: said,
      to: place,
    });
    said = place;
    held = 0;
  }
  return events;
};

/** The race's log, oldest first, numbered as the recorder numbers it. */
const logOf = (
  cars: readonly RaceCar[],
  own: RaceCar,
  now: number,
  iracing: boolean
): RaceEvent[] => {
  const written: WrittenEvent[] = [
    {
      at: GREEN_AT,
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'start',
      durationS: null,
      late: false,
    },
    {
      at: cautionFrom,
      carIdx: null,
      kind: 'flag',
      flag: 'caution',
      after: null,
      durationS: null,
      late: false,
    },
    {
      at: cautionTo,
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'caution',
      durationS: cautionTo - cautionFrom,
      late: false,
    },
    ...cars.flatMap(pitEvents),
    ...fastestLapEvents(cars, now),
    ...placeEvents(own),
  ];
  if (!iracing) {
    // Le Mans Ultimate's forecast, as it has stood since it changed.
    written.push({
      at: FORECAST_CHANGED_AT,
      carIdx: null,
      kind: 'forecast',
      rain: true,
      inMinutes: Math.floor((FORECAST_RAIN_AT - FORECAST_CHANGED_AT) / 60),
      rainChance: FORECAST_RAIN_CHANCE,
    });
  }
  return written
    .filter((event) => event.at <= now)
    .sort((a, b) => a.at - b.at)
    .map(
      ({ at, ...rest }, index) =>
        ({
          ...rest,
          seq: index + 1,
          sessionTime: round(at, 1),
          timeOfDay: Math.round(TIME_OF_DAY_AT_ZERO + at),
        }) as RaceEvent
    );
};

/** The points of the forecast still to come, soonest first. */
const forecastNodes = (now: number): WeatherForecastNode[] => {
  const rain = now >= FORECAST_CHANGED_AT;
  const points: readonly [skyType: number, airTempC: number, chance: number][] =
    [
      [1, 18, 0.05],
      [2, 18, 0.1],
      [3, 16, 0.2],
      rain ? [6, 13, FORECAST_RAIN_CHANCE] : [2, 14, 0.1],
    ];
  return points.flatMap(([skyType, airTempC, rainChance], at) => {
    const index = at + 1;
    const startsAt = index * FORECAST_STEP;
    if (startsAt <= now) return [];
    return [
      {
        index,
        skyType,
        airTempC,
        rainChance,
        humidity: round(0.5 + index * 0.04, 2),
        windSpeedMs: 6 - index,
        windDirectionRad: (7 * Math.PI) / 4,
        startsInMinutes: Math.floor((startsAt - now) / 60),
        startsAtTimeOfDay:
          Math.round((TIME_OF_DAY_AT_ZERO + startsAt) / 60) * 60,
      },
    ];
  });
};

/**
 * Our car's own sectors as the app times them, which it does under both
 * sims: the lap under way, the last one, and the bests of the race.
 */
const ownSectorTimes = (car: RaceCar): SectorTimingResultSnapshot => {
  const sectors = towerSectors(car);
  const { laps } = car.record;
  const clean = laps.filter(
    (lap) => lap.lapTime !== null && isCleanLap(lap.flags)
  );
  const bestLap = clean.reduce<RaceLap | undefined>(
    (best, lap) =>
      best === undefined || (lap.lapTime ?? 0) < (best.lapTime ?? 0)
        ? lap
        : best,
    undefined
  );
  return {
    currentLapSectorTimes: sectors.current,
    previousLapSectorTimes: sectors.last,
    currentLapSectorUnclean: [false, false, false],
    previousLapSectorUnclean: [false, false, false],
    sessionBestSectorTimes: sectors.best,
    previousSessionBestSectorTimes: sectors.best,
    sessionBestLapSectorTimes: sectorsOf(bestLap),
    finishedLapSectorTimes: sectors.last,
  };
};

export interface PitWallRaceOptions {
  /**
   * Laps our car has completed. 162: Ivanov, the user, is back at the wheel
   * in the sixth stint. 141: the fifth stint, Sokolov's. Left out, 162, or
   * 141 while `watching`. The race is staged for its middle: a car needs a
   * stop behind it for every panel to have something to say.
   */
  ownLaps?: number;
  /**
   * A team-mate is at the wheel and the user watches the team car: whoever
   * the records name as driving it is that team-mate. Left aside under
   * iRacing, where the app has no watching yet.
   */
  watching?: boolean;
  /**
   * The race as iRacing would give it: no sectors, no virtual energy, no
   * tread, no damage, no forecast of the weather.
   */
  iracing?: boolean;
}

export interface PitWallRace {
  /**
   * Twenty-two cars, our #77 the player's; a team race, on the circuit
   * named above, with its outline unless the sim is iRacing.
   */
  session: Session;
  /** One snapshot for every channel the page's panels read. */
  snapshots: Partial<ChannelPayloads>;
  /**
   * Laps, stints, driver changes and the log's earlier pages, from the
   * same records.
   */
  historyBridge: RaceHistoryBridge;
  /** The session clock at the staged moment, seconds. */
  sessionTime: number;
  /** The slot of a car, by its number. */
  slotOf: (carNumber: string) => number;
}

/** The staged race, as the page's session, channels and bridge hold it. */
export const pitWallRace = ({
  ownLaps,
  watching: asked = false,
  iracing = false,
}: PitWallRaceOptions = {}): PitWallRace => {
  const watching = asked && !iracing;
  const laps = ownLaps ?? (asked ? TEAM_MATE_LAPS : OWN_LAPS);
  const stageOptions = {
    ...RACE_HISTORY_STAGE_FOR_CHARTS,
    ownLaps: laps,
    stintBudget: STINT_BUDGET,
  };
  const history = raceHistoryStage({ ...stageOptions, iracing });
  // The same race with everything a sim can say of it. What our own car
  // has aboard and its sectors are read by the app under iRacing as well,
  // where the records of the field hold neither.
  const full = iracing ? raceHistoryStage(stageOptions) : history;
  const now = history.sessionTime;
  const ownSlot = history.slotOf(RACE_HISTORY_STAGE_OWN_CAR);

  const entries = history.session.DriverInfo.Drivers;
  const carsOf = (
    records: ReadonlyMap<number, StagedCarRecord>,
    budgetSaid: boolean
  ): RaceCar[] =>
    entries.map((entry, slot) => {
      const record = records.get(slot);
      if (!record) throw new Error(`no records for slot ${slot}`);
      return carOf(
        slot,
        {
          number: entry.CarNumber,
          driver: entry.UserName,
          team: entry.TeamName,
          carClass: entry.CarClassShortName ?? '',
        },
        record,
        now,
        budgetSaid
      );
    });
  const cars = carsOf(history.records, !iracing);
  const own = cars[ownSlot];
  const ownInFull = iracing ? carsOf(full.records, true)[ownSlot] : own;
  const ownClass = cars.filter((car) => car.carClass === own.carClass);

  const behindLeader = gapsToLeader(cars);
  const staged = history.snapshots['standings.snapshot'];
  const summary = history.snapshots['race-history.summary'];
  if (!staged || !summary) throw new Error('the race history stage is short');

  // The pace of each class, for whatever turns a lap into seconds: its
  // leader's, as the gaps are reckoned at.
  const classPace = new Map<string, number>();
  for (const car of [...cars].sort((a, b) => a.progress - b.progress)) {
    classPace.set(car.carClass, car.pace);
  }

  const circuit = iracing ? CIRCUIT.iracing : CIRCUIT.lmu;
  const sectors = SECTOR_STARTS.map((SectorStartPct, SectorNum) => ({
    SectorNum,
    SectorStartPct,
  }));
  const session = {
    ...history.session,
    WeekendInfo: {
      ...history.session.WeekendInfo,
      TrackID: circuit.trackId,
      TrackName: circuit.name,
      TrackDisplayName: circuit.displayName,
      TrackLength: iracing
        ? `${round(CIRCUIT.lengthM / 1000, 2)} km`
        : `${CIRCUIT.lengthM} m`,
    },
    SplitTimeInfo: {
      // iRacing says where its sectors start. Le Mans Ultimate's session
      // carries three at even thirds, and the real starts are learned.
      Sectors: iracing
        ? sectors
        : sectors.map((sector) => ({
            ...sector,
            SectorStartPct: sector.SectorNum / sectors.length,
          })),
    },
    DriverInfo: {
      ...history.session.DriverInfo,
      Drivers: entries.map((entry) => ({
        ...entry,
        CarClassEstLapTime:
          classPace.get(entry.CarClassShortName ?? '') ??
          entry.CarClassEstLapTime,
      })),
    },
    ...(iracing
      ? {}
      : {
          LmuTrackMap: (lmuTrackMaps as unknown as Record<string, LmuTrackMap>)[
            CIRCUIT.lmu.name
          ],
        }),
  } as Session;

  const perCar = <T>(value: (car: RaceCar) => T): T[] => cars.map(value);
  const standings: StandingsSnapshot = {
    ...staged,
    sessionTime: now,
    carIdxF2Time: behindLeader,
    carIdxEstTime: perCar((car) => round(car.fraction * car.pace, 3)),
    carIdxOnPitRoad: perCar((car) => car.inLane),
    carIdxTrackSurface: perCar((car) => (car.inLane ? IN_PIT_STALL : ON_TRACK)),
    carIdxTireCompound: perCar((car) => car.wheels[0]),
    // What Le Mans Ultimate says of every car and iRacing of none.
    carIdxEnergyRemaining: iracing ? [] : perCar((car) => car.energy),
    carIdxEnergyIsVirtual: iracing
      ? []
      : perCar((car) => car.carClass !== 'LMP2'),
    carIdxWheelCompounds: iracing ? [] : cars.flatMap((car) => car.wheels),
    carIdxPitStops: iracing ? [] : perCar((car) => car.stops),
    // A car is on its out-lap while it is still on the lap it was on in
    // the pit lane.
    lastPitLap: perCar((car) =>
      car.outLap || car.inLane ? car.lapsDone : undefined
    ),
  };

  const ownTread = ownTreadOf(ownInFull);
  const tower = timingTowerStage({
    cars: cars.map((car) => towerCarOf(car, !iracing)),
    iracingTyres: iracing,
    // The sim reads no tread while somebody else drives the car.
    ownTreadPct: watching ? null : round(mean(ownTread), 1),
  });
  const towerCarPit = tower.snapshots['car-pit.snapshot'];
  const lapTimes = tower.snapshots['lap-times.snapshot'];
  if (!towerCarPit || !lapTimes) throw new Error('the tower stage is short');
  const carPit: CarPitSnapshot = iracing
    ? {
        ...towerCarPit,
        // Empty under iRacing, which says nothing of what a car has left.
        usedLastLap: [],
        usedAverage: [],
        lapsLeft: [],
        requested: [],
      }
    : towerCarPit;

  const strategyCars: StrategyCar[] = cars.map((car) => ({
    number: car.number,
    driver: car.driver,
    team: car.team,
    carClass: car.carClass,
    pace: car.pace,
    progress: car.progress,
    // As the stage counts it: race time behind our car for a car of our
    // class, and progress for any other.
    place:
      car.carClass === own.carClass
        ? round(behindLeader[car.slot] - behindLeader[ownSlot], 3)
        : car.progress,
    stops: car.stops,
    since: car.sinceStop,
    energy: car === own ? ownInFull.energy : car.energy,
    usage: car === own ? ownInFull.usedAverage : car.usedAverage,
    standingS: car.lastStop?.standingS ?? 0,
    inPits: car.inLane,
  }));
  const strategy = strategyStage({
    iracing,
    teamMate: watching ? own.driver : undefined,
    race: {
      cars: strategyCars,
      sessionTime: now,
      greenAt: GREEN_AT,
      session,
      standings,
      lapTimes,
      carPit,
      treadPct: ownTread,
      compound: ownInFull.wheels[0],
    },
  });

  const events = logOf(cars, own, now, iracing);
  const historyBridge: RaceHistoryBridge = {
    ...raceHistoryStageBridge(history.records),
    getEvents: async (_raceId, before) =>
      (before === undefined
        ? events
        : events.filter((event) => event.seq < before)
      ).slice(-RACE_LOG_PAGE_EVENTS),
  };

  const timeOfDay = Math.round(TIME_OF_DAY_AT_ZERO + now);
  const timeLeft = round(RACE_SECONDS - (now - GREEN_AT), 3);
  const ownSector = SECTOR_STARTS.reduce<number>(
    (sector, start, index) => (own.fraction >= start ? index : sector),
    0
  );
  const sectorTimes = ownSectorTimes(ownInFull);
  // The line our car last crossed, and the sectors it has done since.
  const sectorEntry =
    (own.record.laps[own.record.laps.length - 1]?.sessionTime ?? GREEN_AT) +
    sectorTimes.currentLapSectorTimes
      .slice(0, ownSector)
      .reduce<number>((sum, time) => sum + (time ?? 0), 0);

  const snapshots: Partial<ChannelPayloads> = {
    'standings.snapshot': standings,
    'lap-times.snapshot': lapTimes,
    'car-sectors.snapshot': tower.snapshots['car-sectors.snapshot'],
    'car-pit.snapshot': carPit,
    'class-tyres.snapshot': tower.snapshots['class-tyres.snapshot'],
    'race-history.summary': summary,
    'race-forecast.snapshot': strategy.snapshots['race-forecast.snapshot'],
    'wear.snapshot': strategy.snapshots['wear.snapshot'],
    'damage.snapshot': strategy.snapshots['damage.snapshot'],
    'race-log.snapshot': {
      raceToken: summary.raceToken,
      events: events.slice(-RACE_LOG_SNAPSHOT_EVENTS),
      total: events.length,
      sessionNum: 0,
      version: 1,
    },
    'session-bar.snapshot': {
      sessionName: 'RACE',
      trackDisplayName: circuit.displayName,
      displayUnits: 1,
      brakeBiasIsClio: false,
      incidents: 0,
      trackWetness: 1,
      precipitation: 0,
      relativeHumidity: 0.52,
      airTemp: AIR_TEMP_C,
      trackTemp: TRACK_TEMP_C,
      // An LMGT3 runs on virtual energy under Le Mans Ultimate, and on
      // its tank under iRacing: a hundred litres of it.
      ...(iracing
        ? { fuelLevel: round(ownInFull.energy * 100, 1) }
        : { virtualEnergy: own.energy }),
      lastLapTime: own.lastLap,
      bestLapTime: own.bestLap,
      sessionTimeOfDay: timeOfDay,
      timeScale: 1,
      playerCarIdx: ownSlot,
      playerClassified: true,
      playerOverallPosition: standings.carIdxPosition[ownSlot] ?? 0,
      playerClassPosition: standings.carIdxClassPosition[ownSlot] ?? 0,
      playerClassSize: ownClass.length,
      competitorCarIds: [],
      competitorPositions: [],
      lastLapTopSpeed: null,
      sessionBestTopSpeed: null,
      sessionNum: 0,
      version: 1,
    },
    'session-timing.snapshot': {
      sessionType: 'Race',
      state: SESSION_RACING,
      currentLap: own.lapsDone + 1,
      totalLaps: 0,
      time: now,
      timeTotal: RACE_SECONDS,
      // Counted from the green flag, as the header counts it.
      timeRemaining: timeLeft,
      greenFlagTimestamp: GREEN_AT,
      isFixedLapRace: false,
      totalRaceLaps: 0,
      totalRaceTime: 0,
      adjustedRaceTime: 0,
      lapsCompleted: own.lapsDone,
      lapProgress: round(own.fraction, 2),
      sessionNum: 0,
      version: 1,
    },
    'flag-state.snapshot': {
      ...EMPTY_FLAG_STATE,
      kind: 'green',
      detail: 'trackClear',
      // Green since the full-course yellow ended, or since the start.
      since: now >= cautionTo ? cautionTo : GREEN_AT,
      // Le Mans Ultimate flags sectors; iRacing does not.
      yellowSectors: iracing ? [] : [false, false, false],
      playerSector: ownSector,
      sessionNum: 0,
      version: 1,
    },
    'track-state.snapshot': {
      ...trackStateStorySnapshot,
      focusCarIdx: ownSlot,
      sessionTime: now,
      sessionState: SESSION_RACING,
      lapDistPct: round(own.fraction, 3),
      // Where every car is, for the map.
      carIdxLapDistPct: perCar((car) => round(car.fraction, 3)),
      carIdxOnPitRoad: standings.carIdxOnPitRoad,
      carIdxTrackSurface: standings.carIdxTrackSurface,
      carIdxClassPosition: standings.carIdxClassPosition,
      onPitRoad: own.inLane,
      lastLapTime: own.lastLap,
      lapCompleted: own.lapsDone,
      ...(watching
        ? {
            isOnTrack: false,
            outOfCar: true,
            watching: true,
            watchingOwnCar: true,
            watchingOwnCarTelemetry: true,
          }
        : {}),
    },
    'track-profile.snapshot': {
      ...emptyTrackProfileStorySnapshot,
      trackKey: `${iracing ? 'iracing' : 'lmu'}:${circuit.trackId}`,
      trackLengthM: CIRCUIT.lengthM,
      sectorStartPct: SECTOR_STARTS,
      sectorSource: iracing ? 'session' : 'learned',
    },
    'sector-timing.snapshot': {
      sectors,
      currentSectorIdx: ownSector,
      sectorEntryTime: round(sectorEntry, 3),
      sectorEntryValid: true,
      inclusive: sectorTimes,
      clean: sectorTimes,
      allTime: null,
      sessionNum: 0,
      version: 1,
    },
    // Read by the map and by the tower's rows; nobody is on the radio, and
    // no lap is held to draw a ghost from.
    'reference-laps.snapshot': {
      bestLaps: [],
      persistedLaps: [],
      sessionNum: 0,
      version: 1,
    },
    'radio.snapshot': { transmittingCarIdxs: [], version: 1 },
    // iRacing publishes the weather as it is and no forecast.
    ...(iracing
      ? {}
      : {
          'weather-forecast.snapshot': {
            available: true,
            now: {
              skyType: now >= 3 * FORECAST_STEP ? 3 : 2,
              airTempC: AIR_TEMP_C,
              rain: 0,
              airTempTrend: -1,
              rainTrend: 0,
            },
            nodes: forecastNodes(now),
            lapLimited: false,
            sessionNum: 0,
            version: 1,
          },
        }),
  };

  return {
    session,
    snapshots,
    historyBridge,
    sessionTime: now,
    slotOf: history.slotOf,
  };
};
