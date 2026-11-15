/** Falling, steady, rising. */
export type WeatherTrend = -1 | 0 | 1;

/**
 * No sky reading: the sim published neither cloud cover nor rain. A sky type
 * outside 0..10 is drawn as unknown, and this is the one the processor uses.
 */
export const WEATHER_SKY_UNKNOWN = -1;

/** One coming point of Le Mans Ultimate's forecast for the running session. */
export interface WeatherForecastNode {
  /** Position in LMU's schedule: 1 = NODE_25, 2 = NODE_50, 3 = NODE_75, 4 = FINISH. */
  index: number;
  /** LMU sky type 0..10. */
  skyType: number;
  /** Celsius. */
  airTempC: number;
  /** 0..1. */
  rainChance: number;
  /** 0..1; null when the forecast carries none. */
  humidity: number | null;
  /** m/s; null when the forecast carries none. */
  windSpeedMs: number | null;
  /**
   * Compass radians the wind blows from, 0 = north, clockwise; null when
   * unknown. Read off LMU's index of eight directions, whose meaning is
   * inferred from two samples (6 is worded "West", 7 "North West").
   */
  windDirectionRad: number | null;
  /**
   * Whole real minutes until the node starts, 0 = under a minute; null in a
   * session with no end time, where there is nothing to count against.
   *
   * An estimate, not a reading: the sim publishes no times for its forecast.
   * The five points are placed at fifths of the session's length from the
   * zero of the session clock, which was measured in one dry race at a time
   * scale of 1 and is assumed elsewhere. See forecastScheduleLength.
   */
  startsInMinutes: number | null;
  /**
   * In-game clock when it starts, seconds since midnight, to the minute; null
   * when the time scale is unknown or there are no minutes. As much an
   * estimate as `startsInMinutes`, from which it follows.
   */
  startsAtTimeOfDay: number | null;
}

/**
 * The weather now and LMU's forecast for the rest of the session.
 *
 * Le Mans Ultimate only: iRacing publishes the weather as it is and no
 * forecast.
 */
export interface WeatherForecastSnapshot {
  /** False until the forecast for this session type has arrived. */
  available: boolean;
  now: {
    /**
     * LMU sky type 0..10, derived from cloud cover and rain;
     * WEATHER_SKY_UNKNOWN when the sim publishes neither.
     */
    skyType: number;
    /** Celsius, to a tenth. */
    airTempC: number | null;
    /** Rain intensity 0..1, to a hundredth. */
    rain: number | null;
    airTempTrend: WeatherTrend;
    rainTrend: WeatherTrend;
  };
  /** Nodes still to come, soonest first; at most four. */
  nodes: readonly WeatherForecastNode[];
  /** True when the race ends on laps with no end time, so no minutes exist. */
  lapLimited: boolean;
  sessionNum: number | null;
  version: number;
}
