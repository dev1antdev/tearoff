import { describe, expect, it, vi } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';

const frame = (values: Record<string, number | boolean>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, entry]) => [key, { value: [entry] }])
  ) as unknown as Telemetry;

describe('FuelProjectionProcessor', () => {
  it('projects live usage and records a completed green lap', () => {
    const lapCompleted = vi.fn();
    const processor = new FuelProjectionProcessor({
      persistence: { lapCompleted, saveLap: vi.fn() },
    });
    processor.init({} as Session);

    processor.onFrame(
      frame({
        FuelLevel: 40,
        Lap: 1,
        LapDistPct: 0.01,
        OnPitRoad: 0,
        PlayerCarTowTime: 0,
        SessionFlags: 4,
        SessionNum: 0,
        SessionTime: 10,
      })
    );
    processor.onFrame(
      frame({
        FuelLevel: 38,
        Lap: 1,
        LapDistPct: 0.75,
        OnPitRoad: 0,
        PlayerCarTowTime: 0,
        SessionFlags: 4,
        SessionNum: 0,
        SessionTime: 70,
      })
    );

    expect(processor.snapshot().currentLapUsage).toBe(2);
    expect(processor.snapshot().projectedLapUsage).toBeGreaterThan(0);

    processor.onFrame(
      frame({
        FuelLevel: 37,
        Lap: 2,
        LapDistPct: 0.01,
        OnPitRoad: 0,
        PlayerCarTowTime: 0,
        SessionFlags: 4,
        SessionNum: 0,
        SessionTime: 100,
      })
    );

    expect(processor.snapshot().lastLapUsage).toBe(3);
    expect(processor.snapshot().completedLaps).toHaveLength(1);
    expect(lapCompleted).toHaveBeenCalledOnce();
  });

  it('uses each heat lap limit after qualifying and race transitions', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Lone Qualify', SessionLaps: 2 },
          { SessionNum: 1, SessionType: 'Race', SessionLaps: 8 },
          { SessionNum: 2, SessionType: 'Race', SessionLaps: 20 },
        ],
      },
    } as unknown as Session);

    for (const [sessionNum, totalLaps] of [
      [0, 0],
      [1, 8],
      [2, 20],
    ]) {
      if (sessionNum > 0) processor.onLifecycle({ type: 'sessionNumChange' });
      processor.onFrame(
        frame({
          SessionNum: sessionNum,
          SessionState: 4,
          SessionTimeRemain: 604800,
          SessionLapsRemain: 32767,
          Lap: 3,
          LapDistPct: 0.25,
        })
      );
      expect(processor.snapshot()).toMatchObject({
        sessionNum,
        calculatedTotalRaceLaps: totalLaps,
        estimatedLapsRemaining: totalLaps > 0 ? totalLaps - 2.25 : 0,
        hasValidRaceEstimate: totalLaps > 0,
      });
    }
  });

  it('resets volatile state on disconnect', () => {
    const processor = new FuelProjectionProcessor();
    processor.onFrame(
      frame({ FuelLevel: 20, Lap: 3, LapDistPct: 0.5, SessionTime: 30 })
    );

    processor.onLifecycle({ type: 'disconnect' });

    expect(processor.snapshot()).toMatchObject({
      fuelLevel: 0,
      currentLap: 0,
      completedLaps: [],
    });
  });

  it('preserves boolean track and pit state in the snapshot', () => {
    const processor = new FuelProjectionProcessor();

    processor.onFrame(
      frame({ FuelLevel: 20, IsOnTrack: true, OnPitRoad: true })
    );

    expect(processor.snapshot().isOnTrack).toBe(true);
    expect(processor.snapshot().engine.wasOnPitRoad).toBe(true);
  });

  it('projects timed-race distance using class pace', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 90 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    // On the third lap, so the time that arrives is the second lap's: the
    // lap from the start is left out of the pace.
    const timedRaceFrame = {
      FuelLevel: { value: [45.39] },
      Lap: { value: [3] },
      LapDistPct: { value: [0.1] },
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionLapsRemain: { value: [32767] },
      SessionTimeRemain: { value: [1620] },
      SessionTimeTotal: { value: [1800] },
      CamCarIdx: { value: [0] },
      CarIdxLap: { value: [3] },
      CarIdxLapDistPct: { value: [0.1] },
      CarIdxPosition: { value: [1] },
      CarIdxClassPosition: { value: [1] },
      CarIdxLastLapTime: { value: [1] },
      CarIdxBestLapTime: { value: [1] },
    } as unknown as Telemetry;
    processor.onFrame(timedRaceFrame);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 21,
      estimatedLapsRemaining: 18.9,
      hasValidRaceEstimate: true,
      isFixedLapRace: false,
    });

    processor.onFrame({
      ...timedRaceFrame,
      CarIdxLastLapTime: { value: [100] },
    } as unknown as Telemetry);
    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 19,
      estimatedLapsRemaining: 16.9,
    });

    processor.onFrame({
      ...timedRaceFrame,
      CarIdxLastLapTime: { value: [110] },
    } as unknown as Telemetry);
    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 19,
      estimatedLapsRemaining: 16.9,
    });
  });

  it('leaves the lap from the start out of the class pace', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 90 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);
    const onLap = (lap: number, lastLapTime: number) =>
      ({
        Lap: { value: [lap] },
        LapDistPct: { value: [0.1] },
        SessionNum: { value: [0] },
        SessionState: { value: [4] },
        SessionTimeRemain: { value: [1620] },
        CamCarIdx: { value: [0] },
        CarIdxLap: { value: [lap] },
        CarIdxLapDistPct: { value: [0.1] },
        CarIdxPosition: { value: [1] },
        CarIdxClassPosition: { value: [1] },
        CarIdxLastLapTime: { value: [lastLapTime] },
      }) as unknown as Telemetry;

    processor.onFrame(onLap(1, -1));
    expect(processor.snapshot().calculatedTotalRaceLaps).toBe(19);

    // The first lap, from a standing start, ten seconds off the pace. Taken
    // as the pace it cut the race by two laps until the next lap came in.
    processor.onFrame(onLap(2, 100));
    expect(processor.snapshot().calculatedTotalRaceLaps).toBe(20);

    // The second lap is a lap at speed, and is what the class runs at.
    processor.onFrame(onLap(3, 88));
    expect(processor.snapshot().calculatedTotalRaceLaps).toBe(21);
  });

  it('does not add a lap for the race leader out of rounding', () => {
    // The player leading is projected to finish on the leader's lap exactly.
    // These figures put the sum a hair over nine, which rounded up to ten.
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 84 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    processor.onFrame({
      Lap: { value: [2] },
      LapDistPct: { value: [0.3] },
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [600] },
      CamCarIdx: { value: [0] },
      CarIdxLap: { value: [2] },
      CarIdxLapDistPct: { value: [0.3] },
      CarIdxPosition: { value: [1] },
    } as unknown as Telemetry);

    expect(processor.snapshot().calculatedTotalRaceLaps).toBe(9);
    expect(processor.snapshot().estimatedLapsRemaining).toBeCloseTo(7.7, 9);
  });

  it('uses fractional distance when correcting a timed race for lapping', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 100 },
          { CarIdx: 1, CarClassID: 1, CarClassEstLapTime: 100 },
        ],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    processor.onFrame({
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [900] },
      CamCarIdx: { value: [1] },
      CarIdxLap: { value: [10, 8] },
      CarIdxLapDistPct: { value: [0.1, 0.8] },
      CarIdxPosition: { value: [1, 10] },
      CarIdxClassPosition: { value: [1, 2] },
      CarIdxBestLapTime: { value: [100, 100] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 18,
      estimatedLapsRemaining: 10.2,
      hasValidRaceEstimate: true,
    });
  });

  it('uses player-class pace for remaining distance in multiclass races', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 55 },
          { CarIdx: 1, CarClassID: 2, CarClassEstLapTime: 80 },
        ],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    processor.onFrame({
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [900] },
      CamCarIdx: { value: [1] },
      CarIdxLap: { value: [10, 8] },
      CarIdxLapDistPct: { value: [0.1, 0.8] },
      CarIdxPosition: { value: [1, 10] },
      CarIdxClassPosition: { value: [1, 1] },
      CarIdxLastLapTime: { value: [60, 90] },
      CarIdxBestLapTime: { value: [55, 80] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 19,
      estimatedLapsRemaining: 11.2,
      hasValidRaceEstimate: true,
    });
  });

  it('uses player distance when no overall leader position is available', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [{ CarIdx: 1, CarClassID: 1, CarClassEstLapTime: 100 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    processor.onFrame({
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [810] },
      CamCarIdx: { value: [1] },
      CarIdxLap: { value: [0, 8] },
      CarIdxLapDistPct: { value: [0, 0.8] },
      CarIdxPosition: { value: [0, 2] },
      CarIdxBestLapTime: { value: [0, 100] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 16,
      estimatedLapsRemaining: 8.2,
      hasValidRaceEstimate: true,
    });
  });

  it('rejects transient timed-race lap times', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarClassEstLapTime: 1 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
        ],
      },
    } as unknown as Session);

    processor.onFrame({
      SessionNum: { value: [0] },
      SessionTimeRemain: { value: [1500] },
      CarIdxLap: { value: [1] },
      CarIdxLapDistPct: { value: [0] },
      CarIdxPosition: { value: [1] },
      CarIdxBestLapTime: { value: [1] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 0,
      estimatedLapsRemaining: 0,
      hasValidRaceEstimate: false,
    });
  });

  it('preserves completed laps while resetting crossing state on session change', () => {
    const processor = new FuelProjectionProcessor();
    processor.onFrame(
      frame({
        FuelLevel: 20,
        Lap: 1,
        LapDistPct: 0.01,
        SessionFlags: 4,
        SessionTime: 10,
      })
    );
    processor.onFrame(
      frame({
        FuelLevel: 18,
        Lap: 2,
        LapDistPct: 0.01,
        SessionFlags: 4,
        SessionTime: 80,
      })
    );
    expect(processor.snapshot().completedLaps).toHaveLength(1);

    processor.onLifecycle({ type: 'sessionNumChange' });

    expect(processor.snapshot().completedLaps).toHaveLength(1);
    expect(processor.snapshot().engine.lastLap).toBe(0);

    processor.onFrame(
      frame({
        FuelLevel: 30,
        Lap: 1,
        LapDistPct: 0.01,
        SessionFlags: 4,
        SessionNum: 1,
        SessionTime: 100,
      })
    );

    expect(processor.snapshot().completedLaps).toHaveLength(1);
    expect(processor.snapshot().projectedLapUsage).toBeGreaterThan(2);
    expect(processor.snapshot().projectedLapUsage).toBeLessThan(2.2);
  });

  it('does not aggregate replay frames and resumes from clean state live', () => {
    const processor = new FuelProjectionProcessor();
    processor.onLifecycle({ type: 'enter', replay: true });

    processor.onFrame(
      frame({ FuelLevel: 20, Lap: 5, LapDistPct: 0.9, SessionTime: 100 })
    );
    expect(processor.snapshot()).toMatchObject({ fuelLevel: 0, currentLap: 0 });

    processor.onLifecycle({ type: 'enter', replay: false });
    processor.onFrame(
      frame({ FuelLevel: 19, Lap: 1, LapDistPct: 0.1, SessionTime: 10 })
    );
    expect(processor.snapshot()).toMatchObject({
      fuelLevel: 19,
      currentLap: 1,
    });
  });
});

/** A green-flag frame for the player alone: fuel, lap, position and time. */
const drive = (
  processor: FuelProjectionProcessor,
  frames: [fuel: number, lap: number, pct: number, time: number][]
) => {
  for (const [FuelLevel, Lap, LapDistPct, SessionTime] of frames) {
    processor.onFrame(
      frame({
        FuelLevel,
        Lap,
        LapDistPct,
        OnPitRoad: 0,
        PlayerCarTowTime: 0,
        SessionFlags: 4,
        SessionNum: 0,
        SessionTime,
      })
    );
  }
};

describe('FuelProjectionProcessor created part-way round a lap', () => {
  it('does not record what was left of that lap', () => {
    // The app opened, or the widget shown, half-way round lap 2. The half
    // burned 1.5 in 45 s where a lap burns 3 in 90, and as a lap it halved
    // the average the driver fuels by.
    const lapCompleted = vi.fn();
    const processor = new FuelProjectionProcessor({
      persistence: { lapCompleted, saveLap: vi.fn() },
    });
    processor.init({} as Session);

    drive(processor, [
      [38.5, 2, 0.5, 145],
      [37.75, 2, 0.75, 167.5],
      [37, 3, 0.01, 190],
    ]);

    expect(processor.snapshot().completedLaps).toEqual([]);
    expect(processor.snapshot().lastLapUsage).toBe(0);
    expect(lapCompleted).not.toHaveBeenCalled();

    // The lap after it was seen from the line.
    drive(processor, [
      [35.5, 3, 0.5, 235],
      [34, 4, 0.01, 280],
    ]);

    expect(processor.snapshot().completedLaps).toMatchObject([
      { lapNumber: 3, fuelUsed: 3, lapTime: 90, isValidForCalc: true },
    ]);
    expect(lapCompleted).toHaveBeenCalledOnce();
  });

  it('does not record the lap under way when it starts over', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({} as Session);
    drive(processor, [
      [40, 1, 0.01, 10],
      [38.5, 1, 0.5, 55],
    ]);

    // Entering a session again clears the engine half-way round the lap.
    processor.onLifecycle({ type: 'enter', replay: false });
    drive(processor, [
      [38.4, 1, 0.52, 57],
      [37, 2, 0.01, 100],
    ]);

    expect(processor.snapshot().completedLaps).toEqual([]);
  });
});

describe('FuelProjectionProcessor on a change of track', () => {
  const at = (weekend: { TrackName?: string; TrackID?: number }): Session =>
    ({
      WeekendInfo: weekend,
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarPath: 'bmwm4gt3' }],
      },
    }) as unknown as Session;
  const laguna = at({ TrackName: 'Laguna Seca', TrackID: 47 });
  const sebring = at({ TrackName: 'Sebring', TrackID: 95 });
  const twoLaps: [number, number, number, number][] = [
    [40, 1, 0.01, 10],
    [37, 2, 0.01, 100],
    [34, 3, 0.01, 190],
  ];

  it('does not carry the laps to another track', () => {
    // Le Mans Ultimate never disconnects between events, so the same car at
    // the next track arrives as nothing more than a session naming it.
    const processor = new FuelProjectionProcessor();
    processor.init(laguna);
    drive(processor, twoLaps);
    expect(processor.snapshot().completedLaps).toHaveLength(2);
    expect(processor.snapshot().trackId).toBe('Laguna Seca');

    processor.init(sebring);
    expect(processor.snapshot().completedLaps).toEqual([]);

    // And the lap under way at the old track is not finished at the new one.
    drive(processor, [
      [60, 1, 0.4, 20],
      [58, 2, 0.01, 80],
    ]);
    expect(processor.snapshot().trackId).toBe('Sebring');
    expect(processor.snapshot().completedLaps).toEqual([]);
  });

  it('keeps the laps while the session is rebuilt for the same track', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(laguna);
    drive(processor, twoLaps);

    processor.init(at({ TrackName: 'Laguna Seca', TrackID: 47 }));
    // A session that does not name its track says nothing about it.
    processor.init(at({ TrackName: '' }));
    processor.init(at({}));
    processor.init({} as Session);

    expect(processor.snapshot().completedLaps).toHaveLength(2);
  });

  it('tells tracks apart by id when they have no name', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(at({ TrackID: 18 }));
    drive(processor, twoLaps);

    processor.init(at({ TrackID: 52 }));

    expect(processor.snapshot().completedLaps).toEqual([]);
  });

  it('takes the first track after a disconnect as no change', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(laguna);
    processor.onLifecycle({ type: 'disconnect' });
    processor.onLifecycle({ type: 'enter', replay: false });

    processor.init(sebring);
    drive(processor, twoLaps);
    processor.init(sebring);

    expect(processor.snapshot().completedLaps).toHaveLength(2);
  });
});

describe('FuelProjectionProcessor in a race run to the clock', () => {
  /** A timed race as a producer has written it, the player leading. */
  const timedRace = (sessionLaps: unknown): Session =>
    ({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 90 }],
      },
      SessionInfo: {
        Sessions: [
          { SessionNum: 0, SessionType: 'Race', SessionLaps: sessionLaps },
        ],
      },
    }) as unknown as Session;
  const raceFrame = (timeRemain: number, pct = 0.25) =>
    ({
      Lap: { value: [12] },
      LapDistPct: { value: [pct] },
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [timeRemain] },
      CamCarIdx: { value: [0] },
      CarIdxLap: { value: [12] },
      CarIdxLapDistPct: { value: [pct] },
      CarIdxPosition: { value: [1] },
    }) as unknown as Telemetry;

  it.each([
    ['rFactor 2 as text', '2147483647'],
    ['rFactor 2', 2147483647],
    ['iRacing in telemetry', 32767],
    ['iRacing in the session', 'unlimited'],
  ])('has no lap total once the clock runs out: %s', (_from, sessionLaps) => {
    // Time is up and the leader has yet to reach the line. Le Mans Ultimate
    // said 2147483647 laps, and that became the race: two billion laps to
    // go, held at a thousand, and the fuel for them.
    const processor = new FuelProjectionProcessor();
    processor.init(timedRace(sessionLaps));

    processor.onFrame(raceFrame(0));

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 0,
      estimatedLapsRemaining: 0,
      hasValidRaceEstimate: false,
    });
  });

  it('is not capped by a lap total that is not one', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(timedRace('2147483647'));

    // 900 s at 90 s a lap from 11.25 laps: over the line for the 22nd time
    // with the clock run out.
    processor.onFrame(raceFrame(900));

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 22,
      estimatedLapsRemaining: 10.75,
      hasValidRaceEstimate: true,
      isFixedLapRace: false,
    });
  });

  it('still ends a timed race at its lap limit when it has one', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(timedRace('15'));

    processor.onFrame(raceFrame(900));

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 15,
      estimatedLapsRemaining: 3.75,
      hasValidRaceEstimate: true,
    });
  });
});

describe('FuelProjectionProcessor race distance at a lap boundary', () => {
  /**
   * The player in second, a class of their own, with the leader a little
   * way up the road. Both run to the session's estimate: 100 s a lap.
   */
  const session = {
    DriverInfo: {
      DriverCarIdx: 1,
      Drivers: [
        { CarIdx: 0, CarClassID: 1, CarClassEstLapTime: 100 },
        { CarIdx: 1, CarClassID: 2, CarClassEstLapTime: 100 },
      ],
    },
    SessionInfo: {
      Sessions: [
        { SessionNum: 0, SessionType: 'Race', SessionLaps: 'unlimited' },
      ],
    },
  } as unknown as Session;
  /** Both cars on lap 3: the leader at 0.5, the player where given. */
  const raceFrame = (
    timeRemain: number,
    playerPct: number,
    { lap = 3, leaderPct = 0.5 } = {}
  ) =>
    ({
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [timeRemain] },
      CamCarIdx: { value: [1] },
      CarIdxLap: { value: [lap, lap] },
      CarIdxLapDistPct: { value: [leaderPct, playerPct] },
      CarIdxPosition: { value: [1, 2] },
    }) as unknown as Telemetry;
  const total = (processor: FuelProjectionProcessor) =>
    processor.snapshot().calculatedTotalRaceLaps;

  it('does not flip between two totals when the finish lands on one', () => {
    // 1000 s to run: the leader is over the line for the 13th time as it
    // runs out. The player reaches that moment within a few metres of the
    // line themselves, one side of it or the other as each frame has it.
    const processor = new FuelProjectionProcessor();
    processor.init(session);
    const totals = [0.49, 0.51, 0.49, 0.52, 0.48, 0.51, 0.49].map((pct) => {
      processor.onFrame(raceFrame(1000, pct));
      return total(processor);
    });

    // The lap more as soon as it is projected, and then no stepping back
    // from it for a hundredth of a lap.
    expect(totals).toEqual([13, 14, 14, 14, 14, 14, 14]);
  });

  it('never gives fewer laps than the projection', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session);

    processor.onFrame(raceFrame(1000, 0.3));
    expect(total(processor)).toBe(13);
    processor.onFrame(raceFrame(1000, 0.51));
    expect(total(processor)).toBe(14);
  });

  it('gives the lap up once the finish is clearly short of it', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session);
    processor.onFrame(raceFrame(1000, 0.51));
    expect(total(processor)).toBe(14);

    // Ten laps to run at a pace trusted to 2 %: a fifth of a lap of doubt.
    processor.onFrame(raceFrame(1000, 0.35));
    expect(total(processor)).toBe(14);
    processor.onFrame(raceFrame(1000, 0.25));
    expect(total(processor)).toBe(13);
  });

  it('holds on to less of a lap as the race runs out', () => {
    // One lap to run, where the same hundredth of a lap is no longer in
    // doubt: the leader is over the line for the 4th time, and the player
    // either is by then or is not.
    const processor = new FuelProjectionProcessor();
    processor.init(session);
    processor.onFrame(raceFrame(100, 0.51));
    expect(total(processor)).toBe(5);

    processor.onFrame(raceFrame(100, 0.47));
    expect(total(processor)).toBe(4);
  });

  it('holds nothing from before the start', () => {
    // The green flag is out and the cars are short of the line, on lap 0:
    // their place on the track counts as distance covered, and the race
    // reads a lap long. It is that lap shorter once they are over the line,
    // however close to a whole lap the finish then lands.
    const processor = new FuelProjectionProcessor();
    processor.init(session);
    processor.onFrame(raceFrame(1000, 0.95, { lap: 0, leaderPct: 0.97 }));
    expect(total(processor)).toBe(11);

    processor.onFrame(raceFrame(990, 0.005, { lap: 1, leaderPct: 0.02 }));
    expect(total(processor)).toBe(10);
  });

  it('starts from nothing in a new session', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session);
    processor.onFrame(raceFrame(1000, 0.51));
    expect(total(processor)).toBe(14);

    processor.onLifecycle({ type: 'sessionNumChange' });
    processor.onFrame(raceFrame(1000, 0.49));

    expect(total(processor)).toBe(13);
  });
});
