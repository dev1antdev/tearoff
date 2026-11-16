import { describe, expect, it } from 'vitest';
import {
  SessionState,
  TrackLocation,
  type Session,
  type Telemetry,
  type TrafficSnapshot,
} from '@irdashies/types';
import { TrafficProcessor } from './TrafficProcessor';

/** A 4.5 km lap driven at 50 m/s: a 90 s lap, 0.2 s a tick. */
const TRACK_M = 4500;
const PLAYER_MS = 50;
const LAP_S = TRACK_M / PLAYER_MS;
const TICK_S = 0.2;
const PLAYER = 0;
const PRACTICE = 0;
const RACE = 1;
/** Where the player starts: half way round its eleventh lap. */
const START_M = 10.5 * TRACK_M;

type CarClass = 'gt3' | 'lmp2';
const CLASS_ID: Record<CarClass, number> = { gt3: 3, lmp2: 2 };
const CLASS_SPEED: Record<CarClass, number> = { gt3: 1, lmp2: 4 };

interface Car {
  carClass: CarClass;
  /** Metres along the track since the start of the race. */
  pos: number;
  /** m/s. */
  speed: number;
  inPitLane: boolean;
  surface: number;
  place: number;
  /** A lap time for lap-times.snapshot; 0 for none. */
  lapTime: number;
  /** LMU holding the car at the line: its fraction reads exactly 0. */
  held: boolean;
}

interface CarInput {
  carClass?: CarClass;
  /** Metres behind the player; negative is ahead. */
  behind: number;
  /** Laps ahead of the player on top of that. */
  lapsAhead?: number;
  speed?: number;
  inPitLane?: boolean;
  surface?: number;
  place?: number;
  lapTime?: number;
  held?: boolean;
}

interface WorldOptions {
  sessionNum?: number;
  state?: number;
  lmu?: boolean;
  playerLapTime?: number;
  playerPlace?: number;
}

/**
 * A small world to drive the processor through: a player and some cars
 * moving along one lap at speeds a case sets, and the frame each tick
 * makes.
 */
class World {
  readonly processor: TrafficProcessor;
  readonly cars: Car[];
  time = 100;
  sessionNum: number;
  state: number;
  lmu: boolean;
  /** The player is at the wheel; false is a team-mate driving. */
  atWheel = true;
  /** LMU's wheel surfaces, or undefined to publish none. */
  wheels: number[] | undefined = [0, 0, 0, 0];
  offTrack = false;

  constructor(cars: readonly CarInput[], options: WorldOptions = {}) {
    this.sessionNum = options.sessionNum ?? RACE;
    this.state = options.state ?? SessionState.Racing;
    this.lmu = options.lmu ?? false;
    this.cars = [
      {
        carClass: 'gt3',
        pos: START_M,
        speed: PLAYER_MS,
        inPitLane: false,
        surface: TrackLocation.OnTrack,
        place: options.playerPlace ?? 20,
        lapTime: options.playerLapTime ?? LAP_S,
        held: false,
      },
      ...cars.map((car, index) => ({
        carClass: car.carClass ?? 'gt3',
        pos: START_M - car.behind + (car.lapsAhead ?? 0) * TRACK_M,
        speed: car.speed ?? PLAYER_MS,
        inPitLane: car.inPitLane ?? false,
        surface: car.surface ?? TrackLocation.OnTrack,
        place: car.place ?? index + 2,
        lapTime: car.lapTime ?? 0,
        held: car.held ?? false,
      })),
    ];
    this.processor = new TrafficProcessor({
      carSpeeds: () => this.cars.map((car) => car.speed * 3.6),
      lapTimes: () => this.cars.map((car) => car.lapTime),
    });
    this.processor.init(this.session());
    this.processor.onLifecycle({ type: 'enter', replay: false });
  }

  get player(): Car {
    return this.cars[PLAYER];
  }

  get snapshot(): TrafficSnapshot {
    return this.processor.snapshot();
  }

  /** The player's lap fraction now. */
  get playerPct(): number {
    return (this.player.pos % TRACK_M) / TRACK_M;
  }

  session(): Session {
    return {
      WeekendInfo: { TrackLength: `${TRACK_M / 1000} km` },
      SessionInfo: {
        Sessions: [
          { SessionNum: PRACTICE, SessionType: 'Practice' },
          { SessionNum: RACE, SessionType: 'Race' },
        ],
      },
      DriverInfo: {
        DriverCarIdx: PLAYER,
        PaceCarIdx: -1,
        Drivers: this.cars.map((car, carIdx) => ({
          CarIdx: carIdx,
          CarClassID: CLASS_ID[car.carClass],
          CarClassRelSpeed: CLASS_SPEED[car.carClass],
          CarClassEstLapTime: 0,
          CarIsPaceCar: 0,
          IsSpectator: 0,
        })),
      },
    } as unknown as Session;
  }

  frame(): Telemetry {
    const cells: Record<string, { value: unknown[] }> = {
      SessionTime: { value: [this.time] },
      SessionNum: { value: [this.sessionNum] },
      SessionState: { value: [this.state] },
      PlayerCarIdx: { value: [PLAYER] },
      IsOnTrack: { value: [this.atWheel] },
      PlayerTrackSurface: {
        value: [this.offTrack ? TrackLocation.OffTrack : this.player.surface],
      },
      CarIdxLapDistPct: {
        value: this.cars.map((car) =>
          car.held ? 0 : (car.pos % TRACK_M) / TRACK_M
        ),
      },
      CarIdxLapCompleted: {
        value: this.cars.map((car) => Math.floor(car.pos / TRACK_M)),
      },
      CarIdxOnPitRoad: { value: this.cars.map((car) => car.inPitLane) },
      CarIdxTrackSurface: { value: this.cars.map((car) => car.surface) },
      CarIdxPosition: { value: this.cars.map((car) => car.place) },
    };
    if (this.atWheel) cells.Speed = { value: [this.player.speed] };
    if (this.lmu) {
      cells.LmuGamePhase = { value: [5] };
      if (this.wheels) cells.LmuWheelSurfaceType = { value: this.wheels };
    }
    return cells as unknown as Telemetry;
  }

  /** One tick: the processor reads the world as it stands, then it moves. */
  tick(): void {
    this.processor.onFrame(this.frame());
    this.time = Math.round((this.time + TICK_S) * 1000) / 1000;
    for (const car of this.cars) car.pos += car.speed * TICK_S;
  }

  /** Runs for a time and reads the world once more at the end of it. */
  run(seconds: number): TrafficSnapshot {
    const ticks = Math.round(seconds / TICK_S);
    for (let tick = 0; tick < ticks; tick += 1) this.tick();
    this.processor.onFrame(this.frame());
    return this.snapshot;
  }
}

describe('the interval to a car behind', () => {
  it('is how long ago the player was where the car is', () => {
    const world = new World([{ behind: 100 }]);
    const snapshot = world.run(5);

    expect(snapshot.behind).toEqual([
      {
        carIdx: 1,
        relation: 'position',
        distanceM: 100,
        gapS: 2,
        measured: true,
        closingS: 0,
        lapsAhead: 0,
      },
    ]);
    expect(snapshot.nearestBehind).toEqual({ carIdx: 1, gapS: 2 });
    expect(snapshot.lapS).toBe(LAP_S);
  });

  it('is the metres over the speed until the record reaches back that far', () => {
    const world = new World([{ behind: 200, lapsAhead: 1 }]);
    // A second in, the player's own running covers 50 m.
    expect(world.run(1).behind[0]).toMatchObject({
      carIdx: 1,
      relation: 'lapping',
      gapS: 4,
      measured: false,
      closingS: null,
    });
    expect(world.run(4).behind[0]).toMatchObject({
      gapS: 4,
      measured: true,
    });
  });

  it('does not count the time lost in a crawl as a gap', () => {
    const world = new World([{ behind: 100, lapsAhead: 1 }]);
    world.run(5);
    // The player crawls for four seconds; the car behind slows with them.
    world.player.speed = 5;
    world.cars[1].speed = 5;
    world.run(4);
    world.player.speed = PLAYER_MS;
    world.cars[1].speed = PLAYER_MS;
    const after = world.run(1);

    // Measured across the crawl it would read the 100 m as 5.6 s.
    expect(after.behind[0]).toMatchObject({ measured: false, gapS: 2 });
    // Once the car is on road the player has driven at speed since, it
    // is measured again.
    expect(world.run(3).behind[0]).toMatchObject({ measured: true, gapS: 2 });
  });

  it('starts again when the car is moved', () => {
    const world = new World([{ behind: 100, lapsAhead: 1 }]);
    expect(world.run(5).behind[0].measured).toBe(true);
    // Back to the pits and out again somewhere else on the lap.
    world.player.pos += 0.4 * TRACK_M;
    world.cars[1].pos += 0.4 * TRACK_M;
    expect(world.run(0).behind[0]).toMatchObject({ measured: false, gapS: 2 });
  });
});

describe('the table of contacts', () => {
  it('picks the car ahead the player reaches soonest', () => {
    // 5 s ahead closing at 0.05 s a second, and 40 s ahead closing at 0.5.
    const world = new World([
      { behind: -250, speed: 47.5, place: 2 },
      { behind: -2000, speed: 25, place: 1 },
    ]);
    const snapshot = world.run(15);

    // After 15 s the gaps are 4.25 s and 32.5 s: 0.94 and 0.72 laps off.
    expect(snapshot.slowerAhead?.carIdx).toBe(2);
    expect(snapshot.slowerAhead?.gapS).toBeCloseTo(32.5, 1);
    expect(snapshot.slowerAhead?.laps).toBeCloseTo(32.5 / 0.5 / LAP_S, 2);
    // The car ahead is 3 % into its lap: the meeting is inside it.
    expect(snapshot.slowerAhead?.thisLap).toBe(true);
    // Neither is gaining on the player.
    expect(snapshot.fasterBehind).toBeNull();
    // The leader is the car in first place, a lap less 32.5 s behind, and
    // it is not closing.
    expect(snapshot.leader).toEqual({
      carIdx: 2,
      gapS: 57.5,
      laps: null,
      thisLap: false,
    });
  });

  it('needs ten seconds of closing before it names a car', () => {
    const world = new World([{ behind: -250, speed: 47.5 }]);
    expect(world.run(9).slowerAhead).toBeNull();
    expect(world.run(3).slowerAhead?.carIdx).toBe(1);
  });

  it('skips a car in the pit lane, and a car that is pulling away is coming round', () => {
    const world = new World([
      { behind: -250, speed: 25, inPitLane: true },
      { behind: -250, speed: 52.5 },
    ]);
    const snapshot = world.run(15);

    expect(snapshot.slowerAhead).toBeNull();
    // 5.75 s ahead and gaining 0.05 s a second: 84.25 s behind, 18.7 laps.
    expect(snapshot.fasterBehind?.carIdx).toBe(2);
    expect(snapshot.fasterBehind?.gapS).toBeCloseTo(84.3, 1);
    expect(snapshot.fasterBehind?.laps).toBeCloseTo(84.25 / 0.05 / LAP_S, 1);
    expect(snapshot.fasterBehind?.thisLap).toBe(false);
  });

  it('gives no laps to a contact more than 50 laps off', () => {
    // 40 s ahead closing at 0.005 s a second: 89 laps.
    const world = new World([{ behind: -2000, speed: 49.75 }]);
    const snapshot = world.run(15);

    expect(snapshot.slowerAhead?.carIdx).toBe(1);
    expect(snapshot.slowerAhead?.gapS).toBeCloseTo(39.9, 1);
    expect(snapshot.slowerAhead?.laps).toBeNull();
  });

  it('marks a contact after the end of the lap under way', () => {
    // 5 s ahead at 81 % of its lap and 0.94 laps off.
    const world = new World([{ behind: -250, speed: 47.5 }]);
    expect(world.run(15).slowerAhead).toMatchObject({
      carIdx: 1,
      thisLap: false,
    });
  });

  it('has no leader when the player leads', () => {
    const world = new World([{ behind: 300, speed: 55, place: 2 }], {
      playerPlace: 1,
    });
    const snapshot = world.run(15);
    expect(snapshot.leader).toBeNull();
    expect(snapshot.fasterBehind?.carIdx).toBe(1);
  });

  it('counts down the leader coming to lap the player', () => {
    // 20 s behind and gaining 0.1 s a second.
    const world = new World([
      { behind: 1000, lapsAhead: 1, speed: 55, place: 1, carClass: 'lmp2' },
    ]);
    const snapshot = world.run(20);

    expect(snapshot.leader?.carIdx).toBe(1);
    expect(snapshot.leader?.gapS).toBeCloseTo(18, 1);
    expect(snapshot.leader?.laps).toBeCloseTo(18 / 0.1 / LAP_S, 1);
  });

  it('has laps only with a lap time', () => {
    // Under LMU with no lap on record and none measured there is no lap
    // time at first, and so no closing to read off the lap fractions. Once
    // a tenth of a lap is on record it works out to 90 s a lap.
    const world = new World([{ behind: -250, speed: 47.5 }], {
      lmu: true,
      playerLapTime: 0,
    });
    expect(world.run(0.2).lapS).toBeNull();
    expect(world.run(8).lapS).toBeNull();
    const snapshot = world.run(17);
    expect(snapshot.lapS).toBeCloseTo(LAP_S, 1);
    // 3.74 s ahead by now, closing at 0.05 s a second.
    expect(snapshot.slowerAhead?.laps).toBeCloseTo(0.83, 1);
  });
});

describe('the mirror', () => {
  it('lists the traffic in the order it queues, behind the rival right behind', () => {
    const world = new World([
      { behind: 150, lapsAhead: 1, carClass: 'lmp2' },
      { behind: 50 },
      { behind: 300, carClass: 'lmp2' },
      { behind: 100 },
    ]);
    const snapshot = world.run(8);

    expect(
      snapshot.behind.map((car) => [car.carIdx, car.relation, car.gapS])
    ).toEqual([
      [2, 'position', 1],
      [1, 'lapping', 3],
      [3, 'fasterClass', 6],
    ]);
    expect(snapshot.behind[1].lapsAhead).toBe(1);
    expect(snapshot.moreBehind).toBe(0);
  });

  it('shows four rows and counts the rest', () => {
    const world = new World([
      { behind: 50 },
      ...[100, 150, 200, 250, 300].map((behind) => ({
        behind,
        lapsAhead: 1,
        carClass: 'lmp2' as const,
      })),
    ]);
    const snapshot = world.run(8);

    expect(snapshot.behind.map((car) => car.carIdx)).toEqual([1, 2, 3, 4]);
    expect(snapshot.moreBehind).toBe(2);
  });

  it('leaves out a rival behind the traffic, and one more than 3 s back', () => {
    const behindTraffic = new World([
      { behind: 60, lapsAhead: 1 },
      { behind: 100 },
    ]);
    expect(behindTraffic.run(5).behind.map((car) => car.carIdx)).toEqual([1]);

    const farRival = new World([{ behind: 200 }]);
    expect(farRival.run(8).behind).toEqual([]);
  });

  it('leaves out traffic more than 8 s back, and everything in the pits', () => {
    const world = new World([
      { behind: 450, lapsAhead: 1 },
      { behind: 100, lapsAhead: 1, inPitLane: true },
    ]);
    expect(world.run(12).behind).toEqual([]);
    // 9 s back: not in the mirror, still the nearest car behind.
    expect(world.snapshot.nearestBehind).toEqual({ carIdx: 1, gapS: 9 });
  });

  it('outside a race lists the cars that are closing', () => {
    const world = new World(
      [
        { behind: 100, speed: 50.5 },
        { behind: 200, speed: 55 },
      ],
      { sessionNum: PRACTICE }
    );
    const snapshot = world.run(10);
    expect(snapshot.behind.map((car) => [car.carIdx, car.relation])).toEqual([
      [2, 'closing'],
    ]);
    expect(snapshot.behind[0].closingS).toBeCloseTo(0.1, 2);
  });
});

describe('the forecast', () => {
  /** A prototype a lap ahead, 12 s behind, closing at 0.25 s a second. */
  const closingWorld = (lapTime = 0) =>
    new World([
      {
        behind: 600,
        lapsAhead: 1,
        speed: 62.5,
        carClass: 'lmp2',
        lapTime,
      },
    ]);

  it('waits for six seconds of measured closing', () => {
    const world = closingWorld();
    // The car reaches road the player has on record 9.6 s in; six seconds
    // of readings a second apart are complete at 16 s.
    expect(world.run(15).forecast).toBeNull();
    expect(world.run(1.2).forecast).not.toBeNull();
  });

  it('says when and where a steadily closing car arrives', () => {
    const world = closingWorld();
    const snapshot = world.run(31);

    // 4.25 s behind and closing at 0.25 s a second: 17 s.
    expect(snapshot.behind[0]).toMatchObject({ gapS: 4.3, closingS: 0.25 });
    expect(snapshot.forecast).toEqual({
      carIdx: 1,
      etaS: 17,
      lowS: 13,
      highS: 21,
      steady: true,
      laps: 0.19,
      // 17 s on at 90 s a lap, from where the player is.
      meetPct: round3((world.playerPct + 17 / LAP_S) % 1),
      meetLowPct: round3((world.playerPct + 12.75 / LAP_S) % 1),
      meetHighPct: round3((world.playerPct + 21.25 / LAP_S) % 1),
    });
  });

  it('gives a range and no place to an arrival further off than it measured', () => {
    const world = closingWorld();
    // 7 s behind, measured for ten seconds: 28 s off.
    expect(world.run(20).forecast).toEqual({
      carIdx: 1,
      etaS: 28,
      lowS: 14,
      highS: 42,
      steady: false,
      laps: 0.31,
      meetPct: null,
      meetLowPct: null,
      meetHighPct: null,
    });
  });

  it('lets measured lap times vouch for an arrival that far off', () => {
    // 72 s laps against the player's 90 s: 0.2 s a second over a lap.
    const world = closingWorld(72);
    expect(world.run(20).forecast).toMatchObject({
      etaS: 28,
      lowS: 21,
      highS: 35,
      steady: true,
      meetPct: null,
    });
  });

  it('goes when the car stops closing', () => {
    const world = closingWorld();
    expect(world.run(31).forecast).not.toBeNull();
    world.cars[1].speed = PLAYER_MS;
    // Ten seconds on, the newer half of what was measured is flat.
    expect(world.run(10).forecast).toBeNull();
    expect(world.snapshot.behind[0]).toMatchObject({ gapS: 4.3 });
  });

  it('is for the car that arrives soonest, not the nearest', () => {
    const world = new World([
      // A rival 2 s behind gaining 0.04 s a second: 50 s off at first.
      { behind: 100, speed: 52 },
      // A prototype 6 s behind gaining 0.25 s a second: 24 s off.
      { behind: 300, lapsAhead: 1, speed: 62.5, carClass: 'lmp2' },
    ]);
    const snapshot = world.run(14);
    expect(snapshot.behind.map((car) => car.carIdx)).toEqual([1, 2]);
    expect(snapshot.forecast?.carIdx).toBe(2);
  });

  it('reads the place off the player’s own last lap where it has one', () => {
    // A lap and a bit on record, then a prototype 6 s behind.
    const world = new World([
      { behind: 300 + 100 * 12.5, lapsAhead: 1, speed: 62.5, carClass: 'lmp2' },
    ]);
    world.run(100);
    // It has closed by 25 s: 6 s behind now, and measured throughout.
    world.run(10);
    const forecast = world.snapshot.forecast;
    expect(forecast?.etaS).toBe(14);
    expect(forecast?.meetPct).toBe(round3((world.playerPct + 14 / LAP_S) % 1));
  });
});

describe('the pit lane and the rejoin', () => {
  it('lists who is coming while the player is in the pit lane', () => {
    const world = new World([
      { behind: 600, speed: 60 },
      { behind: 1500 },
      // More than half a lap back is ahead, not behind.
      { behind: 4000 },
      { behind: 300, inPitLane: true },
    ]);
    world.player.inPitLane = true;
    world.player.surface = TrackLocation.ApproachingPits;
    world.player.speed = 16.7;
    const snapshot = world.run(0);

    expect(snapshot.inPitLane).toBe(true);
    expect(snapshot.arriving).toEqual([
      { carIdx: 1, gapS: 10, speedMs: 60 },
      { carIdx: 2, gapS: 30, speedMs: 50 },
    ]);
    expect(snapshot.nearestBehind).toEqual({ carIdx: 1, gapS: 10 });
    // Nothing is measured, listed or forecast from the pit lane.
    expect(snapshot.behind).toEqual([]);
    expect(snapshot.slowerAhead).toBeNull();
    expect(snapshot.exitedAt).toBeNull();
  });

  it('takes a car at its lap average when that is the quickest it shows', () => {
    // Standing in the box, and the car behind is in a hairpin at 20 m/s,
    // but laps in 75 s: 60 m/s round the lap.
    const world = new World([{ behind: 600, speed: 20, lapTime: 75 }]);
    world.player.inPitLane = true;
    world.player.surface = TrackLocation.InPitStall;
    world.player.speed = 0;
    expect(world.run(0).arriving).toEqual([
      { carIdx: 1, gapS: 10, speedMs: 60 },
    ]);
  });

  it('notes when the player left the pit lane, and goes on listing for 30 s', () => {
    const world = new World([{ behind: 1000 }]);
    world.player.inPitLane = true;
    world.player.surface = TrackLocation.ApproachingPits;
    world.run(2);
    world.player.inPitLane = false;
    world.player.surface = TrackLocation.OnTrack;
    const left = world.run(0);

    expect(left.inPitLane).toBe(false);
    expect(left.exitedAt).toBe(102);
    expect(left.arriving.map((car) => car.carIdx)).toEqual([1]);
    expect(world.run(29).arriving).toHaveLength(1);
    expect(world.run(2).arriving).toEqual([]);
    expect(world.snapshot.exitedAt).toBe(102);
  });

  it('starts the closing rates again after the pit lane', () => {
    const world = new World([{ behind: -250, speed: 47.5 }]);
    expect(world.run(15).slowerAhead?.carIdx).toBe(1);
    world.player.inPitLane = true;
    world.run(2);
    world.player.inPitLane = false;
    expect(world.run(5).slowerAhead).toBeNull();
    expect(world.run(8).slowerAhead?.carIdx).toBe(1);
  });

  it('notes when the player was slow on the track', () => {
    const world = new World([{ behind: 400 }]);
    world.run(1);
    expect(world.snapshot.slowAt).toBeNull();
    world.player.speed = 5;
    expect(world.run(1).slowAt).toBe(102);
    world.player.speed = PLAYER_MS;
    world.run(3);
    // The last moment it was slow, kept.
    expect(world.snapshot.slowAt).toBe(102);
    expect(world.snapshot.arriving.map((car) => car.carIdx)).toEqual([1]);
  });

  it('is not slow in the pit lane, nor before the green flag', () => {
    const inPits = new World([]);
    inPits.player.speed = 5;
    inPits.player.inPitLane = true;
    expect(inPits.run(1).slowAt).toBeNull();

    const onGrid = new World([], { state: SessionState.ParadeLaps });
    onGrid.player.speed = 5;
    expect(onGrid.run(1).slowAt).toBeNull();
    // The lights go out: the first three seconds are a standing field.
    onGrid.state = SessionState.Racing;
    expect(onGrid.run(2.8).slowAt).toBeNull();
    expect(onGrid.run(0.4).slowAt).not.toBeNull();
  });

  it('is slow off the road: iRacing says so, LMU by all four wheels', () => {
    const iracing = new World([]);
    iracing.offTrack = true;
    expect(iracing.run(0).slowAt).toBe(100);

    const lmu = new World([], { lmu: true });
    lmu.wheels = [2, 5, 2, 2];
    expect(lmu.run(1).slowAt).toBeNull();
    lmu.wheels = [2, 4, 3, 2];
    expect(lmu.run(0).slowAt).toBe(101);
    // With no player car the sim publishes no wheels.
    const noWheels = new World([], { lmu: true });
    noWheels.wheels = undefined;
    expect(noWheels.run(1).slowAt).toBeNull();
  });
});

describe('the car it follows', () => {
  it('is the player’s own entry through a team-mate’s stint', () => {
    // Nobody at the wheel: no speed of the player's, and the car's own
    // speed comes from how its lap fraction moves.
    const world = new World([{ behind: 100, lapsAhead: 1 }]);
    world.atWheel = false;
    expect(world.run(5).behind[0]).toMatchObject({ carIdx: 1, gapS: 2 });
    world.player.speed = 5;
    expect(world.run(1).slowAt).toBe(106);
  });

  it('leaves out a car LMU holds at the line, and is nowhere when held itself', () => {
    const world = new World([{ behind: 100, lapsAhead: 1, held: true }], {
      lmu: true,
    });
    expect(world.run(5).behind).toEqual([]);
    expect(world.snapshot.nearestBehind).toBeNull();

    world.player.held = true;
    const held = world.run(1);
    expect(held.lapS).toBeNull();
    expect(held.slowerAhead).toBeNull();
  });

  it('publishes nothing about cars while the sim’s data is stale', () => {
    const world = new World([{ behind: 100, lapsAhead: 1 }], { lmu: true });
    expect(world.run(5).behind).toHaveLength(1);
    const frame = world.frame() as unknown as Record<string, unknown>;
    frame.LmuDataStale = { value: [true] };
    world.processor.onFrame(frame as unknown as Telemetry);
    expect(world.snapshot.behind).toEqual([]);
    expect(world.snapshot.nearestBehind).toBeNull();
  });
});

describe('what ends it', () => {
  const busy = () => {
    const world = new World([{ behind: 100, lapsAhead: 1 }]);
    world.run(5);
    world.player.speed = 5;
    world.run(1);
    world.player.speed = PLAYER_MS;
    world.player.inPitLane = true;
    world.run(1);
    world.player.inPitLane = false;
    world.run(1);
    return world;
  };

  it('a new session clears every car and both anchors', () => {
    const world = busy();
    expect(world.snapshot.slowAt).not.toBeNull();
    expect(world.snapshot.exitedAt).not.toBeNull();
    const version = world.snapshot.version;

    world.processor.onLifecycle({ type: 'sessionNumChange' });
    expect(world.snapshot).toMatchObject({
      slowerAhead: null,
      leader: null,
      fasterBehind: null,
      nearestBehind: null,
      slowAt: null,
      exitedAt: null,
      inPitLane: false,
      behind: [],
      moreBehind: 0,
      forecast: null,
      arriving: [],
      lapS: null,
      sessionNum: null,
    });
    expect(world.snapshot.version).toBeGreaterThan(version);
  });

  it('so does a disconnect, and a session number that changes on a frame', () => {
    const world = busy();
    world.processor.onLifecycle({ type: 'disconnect' });
    expect(world.snapshot.exitedAt).toBeNull();

    const other = busy();
    other.sessionNum = PRACTICE;
    const snapshot = other.run(0);
    expect(snapshot.slowAt).toBeNull();
    expect(snapshot.exitedAt).toBeNull();
    expect(snapshot.sessionNum).toBe(PRACTICE);
  });

  it('a clock that runs backwards starts everything again', () => {
    const world = busy();
    world.time = 50;
    const snapshot = world.run(0);
    expect(snapshot.slowAt).toBeNull();
    expect(snapshot.exitedAt).toBeNull();
    expect(snapshot.behind[0]).toMatchObject({ measured: false });
  });

  it('moves its version only when something published moves', () => {
    const world = new World([]);
    world.run(3);
    const version = world.snapshot.version;
    world.run(3);
    // An empty road at a steady pace: nothing to say twice.
    expect(world.snapshot.version).toBe(version);
  });
});

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
