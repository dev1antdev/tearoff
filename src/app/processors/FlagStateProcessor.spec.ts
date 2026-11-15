import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAG_TUNING,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_FULL_COURSE_YELLOW,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_PENALTY,
  FLAG_ACTIVE_YELLOW,
  FLAG_ACTIVE_YELLOW_NEAR,
  GlobalFlags,
  LMU_FINISH_STATUS,
  LMU_PENALTY_CODE,
  SessionState,
  TrackLocation,
  type FlagProcessorTuning,
  type Session,
  type Telemetry,
} from '@irdashies/types';
import { FlagStateProcessor } from './FlagStateProcessor';

/** A five-kilometre lap, so a metre is 0.0002 of it. */
const TRACK_M = 5000;
const PLAYER = 0;
const PLAYER_PCT = 0.5;
const PRACTICE = 0;
const RACE = 1;

type CarClass = 'gt3' | 'lmp2' | 'hyper';

const CLASS_ID: Record<CarClass, number> = { gt3: 3, lmp2: 2, hyper: 1 };
const CLASS_SPEED: Record<CarClass, number> = { gt3: 1, lmp2: 4, hyper: 5 };

const session = (classes: readonly CarClass[]): Session =>
  ({
    WeekendInfo: { TrackLength: '5 km' },
    SessionInfo: {
      Sessions: [
        { SessionNum: PRACTICE, SessionType: 'Practice' },
        { SessionNum: RACE, SessionType: 'Race' },
      ],
    },
    DriverInfo: {
      DriverCarIdx: PLAYER,
      PaceCarIdx: -1,
      Drivers: classes.map((carClass, carIdx) => ({
        CarIdx: carIdx,
        CarClassID: CLASS_ID[carClass],
        CarClassRelSpeed: CLASS_SPEED[carClass],
        CarClassEstLapTime: 0,
        CarIsPaceCar: 0,
        IsSpectator: 0,
      })),
    },
  }) as unknown as Session;

/** One car as a spec places it. The player is the first of the list. */
interface Car {
  /** Metres behind the player on the road; negative is ahead. */
  behind?: number;
  /** Laps completed. The player has completed ten. */
  laps?: number;
  /** Speed in m/s; 50 unless stated. */
  speed?: number;
  inPitLane?: boolean;
  surface?: number;
}

const PLAYER_LAPS = 10;

interface FrameInput {
  time?: number;
  sessionNum?: number;
  /** Every car but the player, whose slot is 0. */
  cars?: readonly Car[];
  playerSpeed?: number;
  /** The player's lap fraction; half way round unless stated. */
  playerPct?: number;
  playerInPitLane?: boolean;
  blue?: boolean;
}

interface LmuInput extends FrameInput {
  phase?: number;
  yellowState?: number;
  /** Local yellow per sector, in driving order. */
  sectors?: readonly boolean[];
  finish?: number;
  penalties?: number;
  penaltyKind?: number;
  penaltySeconds?: number;
  stopSeconds?: number;
  startLight?: number;
  numRedLights?: number;
  lapsTotal?: number;
  timeRemain?: number;
  stale?: boolean;
  noPlayer?: boolean;
}

interface IRacingInput extends FrameInput {
  flags?: number;
  state?: number;
  pitsOpen?: boolean;
}

const LMU_STATE: Record<number, number> = {
  0: SessionState.Invalid,
  1: SessionState.Warmup,
  2: SessionState.GetInCar,
  3: SessionState.ParadeLaps,
  4: SessionState.ParadeLaps,
  5: SessionState.Racing,
  6: SessionState.Racing,
  7: SessionState.Checkered,
  8: SessionState.CoolDown,
  9: SessionState.Racing,
};

type Cells = Record<string, { value: unknown[] }>;

/** The per-car arrays both sims publish, and the speeds that go with them. */
const field = ({
  cars = [],
  playerSpeed = 50,
  playerPct = PLAYER_PCT,
  playerInPitLane = false,
}: FrameInput): { cells: Cells; kmh: number[] } => {
  const all: Car[] = [
    {
      behind: 0,
      laps: PLAYER_LAPS,
      speed: playerSpeed,
      inPitLane: playerInPitLane,
    },
    ...cars,
  ];
  const pct = (car: Car) => {
    const value = playerPct - (car.behind ?? 0) / TRACK_M;
    return value < 0 ? value + 1 : value >= 1 ? value - 1 : value;
  };
  return {
    cells: {
      PlayerCarIdx: { value: [PLAYER] },
      OnPitRoad: { value: [playerInPitLane] },
      CarIdxLapDistPct: { value: all.map(pct) },
      CarIdxLapCompleted: { value: all.map((car) => car.laps ?? PLAYER_LAPS) },
      CarIdxOnPitRoad: { value: all.map((car) => car.inPitLane === true) },
      CarIdxTrackSurface: {
        value: all.map(
          (car) =>
            car.surface ??
            (car.inPitLane
              ? TrackLocation.ApproachingPits
              : TrackLocation.OnTrack)
        ),
      },
    },
    kmh: all.map((car) => (car.speed ?? 50) * 3.6),
  };
};

const lmuFrame = (input: LmuInput) => {
  const {
    time = 100,
    sessionNum = RACE,
    phase = 5,
    yellowState = 0,
    sectors = [false, false, false],
    blue = false,
  } = input;
  const { cells, kmh } = field(input);
  const cars = cells.CarIdxLapDistPct.value.length;
  const perCar = (playerValue: number) =>
    Array.from({ length: cars }, (_, carIdx) =>
      carIdx === PLAYER ? playerValue : 0
    );
  Object.assign(cells, {
    SessionNum: { value: [sessionNum] },
    SessionTime: { value: [time] },
    SessionState: { value: [LMU_STATE[phase] ?? 0] },
    SessionFlags: { value: [blue ? GlobalFlags.Blue : 0] },
    SessionLapsTotal: { value: [input.lapsTotal ?? 32767] },
    SessionTimeRemain: { value: [input.timeRemain ?? 1800] },
    SessionTimeTotal: { value: [3600] },
    LmuGamePhase: { value: [phase] },
    LmuYellowFlagState: { value: [yellowState] },
    LmuSectorYellow: { value: [...sectors] },
    LmuSectorIdx: { value: [1] },
    LmuDataStale: { value: [input.stale === true] },
    LmuCarIdxFinishStatus: { value: perCar(input.finish ?? 0) },
    LmuCarIdxPenalties: { value: perCar(input.penalties ?? 0) },
  } satisfies Cells);
  if (input.penaltyKind !== undefined) {
    cells.LmuCarIdxPenaltyKind = { value: perCar(input.penaltyKind) };
    cells.LmuCarIdxPenaltySeconds = {
      value: perCar(input.penaltySeconds ?? 0),
    };
  }
  if (input.stopSeconds !== undefined) {
    cells.LmuPenaltySeconds = { value: [input.stopSeconds] };
  }
  if (input.numRedLights !== undefined) {
    cells.LmuNumRedLights = { value: [input.numRedLights] };
    cells.LmuStartLight = { value: [input.startLight ?? 0] };
  }
  if (input.noPlayer) cells.PlayerCarIdx = { value: [-1] };
  return { frame: cells as unknown as Telemetry, kmh };
};

const iracingFrame = (input: IRacingInput) => {
  const {
    time = 100,
    sessionNum = RACE,
    flags = 0,
    state = SessionState.Racing,
    blue = false,
  } = input;
  const { cells, kmh } = field(input);
  Object.assign(cells, {
    SessionNum: { value: [sessionNum] },
    SessionTime: { value: [time] },
    SessionState: { value: [state] },
    SessionFlags: { value: [flags | (blue ? GlobalFlags.Blue : 0)] },
    PitsOpen: { value: [input.pitsOpen ?? true] },
  } satisfies Cells);
  return { frame: cells as unknown as Telemetry, kmh };
};

/** The player in a GT3, and whatever classes the other slots are given. */
const rig = (
  classes: readonly CarClass[] = ['gt3', 'gt3', 'gt3', 'gt3', 'gt3'],
  tuningOverrides: Partial<FlagProcessorTuning> = {}
) => {
  let speeds: readonly number[] = [];
  const tuning = { ...DEFAULT_FLAG_TUNING, ...tuningOverrides };
  const processor = new FlagStateProcessor({
    carSpeeds: () => speeds,
    tuning: () => tuning,
  });
  processor.init(session(classes));
  processor.onLifecycle({ type: 'enter', replay: false });
  const feed = ({ frame, kmh }: { frame: Telemetry; kmh: number[] }) => {
    speeds = kmh;
    processor.onFrame(frame);
    return processor.snapshot();
  };
  return {
    processor,
    lmu: (input: LmuInput = {}) => feed(lmuFrame(input)),
    iracing: (input: IRacingInput = {}) => feed(iracingFrame(input)),
    /** A frame with no speeds at all, as while a replay is playing. */
    withoutSpeeds: (input: LmuInput = {}) =>
      feed({ frame: lmuFrame(input).frame, kmh: [] }),
  };
};

const YELLOW_S2 = [false, true, false] as const;
const ONE_LAP_AHEAD = PLAYER_LAPS + 1;

describe('FlagStateProcessor under Le Mans Ultimate', () => {
  it('starts with no flag', () => {
    const { processor } = rig();
    const snapshot = processor.snapshot();

    expect(snapshot.kind).toBe('none');
    expect(snapshot.detail).toBe('noSession');
    expect(snapshot.blue).toBeNull();
    expect(snapshot.penalty).toBeNull();
  });

  it('is green with a clear track at phase 5', () => {
    const snapshot = rig().lmu({ cars: [{ behind: 200 }] });

    expect(snapshot.kind).toBe('green');
    expect(snapshot.detail).toBe('trackClear');
    expect(snapshot.active).toBe(FLAG_ACTIVE_GREEN);
    expect(snapshot.yellowSectors).toEqual([false, false, false]);
    expect(snapshot.playerSector).toBe(1);
    expect(snapshot.blue).toBeNull();
    expect(snapshot.incidentDistM).toBeNull();
    expect(snapshot.pitLaneClosed).toBe(false);
    expect(snapshot.sessionNum).toBe(RACE);
  });

  it('flags nothing from a frame the sim has stopped writing', () => {
    const snapshot = rig().lmu({ stale: true, sectors: YELLOW_S2 });

    expect(snapshot.kind).toBe('none');
    expect(snapshot.detail).toBe('noSession');
    expect(snapshot.active).toBe(0);
  });

  describe('local yellow', () => {
    it('is the player’s with a stopped car in range ahead', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        cars: [{ behind: -300, speed: 0 }, { behind: 100 }],
      });

      expect(snapshot.kind).toBe('yellow');
      expect(snapshot.detail).toBe('yellowAhead');
      expect(snapshot.incidentDistM).toBe(300);
      expect(snapshot.incidentCarIdx).toBe(1);
      expect(snapshot.yellowSectors).toEqual([false, true, false]);
      expect(snapshot.active & FLAG_ACTIVE_YELLOW_NEAR).not.toBe(0);
    });

    it('yields to a blue when the stopped car is out of range', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        blue: true,
        cars: [{ behind: -700, speed: 0 }],
      });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.active & FLAG_ACTIVE_BLUE).not.toBe(0);
      expect(snapshot.active & FLAG_ACTIVE_YELLOW).not.toBe(0);
      expect(snapshot.active & FLAG_ACTIVE_YELLOW_NEAR).toBe(0);
      expect(snapshot.incidentDistM).toBeNull();
    });

    it('is a yellow elsewhere with nothing in range and no blue', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        cars: [{ behind: -700, speed: 0 }],
      });

      expect(snapshot.kind).toBe('yellow');
      expect(snapshot.detail).toBe('yellowElsewhere');
      expect(snapshot.incidentDistM).toBeNull();
      expect(snapshot.incidentCarIdx).toBeNull();
    });

    it('reports a stopped car just passed as behind', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        cars: [
          { behind: 30, speed: 2 },
          { behind: -900, speed: 0 },
        ],
      });

      expect(snapshot.detail).toBe('yellowBehind');
      expect(snapshot.incidentDistM).toBe(-30);
      expect(snapshot.incidentCarIdx).toBe(1);
    });

    it('does not take a car crawling down pit road for the incident', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        cars: [{ behind: -120, speed: 6, inPitLane: true }, { behind: 60 }],
      });

      expect(snapshot.detail).toBe('yellowElsewhere');
      expect(snapshot.incidentDistM).toBeNull();
    });

    it('takes the ranges from the flag panel settings', () => {
      const near = rig(undefined, { yellowRangeAheadM: 800 }).lmu({
        sectors: YELLOW_S2,
        cars: [{ behind: -700, speed: 0 }],
      });

      expect(near.detail).toBe('yellowAhead');
      expect(near.incidentDistM).toBe(700);
    });

    it('counts the player’s own stopped car, at no distance', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        playerSpeed: 0,
        cars: [{ behind: 400 }],
      });

      expect(snapshot.detail).toBe('yellowAhead');
      expect(snapshot.incidentDistM).toBe(0);
      expect(snapshot.incidentCarIdx).toBe(PLAYER);
    });

    it('judges no car slow before any speed has been measured', () => {
      // A speed average that has not started reads 0 for the whole field.
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        playerSpeed: 0,
        cars: [{ behind: -100, speed: 0 }],
      });

      expect(snapshot.detail).toBe('yellowElsewhere');
    });

    it('does not take a car LMU still holds at the line for a stopped one', () => {
      // At a rolling start the sim holds each car's lap fraction at exactly 0
      // until it reaches the line, so its speed, worked out from how the
      // fraction moves, reads as nothing until a little after.
      const { lmu } = rig();
      const nearLine = { sectors: YELLOW_S2, playerPct: 0.01 };

      // Fifty metres behind the player is the line itself.
      const held = lmu({
        ...nearLine,
        time: 100,
        cars: [{ behind: 50, speed: 0 }],
      });
      expect(held.detail).toBe('yellowElsewhere');

      const letGo = lmu({
        ...nearLine,
        time: 100.2,
        cars: [{ behind: 45, speed: 2 }],
      });
      expect(letGo.detail).toBe('yellowElsewhere');

      // Still crawling a second later: that one has stopped.
      const stopped = lmu({
        ...nearLine,
        time: 101.2,
        cars: [{ behind: 44, speed: 2 }],
      });
      expect(stopped.detail).toBe('yellowBehind');
      expect(stopped.incidentDistM).toBe(-44);
    });

    it('measures nothing before the player has reached the line', () => {
      const snapshot = rig().lmu({
        sectors: YELLOW_S2,
        blue: true,
        playerPct: 0,
        cars: [
          { behind: -100, speed: 0 },
          { behind: -200, laps: ONE_LAP_AHEAD },
        ],
      });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.blue).toBeNull();
      expect(snapshot.incidentDistM).toBeNull();
    });

    it('names the player’s own sector only when the setting is on', () => {
      const off = rig().lmu({ sectors: YELLOW_S2 });
      const on = rig(undefined, { yellowInOwnSector: true }).lmu({
        sectors: YELLOW_S2,
      });

      expect(off.detail).toBe('yellowElsewhere');
      expect(on.detail).toBe('yellowInSector');
      expect(on.active & FLAG_ACTIVE_YELLOW_NEAR).not.toBe(0);
    });
  });

  describe('full-course yellow', () => {
    it('names the sub-phase and closes the pit lane', () => {
      const snapshot = rig().lmu({
        phase: 6,
        yellowState: 2,
        sectors: YELLOW_S2,
        cars: [{ behind: -100, speed: 0 }],
      });

      expect(snapshot.kind).toBe('fullCourseYellow');
      expect(snapshot.detail).toBe('fcyPitsClosed');
      expect(snapshot.pitLaneClosed).toBe(true);
      // Everyone is slow under a full-course yellow: no incident is sought.
      expect(snapshot.incidentDistM).toBeNull();
      expect(snapshot.active & FLAG_ACTIVE_YELLOW).toBe(0);
      expect(snapshot.active & FLAG_ACTIVE_FULL_COURSE_YELLOW).not.toBe(0);
    });

    it('holds at phase 5 while the sim states a sub-phase', () => {
      const snapshot = rig().lmu({ phase: 5, yellowState: 1 });

      expect(snapshot.kind).toBe('fullCourseYellow');
      expect(snapshot.detail).toBe('fcyPending');
    });

    it('is plain when the sim states no sub-phase', () => {
      expect(rig().lmu({ phase: 6 }).detail).toBe('fcy');
    });

    it('closes the pit lane to a lapped car while it is open to the lead lap', () => {
      const lapped = rig().lmu({
        phase: 6,
        yellowState: 3,
        cars: [{ behind: 100, laps: PLAYER_LAPS + 2 }],
      });
      const leadLap = rig().lmu({
        phase: 6,
        yellowState: 3,
        cars: [{ behind: 100, laps: PLAYER_LAPS }],
      });

      expect(lapped.detail).toBe('fcyPitLeadLap');
      expect(lapped.pitLaneClosed).toBe(true);
      expect(leadLap.pitLaneClosed).toBe(false);
    });
  });

  describe('blue in a race', () => {
    it('names the car lapping the player, not the rival ahead of it', () => {
      const snapshot = rig().lmu({
        blue: true,
        cars: [{ behind: 20 }, { behind: 60, laps: ONE_LAP_AHEAD }],
      });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.detail).toBe('blueLapping');
      expect(snapshot.blue).toEqual({
        carIdx: 2,
        distanceM: 60,
        gapS: 1.2,
        closingMs: 0,
        lapsAhead: 1,
        fasterClass: false,
        confirmed: true,
        othersCount: 0,
      });
    });

    it('falls back to the nearest car, unconfirmed, when none is lapping', () => {
      const snapshot = rig().lmu({ blue: true, cars: [{ behind: 20 }] });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.blue?.carIdx).toBe(1);
      expect(snapshot.blue?.confirmed).toBe(false);
      expect(snapshot.blue?.othersCount).toBe(0);
    });

    it('offers no fallback further away than 150 m', () => {
      const snapshot = rig().lmu({ blue: true, cars: [{ behind: 180 }] });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.blue).toBeNull();
    });

    it('takes a faster class on the same lap', () => {
      const snapshot = rig(['gt3', 'hyper']).lmu({
        blue: true,
        cars: [{ behind: 90, speed: 62 }],
      });

      expect(snapshot.detail).toBe('blueFasterClass');
      expect(snapshot.blue).toMatchObject({
        carIdx: 1,
        distanceM: 90,
        lapsAhead: 0,
        fasterClass: true,
        confirmed: true,
        closingMs: 12,
        gapS: 1.5,
      });
    });

    it('never takes a car of the player’s class that is a lap down', () => {
      const snapshot = rig().lmu({
        blue: true,
        cars: [
          { behind: 200, laps: PLAYER_LAPS - 1 },
          { behind: 260, laps: PLAYER_LAPS - 1 },
        ],
      });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.blue).toBeNull();
    });

    it('takes a slower class only when it is a lap ahead', () => {
      // The player in an LMP2 being lapped by, and racing, a GT3.
      const classes = ['lmp2', 'gt3'] as const;
      const sameLap = rig(classes).lmu({ blue: true, cars: [{ behind: 200 }] });
      const lapAhead = rig(classes).lmu({
        blue: true,
        cars: [{ behind: 200, laps: ONE_LAP_AHEAD }],
      });

      expect(sameLap.blue).toBeNull();
      expect(lapAhead.blue?.confirmed).toBe(true);
    });

    it('leaves out cars in the pit lane, in a garage and not yet at the line', () => {
      const snapshot = rig().lmu({
        blue: true,
        cars: [
          { behind: 30, laps: ONE_LAP_AHEAD, inPitLane: true },
          {
            behind: 40,
            laps: ONE_LAP_AHEAD,
            surface: TrackLocation.InPitStall,
          },
          // Held at a lap fraction of exactly 0 until it reaches the line.
          { behind: PLAYER_PCT * TRACK_M, laps: ONE_LAP_AHEAD },
          { behind: 300, laps: ONE_LAP_AHEAD },
        ],
      });

      expect(snapshot.blue?.carIdx).toBe(4);
    });

    it('calls a blue in the pit lane traffic', () => {
      const snapshot = rig().lmu({
        blue: true,
        playerInPitLane: true,
        cars: [{ behind: 60, laps: ONE_LAP_AHEAD }],
      });

      expect(snapshot.detail).toBe('blueTraffic');
      expect(snapshot.blue?.carIdx).toBe(1);
    });

    it('keeps the plate until another car is ten metres nearer', () => {
      const { lmu } = rig();
      const lapping = (holder: number, other: number, time: number) =>
        lmu({
          time,
          blue: true,
          cars: [
            { behind: holder, laps: ONE_LAP_AHEAD },
            { behind: other, laps: ONE_LAP_AHEAD },
          ],
        });

      expect(lapping(60, 90, 100).blue?.carIdx).toBe(1);
      expect(lapping(60, 55, 100.1).blue?.carIdx).toBe(1);
      expect(lapping(60, 55, 100.2).blue?.distanceM).toBe(60);
      expect(lapping(60, 49, 100.3).blue?.carIdx).toBe(2);
      expect(lapping(60, 49, 100.4).blue?.distanceM).toBe(49);
    });

    it('holds through a blue that drops for less than a second', () => {
      const { lmu } = rig();
      const cars = [{ behind: 60, laps: ONE_LAP_AHEAD }];
      lmu({ time: 100, blue: true, cars });

      const dropped = lmu({ time: 100.4, blue: false, cars });
      expect(dropped.kind).toBe('blue');
      expect(dropped.blue?.carIdx).toBe(1);

      const gone = lmu({ time: 101.5, blue: false, cars });
      expect(gone.kind).toBe('green');
      expect(gone.blue).toBeNull();
    });

    it('names the nearest of several and counts the rest of the queue', () => {
      const snapshot = rig([
        'gt3',
        'gt3',
        'gt3',
        'gt3',
        'gt3',
        'gt3',
        'gt3',
      ]).lmu({
        blue: true,
        cars: [
          { behind: 300, laps: ONE_LAP_AHEAD },
          { behind: 40, laps: ONE_LAP_AHEAD },
          { behind: 120, laps: ONE_LAP_AHEAD },
          // Nine seconds back at 50 m/s: outside the listing window.
          { behind: 450, laps: ONE_LAP_AHEAD },
          // On the player's lap: racing for position.
          { behind: 80 },
          { behind: 100, laps: ONE_LAP_AHEAD, inPitLane: true },
        ],
      });

      expect(snapshot.blue?.carIdx).toBe(2);
      expect(snapshot.blue?.distanceM).toBe(40);
      expect(snapshot.blue?.othersCount).toBe(2);
    });

    it('hands the plate to the next car as each one goes by', () => {
      const { lmu } = rig();
      const queue = (first: number, second: number, third: number, t: number) =>
        lmu({
          time: t,
          blue: true,
          cars: [
            { behind: first, laps: ONE_LAP_AHEAD },
            { behind: second, laps: ONE_LAP_AHEAD },
            { behind: third, laps: ONE_LAP_AHEAD },
            { behind: 80 },
          ],
        });

      const start = queue(40, 120, 300, 100);
      expect(start.blue?.carIdx).toBe(1);
      expect(start.blue?.othersCount).toBe(2);
      const since = start.since;
      expect(since).toBe(100);

      // Drawing level, then a couple of metres ahead: still the holder.
      const level = queue(-2, 110, 290, 101);
      expect(level.blue?.carIdx).toBe(1);
      expect(level.blue?.distanceM).toBe(0);
      expect(level.blue?.othersCount).toBe(2);

      // Five metres ahead: gone by, and the next car has the plate at once.
      const handed = queue(-6, 100, 280, 102);
      expect(handed.kind).toBe('blue');
      expect(handed.blue?.carIdx).toBe(2);
      expect(handed.blue?.distanceM).toBe(100);
      expect(handed.blue?.othersCount).toBe(1);
      expect(handed.since).toBe(since);

      queue(-60, -8, 200, 103);
      // The last one passes with the flag still out: no car is left to name,
      // and the rival on the player's lap is not offered in its place.
      const empty = queue(-120, -70, -10, 104);
      expect(empty.kind).toBe('blue');
      expect(empty.blue).toBeNull();
      expect(empty.since).toBe(since);
    });

    it('ranks a pending penalty below the blue', () => {
      const { lmu } = rig();
      const penalty = lmu({
        penalties: 1,
        penaltyKind: LMU_PENALTY_CODE.driveThrough,
      });

      expect(penalty.kind).toBe('penalty');
      expect(penalty.detail).toBe('driveThrough');
      expect(penalty.penalty).toEqual({
        count: 1,
        kind: LMU_PENALTY_CODE.driveThrough,
        seconds: null,
      });

      const withBlue = lmu({
        time: 101,
        blue: true,
        penalties: 1,
        penaltyKind: LMU_PENALTY_CODE.driveThrough,
        cars: [{ behind: 60, laps: ONE_LAP_AHEAD }],
      });
      expect(withBlue.kind).toBe('blue');
      expect(withBlue.active & FLAG_ACTIVE_PENALTY).not.toBe(0);
      expect(withBlue.penalty?.count).toBe(1);
    });
  });

  describe('blue outside a race', () => {
    it('names the nearest car behind', () => {
      const snapshot = rig().lmu({
        sessionNum: PRACTICE,
        blue: true,
        cars: [{ behind: 200 }, { behind: 90 }],
      });

      expect(snapshot.kind).toBe('blue');
      expect(snapshot.detail).toBe('blueTraffic');
      expect(snapshot.blue).toMatchObject({
        carIdx: 2,
        distanceM: 90,
        lapsAhead: 0,
        confirmed: true,
        othersCount: 0,
      });
    });

    it('prefers a car that is closing to a nearer one that is not', () => {
      const snapshot = rig().lmu({
        sessionNum: PRACTICE,
        blue: true,
        cars: [
          { behind: 60, speed: 50 },
          { behind: 150, speed: 58 },
          { behind: 240, speed: 51 },
        ],
      });

      expect(snapshot.blue?.carIdx).toBe(2);
      expect(snapshot.blue?.closingMs).toBe(8);
      expect(snapshot.blue?.othersCount).toBe(0);
    });

    it('counts only closing cars towards the queue', () => {
      const snapshot = rig().lmu({
        sessionNum: PRACTICE,
        blue: true,
        cars: [
          { behind: 60, speed: 50 },
          { behind: 150, speed: 58 },
          { behind: 240, speed: 56 },
        ],
      });

      expect(snapshot.blue?.carIdx).toBe(2);
      expect(snapshot.blue?.othersCount).toBe(1);
    });

    it('still names a car when no speed is known at all', () => {
      const snapshot = rig().withoutSpeeds({
        sessionNum: PRACTICE,
        blue: true,
        cars: [{ behind: 200 }, { behind: 90 }],
      });

      expect(snapshot.blue).toMatchObject({
        carIdx: 2,
        gapS: null,
        closingMs: null,
      });
    });
  });

  describe('penalties', () => {
    it('reads a stop-go and its seconds from the stop estimate', () => {
      const snapshot = rig().lmu({ penalties: 1, stopSeconds: 10 });

      expect(snapshot.detail).toBe('stopGo');
      expect(snapshot.penalty).toEqual({
        count: 1,
        kind: LMU_PENALTY_CODE.stopGo,
        seconds: 10,
      });
    });

    it('reads a time penalty and what it adds', () => {
      const snapshot = rig().lmu({
        penalties: 1,
        penaltyKind: LMU_PENALTY_CODE.time,
        penaltySeconds: 5,
      });

      expect(snapshot.detail).toBe('timePenalty');
      expect(snapshot.penalty?.seconds).toBe(5);
    });

    it('says so when the sim counts a penalty it has not named', () => {
      const snapshot = rig().lmu({ penalties: 2 });

      expect(snapshot.detail).toBe('penaltyUnknown');
      expect(snapshot.penalty).toEqual({ count: 2, kind: 0, seconds: null });
    });
  });

  describe('the end of the session', () => {
    it('puts the finish above every flag but red and disqualification', () => {
      const busy: LmuInput = {
        blue: true,
        penalties: 1,
        sectors: YELLOW_S2,
        cars: [
          { behind: -100, speed: 0 },
          { behind: 60, laps: ONE_LAP_AHEAD },
        ],
      };

      const finished = rig().lmu({
        ...busy,
        finish: LMU_FINISH_STATUS.finished,
      });
      expect(finished.kind).toBe('chequered');
      expect(finished.detail).toBe('finished');

      const stopped = rig().lmu({
        ...busy,
        phase: 7,
        finish: LMU_FINISH_STATUS.finished,
      });
      expect(stopped.kind).toBe('red');
      expect(stopped.detail).toBe('sessionStopped');

      const disqualified = rig().lmu({
        ...busy,
        phase: 7,
        finish: LMU_FINISH_STATUS.dq,
      });
      expect(disqualified.kind).toBe('disqualified');
      expect(disqualified.detail).toBe('disqualified');
    });

    it('asks a car still running at phase 8 to finish its lap', () => {
      expect(rig().lmu({ phase: 8 }).detail).toBe('finishLap');
    });

    it('calls the end of practice session over', () => {
      const snapshot = rig().lmu({ phase: 8, sessionNum: PRACTICE });

      expect(snapshot.kind).toBe('chequered');
      expect(snapshot.detail).toBe('sessionOver');
    });

    it('works out the last lap of a race run to laps', () => {
      const { lmu } = rig();
      const before = lmu({
        lapsTotal: 20,
        cars: [{ behind: -400, laps: 18 }],
      });
      expect(before.kind).toBe('green');

      const last = lmu({
        time: 101,
        lapsTotal: 20,
        cars: [{ behind: -400, laps: 19 }],
      });
      expect(last.kind).toBe('white');
      expect(last.detail).toBe('lastLap');
    });

    it('works out the last lap of a timed race from the clock', () => {
      const { lmu } = rig();
      expect(lmu({ timeRemain: 12 }).kind).toBe('green');
      expect(lmu({ time: 101, timeRemain: 0 }).kind).toBe('white');
    });

    it('has no last lap outside a race', () => {
      const snapshot = rig().lmu({ sessionNum: PRACTICE, timeRemain: 0 });

      expect(snapshot.kind).toBe('green');
    });
  });

  describe('the start', () => {
    it('counts the lights and announces the green for five seconds', () => {
      const { lmu } = rig();
      const lights = lmu({
        time: 50,
        phase: 4,
        numRedLights: 5,
        startLight: 3,
      });
      expect(lights.kind).toBe('start');
      expect(lights.detail).toBe('lights');
      expect(lights.startLights).toEqual({ lit: 3, total: 5 });

      const go = lmu({ time: 51, phase: 5 });
      expect(go.kind).toBe('green');
      expect(go.detail).toBe('greenStart');
      expect(go.startLights).toBeNull();
      expect(go.since).toBe(51);

      expect(lmu({ time: 55.9, phase: 5 }).detail).toBe('greenStart');
      const clear = lmu({ time: 56.1, phase: 5 });
      expect(clear.detail).toBe('trackClear');
      expect(clear.since).toBe(56.1);
    });

    it('gives no light count when the sim gives none', () => {
      const snapshot = rig().lmu({ phase: 4 });

      expect(snapshot.detail).toBe('lights');
      expect(snapshot.startLights).toBeNull();
    });

    it('names each phase before a race', () => {
      expect(rig().lmu({ phase: 1 }).detail).toBe('recon');
      expect(rig().lmu({ phase: 2 }).detail).toBe('grid');
      expect(rig().lmu({ phase: 3 }).detail).toBe('formationLap');
    });

    it('is before the session at phase 0 in any session, pit lane closed', () => {
      const snapshot = rig().lmu({ phase: 0, sessionNum: PRACTICE });

      expect(snapshot.kind).toBe('start');
      expect(snapshot.detail).toBe('beforeSession');
      expect(snapshot.pitLaneClosed).toBe(true);
    });

    it('looks for no incident while the grid is standing still', () => {
      const snapshot = rig().lmu({
        phase: 2,
        sectors: YELLOW_S2,
        cars: [{ behind: -20, speed: 0 }, { behind: 40 }],
      });

      expect(snapshot.kind).toBe('start');
      expect(snapshot.incidentDistM).toBeNull();
    });
  });

  it('announces the restart for five seconds after a yellow ends', () => {
    const { lmu } = rig();
    lmu({ time: 200, phase: 6 });

    expect(lmu({ time: 201, phase: 5 }).detail).toBe('greenRestart');
    expect(lmu({ time: 205.5, phase: 5 }).detail).toBe('greenRestart');
    expect(lmu({ time: 206.5, phase: 5 }).detail).toBe('trackClear');
  });

  it('reads the pause heartbeat as the phase before it', () => {
    const { lmu } = rig();
    lmu({ time: 200, phase: 6 });

    expect(lmu({ time: 200.1, phase: 9 }).kind).toBe('fullCourseYellow');
  });

  it('shows only session-level states without a player car', () => {
    const snapshot = rig().lmu({
      noPlayer: true,
      sectors: YELLOW_S2,
      blue: true,
      penalties: 1,
      cars: [{ behind: -100, speed: 0 }],
    });

    expect(snapshot.kind).toBe('yellow');
    expect(snapshot.detail).toBe('yellowElsewhere');
    expect(snapshot.blue).toBeNull();
    expect(snapshot.penalty).toBeNull();
    expect(snapshot.playerSector).toBeNull();
  });

  it('moves the version only when something published changes', () => {
    const { lmu } = rig();
    const cars = [{ behind: 60.2, laps: ONE_LAP_AHEAD }];
    const first = lmu({ time: 100, blue: true, cars }).version;

    // The same whole metre: nothing to republish.
    const same = lmu({
      time: 100.1,
      blue: true,
      cars: [{ behind: 60.4, laps: ONE_LAP_AHEAD }],
    }).version;
    expect(same).toBe(first);

    const moved = lmu({
      time: 100.2,
      blue: true,
      cars: [{ behind: 58, laps: ONE_LAP_AHEAD }],
    }).version;
    expect(moved).toBe(first + 1);
  });

  it('clears everything on a new session and on disconnect', () => {
    for (const type of ['sessionNumChange', 'disconnect'] as const) {
      const { lmu, processor } = rig();
      lmu({
        blue: true,
        penalties: 1,
        sectors: YELLOW_S2,
        cars: [{ behind: 60, laps: ONE_LAP_AHEAD }],
      });
      const { version } = processor.snapshot();

      processor.onLifecycle({ type });
      const snapshot = processor.snapshot();

      expect(snapshot).toMatchObject({
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
      });
      expect(snapshot.version).toBe(version + 1);
    }
  });

  it('forgets the car it had chosen when the session number moves', () => {
    const { lmu } = rig();
    lmu({ time: 100, blue: true, cars: [{ behind: 20 }] });

    // A new session, with the blue still held from the old one's clock.
    const next = lmu({ time: 5, sessionNum: PRACTICE, cars: [{ behind: 20 }] });

    expect(next.kind).toBe('green');
    expect(next.blue).toBeNull();
    expect(next.sessionNum).toBe(PRACTICE);
  });
});

describe('FlagStateProcessor under iRacing', () => {
  it('is green with no bit set while racing', () => {
    const snapshot = rig().iracing();

    expect(snapshot.kind).toBe('green');
    expect(snapshot.detail).toBe('trackClear');
    // iRacing flags no sectors.
    expect(snapshot.yellowSectors).toEqual([]);
    expect(snapshot.playerSector).toBeNull();
  });

  it('has no flag before the sim reports a session state', () => {
    expect(rig().iracing({ state: SessionState.Invalid }).kind).toBe('none');
  });

  it('puts a blue over a yellow whose incident is out of range', () => {
    const snapshot = rig().iracing({
      flags: GlobalFlags.Blue | GlobalFlags.Yellow,
      cars: [
        { behind: -900, speed: 0, surface: TrackLocation.OffTrack },
        { behind: 60, laps: ONE_LAP_AHEAD },
      ],
    });

    expect(snapshot.kind).toBe('blue');
    expect(snapshot.blue?.carIdx).toBe(2);
    expect(snapshot.active & FLAG_ACTIVE_YELLOW).not.toBe(0);
  });

  it('finds the incident of a yellow among cars off the track', () => {
    const snapshot = rig().iracing({
      flags: GlobalFlags.YellowWaving,
      cars: [{ behind: -240, speed: 3, surface: TrackLocation.OffTrack }],
    });

    expect(snapshot.kind).toBe('yellow');
    expect(snapshot.detail).toBe('yellowAhead');
    expect(snapshot.incidentDistM).toBe(240);
  });

  it('reads a caution with one lap to green', () => {
    const snapshot = rig().iracing({
      flags:
        GlobalFlags.Caution | GlobalFlags.Yellow | GlobalFlags.OneLapToGreen,
    });

    expect(snapshot.kind).toBe('fullCourseYellow');
    expect(snapshot.detail).toBe('fcyLastLap');
  });

  it('reads a plain caution', () => {
    const snapshot = rig().iracing({ flags: GlobalFlags.CautionWaving });

    expect(snapshot.detail).toBe('fcy');
  });

  it('reads the black flag, with no count to publish', () => {
    const snapshot = rig().iracing({ flags: GlobalFlags.Black });

    expect(snapshot.kind).toBe('penalty');
    expect(snapshot.detail).toBe('blackFlag');
    expect(snapshot.penalty).toBeNull();
  });

  it('reads the furled black flag as a warning', () => {
    const snapshot = rig().iracing({ flags: GlobalFlags.Furled });

    expect(snapshot.kind).toBe('penalty');
    expect(snapshot.detail).toBe('slowDown');
  });

  it('reads the meatball only with both of its bits', () => {
    const { iracing } = rig();

    expect(iracing({ flags: GlobalFlags.Repair }).kind).toBe('green');
    const meatball = iracing({
      time: 101,
      flags: GlobalFlags.Repair | GlobalFlags.Servicible,
    });
    expect(meatball.kind).toBe('meatball');
    expect(meatball.detail).toBe('repairRequired');
  });

  it('reads debris, the last lap and the red flag', () => {
    expect(rig().iracing({ flags: GlobalFlags.Debris }).kind).toBe('debris');
    expect(rig().iracing({ flags: GlobalFlags.White }).detail).toBe('lastLap');
    expect(rig().iracing({ flags: GlobalFlags.Red }).kind).toBe('red');
    expect(rig().iracing({ flags: GlobalFlags.Disqualify }).kind).toBe(
      'disqualified'
    );
  });

  it('reads the chequered flag, finished once the session cools down', () => {
    const racing = rig().iracing({ flags: GlobalFlags.Checkered });
    const done = rig().iracing({
      flags: GlobalFlags.Checkered,
      state: SessionState.CoolDown,
    });

    expect(racing.detail).toBe('finishLap');
    expect(done.detail).toBe('finished');
  });

  it('names the parade laps and the lights before a race', () => {
    expect(rig().iracing({ state: SessionState.GetInCar }).detail).toBe('grid');
    expect(rig().iracing({ state: SessionState.ParadeLaps }).detail).toBe(
      'formationLap'
    );
    expect(
      rig().iracing({
        state: SessionState.ParadeLaps,
        flags: GlobalFlags.StartReady,
      }).detail
    ).toBe('ready');
    const set = rig().iracing({
      state: SessionState.ParadeLaps,
      flags: GlobalFlags.StartSet,
    });
    expect(set.detail).toBe('set');
    expect(set.startLights).toBeNull();
  });

  it('announces the green for as long as the sim shows it', () => {
    const { iracing } = rig();
    iracing({ time: 10, state: SessionState.ParadeLaps });

    const go = iracing({ time: 11, flags: GlobalFlags.StartGo });
    expect(go.detail).toBe('greenStart');
    // Past the five seconds, while the sim still shows its green.
    expect(iracing({ time: 18, flags: GlobalFlags.Green }).detail).toBe(
      'greenStart'
    );
    expect(iracing({ time: 19 }).detail).toBe('trackClear');
  });

  it('closes the pit lane when the sim says so while racing', () => {
    expect(rig().iracing({ pitsOpen: false }).pitLaneClosed).toBe(true);
    expect(rig().iracing({ pitsOpen: true }).pitLaneClosed).toBe(false);
  });
});
