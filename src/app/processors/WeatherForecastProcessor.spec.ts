import { describe, expect, it } from 'vitest';
import type {
  LmuWeatherNode,
  Session,
  Telemetry,
  WeatherForecastSnapshot,
} from '@irdashies/types';
import { TIMED_SESSION_LAPS, WEATHER_SKY_UNKNOWN } from '@irdashies/types';
import {
  forecastScheduleLength,
  liveSkyType,
  lmuForecastSlot,
  WeatherForecastProcessor,
} from './WeatherForecastProcessor';

/** Five points at fifths of the session, as the REST parser lands them. */
const forecast = (
  sky: number[],
  temperature: number[],
  rainChance: number[] = [0, 0, 0, 0, 0],
  extra: Partial<LmuWeatherNode>[] = []
): LmuWeatherNode[] =>
  sky.map((skyType, index) => ({
    start: Math.round(index * 0.2 * 10) / 10,
    skyType,
    temperature: temperature[index],
    rainChance: rainChance[index],
    ...extra[index],
  }));

/** The race forecast of the curated recording, humidity and wind included. */
const recordedRace = (): LmuWeatherNode[] =>
  forecast(
    [0, 1, 1, 1, 2],
    [18, 17, 16, 16, 16],
    [0, 0, 0, 0, 0],
    [
      { humidity: 0.56, windSpeed: 17, windDirection: 6 },
      { humidity: 0.6, windSpeed: 17, windDirection: 7 },
      { humidity: 0.62, windSpeed: 17, windDirection: 7 },
      { humidity: 0.54, windSpeed: 14, windDirection: 7 },
      { humidity: 0.57, windSpeed: 11, windDirection: 7 },
    ]
  );

const session = (
  forecasts: NonNullable<Session['LmuRest']>['forecast'],
  /** How long the race is set to run, seconds, where the sim has said. */
  raceTime?: number
): Session =>
  ({
    LmuRest: {
      forecast: forecasts,
      ...(raceTime === undefined ? {} : { raceTime }),
    },
  }) as unknown as Session;

/**
 * The curated recording: the race's forecast, and a race set to fifteen
 * minutes. Its clock ends at 1035 s, 135 s more than that, and it was joined
 * after the green flag, so the frame states no length shorter than the end
 * time.
 */
const recordedSession = (): Session => session({ race: recordedRace() }, 900);

interface FrameInput {
  time: number;
  sessionNum?: number;
  /** 0 or absent: the sim gives the session no end time. */
  endTime?: number;
  /**
   * The session's length as the frame states it. The end time unless given:
   * what a practice frame carries, and a race's until its green is seen.
   */
  timeTotal?: number;
  lapsTotal?: number;
  timeOfDay?: number;
  airTemp?: number;
  rain?: number;
  skies?: number;
  lapsCompleted?: number[];
  lapDistPct?: number[];
}

const frame = ({
  time,
  sessionNum = 10,
  endTime = 1035,
  timeTotal = endTime,
  lapsTotal = TIMED_SESSION_LAPS,
  timeOfDay,
  airTemp = 17.16,
  rain = 0,
  skies = 0,
  lapsCompleted,
  lapDistPct,
}: FrameInput): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionTime: { value: [time] },
    SessionNum: { value: [sessionNum] },
    SessionLapsTotal: { value: [lapsTotal] },
    SessionTimeTotal: { value: [timeTotal] },
    AirTemp: { value: [airTemp] },
    Precipitation: { value: [rain] },
    Skies: { value: [skies] },
  };
  // As the mapper does: no end, no key.
  if (endTime > 0) out.LmuSessionEndTime = { value: [endTime] };
  if (timeOfDay !== undefined) out.SessionTimeOfDay = { value: [timeOfDay] };
  if (lapsCompleted) out.CarIdxLapCompleted = { value: lapsCompleted };
  if (lapDistPct) out.CarIdxLapDistPct = { value: lapDistPct };
  return out as unknown as Telemetry;
};

const run = (
  processor: WeatherForecastProcessor,
  input: FrameInput
): WeatherForecastSnapshot => {
  processor.onFrame(frame(input));
  return processor.snapshot();
};

describe('lmuForecastSlot', () => {
  it.each([
    [0, 'practice'],
    [1, 'practice'],
    [4, 'practice'],
    [5, 'qualify'],
    [8, 'qualify'],
    // The warm-up runs on the race's weather.
    [9, 'race'],
    [10, 'race'],
    [13, 'race'],
  ] as const)('reads session index %s as the %s forecast', (index, slot) => {
    expect(lmuForecastSlot(index)).toBe(slot);
  });
});

describe('liveSkyType', () => {
  it.each([
    [2, 0, 2],
    [0, 0, 0],
    [4, 0, 4],
    // Beyond overcast is still overcast.
    [7, 0, 4],
    [-1, 0, 0],
  ])('dry with cloud index %s and rain %s is sky %s', (cloud, rain, sky) => {
    expect(liveSkyType(cloud, rain)).toBe(sky);
  });

  it.each([
    [0.05, 5],
    [0.1, 5],
    [0.12, 6],
    [0.15, 6],
    [0.2, 7],
    [0.4, 8],
    [0.6, 9],
    [0.61, 10],
    [1, 10],
  ])('rain of %s is sky %s whatever the cloud', (rain, sky) => {
    expect(liveSkyType(0, rain)).toBe(sky);
    expect(liveSkyType(4, rain)).toBe(sky);
    expect(liveSkyType(undefined, rain)).toBe(sky);
  });

  it('is unknown when the sim publishes neither', () => {
    expect(liveSkyType(undefined, undefined)).toBe(WEATHER_SKY_UNKNOWN);
    expect(liveSkyType(undefined, 0)).toBe(WEATHER_SKY_UNKNOWN);
  });
});

describe('forecastScheduleLength', () => {
  it('is the end time less the green flag in a race whose green was seen', () => {
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 900,
        raceTime: undefined,
      })
    ).toBe(900);
  });

  it('is the length the race is set to until the green has been seen', () => {
    // Before the flag, and in a race joined after it, the frame's length is
    // the end time itself.
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 1035,
        raceTime: 900,
      })
    ).toBe(900);
    expect(
      forecastScheduleLength({
        sessionNum: 11,
        endTime: 1035,
        timeTotal: undefined,
        raceTime: 900,
      })
    ).toBe(900);
  });

  it('takes the green flag over the setting when it has both', () => {
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 898,
        raceTime: 900,
      })
    ).toBe(898);
  });

  it('is the end time in a race when the sim states neither', () => {
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 1035,
        raceTime: undefined,
      })
    ).toBe(1035);
    // Nor a length that cannot be this race's.
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 0,
        raceTime: 7200,
      })
    ).toBe(1035);
    expect(
      forecastScheduleLength({
        sessionNum: 10,
        endTime: 1035,
        timeTotal: 1035,
        raceTime: 0,
      })
    ).toBe(1035);
  });

  it.each([
    [0, 'the test day'],
    [1, 'practice'],
    [5, 'qualifying'],
    [9, 'the warm-up'],
  ])(
    'is the session’s own length in session %s, %s, whatever the race is set to',
    (sessionNum) => {
      expect(
        forecastScheduleLength({
          sessionNum,
          endTime: 3600,
          timeTotal: 3600,
          raceTime: 900,
        })
      ).toBe(3600);
    }
  );
});

describe('WeatherForecastProcessor', () => {
  it('declares the forecast channel at one tick a second', () => {
    const processor = new WeatherForecastProcessor();
    expect(processor.channel).toBe('weather-forecast.snapshot');
    expect(processor.tickRateHz).toBe(1);
  });

  it('is unavailable until the forecast for the session has arrived', () => {
    const processor = new WeatherForecastProcessor();
    processor.init({} as Session);

    const before = run(processor, { time: 139.8 });
    expect(before.available).toBe(false);
    expect(before.nodes).toEqual([]);
    // The live column does not wait for the forecast.
    expect(before.now).toMatchObject({ skyType: 0, airTempC: 17.2, rain: 0 });

    // The REST answer lands and the session is republished.
    processor.init(recordedSession());
    const after = run(processor, { time: 140.8 });
    expect(after.available).toBe(true);
    expect(after.nodes).toHaveLength(4);
    expect(after.version).toBeGreaterThan(before.version);
  });

  it('places the recorded race’s points at 180, 360, 540 and 720 s', () => {
    const processor = new WeatherForecastProcessor();
    processor.init(recordedSession());

    const snapshot = run(processor, { time: 139.8 });

    expect(snapshot.lapLimited).toBe(false);
    expect(snapshot.nodes.map((node) => node.index)).toEqual([1, 2, 3, 4]);
    // Fifths of the race's fifteen minutes, seen from 139.8 s: 40, 220, 400
    // and 580 s away.
    expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
      0, 3, 6, 9,
    ]);
    expect(snapshot.nodes.map((node) => node.skyType)).toEqual([1, 1, 1, 2]);
    expect(snapshot.nodes.map((node) => node.airTempC)).toEqual([
      17, 16, 16, 16,
    ]);
    expect(snapshot.nodes.map((node) => node.rainChance)).toEqual([0, 0, 0, 0]);
    expect(snapshot.nodes.map((node) => node.humidity)).toEqual([
      0.6, 0.62, 0.54, 0.57,
    ]);
    expect(snapshot.nodes.map((node) => node.windSpeedMs)).toEqual([
      17, 17, 14, 11,
    ]);
  });

  it('drops a point the moment it begins and keeps one under a minute away', () => {
    const processor = new WeatherForecastProcessor();
    processor.init(recordedSession());

    // To the second it begins, and not after.
    const before = run(processor, { time: 179.9 });
    expect(before.nodes[0]).toMatchObject({ index: 1, startsInMinutes: 0 });
    expect(run(processor, { time: 180 }).nodes[0].index).toBe(2);

    // At the recording's end the second has gone too.
    const late = run(processor, { time: 379.8 });
    expect(late.nodes.map((node) => node.index)).toEqual([3, 4]);
    expect(late.nodes.map((node) => node.startsInMinutes)).toEqual([2, 5]);

    expect(
      run(processor, { time: 719.9 }).nodes.map((node) => node.index)
    ).toEqual([4]);
    // Past the last point there is nothing left to come, though the race
    // runs on to 1035 s.
    expect(run(processor, { time: 720 }).nodes).toEqual([]);
    expect(run(processor, { time: 1000 }).nodes).toEqual([]);
  });

  describe('where the points sit', () => {
    it('in a race after the green: at fifths of the end time less the flag', () => {
      const processor = new WeatherForecastProcessor();
      // No setting from the sim: the frame's own length is enough.
      processor.init(session({ race: recordedRace() }));

      const snapshot = run(processor, { time: 139.8, timeTotal: 900 });
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        0, 3, 6, 9,
      ]);
      expect(run(processor, { time: 180, timeTotal: 900 }).nodes[0].index).toBe(
        2
      );
    });

    it('in a race before the green: at fifths of the length it is set to', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      // On the grid, 20 s in: the frame's length is still the end time.
      const snapshot = run(processor, { time: 20, timeTotal: 1035 });
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        2, 5, 8, 11,
      ]);
      // And the same points once a flag that fell at 135 s has been seen.
      const green = run(processor, { time: 136, timeTotal: 900 });
      expect(green.nodes.map((node) => node.startsInMinutes)).toEqual([
        0, 3, 6, 9,
      ]);
    });

    it('in a race the sim states no length for: at fifths of the end time', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(session({ race: recordedRace() }));

      // 207, 414, 621 and 828 s of a clock ending at 1035 s.
      const snapshot = run(processor, { time: 139.8 });
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        1, 4, 8, 11,
      ]);
    });

    it('in practice: at fifths of the session, whatever the race is set to', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(session({ practice: recordedRace() }, 900));

      // An hour of practice, ten minutes in: 720, 1440, 2160 and 2880 s.
      const snapshot = run(processor, {
        time: 600,
        sessionNum: 1,
        endTime: 3600,
      });
      expect(snapshot.nodes.map((node) => node.index)).toEqual([1, 2, 3, 4]);
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        2, 14, 26, 38,
      ]);
    });

    it('in qualifying and the warm-up: at fifths of the session', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(
        session({ qualify: recordedRace(), race: recordedRace() }, 900)
      );

      // Twenty minutes of qualifying: 240, 480, 720 and 960 s.
      expect(
        run(processor, { time: 60, sessionNum: 5, endTime: 1200 }).nodes.map(
          (node) => node.startsInMinutes
        )
      ).toEqual([3, 7, 11, 15]);
      // Ten minutes of warm-up, on the race's forecast: 120, 240, 360, 480 s.
      expect(
        run(processor, { time: 60, sessionNum: 9, endTime: 600 }).nodes.map(
          (node) => node.startsInMinutes
        )
      ).toEqual([1, 3, 5, 7]);
    });
  });

  it('picks the forecast by the sim’s session index', () => {
    const forecasts = {
      practice: forecast([0, 0, 0, 0, 0], [21, 21, 22, 22, 22]),
      qualify: forecast([0, 0, 0, 0, 0], [23, 20, 19, 14, 21]),
      race: recordedRace(),
    };
    const firstTemperature = (sessionNum: number) => {
      const processor = new WeatherForecastProcessor();
      processor.init(session(forecasts));
      return run(processor, { time: 10, sessionNum, endTime: 3600 }).nodes[0]
        .airTempC;
    };

    expect(firstTemperature(0)).toBe(21);
    expect(firstTemperature(1)).toBe(21);
    expect(firstTemperature(5)).toBe(20);
    expect(firstTemperature(9)).toBe(17);
    expect(firstTemperature(10)).toBe(17);
  });

  it('is unavailable in a session whose own forecast is missing', () => {
    const processor = new WeatherForecastProcessor();
    processor.init(recordedSession());

    const snapshot = run(processor, { time: 10, sessionNum: 1 });
    expect(snapshot.available).toBe(false);
    expect(snapshot.nodes).toEqual([]);
  });

  describe('a race that ends on laps', () => {
    const lapRace = (leader: number, lapsTotal = 20): FrameInput => ({
      time: 300,
      endTime: 0,
      lapsTotal,
      lapsCompleted: [Math.floor(leader) - 2, Math.floor(leader), -1],
      lapDistPct: [0.5, leader - Math.floor(leader), -1],
    });

    it('keeps the points in order with no minutes', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      const snapshot = run(processor, lapRace(0.5));

      expect(snapshot.lapLimited).toBe(true);
      expect(snapshot.nodes.map((node) => node.index)).toEqual([1, 2, 3, 4]);
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(snapshot.nodes.map((node) => node.startsAtTimeOfDay)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('drops a point as the leader passes that share of the laps', () => {
      const processor = new WeatherForecastProcessor(() => 1);
      processor.init(recordedSession());

      // Nine laps of twenty: 45 per cent.
      expect(
        run(processor, lapRace(9)).nodes.map((node) => node.index)
      ).toEqual([3, 4]);
      // The lap in progress counts: 11.9 of 20 is short of 60 per cent...
      expect(
        run(processor, lapRace(11.9)).nodes.map((node) => node.index)
      ).toEqual([3, 4]);
      // ...and 12 is not.
      expect(
        run(processor, lapRace(12)).nodes.map((node) => node.index)
      ).toEqual([4]);
      expect(run(processor, lapRace(16)).nodes).toEqual([]);
    });
  });

  it('keeps every point, untimed, when the sim gives neither an end nor a lap count', () => {
    const processor = new WeatherForecastProcessor();
    processor.init(recordedSession());

    const snapshot = run(processor, { time: 300, endTime: 0 });

    expect(snapshot.lapLimited).toBe(false);
    expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  describe('the clock time a point starts at', () => {
    it('is null until the time scale has been measured', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      const snapshot = run(processor, { time: 139.8, timeOfDay: 54_739.8 });
      expect(snapshot.nodes.map((node) => node.startsAtTimeOfDay)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('is the session start plus the point’s place, in real time', () => {
      const processor = new WeatherForecastProcessor(() => 1);
      processor.init(recordedSession());

      const snapshot = run(processor, { time: 139.8, timeOfDay: 54_739.8 });
      // 15:10:00 plus 180, 360, 540 and 720 s: 15:13, 15:16, 15:19, 15:22.
      expect(snapshot.nodes.map((node) => node.startsAtTimeOfDay)).toEqual([
        54_780, 54_960, 55_140, 55_320,
      ]);
    });

    it('runs ahead with a day faster than the session clock', () => {
      const processor = new WeatherForecastProcessor(() => 30);
      processor.init(session({ practice: recordedRace() }));

      // An hour of practice, ten minutes in, at 22:00 in-game.
      const snapshot = run(processor, {
        time: 600,
        sessionNum: 1,
        endTime: 3600,
        timeOfDay: 79_200,
      });
      // Two minutes of real time is an hour of the day: 23:00, then past
      // midnight to 05:00, 11:00 and 17:00.
      expect(snapshot.nodes.map((node) => node.startsInMinutes)).toEqual([
        2, 14, 26, 38,
      ]);
      expect(snapshot.nodes.map((node) => node.startsAtTimeOfDay)).toEqual([
        82_800, 18_000, 39_600, 61_200,
      ]);
    });

    it('holds still while the two clocks disagree by a reading', () => {
      const processor = new WeatherForecastProcessor(() => 30);
      processor.init(session({ practice: recordedRace() }));

      const first = run(processor, {
        time: 590,
        sessionNum: 1,
        endTime: 3600,
        timeOfDay: 79_200,
      });
      expect(first.nodes[0].startsAtTimeOfDay).toBe(83_100);
      // A second later the time of day reads a fifth of a second old: six
      // in-game seconds short, which must not move a clock time.
      const second = run(processor, {
        time: 591,
        sessionNum: 1,
        endTime: 3600,
        timeOfDay: 79_224,
      });

      expect(second.nodes.map((node) => node.startsAtTimeOfDay)).toEqual(
        first.nodes.map((node) => node.startsAtTimeOfDay)
      );
      expect(second.version).toBe(first.version);
    });

    it('follows a clock that really moved', () => {
      let scale = 1;
      const processor = new WeatherForecastProcessor(() => scale);
      processor.init(recordedSession());

      const first = run(processor, { time: 139.8, timeOfDay: 54_739.8 });
      expect(first.nodes[1].startsAtTimeOfDay).toBe(54_960);
      scale = 2;
      const snapshot = run(processor, { time: 140.8, timeOfDay: 54_741.8 });

      // 219.2 s of real time is now 438.4 s of the day.
      expect(snapshot.nodes[1].startsAtTimeOfDay).toBe(55_200);
    });
  });

  it('turns the wind direction index into a compass bearing', () => {
    const processor = new WeatherForecastProcessor();
    processor.init(recordedSession());

    const [first] = run(processor, { time: 139.8 }).nodes;
    // Index 7, north-west: 315 degrees.
    expect(first.windDirectionRad).toBeCloseTo((7 * Math.PI) / 4, 6);

    const west = new WeatherForecastProcessor();
    west.init(
      session({
        race: forecast([0, 0, 0, 0, 0], [18, 18, 18, 18, 18], undefined, [
          {},
          { windDirection: 6 },
        ]),
      })
    );
    const nodes = run(west, { time: 10 }).nodes;
    // Index 6, west: 270 degrees.
    expect(nodes[0].windDirectionRad).toBeCloseTo(4.71, 2);
    // A point that states no wind or humidity is still a point.
    expect(nodes[1]).toMatchObject({
      humidity: null,
      windSpeedMs: null,
      windDirectionRad: null,
    });
  });

  describe('the live column', () => {
    it('reads the sky, the air and the rain off the frame', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      expect(
        run(processor, { time: 1, airTemp: 16.96, rain: 0, skies: 2 }).now
      ).toEqual({
        skyType: 2,
        airTempC: 17,
        rain: 0,
        airTempTrend: 0,
        rainTrend: 0,
      });
      expect(
        run(processor, { time: 2, airTemp: 16.96, rain: 0.124, skies: 2 }).now
      ).toMatchObject({ skyType: 6, rain: 0.12 });
    });

    it('has no readings on a frame without them', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());
      processor.onFrame({
        SessionTime: { value: [5] },
        SessionNum: { value: [10] },
      } as unknown as Telemetry);

      expect(processor.snapshot().now).toEqual({
        skyType: WEATHER_SKY_UNKNOWN,
        airTempC: null,
        rain: null,
        airTempTrend: 0,
        rainTrend: 0,
      });
    });

    it('starts steady, falls with the temperature and is steady again a minute after', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      // The first reading is a baseline, not a rise from nothing.
      expect(
        run(processor, { time: 100, airTemp: 17.2 }).now.airTempTrend
      ).toBe(0);
      expect(
        run(processor, { time: 110, airTemp: 17.1 }).now.airTempTrend
      ).toBe(-1);
      // Unchanged, and still falling a minute on...
      expect(
        run(processor, { time: 170, airTemp: 17.1 }).now.airTempTrend
      ).toBe(-1);
      // ...steady from the second after.
      expect(
        run(processor, { time: 171, airTemp: 17.1 }).now.airTempTrend
      ).toBe(0);
      expect(
        run(processor, { time: 180, airTemp: 17.3 }).now.airTempTrend
      ).toBe(1);
    });

    it('ignores a move smaller than a tenth of a degree', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      run(processor, { time: 100, airTemp: 17.12 });
      expect(
        run(processor, { time: 101, airTemp: 17.08 }).now.airTempTrend
      ).toBe(0);
    });

    it('follows the rain to a hundredth', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      expect(run(processor, { time: 100, rain: 0 }).now.rainTrend).toBe(0);
      expect(run(processor, { time: 101, rain: 0.004 }).now.rainTrend).toBe(0);
      expect(run(processor, { time: 102, rain: 0.05 }).now.rainTrend).toBe(1);
      expect(run(processor, { time: 103, rain: 0.03 }).now.rainTrend).toBe(-1);
      expect(run(processor, { time: 164, rain: 0.03 }).now.rainTrend).toBe(0);
    });

    it('counts the minute again when the clock runs backwards', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());

      run(processor, { time: 500, airTemp: 17.2 });
      expect(
        run(processor, { time: 510, airTemp: 17.1 }).now.airTempTrend
      ).toBe(-1);
      // A restart without a new session: the clock is back at 20 s.
      expect(run(processor, { time: 20, airTemp: 17.1 }).now.airTempTrend).toBe(
        -1
      );
      expect(run(processor, { time: 80, airTemp: 17.1 }).now.airTempTrend).toBe(
        -1
      );
      // A minute after the restart, not when the clock is back at 510.
      expect(run(processor, { time: 81, airTemp: 17.1 }).now.airTempTrend).toBe(
        0
      );
    });
  });

  describe('publishing', () => {
    it('moves the version only when a shown value moves', () => {
      const processor = new WeatherForecastProcessor(() => 1);
      processor.init(recordedSession());

      const first = run(processor, { time: 141.5, timeOfDay: 54_741.5 });
      expect(first.nodes.map((node) => node.startsInMinutes)).toEqual([
        0, 3, 6, 9,
      ]);
      // Half a minute on: the same minutes, the same tenth of a degree.
      const second = run(processor, {
        time: 171.5,
        timeOfDay: 54_771.5,
        airTemp: 17.19,
      });
      expect(second.version).toBe(first.version);
      expect(second).toBe(first);
      const third = run(processor, { time: 179.9, timeOfDay: 54_779.9 });
      expect(third.version).toBe(first.version);

      // The first point begins, and the others are each a minute nearer.
      const fourth = run(processor, { time: 180.1, timeOfDay: 54_780.1 });
      expect(fourth.nodes.map((node) => node.startsInMinutes)).toEqual([
        2, 5, 8,
      ]);
      expect(fourth.version).toBe(first.version + 1);
    });

    it('publishes a few times a minute over the recorded four minutes, not once a second', () => {
      const processor = new WeatherForecastProcessor(() => 1);
      processor.init(recordedSession());

      const versions = new Set<number>();
      for (let time = 139.8; time <= 379.8; time += 1) {
        versions.add(
          run(processor, {
            time,
            timeOfDay: 54_600 + time,
            // 17.15 falling to 16.00 by 360 s, as on the recording.
            airTemp: Math.max(16, 17.15 - ((time - 139.8) / 220.2) * 1.15),
          }).version
        );
      }
      // The minutes tick over, a dozen tenths of a degree go by and the
      // trend comes and goes: a couple of dozen publications, not two
      // hundred and forty.
      expect(versions.size).toBeGreaterThan(8);
      expect(versions.size).toBeLessThan(40);
    });
  });

  describe('session changes', () => {
    it('clears the points and the trends on a new session and picks its forecast', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(
        session({
          qualify: forecast([0, 0, 0, 0, 0], [23, 20, 19, 14, 21]),
          race: recordedRace(),
        })
      );
      run(processor, { time: 100, sessionNum: 5, endTime: 900, airTemp: 20 });
      const falling = run(processor, {
        time: 110,
        sessionNum: 5,
        endTime: 900,
        airTemp: 19.5,
      });
      expect(falling.now.airTempTrend).toBe(-1);
      expect(falling.nodes[0].airTempC).toBe(20);

      processor.onLifecycle({ type: 'sessionNumChange' });
      const cleared = processor.snapshot();
      expect(cleared.nodes).toEqual([]);
      expect(cleared.now.airTempTrend).toBe(0);
      expect(cleared.version).toBeGreaterThan(falling.version);

      const race = run(processor, { time: 5, sessionNum: 10, airTemp: 18 });
      expect(race.sessionNum).toBe(10);
      expect(race.now.airTempTrend).toBe(0);
      expect(race.nodes[0].airTempC).toBe(17);
    });

    it('starts the trends over when the frame itself changes session', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());
      run(processor, { time: 100, sessionNum: 9, airTemp: 20 });
      expect(
        run(processor, { time: 110, sessionNum: 9, airTemp: 19 }).now
          .airTempTrend
      ).toBe(-1);

      // No lifecycle event yet, and a colder session: not a fall.
      expect(
        run(processor, { time: 1, sessionNum: 10, airTemp: 15 }).now
          .airTempTrend
      ).toBe(0);
    });

    it('goes unavailable on disconnect and forgets the forecast', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());
      const live = run(processor, { time: 139.8 });
      expect(live.available).toBe(true);

      processor.onLifecycle({ type: 'disconnect' });
      const gone = processor.snapshot();
      expect(gone).toMatchObject({
        available: false,
        nodes: [],
        sessionNum: null,
        lapLimited: false,
      });
      expect(gone.now.airTempC).toBeNull();
      expect(gone.version).toBeGreaterThan(live.version);

      // A new connection has no forecast until its own session brings one.
      expect(run(processor, { time: 1 }).available).toBe(false);
    });

    it('does nothing on entering a session', () => {
      const processor = new WeatherForecastProcessor();
      processor.init(recordedSession());
      const before = run(processor, { time: 139.8 });

      processor.onLifecycle({ type: 'enter', replay: false });
      expect(processor.snapshot()).toBe(before);
    });
  });

  it('stays unavailable under a sim with no forecast', () => {
    const processor = new WeatherForecastProcessor();
    // iRacing: a session with no LmuRest at all.
    processor.init({ WeekendInfo: {} } as unknown as Session);
    processor.onFrame({
      SessionTime: { value: [100] },
      SessionNum: { value: [2] },
      AirTemp: { value: [24] },
      Skies: { value: [1] },
      Precipitation: { value: [0] },
      SessionLapsTotal: { value: [20] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      available: false,
      nodes: [],
    });
  });
});
