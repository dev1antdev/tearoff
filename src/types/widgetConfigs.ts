import type { DashboardWidget } from './dashboardLayout';
import type { GantryPitStopsConfig } from './gantryPitStops';
import type { CornerNameOverlayConfig } from './cornerName';
import type { FlagPanelConfig } from './flagPanel';
import type { TrafficConfig } from './traffic';
import type { LapTraceColors, LapTraceSound, LapTraceSource } from './lapTrace';
import type { LmuBadgeFormat } from './lmu';

// ===========================
// Shared primitive types
// ===========================

export interface SessionVisibilitySettings {
  race: boolean;
  loneQualify: boolean;
  openQualify: boolean;
  practice: boolean;
  offlineTesting: boolean;
  /** Optional: only widgets that offer it save it; unset shows the widget. */
  warmup?: boolean;
}

export type TimeFormat =
  | 'full'
  | 'mixed'
  | 'minutes'
  | 'seconds-full'
  | 'seconds-2'
  | 'seconds-mixed'
  | 'seconds';

export type NameFormat =
  | 'name-middlename-surname'
  | 'name-m.-surname'
  | 'name-surname'
  | 'n.-surname'
  | 'surname-n.'
  | 'surname';

export type TemperatureUnit = 'Metric' | 'Imperial';

/** How the session bar writes the in-game clock. */
export type TrackClockFormat = 'locale' | '24h' | '12h';

/**
 * When the session bar shows the in-game day's speed beside the clock: only
 * when it is not real time, always, or never.
 */
export type TrackClockTimeScaleDisplay = 'whenScaled' | 'always' | 'never';

// ===========================
// Shared widget config sub-types
// ===========================

export interface DriverNameConfig {
  enabled: boolean;
  showStatusBadges: boolean;
  removeNumbersFromName: boolean;
  nameFormat?: NameFormat;
}

export interface PitStatusConfig {
  enabled: boolean;
  showPitTime?: boolean;
  pitLapDisplayMode: 'lastPitLap' | 'lapsSinceLastPit';
}

export interface SessionBarConfig {
  enabled: boolean;
  sessionName: { enabled: boolean };
  sessionTime: {
    enabled: boolean;
    mode: 'Remaining' | 'Elapsed';
    totalFormat?: 'hh:mm' | 'minimal';
    labelStyle?: 'none' | 'short' | 'minimal';
  };
  sessionLaps: {
    enabled: boolean;
    mode?: 'Elapsed' | 'Remaining';
    /**
     * 'lap' is the lap number against the race distance: "L3 / 11.6".
     * 'progress' is the laps done with the share of the lap under way,
     * against the car's own distance at the flag: "2.72 / ~10.3".
     */
    format?: 'lap' | 'progress';
    /** The "+1" or "-1" behind the projection. Progress format only. */
    showExtraLaps?: boolean;
  };
  incidentCount: { enabled: boolean };
  brakeBias: { enabled: boolean };
  localTime: { enabled: boolean };
  /** The in-game clock. Every option is optional: unset is the default. */
  sessionClockTime: {
    enabled: boolean;
    /** 'locale' follows the system's own clock format. */
    format?: TrackClockFormat;
    /** When to show how fast the in-game day runs, as "x2". */
    timeScale?: TrackClockTimeScaleDisplay;
    /**
     * Counts down to the next of sunrise, midday, sunset and midnight, from
     * the sunrise and sunset kept for the track. Off unless set; and nothing
     * is drawn for a track that has neither.
     */
    sunPhase?: boolean;
    /** Counts that in in-game time instead of real time. */
    sunPhaseInGameTime?: boolean;
  };
  trackWetness: { enabled: boolean };
  precipitation?: { enabled: boolean };
  humidity?: { enabled: boolean };
  airTemperature: { enabled: boolean; unit: TemperatureUnit };
  trackTemperature: { enabled: boolean; unit: TemperatureUnit };
  wind?: { enabled: boolean; speedPosition?: 'left' | 'right' };
  trackName: { enabled: boolean };
  fuelLevel?: { enabled: boolean };
  lastLap?: { enabled: boolean };
  bestLap?: { enabled: boolean };
  topSpeed?: { enabled: boolean };
  manufacturerPosition?: {
    enabled: boolean;
    hideIfSingleMake?: boolean;
    hideIfSingleDriver?: boolean;
  };
  classRank?: { enabled: boolean };
  /** Overall place against the field: "P26/38". */
  position?: { enabled: boolean };
  /** Places gained or lost since the grid. Race only. */
  positionChange?: {
    enabled: boolean;
    /** Which grid the change is measured on. Class unless stated. */
    scope?: 'class' | 'overall';
  };
  /** LMU's track-limits penalty points for the player. */
  trackLimits?: { enabled: boolean };
  displayOrder: string[];
  foreground?: { opacity: number };
}

// ===========================
// Styling option types
// ===========================

export interface StylingOptions {
  badge?: boolean;
  statusBadges?: boolean;
  columnHeaders?: { enabled: boolean };
  driverPosition?: { background?: boolean };
  driverNumber?: { background?: boolean; border?: boolean };
  lapCount?: { minimal?: boolean };
  flagContour?: {
    enabled?: boolean;
    borderWidth?: number;
  };
}

export interface ClassHeaderStyle {
  className?: { colorBackground?: boolean };
  classInfo?: { colorBackground?: boolean };
  classDivider?: { bottomBorder?: boolean };
  compactSof?: boolean;
  manufacturerStats?: {
    enabled: boolean;
    cap: number | null; // null = All
    showPlayerManufacturer: boolean;
  };
  estimatedLaps?: { enabled: boolean; numLaps?: number };
}

// ===========================
// Badge format types
// ===========================

export type StandingsBadgeFormat =
  | 'license-color-fullrating-combo'
  | 'fullrating-color-no-license'
  | 'rating-color-no-license'
  | 'license-color-fullrating-bw'
  | 'license-color-rating-bw'
  | 'rating-only-color-rating-bw'
  | 'license-color-rating-bw-no-license'
  | 'license-bw-rating-bw'
  | 'rating-only-bw-rating-bw'
  | 'license-bw-rating-bw-no-license'
  | 'rating-bw-no-license'
  | 'fullrating-bw-no-license';

export type RelativeBadgeFormat =
  | 'license-color-fullrating-combo'
  | 'fullrating-color-no-license'
  | 'license-color-fullrating-bw'
  | 'license-color-rating-bw'
  | 'license-color-rating-bw-no-license'
  | 'rating-color-no-license'
  | 'license-bw-rating-bw'
  | 'rating-only-bw-rating-bw'
  | 'license-bw-rating-bw-no-license'
  | 'rating-bw-no-license'
  | 'fullrating-bw-no-license';

// ===========================
// Widget config types
// ===========================

/** The last-lap column of the standings, the relative and the battle rows. */
export interface LastTimeColumnConfig {
  enabled: boolean;
  timeFormat: TimeFormat;
  /**
   * Mark a last lap the sim did not time. On unless switched off; optional
   * so configs written before it need no change.
   */
  markInvalid?: boolean;
}

/**
 * Which laps the Avg 5 and Avg 10 columns are taken from.
 *
 * 'clean' is `cleanLapTimeHistory` of `lap-times.snapshot`: the laps the app
 * watched from line to line with the car never on pit road. 'all' is every
 * lap that has a time, pit laps included.
 */
export type LapAverageLaps = 'clean' | 'all';

/** A column averaging a car's last laps: Avg 5 and Avg 10. */
export interface LapAverageColumnConfig {
  enabled: boolean;
  timeFormat: TimeFormat;
}

export interface StandingsConfig {
  customClassOrdering: boolean;
  iratingChange: { enabled: boolean; estimateInPractice?: boolean };
  positionChange: { enabled: boolean };
  /**
   * The LMU achievement badge, as its own column.
   *
   * Separate from `badge`, which is the rank pair: this is the single marker
   * the rating service reports in `profile.badge` (`sr-saint` and the like),
   * and it is drawn from bundled artwork. Absent on every other sim, so the
   * column simply renders nothing there.
   */
  lmuBadge: { enabled: boolean };
  badge: {
    enabled: boolean;
    badgeFormat: StandingsBadgeFormat;
    /** How the LMU rank pair is drawn; see LmuBadgeFormat. */
    lmuFormat?: LmuBadgeFormat;
  };
  delta: { enabled: boolean };
  gap: {
    enabled: boolean;
    decimalPlaces?: number;
    reference?: 'classLeader' | 'player';
  };
  interval: {
    enabled: boolean;
    decimalPlaces?: number;
    displayMode?: 'time' | 'laps';
  };
  lastTime: LastTimeColumnConfig;
  fastestTime: { enabled: boolean; timeFormat: TimeFormat };
  background: { opacity: number };
  foreground?: { opacity: number };
  driverRow?: { opacity: number };
  countryFlags: { enabled: boolean };
  carNumber: { enabled: boolean };
  driverStandings: {
    buffer: number;
    numNonClassDrivers: number;
    minPlayerClassDrivers: number;
    numTopDrivers: number;
    topDriverDivider?: 'none' | 'theme' | 'highlight';
    /** Lists every driver instead of the slice around the player. */
    showAll?: boolean;
  };
  compound: { enabled: boolean };
  carManufacturer: { enabled: boolean; hideIfSingleMake?: boolean };
  radio?: { persistenceSeconds: number };
  lapTimeDeltas: { enabled: boolean; numLaps: number; decimalPlaces: number };
  avgLapTime: AverageLapTimeConfig;
  /** The average of the car's last 5 laps; nothing until it has 5. */
  avgLast5: LapAverageColumnConfig;
  /** The average of the car's last 10 laps; nothing until it has 10. */
  avgLast10: LapAverageColumnConfig;
  /** Which laps those two columns count. */
  averagesOver: LapAverageLaps;
  lapCount: { enabled: boolean };
  /** LMU's track-limits penalty points. Absent on sims without them. */
  trackLimits: { enabled: boolean };
  /**
   * LMU's remaining virtual energy, or fuel for a car without it.
   * Absent on sims with neither.
   */
  lmuVirtualEnergy: { enabled: boolean };
  titleBar: { enabled: boolean; progressBar: { enabled: boolean } };
  headerBar: SessionBarConfig;
  footerBar: SessionBarConfig;
  showOnlyWhenOnTrack: boolean;
  useLivePosition?: boolean;
  position: { enabled: boolean };
  driverName: DriverNameConfig & { subtext?: 'none' | 'teamName' };
  teamName: { enabled: boolean; subtext?: 'none' | 'driverName' };
  pitStatus: PitStatusConfig;
  pushToPass: { enabled: boolean };
  driverTag: { enabled: boolean; widthPx?: number };
  displayOrder: string[];
  sessionVisibility: SessionVisibilitySettings;
  stylingOptions?: StylingOptions;
  classHeaderStyle?: ClassHeaderStyle;
}

export interface AverageLapTimeConfig {
  enabled: boolean;
  numLaps: number;
  timeFormat: TimeFormat;
  excludePitLaps?: boolean;
}

export interface RelativeConfig {
  buffer: number;
  background: { opacity: number };
  foreground?: { opacity: number };
  countryFlags: { enabled: boolean };
  carNumber: { enabled: boolean };
  lastTime: LastTimeColumnConfig;
  fastestTime: { enabled: boolean; timeFormat: TimeFormat };
  compound: { enabled: boolean };
  carManufacturer: { enabled: boolean; hideIfSingleMake?: boolean };
  radio?: { persistenceSeconds: number };
  titleBar: { enabled: boolean; progressBar: { enabled: boolean } };
  headerBar: SessionBarConfig;
  footerBar: SessionBarConfig;
  showOnlyWhenOnTrack: boolean;
  /**
   * Hides drivers sitting in their pit stall (TrackLocation.InPitStall) so they
   * stop scrolling through the relative while being serviced or waiting for
   * repairs. Drivers driving down pit road (entering or exiting) still show.
   */
  hideDriversInPitStall?: boolean;
  /**
   * The LMU achievement badge, as its own column.
   *
   * Separate from `badge`, which is the rank pair: this is the single marker
   * the rating service reports in `profile.badge` (`sr-saint` and the like),
   * and it is drawn from bundled artwork. Absent on every other sim, so the
   * column simply renders nothing there.
   */
  lmuBadge: { enabled: boolean };
  badge: {
    enabled: boolean;
    badgeFormat: RelativeBadgeFormat;
    /** How the LMU rank pair is drawn; see LmuBadgeFormat. */
    lmuFormat?: LmuBadgeFormat;
  };
  iratingChange: { enabled: boolean };
  positionChange?: { enabled: boolean };
  delta: { enabled: boolean; precision: number };
  position: { enabled: boolean };
  driverName: DriverNameConfig;
  teamName: { enabled: boolean };
  pitStatus: PitStatusConfig;
  pushToPass: { enabled: boolean };
  driverTag: { enabled: boolean; widthPx?: number };
  lapTimeDeltas: { enabled: boolean; numLaps: number; decimalPlaces: number };
  avgLapTime: AverageLapTimeConfig;
  /** The average of the car's last 5 laps; nothing until it has 5. */
  avgLast5: LapAverageColumnConfig;
  /** The average of the car's last 10 laps; nothing until it has 10. */
  avgLast10: LapAverageColumnConfig;
  /** Which laps those two columns count. */
  averagesOver: LapAverageLaps;
  /** LMU's track-limits penalty points. Absent on sims without them. */
  trackLimits: { enabled: boolean };
  /**
   * LMU's remaining virtual energy, or fuel for a car without it.
   * Absent on sims with neither.
   */
  lmuVirtualEnergy: { enabled: boolean };
  displayOrder: string[];
  useLivePosition?: boolean;
  sessionVisibility: SessionVisibilitySettings;
  stylingOptions?: StylingOptions;
}

export interface WeatherConfig {
  background: { opacity: number };
  layout?: 'vertical' | 'horizontal';
  horizontalMode?: 'compact' | 'full';
  displayOrder: string[];
  showOnlyWhenOnTrack?: boolean;
  airTemp: { enabled: boolean };
  trackTemp: { enabled: boolean };
  humidity: { enabled: boolean };
  wetness: { enabled: boolean };
  trackState: { enabled: boolean };
  precipitation: { enabled: boolean };
  wind: { enabled: boolean };
  units: 'auto' | 'Metric' | 'Imperial';
  sessionVisibility: SessionVisibilitySettings;
}

export interface WindConfig {
  background: { opacity: number };
  units: 'auto' | 'Metric' | 'Imperial';
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

/**
 * The weather now and the points of Le Mans Ultimate's forecast still to
 * come, as a row of columns.
 */
export interface WeatherForecastConfig {
  background: { opacity: number };
  /** Forecast columns after "Now", 1 to 4. */
  nodes: number;
  /** The live weather as the first column. */
  showNow: boolean;
  /** Right to left. */
  reverse: boolean;
  /**
   * What heads a forecast column: the minutes until it starts, or the
   * in-game clock time it starts at. Both are estimates, and drawn as such.
   */
  timeLabel: 'countdown' | 'clock';
  /** Temperature and wind speed units; 'auto' follows the sim. */
  units: 'auto' | 'Metric' | 'Imperial';
  temperature: { enabled: boolean };
  rainChance: { enabled: boolean; showValue: boolean };
  humidity: { enabled: boolean };
  /** The forecast's wind, which LMU does not apply on track. */
  wind: { enabled: boolean };
  /** Arrows in the "Now" column for a temperature or rain on the move. */
  trend: { enabled: boolean };
  /** Leave out a column the forecast has no point for. */
  hideEmptyColumns: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface TrackMapConfig {
  turnLabels: {
    enabled: boolean;
    labelType: 'names' | 'numbers' | 'both';
    highContrast: boolean;
    labelFontSize: number;
  };
  showCarNumbers: boolean;
  displayMode?: 'carNumber' | 'sessionPosition' | 'livePosition';
  invertTrackColors: boolean;
  driverCircleSize: number;
  playerCircleSize: number;
  trackmapFontSize: number;
  trackLineWidth: number;
  trackOutlineWidth: number;
  useHighlightColor: boolean;
  invertLeaderColor: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
  styling?: { isMinimalTrack?: boolean; isMinimalCar?: boolean };
  sectorColoring?: {
    enabled: boolean;
  };
  playerIcon?: { enabled: boolean; fileName: string };
}

export interface FlatTrackMapConfig {
  showCarNumbers: boolean;
  displayMode: 'carNumber' | 'sessionPosition' | 'livePosition';
  driverCircleSize: number;
  playerCircleSize: number;
  trackmapFontSize: number;
  trackLineWidth: number;
  trackOutlineWidth: number;
  invertTrackColors: boolean;
  useHighlightColor: boolean;
  invertLeaderColor: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface SteerConfig {
  style: 'formula' | 'lmp' | 'nascar' | 'ushape' | 'default' | 'ring';
  color: 'dark' | 'light';
}

export interface InputConfig {
  /**
   * The input source, kept as the boolean it has always been stored as:
   * false is Car, what the car receives after traction control, ABS and
   * shift cuts; true is Pedals, the raw pedal position. Where the chosen
   * source has no value the other one is shown.
   */
  useRawValues: boolean;
  trace: {
    enabled: boolean;
    includeThrottle: boolean;
    includeBrake: boolean;
    includeClutch: boolean;
    includeAbs: boolean;
    /** Mark the throttle curve while traction control is cutting. Default true. */
    includeTc?: boolean;
    /**
     * How ABS and traction control are marked: 'overlay' draws a wider stroke
     * on top of the pedal's curve; 'bar' fills the area under the curve to y=0
     */
    absStyle?: 'overlay' | 'bar';
    includeSteer?: boolean;
    strokeWidth?: number;
    maxSamples?: number;
  };
  bar: {
    enabled: boolean;
    includeClutch: boolean;
    includeBrake: boolean;
    includeThrottle: boolean;
    includeAbs: boolean;
    /** Mark the throttle bar while traction control is cutting. Default true. */
    includeTc?: boolean;
    /**
     * Draw each pedal as a narrow strip of pedal travel beside a wide strip
     * of what the car received, whatever the input source. Default false.
     */
    dual?: boolean;
    /**
     * With `dual`: the brake's wide strip shows the brake line pressure
     * instead of the brake the car received. Default false.
     */
    brakeFromPressure?: boolean;
    /** A cap above each pedal bar, lit at full pedal travel. Default true. */
    showMaxMarker?: boolean;
    /** A fourth bar: the size of the force feedback. Default false. */
    includeFfb?: boolean;
  };
  gear: {
    enabled: boolean;
    size: number;
    unit: 'mph' | 'km/h' | 'auto';
    showspeed: boolean;
    showspeedunit: boolean;
    /** Swap the speed number and the km/h unit (order + emphasis). Default false. */
    swapSpeedUnit?: boolean;
  };
  abs: { enabled: boolean };
  steer: {
    enabled: boolean;
    config: SteerConfig;
    /**
     * When the wheel shows its angle in degrees. `beyond270`, the default,
     * shows it only past 270 degrees either way.
     */
    angleReadout?: 'beyond270' | 'always' | 'never';
    /**
     * An arc from 12 o'clock sweeping by the steering angle; `stationary`
     * draws it below 1 m/s. Default `never`.
     */
    rotationArc?: 'never' | 'stationary' | 'always';
    /**
     * The wheel's lock-to-lock rotation in degrees, for a wheel whose range
     * the sim gets wrong; 0, the default, uses the sim's.
     */
    rangeDeg?: number;
    /**
     * Le Mans Ultimate: the front wheel angle and the steering ratio as two
     * small numbers under the wheel. Default false.
     */
    showWheelAngle?: boolean;
  };
  /**
   * The `steermeter` layout element: a horizontal bar filling from the centre
   * toward the steered side.
   */
  steerMeter?: {
    enabled: boolean;
    /** Spacing of the scale marks, degrees of wheel angle. */
    markDeg: number;
    /** Whole degrees at the steered end. */
    showAngle: boolean;
  };
  background: { opacity: number };
  displayOrder: string[];
  /** When set, decides which elements show and where. Supersedes the enabled flags and displayOrder. */
  layoutTree?: LayoutNode;
  /** Briefly flash the gear number on an upshift or downshift. */
  gearFlash?: {
    enabled: boolean;
    upColor: string;
    downColor: string;
  };
  /** Flash the whole layout at the redline or at the Tachometer custom shift points. */
  shiftFlash?: {
    enabled: boolean;
    source: 'redline' | 'shiftPoints';
    color: string;
  };
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface TachometerConfig {
  showRpmText: boolean;
  rpmOrientation?: 'horizontal' | 'bottom' | 'top';
  shiftPointStyle?: 'glow' | 'pulse' | 'border';
  shiftPointSettings: {
    enabled: boolean;
    indicatorType: 'glow' | 'pulse' | 'border';
    indicatorColor: string;
    carConfigs: Record<
      string,
      {
        enabled: boolean;
        carId: string;
        carName: string;
        gearCount: number;
        redlineRpm: number;
        gearShiftPoints: Record<string, { shiftRpm: number }>;
      }
    >;
  };
  oilTemp?: {
    enabled: boolean;
    position: 'top' | 'bottom';
    /** 0-100: slide the oil box from the edge toward the centre. */
    edgeOffset?: number;
  };
  waterTemp?: {
    enabled: boolean;
    position: 'top' | 'bottom';
    /** 0-100: slide the water box from the edge toward the centre. */
    edgeOffset?: number;
  };
  /**
   * Shared layout for the oil/water temperature boxes.
   * `swapSides` flips which side each box sits on (default: oil left, water right).
   */
  tempLayout?: { swapSides: boolean };
  background: { opacity: number };
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}
export interface ShiftLightConfig {
  showRpmText: boolean;
  shiftPointStyle?: 'glow' | 'pulse' | 'border';
  shiftPointSettings: {
    enabled: boolean;
    indicatorType: 'glow' | 'pulse' | 'border';
    indicatorColor: string;
    carConfigs: Record<
      string,
      {
        enabled: boolean;
        carId: string;
        carName: string;
        gearCount: number;
        redlineRpm: number;
        gearShiftPoints: Record<string, { shiftRpm: number }>;
      }
    >;
  };
  background: { opacity: number };
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export type LayoutDirection = 'row' | 'col';

export type LayoutNode =
  | {
      id: string;
      type: 'box';
      widgets: string[];
      direction: LayoutDirection;
      weight?: number;
    }
  | {
      id: string;
      type: 'split';
      direction: LayoutDirection;
      children: LayoutNode[];
      weight?: number;
    };

export interface BoxConfig {
  id: string;
  flow?: 'vertical' | 'horizontal';
  width?: '1/1' | '1/2' | '1/3' | '1/4';
  widgets: string[];
}

export interface FuelConfig {
  showOnlyWhenOnTrack: boolean;
  fuelUnits: 'L' | 'gal';
  layout: 'vertical' | 'horizontal';
  showConsumption: boolean;
  showFuelLevel: boolean;
  showLapsRemaining: boolean;
  showMin: boolean;
  showCurrentLap: boolean;
  showQualifyConsumption?: boolean;
  showLastLap: boolean;
  show3LapAvg: boolean;
  show10LapAvg: boolean;
  showMax: boolean;
  showPitWindow: boolean;
  showEnduranceStrategy: boolean;
  showFuelScenarios: boolean;
  showFuelRequired: boolean;
  showFuelHistory: boolean;
  fuelHistoryType: 'line' | 'histogram' | 'table';
  /** Number of completed laps shown in the history table. */
  fuelHistoryLapCount?: number;
  safetyMargin: number;
  manualTarget?: number;
  background: { opacity: number };
  fuelRequiredMode: 'toFinish' | 'toAdd';
  enableTargetPitLap?: boolean;
  targetPitLap?: number;
  targetPitLapBasis?: 'avg' | 'avg10' | 'last' | 'max' | 'min' | 'qual';
  economyPredictMode?: 'live' | 'endOfLap';
  useGeneralFontSize?: boolean;
  useGeneralCompactMode?: boolean;
  sessionVisibility: SessionVisibilitySettings;
  layoutConfig?: BoxConfig[];
  layoutTree?: LayoutNode;
  widgetStyles?: Record<
    string,
    {
      fontSize?: number;
      labelFontSize?: number;
      valueFontSize?: number;
      barFontSize?: number;
      height?: number;
    }
  >;
  consumptionGridOrder?: string[];
  fuelStatusThresholds?: { green: number; amber: number; red: number };
  fuelStatusBasis?: 'last' | 'avg' | 'min' | 'max';
  fuelStatusRedLaps?: number;
  avgLapsCount?: number;
  enableStorage?: boolean;
  enableLogging?: boolean;
  showFuelStatusBorder?: boolean;
}

export interface BlindSpotMonitorConfig {
  showOnlyWhenOnTrack?: boolean;
  background?: { opacity: number };
  distAhead: number;
  distBehind: number;
  width?: number;
  borderSize?: number;
  indicatorColor?: number;
  sessionVisibility: SessionVisibilitySettings;
  displayMode?: 'standard' | 'simple';
  simpleSize?: number;
  simpleVerticalPosition?: number;
  simpleShowCount?: boolean;
  thresholdColorsEnabled?: boolean;
  thresholdColor1?: number;
  thresholdColor2?: number;
}

/**
 * How a warning marks the rim: a solid arc, three segments that light up
 * with urgency, a soft glow inward from the rim, or a wedge from our car.
 */
export const RADAR_ARC_STYLES = ['arc', 'segments', 'glow', 'sector'] as const;
export type RadarArcStyle = (typeof RADAR_ARC_STYLES)[number];

/** Where along our car a rival must reach to be owed room. */
export const RADAR_OVERLAP_THRESHOLDS = [
  'rearWheel',
  'door',
  'frontWheel',
] as const;
export type RadarOverlapThreshold = (typeof RADAR_OVERLAP_THRESHOLDS)[number];

export const RADAR_RIVAL_COLOR_MODES = ['safety', 'class', 'custom'] as const;

export interface RadarConfig {
  /** Metres from the centre to the edge of the disc. */
  range: number;
  /** Keep the radar off screen while no rival is near. */
  autoHide: boolean;
  /** Metres; a rival this close brings the radar on screen. */
  showDistance: number;
  /**
   * Metres; the radar leaves once every rival is further than this. Kept
   * above `showDistance` so a car sitting on the threshold cannot make it
   * blink.
   */
  hideDistance: number;
  /** Seconds the fade in and out takes. */
  fadeSeconds: number;
  /**
   * Car body size in metres; the SDK reports none. Used for every car when
   * `sizeByClass` is off, and for unknown classes when it is on.
   */
  carLength: number;
  carWidth: number;
  /** Size cars by class: saved overrides, then typical sizes per class. */
  sizeByClass: boolean;
  /** Per-class size overrides keyed by CarClassShortName. */
  classSizes: Record<string, { length: number; width: number }>;
  /** Rim arcs and outlines for close and alongside rivals. */
  showWarnings: boolean;
  /** The rim arc of a close or alongside rival; off leaves the outline. */
  warningArcs: boolean;
  warningArcStyle: RadarArcStyle;
  /** Metres of bumper gap below which a rival is drawn as close. */
  cautionDistance: number;
  /** Write the bumper gap next to a close rival. */
  showGapLabel: boolean;
  showCarNumbers: boolean;
  /** Draw the road under the cars. */
  showTrackMap: boolean;
  /** Drawn road width in metres; the drawings carry no width. */
  trackWidth: number;
  /** Road opacity, 0-100. */
  mapOpacity: number;
  showRings: boolean;
  /** Metres between distance rings. */
  ringSpacing: number;
  /** Hide cars on pit road while we are on track, and the reverse. */
  hideInPit: boolean;
  /** Keep the radar off screen while our car sits in its pit box. */
  hideInPitBox: boolean;
  /**
   * Rival fill: their licence colour as on the rating badge, their class
   * colour, or one colour for everyone.
   */
  rivalColorMode: (typeof RADAR_RIVAL_COLOR_MODES)[number];
  /** Colour for `custom`; null picks a paler shade of `playerColor`. */
  rivalCustomColor: number | null;
  playerColor: number;
  background: { opacity: number };
  /** Share of the radius, 0-100, over which the radar fades out at the rim. */
  edgeFade: number;
  /** Dashed lines through our car, ahead/behind and left/right. */
  showCrosshair: boolean;
  /** Run the dashes of the line ahead/behind past at our speed. */
  axisMotion: boolean;
  /** Metres of each dash on the moving line; the gaps are twice as long. */
  axisDashLength: number;
  /** Speed of the moving dashes, % of our own. */
  axisSpeed: number;
  closeColor: number;
  alongsideColor: number;
  /** Pulses per second on cars alongside; 0 keeps them steady. */
  pulseHz: number;
  /**
   * Degrees either side of the bearing the arc of a close or alongside car
   * spans, at least/most.
   */
  arcMinDeg: number;
  arcMaxDeg: number;
  /** Thickness of every rim arc, % of the radius. */
  arcThickness: number;
  /**
   * A strip along the side a rival is on, showing how far along our car it
   * reaches (or how far along its car we reach when we attack).
   */
  showOverlap: boolean;
  /** How far alongside counts as owed room: the strip turns red from there. */
  overlapThreshold: RadarOverlapThreshold;
  /** Write the overlap in per cent next to the strip. */
  overlapShowPercent: boolean;
  /** Warn early about a car coming up fast from behind and diving in. */
  showDiveWarning: boolean;
  /** Closing speed in km/h below which a car behind is no worry. */
  diveMinClosingKmh: number;
  /** Seconds to our side under which a fast car turns into a dive warning. */
  diveWarnSeconds: number;
  /** Draw where a diving car will be shortly, as a dashed outline. */
  diveGhost: boolean;
  /** Write the closing speed (and time to our side) next to a fast car. */
  diveShowClosing: boolean;
  /** The rim arc of a car coming up fast or diving in. */
  diveArcs: boolean;
  diveArcStyle: RadarArcStyle;
  diveArcMinDeg: number;
  diveArcMaxDeg: number;
  /** Mark cars ahead that crashed, crawl, left the track or are rejoining. */
  showHazards: boolean;
  /** Metres ahead a hazard is shown from. */
  hazardRange: number;
  /** Metres under which the hazard marker flashes. */
  hazardBlinkDistance: number;
  hazardCrash: boolean;
  hazardSlow: boolean;
  /** Cars off the track, and coming back on. */
  hazardOff: boolean;
  /** Write what happened (CRASH, SLOW, OFF, REJOIN) before the distance. */
  hazardShowLabel: boolean;
  /** Write the hazard car's speed under its distance. */
  hazardShowSpeed: boolean;
  /** The rim arc under a hazard's triangle. */
  hazardArcs: boolean;
  hazardArcStyle: RadarArcStyle;
  /** Half-span of a hazard's arc far off and right at the rim, degrees. */
  hazardArcMinDeg: number;
  hazardArcMaxDeg: number;
  /** Switch to `ovalProfile` on oval tracks. */
  autoProfile: boolean;
  /** Look and distances for ovals; null until the oval profile is edited. */
  ovalProfile: Partial<RadarProfileConfig> | null;
  tuning: RadarTuning;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

/** Settings that the road and oval profiles each keep their own copy of. */
export const RADAR_PROFILE_KEYS = [
  'range',
  'autoHide',
  'showDistance',
  'hideDistance',
  'fadeSeconds',
  'showWarnings',
  'warningArcs',
  'warningArcStyle',
  'cautionDistance',
  'showGapLabel',
  'showCarNumbers',
  'showTrackMap',
  'trackWidth',
  'mapOpacity',
  'showRings',
  'ringSpacing',
  'showCrosshair',
  'axisMotion',
  'axisDashLength',
  'axisSpeed',
  'rivalColorMode',
  'rivalCustomColor',
  'playerColor',
  'background',
  'edgeFade',
  'closeColor',
  'alongsideColor',
  'pulseHz',
  'arcMinDeg',
  'arcMaxDeg',
  'arcThickness',
  'showOverlap',
  'overlapThreshold',
  'overlapShowPercent',
  'showDiveWarning',
  'diveMinClosingKmh',
  'diveWarnSeconds',
  'diveGhost',
  'diveShowClosing',
  'diveArcs',
  'diveArcStyle',
  'diveArcMinDeg',
  'diveArcMaxDeg',
  'showHazards',
  'hazardRange',
  'hazardBlinkDistance',
  'hazardArcs',
  'hazardArcStyle',
  'hazardArcMinDeg',
  'hazardArcMaxDeg',
] as const satisfies readonly (keyof RadarConfig)[];

export type RadarProfileKey = (typeof RADAR_PROFILE_KEYS)[number];
export type RadarProfileConfig = Pick<RadarConfig, RadarProfileKey>;

/** The part of the radar tuning the telemetry processor reads. */
export type RadarProcessorTuning = Pick<
  RadarTuning,
  'speedSmoothing' | 'laneRate' | 'overlapSearchM' | 'gridMaxSpeedMs'
>;

export const DEFAULT_RADAR_TUNING: RadarTuning = {
  extrapolationS: 0.15,
  laneGapM: 0.7,
  minLabelPx: 8,
  debugLabels: false,
  showFrameTime: false,
  speedSmoothing: 0.25,
  laneRate: 4,
  overlapSearchM: 8,
  gridMaxSpeedMs: 3,
};

/** Internals for the dev view; the defaults are what the radar was tuned on. */
export interface RadarTuning {
  /** Seconds a snapshot is extrapolated at most before the next arrives. */
  extrapolationS: number;
  /** Gap between lane centres beyond the car's own width, in metres. */
  laneGapM: number;
  /** Car numbers are left out on cars drawn smaller than this, in px. */
  minLabelPx: number;
  /** Write car index and lane next to every car. */
  debugLabels: boolean;
  /** Write how long a frame takes to draw. */
  showFrameTime: boolean;
  /** Weight of a sample 40 ms after the last (25 Hz) in the per-car speed average, 0-1. */
  speedSmoothing: number;
  /** Lanes per second a car may move when it changes lane. */
  laneRate: number;
  /** Metres either side searched for an overlapping car. */
  overlapSearchM: number;
  /** Below this speed, in m/s, cars count as parked on the grid. */
  gridMaxSpeedMs: number;
}

export interface RejoinIndicatorConfig {
  showAtSpeed: number;
  careGap: number;
  stopGap: number;
  clearGap?: number;
  width?: number;
  sessionVisibility: SessionVisibilitySettings;
}

export interface FlagConfig {
  enabled?: boolean;
  showOnlyWhenOnTrack: boolean;
  showLabel: boolean;
  matrixMode: '8x8' | '16x16' | 'uniform';
  animate: boolean;
  blinkPeriod: number;
  showNoFlagState: boolean;
  /**
   * Draw green for as long as the track is clear. Off, green is drawn only
   * while it is announced, after the start and after a yellow, as iRacing
   * shows it. Unset is on.
   */
  greenWhenClear?: boolean;
  enableGlow: boolean;
  doubleFlag?: boolean;
  background?: { opacity: number };
  sessionVisibility: SessionVisibilitySettings;
}

export interface GarageCoverConfig {
  imageFilename: string;
}

export interface TelemetryInspectorConfig {
  background?: { opacity: number };
  properties?: {
    source: 'telemetry' | 'session';
    path: string;
    label?: string;
  }[];
}

export interface FasterCarsFromBehindConfig {
  showOnlyWhenOnTrack?: boolean;
  distanceThreshold: number;
  numberDriversBehind?: number;
  alignDriverBoxes?: 'Top' | 'Bottom';
  closestDriverBox?: 'Top' | 'Reverse';
  showName?: boolean;
  removeNumbersFromName?: boolean;
  showDistance?: boolean;
  showBadge?: boolean;
  badgeFormat?: string;
  onlyShowFasterClasses: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface PitlaneHelperConfig {
  showMode: 'approaching' | 'onPitRoad';
  approachDistance: number;
  enablePitLimiterWarning: boolean;
  enableEarlyPitboxWarning: boolean;
  earlyPitboxThreshold: number;
  showPitlaneTraffic: boolean;
  background: { opacity: number };
  progressBarOrientation?: 'horizontal' | 'vertical';
  speedBarOrientation?: 'horizontal' | 'vertical';
  showPastPitBox?: boolean;
  showProgressBar?: boolean;
  showSpeedBar?: boolean;
  showSpeedSummary: boolean;
  showSpeedDelta: boolean;
  speedUnit?: 'mph' | 'km/h' | 'auto';
  speedLimitStyle?: 'none' | 'text' | 'european' | 'american';
  showPitExitInputs?: boolean;
  pitExitInputs?: { throttle: boolean; clutch: boolean };
  showInputsPhase?: 'atPitbox' | 'afterPitbox' | 'always';
  /** Show what the next stop will put in. Le Mans Ultimate only. */
  showRefuelTarget?: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface StreamChatConfig {
  display: {
    fontSize: number;
    background: { opacity: number };
    autoHide: { enabled: boolean; intervalSeconds: number };
    showPlatformIcons: boolean;
  };
  twitch: {
    /** Twitch channel name; empty disables Twitch chat. */
    channel: string;
  };
  youtube: {
    /** YouTube handle including the leading `@`; empty disables YouTube chat. */
    channel: string;
  };
}

export interface HeartRateConfig {
  /** HypeRate session/device id — the code at the end of your share link (e.g. "KiY"). */
  deviceId: string;
  /**
   * Optional HypeRate widget URL or name (e.g. "Bouncing_Heart_Widget" or
   * "https://app.hyperate.io/animation/59/YOUR-ID-HERE"). The session id is
   * substituted in automatically. Blank uses the default overlay.
   */
  widgetUrl: string;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface LapTimeLogConfig {
  showCurrentLap: boolean;
  showPredictedLap: boolean;
  showLastLap: boolean;
  showBestLap: boolean;
  showAllTimeLap: boolean;
  delta: {
    enabled: boolean;
    method: 'lastlap' | 'bestlap';
  };
  history: {
    enabled: boolean;
    count: number;
    style?: 'list' | 'chart';
    /**
     * Leave laps that involved a pit stop out of the history. They are far
     * slower than a green lap, so they stretch the chart scale and drag the
     * average, which flattens the laps you are actually comparing.
     */
    hidePittedLaps?: boolean;
    /** Leave laps driven under full-course cautions out of the history. */
    hideCautionLaps?: boolean;
    /** A cell for the lap's number within its stint, as `S5`. */
    showStintLap?: boolean;
    /** A cell for the fuel the lap used, or the virtual energy. */
    showFuel?: boolean;
    /** A cell for the tread the lap wore. Le Mans Ultimate only. */
    showWear?: boolean;
    /** The wear cell: the mean of the four wheels, or the worst of them. */
    wearMode?: 'average' | 'highest';
    /** Marks for a pit lap, a voided lap, a yellow, a wet lap. */
    showFlags?: boolean;
    /** A first row for the lap under way. */
    showCurrentRow?: boolean;
    /** Only the laps of the stint under way. */
    thisStintOnly?: boolean;
  };
  /** The unit fuel is shown in; virtual energy is always percent. */
  fuelUnits?: 'L' | 'gal';
  scale: number;
  alignment: 'top' | 'bottom';
  reverse: boolean;
  background: { opacity: number };
  foreground: { opacity: number };
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * Stint history: the stint under way and the last few that are over, one
 * row each, from the player's ledger.
 */
export interface StintHistoryConfig {
  background: { opacity: number };
  /** How many finished stints are listed, 1 to 10. */
  historyCount: number;
  /** A row for the stint under way. */
  showCurrent: boolean;
  /** Leave out the stints of earlier sessions of the event. */
  thisSessionOnly: boolean;
  /** Finished stints with fewer laps than this are left out. */
  minLaps: number;
  /** The newest stint at the top, or at the bottom. */
  newestFirst: boolean;
  showLaps: boolean;
  showTime: boolean;
  /** Fuel used, or virtual energy for a car that runs on it. */
  showFuel: boolean;
  /** Under the fuel used, the mean per lap. */
  showFuelPerLap: boolean;
  showTyres: boolean;
  showWear: boolean;
  /** The wear cell: the mean of the four wheels, or the worst of them. */
  wearMode: 'average' | 'highest';
  /** Brake disc worn, millimetres. Le Mans Ultimate only. */
  showBrakes: boolean;
  /** The stint's best lap. */
  showPace: boolean;
  /** Under the best lap, the best over the mean of the other clean laps. */
  showConsistency: boolean;
  /** The stop that ended the stint. */
  showStop: boolean;
  /** The driver's surname after the stint's number. */
  showDriver: boolean;
  /** The unit fuel is shown in; virtual energy is always percent. */
  fuelUnits: 'L' | 'gal';
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface SlowCarAheadConfig {
  maxDistance: number;
  slowSpeedThreshold: number;
  stoppedSpeedThreshold: number;
  barThickness: number;
  showOnlyWhenOnTrack?: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface SectorDeltaConfig {
  background: { opacity: number };
  timeFormat: TimeFormat;
  /**
   * What each sector is compared with. Where the chosen one does not exist
   * yet a card shows the sector's time and no delta.
   *
   * 'prefer-ghost'      – use ghost lap when available, fall back to session best
   * 'session-best-only' – always compare against session best
   * 'session-best-lap'  – the sectors of the best whole lap of the session
   * 'all-time-best'     – the best of each sector kept for the track and car,
   *                       whose sum is the theoretical best lap
   * 'all-time-best-lap' – the sectors of the best whole lap kept for them
   */
  ghostComparison:
    | 'prefer-ghost'
    | 'session-best-only'
    | 'session-best-lap'
    | 'all-time-best'
    | 'all-time-best-lap';
  /**
   * A row above the cards with the time the comparison adds up to as far as
   * the sector being driven, and the running lap time beside it.
   */
  showTargetLap?: boolean;
  /**
   * How long, in seconds, the gap to that target at the end of a sector
   * stays in the row; never more than half the sector just entered.
   */
  targetFreezeSeconds?: number;
  /**
   * Whether to record and display sectors that contained an incident (x).
   * true  – record the sector time and show a warning icon
   * false – discard the sector time entirely (keeps previous best)
   * Defaults to true when omitted.
   */
  trackIncidentSectors?: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
  /**
   * Custom color thresholds as percentages of session best.
   * Set to null to use defaults (green: 0.5%, yellow: 1.0%).
   */
  thresholds?: {
    green: number; // e.g. 0.5 means within 0.5% → green
    yellow: number; // e.g. 1.0 means within 1.0% → yellow; above = red
  } | null;
  /**
   * Maximum number of sector cards to show at once. When the track has more
   * sectors than this, the widget becomes a sliding carousel centered on the
   * current sector. Set to null to always show all sectors.
   */
  maxSectorsShown?: number | null;
  /**
   * Always use the continuous-scroll mode, even when all sectors fit in the
   * widget. The center line stays pinned to your exact track position.
   */
  alwaysScroll?: boolean;
}

/**
 * In-car systems readout.
 *
 * `rows` is an explicit ordered list of telemetry keys rather than a set of
 * booleans, so the rows keep a fixed screen position and a car that lacks one
 * shows a blank in place rather than shifting everything up.
 */
export interface CarSystemsConfig {
  /** The columns under iRacing. */
  rows: string[];
  /**
   * The columns under Le Mans Ultimate. A list of its own rather than more
   * entries in `rows`, so a selection saved for iRacing is left as it was.
   */
  lmuRows: string[];
  /**
   * `onChange` draws the widget only for a while after the driver moves a
   * dial; `always` keeps it on screen.
   */
  displayMode: 'always' | 'onChange';
  /** Seconds the widget stays after the last dial movement, in `onChange`. */
  changeHoldSeconds: number;
  /** Highlight the value of the column that moved. */
  flashOnChange: boolean;
  /** Light the ABS and traction control columns while they intervene. */
  highlightActive: boolean;
  /** The top of the scale after the value (`6/11`) where the sim gives one. */
  showScale: boolean;
  /** A signed delta from the pit baseline under the brake bias. */
  showBrakeBiasDelta: boolean;
  /** Blank rows for adjustments the current car does not have. */
  showUnsupportedRows: boolean;
  /**
   * Rows for systems the driver has switched off, which read 0 on an unsigned
   * scale. Separate from `showUnsupportedRows`: a car that lacks a system and a
   * driver who turned one off are different facts, and a driver who wants only
   * live readings wants both gone.
   */
  showOffRows: boolean;
  background: { opacity: number };
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * Tyre and brake readout for the player's car.
 *
 * Temperatures are held in Celsius and pressures in kPa throughout, the units
 * the sim publishes; the two unit settings only change what is drawn.
 */
export interface TyresConfig {
  background: { opacity: number };
  /**
   * Which temperature fills the tyre: the tread surface the road touches, the
   * rubber just under it, or the carcass. The surface swings with every
   * corner; the carcass says how the tyre is doing over a stint.
   */
  temperatureSource: 'surface' | 'innerLayer' | 'carcass';
  temperatureUnit: 'celsius' | 'fahrenheit';
  pressureUnit: 'psi' | 'kpa' | 'bar';
  /** The tyre's working window, Celsius: green inside it. */
  tyreWindow: {
    /** Centre the window on the working temperature the sim states. */
    followCompound: boolean;
    /** Half-width of that automatic window. */
    range: number;
    /** Used when not following the compound, or when the sim states none. */
    min: number;
    max: number;
  };
  /** The brakes' working window, Celsius. */
  brakeWindow: { min: number; max: number };
  /** Hot pressure to aim for, kPa: green within the tolerance. */
  pressureTarget: {
    enabled: boolean;
    front: number;
    rear: number;
    tolerance: number;
  };
  /**
   * Carcass temperature, Celsius, under which a pressure is drawn as cold
   * whatever the target says: a cold pressure cannot be judged against a hot
   * target. 0 switches the tint off.
   */
  pressureColdBelow: number;
  /** Under each pressure, how far it sits below the highest of the four. */
  showPressureDeviation: boolean;
  /**
   * A bar under each tyre for its share of the load on all four. An estimate
   * where the sim withholds tyre load: the share is then taken from
   * suspension load, sound between left and right, approximate between front
   * and rear.
   */
  showLoad: boolean;
  /** Percent of the car's load at or below which the bar turns red. */
  lowLoadThreshold: number;
  /** How far each tyre is squashed, millimetres. */
  showDeflection: boolean;
  /** Millimetres at or below which the wheel counts as off the ground. */
  liftOffThreshold: number;
  showBrakes: boolean;
  showWear: boolean;
  showCompound: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * How long the tyres and the brake discs of the player's car will last:
 * what is left on each wheel, how fast it is going and the laps that makes.
 * Two sections, each with a switch. Le Mans Ultimate only.
 *
 * The sim states neither the tread at which a tyre is finished nor the
 * thickness at which a disc fails, so `tyres.floorPct` and the two failure
 * thicknesses are the driver's to set. They are read by the forecast in the
 * main process as well as here.
 */
export interface WearConfig {
  background: { opacity: number };
  tyres: {
    /** The tyre section. */
    show: boolean;
    /** Wear per lap under the tread. */
    showPerLap: boolean;
    /**
     * Which wear per lap is written: the one the forecast uses, from the
     * laps driven, or what the lap under way is heading for.
     */
    perLapSource: 'average' | 'thisLap';
    showLapsLeft: boolean;
    showMinutesLeft: boolean;
    /** Tread expected when the fuel or energy runs out. */
    showEndOfStint: boolean;
    /** Tread, percent, at which the tyre is finished. */
    floorPct: number;
    /** Tread at or below this is amber; at or below half of it, red. */
    warnPct: number;
    /** Laps left at or below this are red. */
    warnLaps: number;
    /** Wear per lap, percent, above this is amber. */
    warnPerLapPct: number;
  };
  brakes: {
    /** The brake section. */
    show: boolean;
    /** The large figure: millimetres of disc, or percent of usable disc. */
    primary: 'thickness' | 'life';
    showPerLap: boolean;
    showLapsLeft: boolean;
    showMinutesLeft: boolean;
    /**
     * Front failure thickness, millimetres. 0 leaves it to a thickness
     * learned from a failed brake, then to the figure for the class.
     */
    failureFrontMm: number;
    /** The same for the rear discs. */
    failureRearMm: number;
    /** Life at or below this is amber; at or below half of it, red. */
    warnLifePct: number;
    /** Laps left at or below this are red. */
    warnLaps: number;
  };
  /** The compound fitted to each axle, between its two tyres. */
  showCompound: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The attitude of the player's car and the alignment of its wheels: ride
 * height at the four corners, rake, roll, camber, toe and damper travel, a
 * row each. Le Mans Ultimate only.
 *
 * The sim publishes heights in millimetres and no wheelbase or track width,
 * so the three lengths below are what turns a difference in height into an
 * angle, and the angles are as good as the numbers entered.
 */
export interface ChassisConfig {
  background: { opacity: number };
  /** Ride height at the four corners, with a bar each. */
  showRideHeight: boolean;
  /** Ride height, millimetres, at which a corner's bar is full. */
  rideHeightScale: number;
  /** Below this ride height, millimetres, a front corner is bottoming. */
  bottomingFront: number;
  /** The same for a rear corner. */
  bottomingRear: number;
  /** Rake as an angle, with the millimetres behind it. */
  showRake: boolean;
  /** Millimetres between the axles, for the rake angle. */
  wheelbase: number;
  /** Front and rear roll angle. */
  showRoll: boolean;
  /** Millimetres between the front wheels, for the front roll angle. */
  trackFront: number;
  /** The same between the rear wheels. */
  trackRear: number;
  /** The front axle's share of the roll, in percent, after the two angles. */
  showRollShare: boolean;
  showCamber: boolean;
  showToe: boolean;
  /** Total toe per axle, or toe at each of the four wheels. */
  toeDisplay: 'axle' | 'wheel';
  /** Damper position at the four corners. */
  showSuspension: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * A strip of lights that fills with the sim's own lift-and-coast signal, and
 * that traction control and ABS take over while they work.
 */
export interface LiftCoastConfig {
  background: { opacity: number };
  /** Lights in the strip, 3 to 20. */
  ledCount: number;
  /** Which way the strip fills. */
  direction: 'right' | 'left' | 'up' | 'down';
  /** A second strip on the opposite side, filling the other way. */
  mirrored: boolean;
  /** Above this share of the signal the lit lights change colour. */
  criticalFraction: number;
  /** The progressive stage itself. */
  showLiftAndCoast: boolean;
  /** Traction control takes the whole strip while it cuts. */
  showTc: boolean;
  /** ABS takes the whole strip while it works. */
  showAbs: boolean;
  /**
   * A locked and a spinning wheel take the strip. Both need the wheels' slip
   * ratio, which nothing publishes yet, so they do nothing until it does.
   */
  showWheelLock: boolean;
  showWheelSlip: boolean;
  /** Slip ratio magnitude that counts as a lock. */
  lockThreshold: number;
  /** Slip ratio that counts as wheelspin. */
  slipThreshold: number;
  /** Draw nothing while no light is lit. */
  hideWhenDark: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * A diagram of the player's car: where the body is dented, what has come off
 * or gone flat, where it was last hit, and what a repair costs at the next
 * stop. Le Mans Ultimate only.
 */
export interface DamageConfig {
  background: { opacity: number };
  diagram: {
    /** The car seen from above, nose up. */
    enabled: boolean;
    /**
     * The figure in the middle of the car. Aero is the sim's own aero damage
     * and falls back to the body until its REST API has answered.
     */
    reading: 'aero' | 'body' | 'none';
    /** Count up from 0 % damage instead of down from 100 % integrity. */
    showDamage: boolean;
  };
  /** A red wedge towards where the car was last hit, for 15 s. */
  impact: { enabled: boolean };
  /** Pulse a part that has come off. */
  flashDetached: boolean;
  /** An icon in the car while the sim shows its overheating warning. */
  overheating: { enabled: boolean };
  stats: {
    /** The Aero, Body, Susp and Tyre figures beside the car. */
    enabled: boolean;
    /** Per cent of integrity at or below which each figure turns red. */
    aeroWarn: number;
    bodyWarn: number;
    suspensionWarn: number;
    tyreWarn: number;
  };
  /** The repair the pit menu is set to, and the time it adds to the stop. */
  repair: { enabled: boolean };
  /** Draw nothing while the car is sound and no repair is set. */
  hideWhenUndamaged: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The hybrid battery and motor of the player's car.
 *
 * Charge is held in percent, temperatures in Celsius and power in kilowatts
 * throughout; the two unit settings only change what is drawn.
 */
export interface HybridConfig {
  background: { opacity: number };
  /** At or below this charge, percent, the battery is drawn as low. */
  lowChargePct: number;
  /** At or above this charge, percent, the battery is drawn as full. */
  highChargePct: number;
  /** Pulse the charge ten times on entering a band, then hold the colour. */
  warningFlash: boolean;
  /** Decimals of the charge and of the per-lap figures, 0 to 2. */
  decimals: number;
  /** Charge used and recovered on this lap. */
  showLapUse: boolean;
  /** Seconds after the line that last lap's totals stay up. */
  freezeSeconds: number;
  /** The estimated net change over the whole lap. */
  showNetEstimate: boolean;
  /** Seconds the motor has deployed on this lap. */
  showDeployTimer: boolean;
  /** The motor row, and which of its cells are drawn. */
  showMotor: boolean;
  motor: {
    showTemps: boolean;
    showRpm: boolean;
    showTorque: boolean;
    showPower: boolean;
    showRegen: boolean;
  };
  /** Overheat thresholds, Celsius. */
  motorTempWarnC: number;
  coolantTempWarnC: number;
  temperatureUnit: 'celsius' | 'fahrenheit';
  /** Unit of the motor's power and of the regeneration reading. */
  powerUnit: 'kW' | 'hp' | 'ps';
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * What the machine, Tearoff and the sim are costing: CPU, memory and, where
 * the sim publishes it, frame rate.
 */
export interface SystemPerformanceConfig {
  background: { opacity: number };
  /** The whole machine's CPU and memory. */
  system: { enabled: boolean };
  /** Tearoff's own CPU and memory, all of its processes together. */
  app: { enabled: boolean };
  /**
   * The sim's frame rate and its own CPU and GPU meters. Drawn only where
   * the sim publishes them, which Le Mans Ultimate does not.
   */
  sim: { enabled: boolean };
  /** One row per group, or everything on a single strip. */
  layout: 'rows' | 'inline';
  warn: {
    /** A CPU or GPU figure is amber from here and red from 95. */
    cpuPercent: number;
    /** The frame rate is amber below this and red below half of it. */
    fps: number;
  };
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The player's lap against one of their own reference laps.
 *
 * Times are seconds throughout, as the channel carries them.
 */
export interface LapDeltaConfig {
  background: { opacity: number };
  /**
   * Which lap the delta is measured against: the best clean lap of this
   * session, the best one kept for this track and car across sessions, the
   * best clean lap of the stint under way, or the lap before this one.
   * Where the chosen one does not exist yet the widget shows dashes rather
   * than falling back to another.
   */
  reference: 'sessionBest' | 'allTime' | 'stintBest' | 'lastLap';
  /**
   * Which of the other references are shown in a strip under the main
   * figure. The one chosen as `reference` is never repeated there.
   */
  secondary: {
    sessionBest: boolean;
    allTime: boolean;
    stintBest: boolean;
    lastLap: boolean;
  };
  /**
   * For how many seconds after the line the gap the finished lap ended on
   * replaces the live delta; 0 switches it off.
   */
  freezeSeconds: number;
  /** Decimal places on the delta. */
  decimals: 2 | 3;
  /** The bar showing whether time is being gained or lost right now. */
  showTrend: boolean;
  /**
   * The rate that fills the trend bar, in seconds gained or lost per second
   * of driving.
   */
  trendRange: number;
  /** The lap time this lap is heading for. */
  showPredictedLap: boolean;
  /** The reference lap's own time, and which reference it is. */
  showReferenceLap: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The corner just driven against the same corner on one of the player's own
 * laps: time gained or lost through it, and the speed in and out.
 */
export interface CornerDeltaConfig {
  background: { opacity: number };
  /**
   * Which lap a corner is measured against: the reference lap kept for this
   * track and car across sessions, the best clean lap of this session, or
   * the last time the corner was driven. Where the chosen one does not exist
   * yet the deltas are dashes rather than borrowed from another.
   */
  reference: 'allTime' | 'sessionBest' | 'lastLap';
  /** Corners by name ('Acque Minerali A') or by turn number ('T5A'). */
  cornerLabel: 'name' | 'number';
  /** Decimal places on the time delta. */
  decimals: 2 | 3;
  /** The speed at the corner's start, and how it compares. */
  showEntrySpeed: boolean;
  /** The speed at the corner's end, and how it compares. */
  showExitSpeed: boolean;
  speedUnit: 'auto' | 'km/h' | 'mph';
  /** How many earlier corners are listed under the last one; 0 for none. */
  historyCount: number;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The timing panel: a block of tiles with the lap, the delta to a reference
 * lap, the last and best laps and the sector times.
 *
 * Times are seconds throughout, as the channels carry them.
 */
export interface TimingConfig {
  background: { opacity: number };
  /** Which tiles are drawn. Each optional pair shares a row. */
  tiles: {
    /** The lap being driven. */
    lap: boolean;
    /** The delta to the reference lap. */
    delta: boolean;
    lastLap: boolean;
    /** The player's best lap of the session. */
    bestLap: boolean;
    /** The row of sector times. */
    sectors: boolean;
    /** The running time of the lap in progress. */
    currentLap: boolean;
    /** The reference lap plus the delta. */
    predictedLap: boolean;
    /** The fastest lap of the session among the cars in scope. */
    sessionBest: boolean;
    /** The best lap kept for this track and car across sessions. */
    allTimeBest: boolean;
    /** The best clean lap of the stint under way. */
    stintBest: boolean;
    /** The player's recent pace. */
    pace: boolean;
  };
  /**
   * Which lap the delta and the predicted lap are measured against: the best
   * of the session, of all time or of the stint, or the last lap. Where the
   * chosen one does not exist the tiles show dashes rather than another
   * lap's figures.
   */
  deltaReference: 'sessionBest' | 'allTime' | 'stintBest' | 'lastLap';
  deltaDecimals: 2 | 3;
  lapTimeDecimals: 1 | 2 | 3;
  sectorDecimals: 1 | 2 | 3;
  /**
   * What a sector tile shows: this lap's time with the previous lap's until
   * it exists, this lap's time alone, or the player's best for the sector.
   */
  sectorSource: 'live' | 'liveOnly' | 'best';
  /**
   * A sector with an incident in it is kept and marked, or left out as if
   * it had not been driven.
   */
  sectorIncidents: 'mark' | 'drop';
  /** The most sector tiles in the row; a lap with more shows a window. */
  sectorTilesMax: number;
  /** Whose laps count as the session best: the player's class or everyone. */
  sessionBestScope: 'class' | 'overall';
  /** Text size, in percent. */
  scale: number;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * Close-range map centred on the car being watched.
 *
 * Distances are metres on the real track, so the same settings look the same
 * on a short circuit and at Le Mans.
 */
export interface MinimapConfig {
  background: { opacity: number };
  /** Metres from the centre of the map to its edge. */
  range: number;
  /**
   * `fixed` keeps the track the way the full map draws it; `heading` turns it
   * so the car always points up.
   */
  orientation: 'fixed' | 'heading';
  /** What each car's marker says. */
  label: 'position' | 'classPosition' | 'carNumber' | 'none';
  /** Marker diameter in pixels, before the widget's own scale. */
  markerSize: number;
  /** Width the track is drawn at, metres. */
  trackWidth: number;
  useClassColors: boolean;
  showStartFinish: boolean;
  dimCarsInPits: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The height of the track along the lap, with the car's place on it. The
 * profile is recorded by driving one clean lap and kept per track.
 */
export interface ElevationConfig {
  background: { opacity: number };
  /** Tint the part of the lap already driven. */
  showProgress: boolean;
  /** Lines where the sectors start. */
  showSectors: boolean;
  /** The height where the car is, top left. */
  showReading: boolean;
  /** The lap's height range, top right. */
  showRange: boolean;
  /**
   * What the reading is measured from: the lowest point of the lap, or the
   * start/finish line, and then it is signed.
   */
  zero: 'lowest' | 'line';
  /** 'auto' follows the sim's display units. */
  unit: 'auto' | 'm' | 'ft';
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/** One cell of the cruise block. */
export type CruiseCellId =
  'compass' | 'elevation' | 'odometer' | 'timeOnTrack' | 'lapDistance';

/** Whether a total is of every session on this track in this car, or of this one. */
export type CruiseScope = 'allTime' | 'session';

/**
 * The cruise block: compass heading, elevation, distance and time driven
 * and the distance into the lap, with an optional compass dial.
 */
export interface CruiseConfig {
  background: { opacity: number };
  /** Three cells over two, or one strip. */
  layout: 'grid' | 'row';
  /** The order the cells are drawn in, as CruiseCellId. */
  displayOrder: string[];
  compass: {
    enabled: boolean;
    /** The compass dial with the drift needle, beside the cells. */
    dial: boolean;
  };
  /** Never drawn under iRacing, which states no height. */
  elevation: { enabled: boolean };
  odometer: { enabled: boolean; scope: CruiseScope };
  timeOnTrack: { enabled: boolean; scope: CruiseScope };
  lapDistance: { enabled: boolean };
  /** Metres and kilometres, or feet and miles. 'auto' follows the sim. */
  units: 'auto' | 'Metric' | 'Imperial';
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The driver's own notes for the track, shown where each was written for:
 * track notes say where the car is, pace notes what is coming.
 */
export interface TrackNotesConfig {
  background: { opacity: number };
  showPaceNotes: boolean;
  showTrackNotes: boolean;
  /** The comment of the note on the first visible line. */
  showComment: boolean;
  /** Metres to the next note of the first visible line. */
  showNextDistance: boolean;
  /** Draw note text in capitals. */
  uppercase: boolean;
  /** Pace notes appear this many metres early, -500 to 500. */
  paceLeadMeters: number;
  /** And this many seconds early at the current speed, 0 to 10. */
  paceLeadSeconds: number;
  /** Hide a note this long after it appeared; 0 keeps it until the next. */
  displaySeconds: number;
  /** On pit road, show the notes written for it. */
  showPitNotes: boolean;
  /** Hide the widget on a track with no notes. */
  hideWhenNoNotes: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

export interface DeltaSpeedConfig {
  background: { opacity: number };
  /**
   * Display unit. Speeds are held in km/h throughout and converted only for
   * display. 'auto' follows iRacing's own DisplayUnits setting.
   */
  unit: 'km/h' | 'mph' | 'auto';
  /**
   * Delta at which the background reaches full colour, in km/h. Held per unit
   * rather than converted so both caps stay whole numbers — converting a 15
   * km/h cap would give an awkward 9.3 mph.
   */
  scaleKph: number;
  /** Delta at which the background reaches full colour, in mph. */
  scaleMph: number;
  /**
   * Largest delta shown numerically, in km/h. Past this the readout holds at
   * the cap instead of climbing: an exact figure only helps while the
   * correction is still worth making, and a wide delta is already obvious from
   * the colour. Held per unit for the same reason as the scales above.
   */
  capKph: number;
  /** Largest delta shown numerically, in mph. */
  capMph: number;
  /**
   * The readout holds its current value until the true delta has moved at
   * least this far, in km/h. Without it the last digit flickers between
   * neighbouring values while the delta is essentially steady, which draws the
   * eye for no reason.
   */
  updateThresholdKph: number;
  /** Update threshold applied when displaying mph. */
  updateThresholdMph: number;
  /** Show the numeric delta inside the box. */
  showNumber: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

/**
 * The rivals box: the class car ahead of the focus car, the focus car and
 * the class car behind.
 */
export interface BattleConfig {
  background: { opacity: number };
  showOnlyWhenOnTrack: boolean;
  /** A line of small labels above the rows, naming each column. */
  header: { enabled: boolean };
  position: { enabled: boolean };
  /** Places gained or lost against the class grid. Race only. */
  positionChange: { enabled: boolean };
  carNumber: { enabled: boolean };
  driverName: { enabled: boolean };
  /** PIT and OUT, a penalty, finished, DNF and DQ. */
  status: {
    enabled: boolean;
    /** Seconds in the pit lane beside PIT and OUT. */
    showPitTime: boolean;
  };
  /** Tyre compound; four wheels where the sim states each. */
  compound: { enabled: boolean };
  stint: {
    enabled: boolean;
    /**
     * "7/24": beside the laps since the last stop, the lap the stint can
     * reach on what the car has left. Only where the sim publishes it.
     */
    showEstimate: boolean;
  };
  /** Stops made; highlighted while the car has asked for one. */
  pitStops: { enabled: boolean };
  /** Virtual energy or fuel remaining, percent. */
  energy: { enabled: boolean };
  /** The last lap's usage, percent of a full allocation. */
  energyUse: { enabled: boolean };
  bestTime: { enabled: boolean; timeFormat: TimeFormat };
  lastTime: LastTimeColumnConfig;
  speed: { enabled: boolean; unit: 'mph' | 'km/h' | 'auto' };
  /** Track-limits penalty points. */
  trackLimits: { enabled: boolean };
  /** The gap now, the gap over the line last lap, and the trend a lap. */
  gap: { enabled: boolean; decimalPlaces: number };
  /** About how many laps until the gap is gone, where that can be said. */
  forecast: { enabled: boolean };
  displayOrder: string[];
  sessionVisibility: SessionVisibilitySettings;
}

/** The field at a glance: one chip per class, cars running of cars entered. */
export interface ClassFieldsConfig {
  background: { opacity: number };
  /** Chips in a row or in a column. */
  orientation: 'horizontal' | 'vertical';
  /** Chips shown, 2 to 20; the focus car's class is always among them. */
  maxClasses: number;
  /** By the overall place of each class's leader, or fastest class first. */
  order: 'leaderPosition' | 'classSpeed';
  /** "12/14" rather than "12". */
  showTotal: boolean;
  /** The number of cars out of the running, after the count. */
  showInactive: boolean;
  /** The number of the class's cars in the pit lane. */
  showInPitLane: boolean;
  /** Emphasise the focus car's class. */
  highlightOwnClass: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export interface LapTraceConfig {
  /**
   * Settings schema version. Bump and add a migrator under src/types/migrators/
   * when making a breaking change to this shape.
   */
  version: number;
  /**
   * Which saved lap to plot. 'manual' (.ibt import) and 'garage61' are not
   * implemented yet and are shown disabled in settings.
   */
  referenceSource: LapTraceSource;
  /**
   * Metres of track visible behind/ahead of the car. Equal values centre the
   * car; an uneven split shifts it toward whichever side is smaller.
   */
  metersBehind: number;
  metersAhead: number;
  showThrottle: boolean;
  showBrake: boolean;
  showSpeed: boolean;
  showGearLabels: boolean;
  /**
   * Dotted vertical line through the plot at the reference's (and, while
   * driving, your own) interpolated brake application/release points. These
   * carry sub-metre precision the bucket grid cannot.
   */
  showBrakePointMarkers: boolean;
  /**
   * Dotted vertical line through the plot at the reference's interpolated
   * throttle application point.
   */
  showThrottlePointMarkers: boolean;
  /** Bright solid overlay of the lap currently being driven. */
  showGhost: boolean;
  /**
   * Colour the driver's brake trace where ABS engaged, the same way the Input
   * widget marks it on the brake bar.
   */
  showAbs: boolean;
  /**
   * 'overlay' colours the brake line itself where ABS engaged. 'bar' also
   * fills the area under the brake curve down to the axis for that stretch —
   * the same style the Input Trace widget's ABS indicator uses — so it reads
   * as a bar rather than a highlighted line, and mixes colour with a filled
   * reference trace (throttle or brake) it overlaps.
   */
  absStyle?: 'overlay' | 'bar';
  /** Also mark ABS activity as a strip beneath the traces. */
  showAbsBar: boolean;
  /** Opacity of the saved reference lap traces and filled bars. */
  ghostOpacity: number;
  /** Opacity of the live driver input trace. */
  driverOpacity: number;
  /** Fill the reference throttle/brake traces as bars down to the axis instead of plotting a line. */
  referenceFilled: boolean;
  strokeWidth: number;
  /** Color of the vertical line marking the car's current position. */
  carLineColor: string;
  /** User-editable plot colours (reference/ghost traces, fills, ABS, markers, grid). */
  colors: LapTraceColors;
  /** Corner time delta in the last-corner row. Negative (green) is faster. */
  showLastCornerTime: boolean;
  /**
   * Metres earlier/later the driver braked into the corner than the
   * reference. Positive (green) means later.
   */
  showLastCornerBrakeDelta: boolean;
  /**
   * Delta between the lowest speed each lap carried through the corner.
   * Positive (green) means the driver carried more.
   */
  showLastCornerApexSpeed: boolean;
  /** Column order for the last-corner history panel. */
  lastCornerDisplayOrder?: LastCornerDisplayColumn[];
  /** Unit for the apex-speed delta. 'auto' follows iRacing's DisplayUnits. */
  lastCornerSpeedUnit: 'mph' | 'km/h' | 'auto';
  /**
   * How a corner is named. 'name' uses the track data's own name and wraps it
   * over two lines when it is long ('Variante Tamburello A'); 'number' uses the
   * turn number instead ('T1A'), which keeps the rows compact. Where the track
   * data does not number its corners they are counted off in order.
   */
  lastCornerLabelStyle: 'name' | 'number';
  /** Text size of the last-corner row in px; its icons and height scale with it. */
  lastCornerFontSize: number;
  /** How much bigger the corner just finished is drawn than the older ones behind it. */
  lastCornerLatestScale: number;
  /**
   * How many recent corners the panel keeps on screen. More than one matters
   * through esses and chicanes, where the next corner starts before there is
   * time to read the last one's result.
   */
  lastCornerCount: number;
  /**
   * Beeps 3, 2 and 1 seconds before the reference lap's brake point, and a
   * distinct tone at the point itself. Needs a reference lap carrying recorded
   * brake points; a Garage 61 import may not have them.
   */
  brakeCueAudio: boolean;
  /**
   * Which system playback device the countdown tones use, as a
   * `MediaDeviceInfo.deviceId` from `enumerateDevices()`. The sentinel
   * 'default' follows whatever Windows is currently using, which is what the
   * cues did before this setting existed. A stored id that is no longer
   * present (headset unplugged) falls back to the default device.
   */
  brakeCueOutputDeviceId: string;
  /** Volume of the brake countdown tones, 0..1. */
  brakeCueVolume: number;
  /** Seconds to trigger every brake audio cue before its visual timing, 0..0.6. */
  brakeCueLeadSec: number;
  /**
   * Peak brake pressure a reference application must reach to count as a braking
   * zone, 0..0.25. Anything softer is treated as a stabilising brush and gets
   * neither a countdown nor a brake-distance delta. At 0 every application that
   * slows the car counts. Car-dependent (brake bias, pedal travel, and some cars
   * log force rather than travel), hence a setting.
   */
  brakeCueMinPeak: number;
  /** Per-cue synthesis of the countdown tones (frequency/type/duration/peak). */
  sound: LapTraceSound;
  /**
   * Which end of the strip the final bar sits at — the one that turns red at
   * the brake point. 'top' drains downwards, 'bottom' drains upwards.
   */
  brakeCueLastBar: 'top' | 'bottom';
  /**
   * Where the plot ('plot'), the last-corner panel ('corners') and the
   * countdown strip ('brakeCue') sit, as edited on the Layout tab. An element
   * shows only while the layout holds it. The last-corner panel summarises
   * each corner just completed against the reference lap, and needs the
   * bundled track data for the circuit. The countdown strip runs as a column
   * of 4 bars beside the trace, or one continuous bar above or below it.
   *
   * Replaced four settings (showLastCorner, lastCornerPosition, brakeCueBars,
   * brakeCueBarSide): the dashboard-load migration builds a tree from them
   * and drops them. Stored trees are still validated where they are read, and
   * a damaged one falls back to the default.
   */
  layoutTree?: LayoutNode;
  background: { opacity: number };
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

export type LastCornerDisplayColumn =
  'corner' | 'cornerTimeDelta' | 'brakePointDelta' | 'apexSpeedDelta';

export type SessionRetention = 'all' | 5 | 10 | 20;

/** Which quantity the lap graph's y axis measures. */
export type LapGraphYAxisMode = 'trace' | 'position' | 'gap';

/** Whether the trace and gap y axis fits the bold lines or every car. */
export type LapGraphAxisFit = 'shown' | 'all';

export interface LapGraphConfig {
  /** Which y axis the graph opens on. */
  yAxisMode: LapGraphYAxisMode;
  /** Laps visible by default; the graph follows the latest lap. */
  lapWindow: number;
  /** Auto-pin the player, the class leader, and the cars around the player. */
  autoPin: boolean;
  /** Which cars the trace and gap y axis is sized to. */
  axisFit: LapGraphAxisFit;
  /** Gap mode ceiling in seconds. 0 means no cap. */
  gapMaxSeconds: number;
}

/** The recorder keeps 300 laps per car, so a wider window has nothing to show. */
export const LAP_GRAPH_LAP_WINDOW_BOUNDS = { min: 5, max: 300 } as const;

export const LAP_GRAPH_GAP_MAX_BOUNDS = { min: 0, max: 600 } as const;

/** Overlay widgets that can be docked under the Gantry incident feed. */
export const GANTRY_DOCK_WIDGET_TYPES = [
  'fuel',
  'map',
  'flatmap',
  'strategytimeline',
] as const;
export type GantryDockWidgetType = (typeof GANTRY_DOCK_WIDGET_TYPES)[number];

export const GANTRY_DOCK_MAX_PANELS = 3;

export interface GantryDockPanel {
  /** Stable key for React and the remembered collapsed state. */
  id: string;
  type: GantryDockWidgetType;
  /** Fuel only: the linked overlay instance or a Gantry-only instance. */
  widgetId?: string;
}

export interface GantryDockConfig {
  enabled: boolean;
  arrangement: 'row' | 'tabs';
  /** At most GANTRY_DOCK_MAX_PANELS. */
  panels: GantryDockPanel[];
}

export const GANTRY_STANDINGS_SOURCES = [
  'builtin',
  'overlay',
  'gantry',
] as const;
export type GantryStandingsSource = (typeof GANTRY_STANDINGS_SOURCES)[number];

export interface GantryStandingsConfig {
  /**
   * builtin: the Gantry's own table. overlay: the Standings widget's settings.
   * gantry: a Gantry-only Standings layout, named by `widgetId`.
   */
  source: GantryStandingsSource;
  widgetId?: string;
}

export interface GantryConfig {
  /** Display units for speed values. Stored thresholds stay in km/h. */
  speedUnit: 'mph' | 'km/h' | 'auto';
  /** How driver names are written in the standings list. */
  driverNameFormat: NameFormat;
  /**
   * Bumped when a saved threshold's meaning changes. Configs below the current
   * version are reset rather than converted; see migrateGantryThresholds.
   */
  thresholdsVersion: number;
  // Incident detection thresholds
  slowSpeedThreshold: number;
  slowDurationSeconds: number;
  impactDecelKmhPerSec: number;
  impactMinSpeed: number;
  offTrackDurationSeconds: number;
  pitEntryDurationSeconds: number;
  cooldownSeconds: number;
  // Persistence
  sessionRetention: SessionRetention;
  /**
   * iRacing camera group the incident replay buttons switch to, by name.
   * Names differ per track and content, so this is matched against the
   * session's own CameraInfo groups and ignored when it is not present.
   */
  incidentCameraGroup: string;
  // Lap Graph tab
  lapGraph: LapGraphConfig;
  window: GantryWindowConfig;
  /** Panels shown under the incident feed. Sanitise with sanitizeGantryDock. */
  dock: GantryDockConfig;
  /** Which standings the left pane shows. Sanitise with sanitizeGantryStandings. */
  standings: GantryStandingsConfig;
  /** Pit service timings per car. Sanitise with sanitizeGantryPitStops. */
  pitStops: GantryPitStopsConfig;
}

export interface GantryWindowConfig {
  /** Keep the Gantry window above iRacing and other apps. */
  alwaysOnTop: boolean;
}

/** Chase camera far enough back to show what happened around the car. */
export const DEFAULT_INCIDENT_CAMERA_GROUP = 'Far Chase';

export type GantryWidgetSettings = BaseWidgetSettings<GantryConfig>;

/** The Pit Wall's fixed page layouts, in the order the header lists them. */
export const PIT_WALL_LAYOUT_IDS = ['race', 'watching', 'compact'] as const;
export type PitWallLayoutId = (typeof PIT_WALL_LAYOUT_IDS)[number];

/**
 * The Pit Wall window: one page about the race from our own car's side.
 * Sanitise with sanitizePitWallConfig; where the window sits on the screen
 * is kept by the main process, not here.
 */
export interface PitWallConfig {
  /** Which of the fixed layouts the page shows. */
  layout: PitWallLayoutId;
}

export type PitWallWidgetSettings = BaseWidgetSettings<PitWallConfig>;

/** Series look for the broadcast tower. */
export type BroadcastTheme = 'imsa' | 'wec' | 'f1';

/** How the tower animates from one page to the next. */
export type BroadcastTransition =
  | 'random'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'fade-in'
  | 'flip'
  | 'wipe'
  | 'zoom'
  | 'checker';

/** What the right-hand column of the tower can show. */
export type BroadcastPage =
  'names' | 'gaps' | 'lastLap' | 'bestLap' | 'gained' | 'pits' | 'tyres';

/**
 * The tower clock: the session clock alone, with the time of day at the
 * track or on this PC, or laps and time together.
 */
export type BroadcastHeaderClock =
  'session' | 'session-track' | 'session-local' | 'laps-time';

/** TV-style leaderboard and focus-car card, meant for OBS capture. */
export interface BroadcastConfig {
  theme: BroadcastTheme;
  /**
   * Series logo above the tower title, as an image data URL. Stored inline so
   * it reaches the OBS page with the rest of the dashboard.
   */
  logo: string;
  background: { opacity: number };
  /** Fades the whole widget, text included, so it covers less of the stream. */
  translucent: { enabled: boolean; opacity: number };
  /** Rows shown per class; the focus car is added below when outside them. */
  driversPerClass: number;
  /** Header text; blank shows the track name. */
  title: string;
  /** Rotate through the chosen pages, or keep one page up. */
  pageMode: 'rotate' | 'static';
  /** Pages in the rotation; one with nothing to show yet is skipped. */
  pages: Record<BroadcastPage, boolean>;
  /** The page a static tower shows; its intervals cover every class. */
  staticPage: BroadcastPage;
  /** How long each tower page (names, gaps per class, gained, pits, tyres) stays up. */
  pageSeconds: number;
  headerClock: BroadcastHeaderClock;
  /** Page change animation; random never repeats the last one. */
  pageTransition: BroadcastTransition;
  /** Lower-third card for the car the camera is on. */
  showFocusCard: boolean;
  /** Show the focus car's last lap time in the lower-third card. */
  showLastLap: boolean;
  /** Show the focus car's best lap time in the lower-third card. */
  showBestLap: boolean;
  /** Starting grid before the green flag (the podium is its own widget). */
  phaseScreens: boolean;
  driverNameFormat: NameFormat;
  sessionVisibility: SessionVisibilitySettings;
}

export type BroadcastWidgetSettings = BaseWidgetSettings<BroadcastConfig>;

/**
 * Weather card that pops up on change, and every `intervalMinutes`
 * (0 = only on change), for `showSeconds`.
 */
export interface BroadcastWeatherConfig {
  background: { opacity: number };
  intervalMinutes: number;
  showSeconds: number;
  sessionVisibility: SessionVisibilitySettings;
}

export type BroadcastWeatherWidgetSettings =
  BaseWidgetSettings<BroadcastWeatherConfig>;

/** Podium places drawn as metal steps or as trophies. */
export type BroadcastPodiumStyle = 'steps' | 'trophy';

/** Podium of each class after the checkered flag of a race. */
export interface BroadcastPodiumConfig {
  background: { opacity: number };
  style: BroadcastPodiumStyle;
}

export type BroadcastPodiumWidgetSettings =
  BaseWidgetSettings<BroadcastPodiumConfig>;

/** Scrolling bottom-of-screen ticker that cycles standings views. */
export interface BroadcastTickerConfig {
  background: { opacity: number };
  /** Fades the whole widget, text included, so it covers less of the stream. */
  translucent: { enabled: boolean; opacity: number };
  /** Scroll speed: how long each car stays in the loop. */
  secondsPerEntry: number;
  sessionVisibility: SessionVisibilitySettings;
}

export type BroadcastTickerWidgetSettings =
  BaseWidgetSettings<BroadcastTickerConfig>;

/** Race control popups: incidents and flags, with the driver involved. */
export interface BroadcastEventsConfig {
  background: { opacity: number };
  /** How long each event stays up; queued events follow one by one. */
  showSeconds: number;
  kinds: {
    crash: boolean;
    offTrack: boolean;
    slowdown: boolean;
    blackFlag: boolean;
    yellow: boolean;
    caution: boolean;
    fastestLap: boolean;
    pitStop: boolean;
    meatball: boolean;
    disqualified: boolean;
    finalLap: boolean;
    checkered: boolean;
  };
  sessionVisibility: SessionVisibilitySettings;
}

export type BroadcastEventsWidgetSettings =
  BaseWidgetSettings<BroadcastEventsConfig>;

// ===========================
// Widget config map + typed widget
// ===========================

export interface InformationBarConfig extends SessionBarConfig {
  background: { opacity: number };
  foreground: { opacity: number };
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}

/** Where the car stands against the race plan, for the driver in it. */
export interface StintPlanConfig {
  background: { opacity: number };
  /** Add race elapsed time to clock times, e.g. "01:42 (+12:42)". */
  showElapsedTime: boolean;
  showFuel: boolean;
  showNextDriver: boolean;
}

/** The team's view of who drives when. */
export interface StrategyTimelineConfig {
  background: { opacity: number };
  /** Add race elapsed time to clock times, e.g. "01:42 (+12:42)". */
  showElapsedTime: boolean;
  /** The whole race as a strip with a "now" marker. */
  showStrip: boolean;
  showDoneStints: boolean;
  /** Recent unplanned stops under the stint list. */
  showStops: boolean;
}

/**
 * The friction circle: the player's lateral g against longitudinal g, with a
 * fading trail and the held maxima.
 */
export interface FrictionCircleConfig {
  background: { opacity: number };
  /** The g at the rim of the circle, 1 to 6. */
  scaleG: number;
  /**
   * Which way the dot goes. 'force' is where the driver is thrown: up under
   * braking, to the right in a left-hand corner. 'acceleration' is where the
   * car is being pushed: down under braking, to the left in a left-hand
   * corner.
   */
  orientation: 'force' | 'acceleration';
  /** The fading trail behind the dot. */
  showTrace: boolean;
  /** How many seconds of driving the trail holds, 1 to 10. */
  traceSeconds: number;
  /** A ring at each whole g and the centre cross. */
  showRings: boolean;
  /** The ring at the best lateral g the car has sustained lately. */
  showSustainedRing: boolean;
  /** The four figures in the corners. */
  showReadings: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * Brake performance: the peak of each braking zone against a best, with the
 * zone's speeds, distance and time, and how long the wheels were locked.
 */
export interface BrakePerformanceConfig {
  background: { opacity: number };
  /**
   * What the delta and the "best" figure are measured against: the best
   * peak of roughly the last minute, or the best of the session.
   */
  reference: 'rolling' | 'session';
  /** The delta as a share of the best, or in g. */
  deltaUnit: 'percent' | 'g';
  /** The line with the speeds, distance, time and average of the zone. */
  showZoneDetail: boolean;
  speedUnit: 'auto' | 'km/h' | 'mph';
  /** Front and rear lock times. Never drawn when the sim gives none. */
  showLockTime: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The pit stop estimate: how long the next stop stands, what it is made of,
 * what the visit costs against staying out, where the car rejoins, and a
 * timer while it is under way.
 */
export interface PitStopConfig {
  background: { opacity: number };
  /** Seconds added to every stop that stands, for reaction and the crew. */
  extraTime: number;
  /** The standing time turns red at or above this, seconds. */
  longStopThreshold: number;
  /** Chips for what the stop is made of. */
  showBreakdown: boolean;
  /** What the stop adds, and what the race still needs. */
  showRefuel: boolean;
  /** Laps and minutes the level set lasts. */
  showRunLength: boolean;
  /** Position and gaps after the stop. */
  showRejoin: boolean;
  /** Which cars the rejoin position counts. */
  rejoinScope: 'class' | 'overall';
  /** Cars in the pit lane and stops asked for. */
  showOccupancy: boolean;
  /** How long the finished stop stays on screen, seconds. */
  resultHold: number;
  /**
   * `whenPitting` shows the widget only with a stop requested (Le Mans
   * Ultimate), in the pit lane, and while the finished stop is held.
   */
  showMode: 'always' | 'whenPitting';
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/**
 * The fuel saver: what a lap may cost for the fuel or the energy to last
 * one lap longer, and what it would take to drop a stop.
 */
export interface FuelSaverConfig {
  background: { opacity: number };
  /** The consumption the targets are compared with. */
  basis: 'projected' | 'last' | 'average';
  /** Laps in the average, 2 to 10. */
  averageLaps: number;
  /** Kept back, in the unit shown: litres, gallons or percent. */
  reserve: number;
  /** Columns for one lap more each, 1 to 5. */
  moreLaps: number;
  /** Columns for one lap fewer each, 0 to 3. */
  fewerLaps: number;
  /** The last lap's consumption. */
  showLast: boolean;
  /** The "one stop fewer" line, in races. */
  showStopTarget: boolean;
  /** Count the stint's last lap only as far as pit entry. */
  pitEntryAllowance: boolean;
  /** Savings above this per cent of current use are drawn as out of reach. */
  reachShare: number;
  /** Fuel unit; energy is always percent. */
  fuelUnits: 'L' | 'gal';
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

/** The most stop lengths the finish projection gives a column each. */
export const FINISH_SCENARIOS_MAX = 6;
/** The longest stop length it takes, seconds. */
export const FINISH_SCENARIO_MAX_S = 300;

/**
 * The finish projection: where the race ends for a set of pit stop lengths,
 * what that leaves to cover and to put in, and how the class neighbours
 * come out once everyone has made the stops they still owe.
 */
export interface FinishProjectionConfig {
  background: { opacity: number };
  /**
   * Seconds lost in the pits, one fixed column each: at most
   * FINISH_SCENARIOS_MAX of them, each 0 to FINISH_SCENARIO_MAX_S.
   */
  scenarios: number[];
  /** Whether the leader loses the same time in a fixed column. */
  leaderStops: 'same' | 'none';
  /** The column for the stop the pit menu is set to. */
  showPlanned: boolean;
  /** The column for the stop that adds exactly what the finish needs. */
  showToFinish: boolean;
  /** The column for the last stop the player and the leader made. */
  showLast: boolean;
  /** Seconds added to every stop that is worked out, as in the pit stop widget. */
  extraTime: number;
  /** A finish within this many seconds of a line is drawn as uncertain. */
  nearRange: number;
  /** Laps added in the second refuel row, 1 to 5. */
  extraLaps: number;
  /** The second refuel row. */
  showExtraRefuel: boolean;
  /** What is missing for the laps to go, or the whole amount they need. */
  refuelDisplay: 'toAdd' | 'total';
  /** Fuel unit; energy is always percent. */
  fuelUnits: 'L' | 'gal';
  /** The two lap fractions TinyPedal's table is made of, as two more rows. */
  showLapFractions: boolean;
  /** The class rivals under the table. */
  showRivals: boolean;
  /** Rows for the class cars ahead and behind, 0 to 3 each. */
  rivalsAhead: number;
  rivalsBehind: number;
  /** Add what the difference in pace does over the laps left. */
  includePace: boolean;
  sessionVisibility: SessionVisibilitySettings;
  showOnlyWhenOnTrack: boolean;
}

export interface WidgetConfigMap {
  standings: StandingsConfig;
  relative: RelativeConfig;
  weather: WeatherConfig;
  weatherforecast: WeatherForecastConfig;
  wind: WindConfig;
  map: TrackMapConfig;
  flatmap: FlatTrackMapConfig;
  input: InputConfig;
  tachometer: TachometerConfig;
  shiftlight: ShiftLightConfig;
  fuel: FuelConfig;
  blindspotmonitor: BlindSpotMonitorConfig;
  radar: RadarConfig;
  garagecover: GarageCoverConfig;
  rejoin: RejoinIndicatorConfig;
  flag: FlagConfig;
  flagpanel: FlagPanelConfig;
  traffic: TrafficConfig;
  telemetryinspector: TelemetryInspectorConfig;
  fastercarsfrombehind: FasterCarsFromBehindConfig;
  pitlanehelper: PitlaneHelperConfig;
  pitstop: PitStopConfig;
  fuelsaver: FuelSaverConfig;
  finishorder: FinishProjectionConfig;
  streamchat: StreamChatConfig;
  laptimelog: LapTimeLogConfig;
  stinthistory: StintHistoryConfig;
  infobar: InformationBarConfig;
  slowcarahead: SlowCarAheadConfig;
  sectordelta: SectorDeltaConfig;
  deltaspeed: DeltaSpeedConfig;
  carsystems: CarSystemsConfig;
  tyres: TyresConfig;
  wear: WearConfig;
  chassis: ChassisConfig;
  damage: DamageConfig;
  liftcoast: LiftCoastConfig;
  hybrid: HybridConfig;
  systemperformance: SystemPerformanceConfig;
  frictioncircle: FrictionCircleConfig;
  brakeperformance: BrakePerformanceConfig;
  minimap: MinimapConfig;
  elevation: ElevationConfig;
  cruise: CruiseConfig;
  tracknotes: TrackNotesConfig;
  lapdelta: LapDeltaConfig;
  cornerdelta: CornerDeltaConfig;
  timing: TimingConfig;
  heartrate: HeartRateConfig;
  cornername: CornerNameOverlayConfig;
  battle: BattleConfig;
  classfields: ClassFieldsConfig;
  laptrace: LapTraceConfig;
  gantry: GantryConfig;
  pitwall: PitWallConfig;
  broadcast: BroadcastConfig;
  broadcastticker: BroadcastTickerConfig;
  broadcastevents: BroadcastEventsConfig;
  broadcastweather: BroadcastWeatherConfig;
  broadcastpodium: BroadcastPodiumConfig;
  stintplan: StintPlanConfig;
  strategytimeline: StrategyTimelineConfig;
}

export type TypedDashboardWidget<
  K extends keyof WidgetConfigMap = keyof WidgetConfigMap,
> = {
  [Id in K]: Omit<DashboardWidget, 'id' | 'config'> & {
    id: Id;
    config: WidgetConfigMap[Id] & Record<string, unknown>;
  };
}[K];

// ===========================
// Widget settings wrappers
// ===========================

export interface BaseWidgetSettings<T = Record<string, unknown>> {
  id?: string;
  type?: string;
  enabled: boolean;
  config: T;
}

/** Available settings tabs */
export type SettingsTabType =
  | 'display'
  | 'twitch'
  | 'youtube'
  | 'options'
  | 'visibility'
  | 'styling'
  | 'track'
  | 'drivers'
  | 'layout'
  | 'header'
  | 'footer'
  | 'history'
  | 'telemetry'
  | 'dashboard'
  | 'chromium'
  | 'incidents'
  | 'trace'
  | 'corner'
  | 'braking'
  | 'help'
  | 'dock'
  | 'standings'
  | 'pitstops';

/** Available widgets for the Fuel Calculator */
export type FuelWidgetType =
  | 'fuelLevel'
  | 'lapsRemaining'
  | 'fuelHeader'
  | 'consumption'
  | 'pitWindow'
  | 'endurance'
  | 'scenarios'
  | 'graph'
  | 'confidence'
  | 'keyInfo';

export interface ShiftPointSettings {
  enabled: boolean;
  indicatorType: 'glow' | 'pulse' | 'border';
  indicatorColor: string;
  carConfigs: Record<
    string,
    {
      enabled: boolean;
      carId: string;
      carName: string;
      gearCount: number;
      redlineRpm: number;
      gearShiftPoints: Record<string, { shiftRpm: number }>;
    }
  >;
}

export type StandingsWidgetSettings = BaseWidgetSettings<StandingsConfig>;
export type RelativeWidgetSettings = BaseWidgetSettings<RelativeConfig>;
export type WeatherWidgetSettings = BaseWidgetSettings<WeatherConfig>;
export type WeatherForecastWidgetSettings =
  BaseWidgetSettings<WeatherForecastConfig>;
export type WindWidgetSettings = BaseWidgetSettings<WindConfig>;
export type TrackMapWidgetSettings = BaseWidgetSettings<TrackMapConfig>;
export type FlatTrackMapWidgetSettings = BaseWidgetSettings<FlatTrackMapConfig>;
export type SteerWidgetSettings = BaseWidgetSettings<SteerConfig>;
export type InputWidgetSettings = BaseWidgetSettings<InputConfig>;
export type TachometerWidgetSettings = BaseWidgetSettings<TachometerConfig>;
export type ShiftLightWidgetSettings = BaseWidgetSettings<ShiftLightConfig>;
export type FuelWidgetSettings = BaseWidgetSettings<FuelConfig>;
export type BlindSpotMonitorWidgetSettings =
  BaseWidgetSettings<BlindSpotMonitorConfig>;
export type RadarWidgetSettings = BaseWidgetSettings<RadarConfig>;
export type RejoinIndicatorWidgetSettings =
  BaseWidgetSettings<RejoinIndicatorConfig>;
export type FlagWidgetSettings = BaseWidgetSettings<FlagConfig> & {
  id: 'flag';
};
export type FlagPanelWidgetSettings = BaseWidgetSettings<FlagPanelConfig>;
export type TrafficWidgetSettings = BaseWidgetSettings<TrafficConfig>;
export type ClassFieldsWidgetSettings = BaseWidgetSettings<ClassFieldsConfig>;
export type GarageCoverWidgetSettings = BaseWidgetSettings<GarageCoverConfig>;
export type TelemetryInspectorWidgetSettings =
  BaseWidgetSettings<TelemetryInspectorConfig>;
export type FasterCarsFromBehindWidgetSettings =
  BaseWidgetSettings<FasterCarsFromBehindConfig>;
export type PitlaneHelperWidgetSettings =
  BaseWidgetSettings<PitlaneHelperConfig>;
export type PitStopWidgetSettings = BaseWidgetSettings<PitStopConfig>;
export type FuelSaverWidgetSettings = BaseWidgetSettings<FuelSaverConfig>;
export type FinishProjectionWidgetSettings =
  BaseWidgetSettings<FinishProjectionConfig>;
export type StreamChatWidgetSettings = BaseWidgetSettings<StreamChatConfig>;
export type LapTimeLogWidgetSettings = BaseWidgetSettings<LapTimeLogConfig>;
export type StintHistoryWidgetSettings = BaseWidgetSettings<StintHistoryConfig>;
export type InformationBarWidgetSettings =
  BaseWidgetSettings<InformationBarConfig>;
export type SlowCarAheadWidgetSettings = BaseWidgetSettings<SlowCarAheadConfig>;
export type SectorDeltaWidgetSettings = BaseWidgetSettings<SectorDeltaConfig>;
export type DeltaSpeedWidgetSettings = BaseWidgetSettings<DeltaSpeedConfig>;
export type CarSystemsWidgetSettings = BaseWidgetSettings<CarSystemsConfig>;
export type TyresWidgetSettings = BaseWidgetSettings<TyresConfig>;
export type WearWidgetSettings = BaseWidgetSettings<WearConfig>;
export type ChassisWidgetSettings = BaseWidgetSettings<ChassisConfig>;
export type DamageWidgetSettings = BaseWidgetSettings<DamageConfig>;
export type LiftCoastWidgetSettings = BaseWidgetSettings<LiftCoastConfig>;
export type HybridWidgetSettings = BaseWidgetSettings<HybridConfig>;
export type SystemPerformanceWidgetSettings =
  BaseWidgetSettings<SystemPerformanceConfig>;
export type FrictionCircleWidgetSettings =
  BaseWidgetSettings<FrictionCircleConfig>;
export type BrakePerformanceWidgetSettings =
  BaseWidgetSettings<BrakePerformanceConfig>;
export type MinimapWidgetSettings = BaseWidgetSettings<MinimapConfig>;
export type ElevationWidgetSettings = BaseWidgetSettings<ElevationConfig>;
export type CruiseWidgetSettings = BaseWidgetSettings<CruiseConfig>;
export type TrackNotesWidgetSettings = BaseWidgetSettings<TrackNotesConfig>;
export type LapDeltaWidgetSettings = BaseWidgetSettings<LapDeltaConfig>;
export type CornerDeltaWidgetSettings = BaseWidgetSettings<CornerDeltaConfig>;
export type TimingWidgetSettings = BaseWidgetSettings<TimingConfig>;
export type HeartRateWidgetSettings = BaseWidgetSettings<HeartRateConfig>;
export type CornerNameWidgetSettings =
  BaseWidgetSettings<CornerNameOverlayConfig>;
export type BattleWidgetSettings = BaseWidgetSettings<BattleConfig>;
export type LapTraceWidgetSettings = BaseWidgetSettings<LapTraceConfig>;
export type StintPlanWidgetSettings = BaseWidgetSettings<StintPlanConfig>;
export type StrategyTimelineWidgetSettings =
  BaseWidgetSettings<StrategyTimelineConfig>;
