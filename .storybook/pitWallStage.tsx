import type { Decorator } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import {
  EMPTY_FLAG_STATE,
  EMPTY_TRAFFIC,
  type ActiveSimulator,
  type ChannelPayloads,
  type DashboardBridge,
  type DashboardLayout,
  type FinishRival,
  type PitWallLayoutId,
  type Session,
  type TyreWheelState,
  type WearWheelSnapshot,
  type WeatherForecastNode,
} from '@irdashies/types';
import {
  DashboardProvider,
  RunningStateProvider,
  useSessionStore,
} from '../src/frontend/context';
import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
} from '../src/frontend/domain/ledger/ledgerSample';
import { defaultDashboard } from '../src/app/storage/defaultDashboard';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import { lmuEnduranceGrid, LMU_STORY_PLAYER } from './lmuEnduranceGrid';
import { mockDashboardBridge } from './mockDashboardBridge';
import { sessionBarStorySnapshot } from './sessionBarSnapshot';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * A staged eight-hour race for the Pit Wall stories: the made-up endurance
 * grid, three hours and thirty-three minutes in, with our LMGT3 third in
 * class. Every channel the hosted widgets read is given one snapshot, each
 * shaped like the one that widget's own stories use and pointed at the cars
 * of the grid. Every name and figure is invented.
 */
const grid = lmuEnduranceGrid;
const slot = grid.slotOf;
const PLAYER = slot(LMU_STORY_PLAYER);

/** Session time at the staged moment, and when the race went green. */
const SESSION_TIME = 16_524;
const GREEN_AT = 140;
const RACE_SECONDS = 8 * 3600;

const place = (values: readonly number[]) => values[PLAYER] ?? 0;
const classSize = grid.session.DriverInfo.Drivers.filter(
  (driver) =>
    driver.CarClassID === grid.session.DriverInfo.Drivers[PLAYER].CarClassID
).length;

/** The session with a team-mate named as the driver of our car. */
const withDriver = (name: string): Session => ({
  ...grid.session,
  DriverInfo: {
    ...grid.session.DriverInfo,
    Drivers: grid.session.DriverInfo.Drivers.map((driver) =>
      driver.CarIdx === PLAYER ? { ...driver, UserName: name } : driver
    ),
  },
});

const rival = (
  car: string,
  classPosition: number,
  gapS: number,
  values: Partial<FinishRival> = {}
): FinishRival => ({
  carIdx: slot(car),
  classPosition,
  ahead: gapS < 0,
  gapS,
  lapsLeft: 14.2,
  stopsOwed: 4,
  stopLossS: 58.4,
  basis: 'energy',
  projectedGapS: gapS,
  paceDeltaS: 0,
  inPit: false,
  ...values,
});

const wearWheel = (
  over: Partial<WearWheelSnapshot> = {}
): WearWheelSnapshot => ({
  treadPct: 84.2,
  treadLapPct: 0.4,
  treadProjectedPct: 0.9,
  treadPerLapPct: 0.92,
  treadRateSource: 'tyre',
  treadLapsLeft: 61,
  treadEndOfStintPct: 71.3,
  compound: 1,
  flat: false,
  brakeMm: 34.6,
  brakeLifePct: 76.7,
  brakeLapMm: 0.004,
  brakePerLapMm: 0.0098,
  brakeRateSource: 'stint',
  brakeLapsLeft: 469,
  brakeFailed: false,
  ...over,
});

const tyre = (
  surface: [number, number, number],
  brake: number,
  pressureKpa: number
): TyreWheelState => ({
  surfaceTempC: surface,
  innerLayerTempC: surface.map((value) => value + 6),
  carcassTempC: surface[1] + 9,
  optimalTempC: 92,
  pressureKpa,
  pressureDeviationKpa: null,
  treadRemaining: 0.84,
  brakeTempC: brake,
  compound: 0,
});

const forecastNode = (
  index: number,
  skyType: number,
  airTempC: number,
  rainChance: number,
  startsInMinutes: number
): WeatherForecastNode => ({
  index,
  skyType,
  airTempC,
  rainChance,
  humidity: 0.5 + index * 0.04,
  windSpeedMs: 6 - index,
  windDirectionRad: (7 * Math.PI) / 4,
  startsInMinutes,
  startsAtTimeOfDay: 66_780 + startsInMinutes * 60,
});

const ledger = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

/** Every car's best lap, as the timing widgets read the field's. */
const bestLaps =
  grid.session.SessionInfo.Sessions[0].ResultsPositions?.reduce<number[]>(
    (laps, result) => {
      laps[result.CarIdx] = result.FastestTime;
      return laps;
    },
    []
  ) ?? [];

const sectorResult = {
  currentLapSectorTimes: [78.412, null, null],
  previousLapSectorTimes: [78.905, 96.214, 62.169],
  currentLapSectorUnclean: [false, false, false],
  previousLapSectorUnclean: [false, false, false],
  sessionBestSectorTimes: [78.412, 95.98, 62.169],
  previousSessionBestSectorTimes: [78.412, 95.98, 62.169],
  sessionBestLapSectorTimes: [78.905, 96.214, 62.169],
  finishedLapSectorTimes: [78.905, 96.214, 62.169],
};

interface StageOptions {
  /** A team-mate is driving and the user watches the team car. */
  watching?: boolean;
}

/** The channel snapshots of the staged race. */
export const pitWallStageSnapshots = ({
  watching = false,
}: StageOptions = {}): Partial<ChannelPayloads> => ({
  'standings.snapshot': grid.standings,
  'lap-times.snapshot': {
    lapTimes: bestLaps,
    lapTimeHistory: [],
    sessionNum: 0,
    version: 1,
  },
  'track-state.snapshot': {
    ...trackStateStorySnapshot,
    focusCarIdx: PLAYER,
    sessionTime: SESSION_TIME,
    lapDistPct: 0.41,
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
  'session-bar.snapshot': {
    ...sessionBarStorySnapshot,
    sessionName: 'RACE',
    trackDisplayName: 'Circuit de la Sarthe',
    sessionTimeOfDay: 18 * 3600 + 33 * 60,
    timeScale: 1,
    airTemp: 16,
    trackTemp: 24,
    trackWetness: 1,
    precipitation: 0,
    relativeHumidity: 0.52,
    virtualEnergy: 0.45,
    playerCarIdx: PLAYER,
    playerClassified: true,
    playerOverallPosition: place(grid.standings.carIdxPosition),
    playerClassPosition: place(grid.standings.carIdxClassPosition),
    playerClassSize: classSize,
    lastLapTime: 237.288,
    bestLapTime: 237.288,
    sessionNum: 0,
    version: 1,
  },
  'session-timing.snapshot': {
    sessionType: 'Race',
    state: 4,
    currentLap: 31,
    totalLaps: 0,
    time: SESSION_TIME,
    timeTotal: RACE_SECONDS,
    timeRemaining: RACE_SECONDS - SESSION_TIME,
    greenFlagTimestamp: GREEN_AT,
    isFixedLapRace: false,
    totalRaceLaps: 0,
    totalRaceTime: 0,
    adjustedRaceTime: 0,
    sessionNum: 0,
    version: 1,
  },
  'flag-state.snapshot': {
    ...EMPTY_FLAG_STATE,
    kind: 'green',
    detail: 'trackClear',
    yellowSectors: [false, false, false],
    playerSector: 1,
    sessionNum: 0,
    version: 1,
  },
  'fuel.projection': {
    isReplay: false,
    fuelLevel: 33.9,
    fuelLevelPct: 0.45,
    currentLap: 31,
    lapDistPct: 0.41,
    currentLapUsage: 1.2,
    projectedLapUsage: 2.3,
    lastLapUsage: 2.34,
    sessionLapsRemain: 53,
    sessionTimeRemain: RACE_SECONDS - SESSION_TIME,
    sessionTimeTotal: RACE_SECONDS,
    sessionFlags: 0,
    sessionState: 4,
    sessionNum: 0,
    sessionLaps: 0,
    calculatedTotalRaceLaps: 84,
    estimatedLapsRemaining: 53,
    hasValidRaceEstimate: true,
    isFixedLapRace: false,
    sessionType: 'Race',
    isOnTrack: !watching,
    fuelTankCapacity: 75,
    completedLaps: [],
    engine: {
      accumulatedRefuel: 0,
      isLapDistPctReset: false,
      lapCrossingTime: SESSION_TIME - 97,
      lapStartFuel: 35.1,
      lastLap: 31,
      lastLapDistPct: 0.41,
      lastSessionFlags: 0,
      wasOnPitRoad: false,
    },
  },
  'pit-stop.snapshot': {
    phase: 'planning',
    requested: false,
    lane: {
      entryPct: 0.95,
      exitPct: 0.03,
      lengthM: 410.5,
      speedLimitMs: 16.6,
      speedLimitSource: 'measured',
      driveAtLimitS: 24.7,
      driveMeasuredS: 31.2,
      trackTimeS: 9.4,
    },
    estimate: {
      source: 'sim',
      standingS: 27.2,
      parts: {
        fuel: 0,
        energy: 27.2,
        tyres: 0,
        damage: 0,
        driverSwap: 0,
        brakes: 0,
        brakeDucts: 0,
        penalties: 0,
      },
      optionalRepairS: null,
      samples: 0,
      penalty: null,
    },
    planned: null,
    timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
    last: null,
    refuel: {
      isVirtualEnergy: true,
      target: 100,
      aboard: 45,
      toAdd: 55,
      toFinish: 100,
      runLaps: 14.2,
      runMinutes: 56.1,
    },
    rejoin: {
      position: 15,
      classPosition: 5,
      ladder: [
        { carIdx: slot('777'), gapS: -9.8, sameClass: true, inPit: false },
        { carIdx: slot('10'), gapS: -3.1, sameClass: false, inPit: false },
        { carIdx: slot('54'), gapS: 4.1, sameClass: true, inPit: false },
        { carIdx: slot('27'), gapS: 41.6, sameClass: true, inPit: false },
      ],
      driveToExitS: 52.4,
      passes: [],
    },
    sessionNum: 0,
    version: 1,
  },
  'car-pit.snapshot': {
    where: [],
    laneTimeS: [],
    standingS: [],
    stops: [],
    lastPitLap: [],
    lastStopLap: [],
    stintLaps: [],
    longestStintLaps: [],
    usedLastLap: [],
    usedAverage: [],
    lapsLeft: [],
    requested: [],
    counts: {
      onTrack: 17,
      inLane: 1,
      standingInLane: 1,
      requested: 0,
      inGarage: 1,
    },
    sessionNum: 0,
    version: 1,
  },
  'finish-projection.snapshot': {
    valid: true,
    reason: null,
    raceType: 'time',
    timeLeftS: RACE_SECONDS - (SESSION_TIME - GREEN_AT),
    lapLimit: null,
    leader: {
      carIdx: slot('8'),
      paceS: 209.1,
      progress: 34.4,
      lastStopLossS: 61.2,
    },
    player: {
      carIdx: PLAYER,
      paceS: 237.6,
      progress: 30.41,
      lastStopLossS: 58.4,
    },
    lapsToGo: 52.6,
    energy: { isVirtualEnergy: true, perLap: 3.17, aboard: 45, capacity: 100 },
    laneLossS: 31.2,
    plannedStandingS: 27.2,
    refuelLines: [
      { fixedS: 0, perUnitS: 0.4 },
      { fixedS: 2.42, perUnitS: 0.3029 },
    ],
    separateS: 0,
    overlapS: 0,
    playerStopsOwed: 4,
    rivals: [
      rival('46', 2, -38.1, { projectedGapS: -33.4, paceDeltaS: -0.2 }),
      rival('92', 1, -45.2, { projectedGapS: -47.9, paceDeltaS: -0.3 }),
      rival('777', 4, 19.0, { projectedGapS: 22.6, paceDeltaS: 0.31 }),
      rival('54', 5, 73.7, {
        stopsOwed: 5,
        projectedGapS: 131.2,
        paceDeltaS: 0.12,
      }),
      rival('27', 6, 228.1, { projectedGapS: 236.4, paceDeltaS: 0.34 }),
    ],
    sessionNum: 0,
    version: 1,
  },
  'player-ledger.snapshot': ledger.ledger,
  'player-stint.snapshot': ledger.live,
  'wear.snapshot': {
    available: true,
    wheels: [
      wearWheel({ treadPct: 84.2 }),
      wearWheel({ treadPct: 85.1 }),
      wearWheel({ treadPct: 88.4, brakeMm: 30.9, brakeLifePct: 45 }),
      wearWheel({ treadPct: 89.0, brakeMm: 30.9, brakeLifePct: 45 }),
    ],
    paceLapTime: 237.6,
    budgetLapsLeft: 14.2,
    brakeNewMm: [36, 32],
    brakeFailureMm: [30, 30],
    brakeFailureSource: ['class', 'class'],
    brakeStale: false,
    sessionNum: 0,
    version: 1,
  },
  'weather-forecast.snapshot': {
    available: true,
    now: {
      skyType: 0,
      airTempC: 16,
      rain: 0,
      airTempTrend: -1,
      rainTrend: 0,
    },
    nodes: [
      forecastNode(1, 1, 15, 0.1, 60),
      forecastNode(2, 5, 14, 0.6, 120),
      forecastNode(3, 7, 13, 0.85, 180),
      forecastNode(4, 2, 13, 0.2, 240),
    ],
    lapLimited: false,
    sessionNum: 0,
    version: 1,
  },
  'traffic.snapshot': {
    ...EMPTY_TRAFFIC,
    behind: [
      {
        carIdx: slot('6'),
        relation: 'lapping',
        distanceM: 410,
        gapS: 7.4,
        measured: true,
        closingS: 0.31,
        lapsAhead: 4,
      },
    ],
    forecast: {
      carIdx: slot('6'),
      etaS: 24,
      lowS: 19,
      highS: 30,
      steady: true,
      laps: 0.1,
      meetPct: 0.52,
      meetLowPct: 0.49,
      meetHighPct: 0.55,
    },
    slowerAhead: { carIdx: slot('54'), gapS: 73.7, laps: 9.4, thisLap: false },
    leader: { carIdx: slot('8'), gapS: 86.0, laps: 3.1, thisLap: false },
    fasterBehind: { carIdx: slot('22'), gapS: 62.4, laps: 2.2, thisLap: false },
    lapS: 237.6,
    sessionNum: 0,
    version: 1,
  },
  'lap-log.snapshot': {
    lapCompleted: 30,
    currentLapTime: 97.3,
    lastLapTime: 237.288,
    bestLapTime: 237.288,
    ownBestLapTime: 237.288,
    carIdxBestLapTime: bestLaps,
    sessionNum: 0,
    sessionTime: SESSION_TIME,
    playerTrackSurface: 3,
    incidentCount: 0,
    lapDistPct: 0.41,
    deltaToSessionLastLap: 0,
    deltaToSessionLastLapOk: false,
    deltaToSessionBestLap: -0.212,
    deltaToSessionBestLapOk: true,
    lapInvalidated: false,
    lastLapInvalid: false,
    lastLapUnderCaution: false,
    version: 1,
  },
  'lap-delta.snapshot': {
    sessionBest: { lapTime: 237.288, delta: -0.212, trend: -0.02 },
    allTime: { lapTime: 236.94, delta: 0.136, trend: -0.02 },
    stintBest: { lapTime: 237.288, delta: -0.212, trend: -0.02 },
    lastLap: { lapTime: 237.288, delta: -0.212, trend: -0.02 },
    lastLapFinal: null,
    stintId: 4,
    sessionNum: 0,
    version: 1,
  },
  'sector-timing.snapshot': {
    sectors: [0, 1, 2].map((index) => ({
      SectorNum: index,
      SectorStartPct: index / 3,
    })),
    currentSectorIdx: 1,
    sectorEntryTime: SESSION_TIME - 19,
    sectorEntryValid: true,
    inclusive: sectorResult,
    clean: sectorResult,
    allTime: null,
    sessionNum: 0,
    version: 1,
  },
  'tyre-state.snapshot': {
    available: true,
    wheels: [
      tyre([88, 92, 95], 480, 186.1),
      tyre([87, 91, 96], 495, 186.9),
      tyre([90, 93, 94], 410, 185.2),
      tyre([89, 92, 95], 405, 185.9),
    ],
    sessionNum: 0,
    version: 1,
  },
  'wheel-dynamics.snapshot': {
    available: true,
    rideHeightMm: [51.2, 50.1, 60.3, 59.4],
    suspensionPositionMm: [64.8, 65.6, 76.6, 77.9],
    loadShare: [0.232, 0.228, 0.274, 0.266],
    loadSource: 'suspensionForce',
    loadTotalN: 18_940,
    tyreDeflectionMm: [15.9, 17.1, 18.9, 20.1],
    camberDeg: [-2.01, -2.18, -1.7, -1.61],
    toeDeg: [-0.05, -0.05, 0.1, 0.11],
    toeTotalDeg: [-0.1, 0.21],
    rakeMm: 8.9,
    rollMm: [-1.1, -0.9],
    rollShareFront: 0.55,
    sessionNum: 0,
    version: 1,
  },
  'damage.snapshot': {
    available: true,
    body: [1, 0, 0, 0, 0, 0, 0, 0],
    wheels: [0, 1, 2, 3].map(() => ({
      detached: false,
      punctured: false,
      suspensionDamage: 0,
    })),
    bodyIntegrity: 0.94,
    aeroIntegrity: 0.97,
    suspensionIntegrity: 1,
    tyreIntegrity: 0.98,
    overheating: false,
    impactBearingRad: null,
    repairSeconds: 0,
    repairChoice: 'Do Not Repair',
    sessionNum: 0,
    version: 1,
  },
});

export interface PitWallStage {
  layout?: PitWallLayoutId;
  /** The sim the page believes is running; null for none detected. */
  simulator?: ActiveSimulator | null;
  /** False stages the app with no sim running. */
  running?: boolean;
  /** False stages a running sim that is in no session. */
  inSession?: boolean;
  /** A team-mate drives and the user watches; names who is at the wheel. */
  teamMate?: string;
  /** Widget ids to take out of the profile, to stage a missing widget. */
  without?: readonly string[];
  /** The Pit Wall's own content scale, percent. */
  scale?: number;
}

/**
 * A dashboard bridge that keeps what is saved to it, so the header's layout
 * switch works in a story as it does in the app.
 */
const stageBridge = ({
  layout = 'race',
  simulator = 'lmu',
  without = [],
  scale,
}: PitWallStage): DashboardBridge => {
  let dashboard: DashboardLayout = {
    ...defaultDashboard,
    widgets: defaultDashboard.widgets
      .filter((widget) => !without.includes(widget.id))
      .map((widget) =>
        widget.id === 'pitwall'
          ? { ...widget, enabled: true, scale, config: { layout } }
          : widget
      ),
  };
  const listeners = new Set<
    Parameters<DashboardBridge['dashboardUpdated']>[0]
  >();
  return {
    ...mockDashboardBridge,
    getActiveSimulator: async () => simulator,
    openWidgetSettings: async () => undefined,
    resetDashboard: async () => dashboard,
    saveDashboard: (next) => {
      dashboard = next;
      listeners.forEach((listener) => listener(dashboard, undefined));
    },
    dashboardUpdated: (callback) => {
      listeners.add(callback);
      callback(dashboard, undefined);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};

/**
 * Everything a Pit Wall story needs around it: the staged session, the
 * channels, a dashboard with the page's layout chosen, and whether a sim is
 * running. The story itself only renders the page.
 */
export const pitWallStage = (stage: PitWallStage = {}) => {
  const { running = true, inSession = true, teamMate } = stage;
  const bridge = stageBridge(stage);
  const session =
    !running || !inSession
      ? null
      : teamMate
        ? withDriver(teamMate)
        : grid.session;
  const runningState = {
    onRunningState: (callback: (running: boolean) => void) => {
      callback(running);
      return () => undefined;
    },
    onSessionData: () => () => undefined,
    getRunningState: async () => running,
    stop: () => undefined,
  };
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={bridge}>
        <RunningStateProvider bridge={runningState}>
          <Story />
        </RunningStateProvider>
      </DashboardProvider>
    ),
    ChannelSnapshotDecorator(
      session ? pitWallStageSnapshots({ watching: !!teamMate }) : {}
    ),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session });
      },
    ],
    decorators,
  };
};
