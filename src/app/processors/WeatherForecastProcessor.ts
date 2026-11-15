import type {
  LmuRestSession,
  LmuWeatherNode,
  Session,
  SessionLifecycleEvent,
  Telemetry,
  WeatherForecastNode,
  WeatherForecastSnapshot,
  WeatherTrend,
} from '@irdashies/types';
import { TIMED_SESSION_LAPS, WEATHER_SKY_UNKNOWN } from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

/** START and the four points after it. */
const FORECAST_NODE_COUNT = 5;
/** An arrow stays this long after the reading last moved. */
const TREND_HOLD_SECONDS = 60;
const SECONDS_PER_DAY = 86_400;
/** LMU's wind direction index counts eighths of the compass. */
const WIND_DIRECTION_STEP_RAD = Math.PI / 4;
/** The cloud-cover index tops out at overcast. */
const SKY_OVERCAST = 4;

type ForecastSlot = 'practice' | 'qualify' | 'race';

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const scalar = (frame: Telemetry, key: keyof Telemetry): number | undefined =>
  finite(frame[key]?.value?.[0]);

const values = (
  frame: Telemetry,
  key: keyof Telemetry
): readonly unknown[] | undefined => {
  const value = frame[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

/**
 * Which of LMU's three forecasts a session runs on, from the sim's own
 * session index: 0 is the test day, 1 to 4 practice, 5 to 8 qualifying, 9 the
 * warm-up and 10 and above the race. The warm-up runs on the race's weather,
 * which is why the index is read and not the session type, where a warm-up
 * is a practice.
 */
export const lmuForecastSlot = (sessionNum: number): ForecastSlot =>
  sessionNum >= 9 ? 'race' : sessionNum >= 5 ? 'qualify' : 'practice';

/** LMU's session index for the first race session; the warm-up is not one. */
const FIRST_RACE_SESSION = 10;

export interface ForecastScheduleInput {
  /** LMU's session index. */
  sessionNum: number;
  /** When the session ends, seconds on the session clock. */
  endTime: number;
  /**
   * The session's length as the frame states it (SessionTimeTotal): in a
   * race, the end time less the green flag once the flag has been seen, and
   * the end time itself until then.
   */
  timeTotal: number | undefined;
  /** How long the race is set to run, seconds, where the session says. */
  raceTime: number | undefined;
}

/**
 * The length the forecast's five points are spread over, in seconds: point k
 * starts at k fifths of it, counted from the zero of the session clock.
 *
 * In a race that is the race's own length, not the session clock's end time,
 * which also holds whatever ran before the green flag. Measured, on one
 * recording: a dry race in real time, set to fifteen minutes and ending at
 * 1035 s on the session clock, whose air temperature is exactly the second
 * point's at 180.0 s and exactly the third's at 360.0 s. The length is the
 * end time less the green flag where the flag was seen; where it was not, as
 * when a race is joined late, the length the session is set to; and the end
 * time when the sim states neither.
 *
 * In practice and qualifying nothing has been measured. The points are
 * assumed to be spread the same way over the session's length, which there
 * is its end time.
 */
export const forecastScheduleLength = ({
  sessionNum,
  endTime,
  timeTotal,
  raceTime,
}: ForecastScheduleInput): number => {
  if (sessionNum < FIRST_RACE_SESSION) return endTime;
  // Below the end time only once the green flag has been taken off it.
  if (timeTotal !== undefined && timeTotal > 0 && timeTotal < endTime) {
    return timeTotal;
  }
  // A race cannot be set to run longer than its clock does: a length that
  // says so is some other session's.
  if (raceTime !== undefined && raceTime > 0 && raceTime <= endTime) {
    return raceTime;
  }
  return endTime;
};

/**
 * The sky now, on the scale the forecast uses: 0 clear to 4 overcast from the
 * sim's cloud cover while it is dry, and 5 drizzle to 10 storm from how hard
 * it is raining.
 */
export const liveSkyType = (
  cloudCoverage: number | undefined,
  rain: number | undefined
): number => {
  if (rain !== undefined && rain > 0) {
    if (rain <= 0.1) return 5;
    if (rain <= 0.15) return 6;
    if (rain <= 0.2) return 7;
    if (rain <= 0.4) return 8;
    if (rain <= 0.6) return 9;
    return 10;
  }
  if (cloudCoverage === undefined) return WEATHER_SKY_UNKNOWN;
  return Math.min(Math.max(Math.trunc(cloudCoverage), 0), SKY_OVERCAST);
};

interface TrendState {
  last: number | null;
  trend: WeatherTrend;
  /** Session time of the last move. */
  stampedAt: number;
}

const newTrend = (): TrendState => ({ last: null, trend: 0, stampedAt: 0 });

/**
 * Rising when a reading is above the one before, falling when below, and
 * steady again once it has not moved for a minute. The first reading is a
 * baseline, not a rise from nothing.
 */
const stepTrend = (
  state: TrendState,
  value: number | null,
  time: number
): WeatherTrend => {
  if (value === null) {
    state.last = null;
    state.trend = 0;
    return 0;
  }
  if (state.last === null) {
    state.last = value;
    state.trend = 0;
    state.stampedAt = time;
    return 0;
  }
  // A clock that ran backwards would hold the arrow until it caught up with
  // the old stamp. Count the minute from here instead.
  if (time < state.stampedAt) state.stampedAt = time;
  if (value > state.last) {
    state.trend = 1;
    state.stampedAt = time;
  } else if (value < state.last) {
    state.trend = -1;
    state.stampedAt = time;
  } else if (time - state.stampedAt > TREND_HOLD_SECONDS) {
    state.trend = 0;
  }
  state.last = value;
  return state.trend;
};

/** How far apart two clock times are, the short way round midnight. */
const clockDistance = (a: number, b: number): number => {
  const distance = Math.abs(a - b) % SECONDS_PER_DAY;
  return Math.min(distance, SECONDS_PER_DAY - distance);
};

const sameNode = (a: WeatherForecastNode, b: WeatherForecastNode): boolean =>
  a.index === b.index &&
  a.skyType === b.skyType &&
  a.airTempC === b.airTempC &&
  a.rainChance === b.rainChance &&
  a.humidity === b.humidity &&
  a.windSpeedMs === b.windSpeedMs &&
  a.windDirectionRad === b.windDirectionRad &&
  a.startsInMinutes === b.startsInMinutes &&
  a.startsAtTimeOfDay === b.startsAtTimeOfDay;

const sameSnapshot = (
  a: WeatherForecastSnapshot,
  b: WeatherForecastSnapshot
): boolean =>
  a.available === b.available &&
  a.lapLimited === b.lapLimited &&
  a.sessionNum === b.sessionNum &&
  a.now.skyType === b.now.skyType &&
  a.now.airTempC === b.now.airTempC &&
  a.now.rain === b.now.rain &&
  a.now.airTempTrend === b.now.airTempTrend &&
  a.now.rainTrend === b.now.rainTrend &&
  a.nodes.length === b.nodes.length &&
  a.nodes.every((node, index) => sameNode(node, b.nodes[index]));

const emptySnapshot = (version: number): WeatherForecastSnapshot => ({
  available: false,
  now: {
    skyType: WEATHER_SKY_UNKNOWN,
    airTempC: null,
    rain: null,
    airTempTrend: 0,
    rainTrend: 0,
  },
  nodes: [],
  lapLimited: false,
  sessionNum: null,
  version,
});

/**
 * The weather now and Le Mans Ultimate's forecast for the running session,
 * as the points still to come and how long until each.
 *
 * The forecast is on the session, from the sim's REST API: five points named
 * START, NODE_25, NODE_50, NODE_75 and FINISH for each of practice,
 * qualifying and the race. Nothing the sim publishes says when a point
 * applies. They are placed at fifths of the session's length, counted from
 * the zero of the session clock: see forecastScheduleLength for which length
 * and for what that rests on.
 *
 * Every time here is an estimate, and is drawn as one. The placement was
 * measured in one dry race at a time scale of 1 and is assumed elsewhere; a
 * session whose weather changes and a time scale above 1 have not been seen.
 *
 * A race that ends on laps has no length in time; there the points are kept
 * in order with no time, and dropped as the leader passes the same fifths of
 * the lap count, which is an assumption of this app's own.
 *
 * iRacing publishes no forecast, so under it the session carries none and the
 * snapshot stays unavailable.
 */
export class WeatherForecastProcessor implements TelemetryProcessor<WeatherForecastSnapshot> {
  readonly channel = 'weather-forecast.snapshot';
  // Minutes and tenths of a degree: nothing here moves within a second.
  readonly tickRateHz = 1;

  private forecast: LmuRestSession['forecast'];
  /** How long the race is set to run, seconds; undefined when not stated. */
  private raceTime: number | undefined;
  private readonly airTempTrend = newTrend();
  private readonly rainTrend = newTrend();
  /**
   * The clock time published for each point, by its index. Held once worked
   * out and replaced only when the answer moves by more than a minute: the
   * time of day is published less often than the session clock, so the same
   * sum comes out a few seconds either way from one tick to the next.
   */
  private readonly clockTimes: (number | null)[] = Array.from(
    { length: FORECAST_NODE_COUNT },
    () => null
  );
  private latest = emptySnapshot(0);

  /**
   * @param timeScale In-game seconds per second of the session clock, as the
   *   session bar measures it; undefined until it has.
   */
  constructor(
    private readonly timeScale: () => number | undefined = () => undefined
  ) {}

  init(session: Session): void {
    this.forecast = session.LmuRest?.forecast;
    this.raceTime = session.LmuRest?.raceTime;
  }

  onFrame(frame: Telemetry): void {
    const time = scalar(frame, 'SessionTime');
    if (time === undefined) return;
    const sessionNum = scalar(frame, 'SessionNum') ?? null;
    if (sessionNum !== this.latest.sessionNum) this.clearSessionState();

    const rain = scalar(frame, 'Precipitation');
    const airTemp = scalar(frame, 'AirTemp');
    const airTempC = airTemp === undefined ? null : round(airTemp, 1);
    const rainRounded = rain === undefined ? null : round(rain, 2);

    const nodes =
      sessionNum === null
        ? undefined
        : this.forecast?.[lmuForecastSlot(sessionNum)];
    const available =
      nodes !== undefined && nodes.length >= FORECAST_NODE_COUNT;

    // No session ends at 0, and the mapper leaves the end off the frame when
    // the sim gives none.
    const endTimeReading = scalar(frame, 'LmuSessionEndTime');
    const endTime =
      endTimeReading !== undefined && endTimeReading >= 1
        ? endTimeReading
        : null;
    const lapsReading = scalar(frame, 'SessionLapsTotal');
    const lapsTotal =
      lapsReading !== undefined &&
      lapsReading > 0 &&
      lapsReading < TIMED_SESSION_LAPS
        ? lapsReading
        : null;

    const next: WeatherForecastSnapshot = {
      available,
      now: {
        skyType: liveSkyType(scalar(frame, 'Skies'), rain),
        airTempC,
        rain: rainRounded,
        airTempTrend: stepTrend(this.airTempTrend, airTempC, time),
        rainTrend: stepTrend(this.rainTrend, rainRounded, time),
      },
      nodes: available
        ? this.comingNodes(
            frame,
            nodes,
            time,
            endTime === null || sessionNum === null
              ? null
              : forecastScheduleLength({
                  sessionNum,
                  endTime,
                  timeTotal: scalar(frame, 'SessionTimeTotal'),
                  raceTime: this.raceTime,
                }),
            lapsTotal
          )
        : [],
      lapLimited: endTime === null && lapsTotal !== null,
      sessionNum,
      version: this.latest.version,
    };
    if (sameSnapshot(this.latest, next)) return;
    next.version += 1;
    this.latest = next;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // LMU has no replay source and iRacing no forecast, so there is nothing
    // to switch off on 'enter'.
    if (event.type === 'enter') return;
    this.clearSessionState();
    if (event.type === 'disconnect') {
      // The session went with the connection, and its forecast with it.
      this.forecast = undefined;
      this.raceTime = undefined;
      this.latest = emptySnapshot(this.latest.version + 1);
      return;
    }
    // The next frame picks the new session's forecast.
    this.latest = {
      ...this.latest,
      now: { ...this.latest.now, airTempTrend: 0, rainTrend: 0 },
      nodes: [],
      version: this.latest.version + 1,
    };
  }

  snapshot(): WeatherForecastSnapshot {
    return this.latest;
  }

  private clearSessionState(): void {
    Object.assign(this.airTempTrend, newTrend());
    Object.assign(this.rainTrend, newTrend());
    this.clockTimes.fill(null);
  }

  /** The points after START that have not begun, soonest first. */
  private comingNodes(
    frame: Telemetry,
    forecast: readonly LmuWeatherNode[],
    time: number,
    /** What the points are spread over, s; null in a session with no end. */
    length: number | null,
    lapsTotal: number | null
  ): WeatherForecastNode[] {
    const timeOfDay = scalar(frame, 'SessionTimeOfDay');
    const timeScale = this.timeScale();
    // Only a race on laps, with no end time, is followed by the leader.
    const progress =
      length === null && lapsTotal !== null
        ? this.leaderProgress(frame) / lapsTotal
        : null;

    const coming: WeatherForecastNode[] = [];
    for (let index = 1; index < FORECAST_NODE_COUNT; index += 1) {
      const node = forecast[index];
      let startsInMinutes: number | null = null;
      let startsAtTimeOfDay: number | null = null;

      if (length !== null) {
        const secondsAway = node.start * length - time;
        if (secondsAway <= 0) {
          this.clockTimes[index] = null;
          continue;
        }
        startsInMinutes = Math.floor(secondsAway / 60);
        startsAtTimeOfDay = this.clockTime(
          index,
          timeOfDay === undefined || timeScale === undefined
            ? null
            : timeOfDay + secondsAway * timeScale
        );
      } else if (progress !== null && progress >= node.start) {
        continue;
      }

      coming.push({
        index,
        skyType: node.skyType,
        airTempC: node.temperature,
        rainChance: node.rainChance,
        humidity: node.humidity ?? null,
        windSpeedMs: node.windSpeed ?? null,
        windDirectionRad:
          node.windDirection === undefined
            ? null
            : node.windDirection * WIND_DIRECTION_STEP_RAD,
        startsInMinutes,
        startsAtTimeOfDay,
      });
    }
    return coming;
  }

  /** The clock time to publish for a point: the one held, unless it moved. */
  private clockTime(index: number, fresh: number | null): number | null {
    if (fresh === null) {
      this.clockTimes[index] = null;
      return null;
    }
    const held = this.clockTimes[index];
    if (held === null || clockDistance(held, fresh) > 60) {
      const wrapped =
        ((fresh % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      this.clockTimes[index] =
        (Math.round(wrapped / 60) * 60) % SECONDS_PER_DAY;
    }
    return this.clockTimes[index];
  }

  /** Laps the leading car has covered, the lap in progress included. */
  private leaderProgress(frame: Telemetry): number {
    const laps = values(frame, 'CarIdxLapCompleted');
    const fractions = values(frame, 'CarIdxLapDistPct');
    if (!laps) return 0;
    let furthest = 0;
    for (let carIdx = 0; carIdx < laps.length; carIdx += 1) {
      const completed = finite(laps[carIdx]);
      // A slot with no car reads -1.
      if (completed === undefined || completed < 0) continue;
      const fraction = finite(fractions?.[carIdx]);
      const covered =
        completed + (fraction !== undefined && fraction > 0 ? fraction : 0);
      if (covered > furthest) furthest = covered;
    }
    return furthest;
  }
}
