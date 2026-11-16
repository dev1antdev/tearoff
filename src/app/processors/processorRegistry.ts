import type {
  FlagProcessorTuning,
  LapTimesSnapshot,
  RadarProcessorTuning,
  ReferenceLapsSnapshot,
  Telemetry,
} from '@irdashies/types';
import type {
  PlayerReferenceLapSource,
  PlayerStintSource,
  ReferenceLapPersistence,
} from './ReferenceLapProcessor';
import type { SectorBestsOptions } from './SectorTimingProcessor';
import { CarSpeedsProcessor } from './CarSpeedsProcessor';
import { BlindSpotProcessor } from './BlindSpotProcessor';
import { CarPitProcessor } from './CarPitProcessor';
import { CarSectorsProcessor } from './CarSectorsProcessor';
import {
  createMemoryPitLaneModelStore,
  PitStopEstimateProcessor,
  type PitLaneModelStore,
} from './PitStopEstimateProcessor';
import {
  TrackProfileProcessor,
  type TrackProfileSource,
} from './TrackProfileProcessor';
import {
  CruiseProcessor,
  type DrivingTotalsPersistence,
} from './CruiseProcessor';
import { DriverControlsProcessor } from './DriverControlsProcessor';
import { FinishProjectionProcessor } from './FinishProjectionProcessor';
import { FlagStateProcessor } from './FlagStateProcessor';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';
import { RaceForecastProcessor } from './RaceForecastProcessor';
import { HybridProcessor } from './HybridProcessor';
import { LapDeltaProcessor } from './LapDeltaProcessor';
import { LapLogProcessor } from './LapLogProcessor';
import { LapTimesProcessor } from './LapTimesProcessor';
import { LapTraceSampleProcessor } from './LapTraceSampleProcessor';
import { MinimapProcessor } from './MinimapProcessor';
import type {
  AnyProcessorDefinition,
  ProcessorMetrics,
  ProcessorDefinition,
} from './ProcessorHost';
import { ProcessorHost } from './ProcessorHost';
import type { ChannelBus } from '../bridge/channelBus';
import type { SessionLifecycle } from '../sessionLifecycle';
import {
  noRacePlanHistory,
  RacePlanProgressProcessor,
  type RacePlanHistoryPersistence,
  type RacePlanSelection,
} from './RacePlanProgressProcessor';
import { RadarProcessor } from './RadarProcessor';
import { RadioProcessor } from './RadioProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { RelativeGapProcessor } from './RelativeGapProcessor';
import { SectorTimingProcessor } from './SectorTimingProcessor';
import { SessionBarProcessor } from './SessionBarProcessor';
import { CarSystemsProcessor } from './CarSystemsProcessor';
import { SessionTimingProcessor } from './SessionTimingProcessor';
import { StandingsProcessor } from './StandingsProcessor';
import { TrackStateProcessor } from './TrackStateProcessor';
import { TrafficProcessor } from './TrafficProcessor';
import { TyreStateProcessor } from './TyreStateProcessor';
import { WheelDynamicsProcessor } from './WheelDynamicsProcessor';
import { DamageProcessor } from './DamageProcessor';
import { SystemPerformanceProcessor } from './SystemPerformanceProcessor';
import { GForceProcessor } from './GForceProcessor';
import { BrakingProcessor } from './BrakingProcessor';
import { WeatherForecastProcessor } from './WeatherForecastProcessor';
import type { SystemLoadSource } from '../services/systemLoadSampler';
import type { PoleSideSettings } from '@irdashies/types';

interface ProcessorRegistryOptions {
  referenceLapPersistence: ReferenceLapPersistence;
  /**
   * The lap library's answer to "which lap is the player's all-time
   * reference on this track in this car". Without it there is no all-time
   * reference at all.
   */
  playerReferenceLaps?: PlayerReferenceLapSource;
  /**
   * Which of the player's stints is under way, from the ledger. Without it
   * the best lap of a stint ends when the car stops in the pits.
   */
  playerStints?: PlayerStintSource;
  /**
   * Where the player's all-time sector bests are kept and which simulator
   * they are filed under. Without it there are none.
   */
  sectorBests?: SectorBestsOptions;
  /** The radar's dev tuning from the current dashboard; defaults without. */
  radarTuning?: () => RadarProcessorTuning;
  /** The player's own pole side per track; the table's without. */
  radarPoleSides?: PoleSideSettings;
  /**
   * The yellow ranges of the flag panel from the current dashboard; 500 m
   * ahead and 50 m behind without.
   */
  flagTuning?: () => FlagProcessorTuning;
  /**
   * The machine's and Tearoff's own load, read outside the processors;
   * without it the system performance channel carries only the sim's meters.
   */
  systemLoad?: SystemLoadSource;
  /**
   * The stored track profiles and the simulator they are filed under;
   * without them the track profile channel names no track.
   */
  trackProfiles?: { source: TrackProfileSource; simulator: string };
  /**
   * Where the metres and seconds driven on each track in each car are kept,
   * and the simulator they are filed under; without it the cruise block's
   * all-time totals are those of the run.
   */
  drivingTotals?: { persistence: DrivingTotalsPersistence; simulator: string };
  /**
   * Where each track's pit lane model is kept; without it the model lasts
   * as long as the app runs and no longer.
   */
  pitLaneModel?: PitLaneModelStore;
  /** The race plan in use and its history; without it there is no plan. */
  racePlan?: {
    getPlan: () => RacePlanSelection | null;
    persistence: RacePlanHistoryPersistence;
    /** Epoch milliseconds; defaults to Date.now. */
    now?: () => number;
  };
}

interface DefaultProcessorHostOptions extends ProcessorRegistryOptions {
  bus: ChannelBus;
  lifecycle?: SessionLifecycle;
  metrics: ProcessorMetrics;
  aggregateReplay?: boolean;
  frameClock?: (frame: Telemetry) => number | undefined;
  logError?: (message: string, error: unknown) => void;
}

const noReferenceLaps: ReferenceLapsSnapshot = {
  bestLaps: [],
  persistedLaps: [],
  sessionNum: null,
  version: 0,
};

const noLapTimes: LapTimesSnapshot = {
  lapTimes: [],
  lapTimeHistory: [],
  sessionNum: null,
  version: 0,
};

const noCarSpeeds: readonly number[] = [];

const defineProcessor = <K extends AnyProcessorDefinition['channel']>(
  definition: ProcessorDefinition<K>
): ProcessorDefinition<K> => definition;

export const createProcessorDefinitions = ({
  referenceLapPersistence,
  playerReferenceLaps,
  playerStints,
  sectorBests,
  radarTuning,
  radarPoleSides,
  flagTuning,
  systemLoad,
  trackProfiles,
  drivingTotals,
  pitLaneModel = createMemoryPitLaneModelStore(),
  racePlan,
}: ProcessorRegistryOptions): readonly AnyProcessorDefinition[] => [
  defineProcessor({
    channel: 'blind-spot.snapshot',
    metricsPrefix: 'blindSpot',
    create: () => new BlindSpotProcessor(),
  }),
  defineProcessor({
    channel: 'fuel.projection',
    metricsPrefix: 'fuelProjection',
    create: ({ sourceReplay }) => new FuelProjectionProcessor({ sourceReplay }),
  }),
  defineProcessor({
    channel: 'lap-times.snapshot',
    // Gantry's last-lap columns need the history built while it was minimised.
    processWhileHidden: true,
    metricsPrefix: 'lapTimes',
    create: () => new LapTimesProcessor(),
  }),
  defineProcessor({
    channel: 'car-speeds.snapshot',
    metricsPrefix: 'carSpeeds',
    create: () => new CarSpeedsProcessor(),
  }),
  defineProcessor({
    channel: 'car-pit.snapshot',
    // Stops and stints are counted over the whole race, so a hidden overlay
    // must not miss one.
    processWhileHidden: true,
    metricsPrefix: 'carPit',
    create: () => new CarPitProcessor(),
  }),
  defineProcessor({
    channel: 'car-sectors.snapshot',
    // The bests are the quickest sectors seen in the session: a window that
    // is hidden, or closed and opened again, must not start them over.
    processWhileHidden: true,
    retainWhenInactive: true,
    metricsPrefix: 'carSectors',
    create: () => new CarSectorsProcessor(),
  }),
  defineProcessor({
    channel: 'pit-stop.snapshot',
    // What a lap costs, every car's pace, and their best laps to read a
    // stretch of track off.
    dependencies: [
      'fuel.projection',
      'lap-times.snapshot',
      'reference-laps.snapshot',
    ],
    // A stop is timed from an entry line that a hidden overlay must not
    // miss, and the sim's own pit stop screen is what hides it.
    processWhileHidden: true,
    // Not 'pitStop', which is the record of every car's stops.
    metricsPrefix: 'pitStopEstimate',
    create: ({ snapshot, sourceReplay }) =>
      new PitStopEstimateProcessor({
        store: pitLaneModel,
        fuel: () => snapshot('fuel.projection'),
        lapTimes: () => snapshot('lap-times.snapshot'),
        referenceLaps: () => snapshot('reference-laps.snapshot'),
        sourceReplay,
      }),
  }),
  defineProcessor({
    channel: 'finish-projection.snapshot',
    // The race as the fuel projection projects it, every car's pace, the
    // pit lane and the planned stop, every car's stints and pit visits, and
    // the class order with the race gaps.
    dependencies: [
      'fuel.projection',
      'lap-times.snapshot',
      'pit-stop.snapshot',
      'car-pit.snapshot',
      'standings.snapshot',
    ],
    // It keeps nothing itself, but the stints it reads are counted over the
    // whole race by processors that live only while something wants them:
    // dropped with a hidden overlay, every rival's stint would start again.
    processWhileHidden: true,
    metricsPrefix: 'finishProjection',
    create: ({ snapshot }) =>
      new FinishProjectionProcessor({
        fuel: () => snapshot('fuel.projection'),
        lapTimes: () => snapshot('lap-times.snapshot'),
        pitStop: () => snapshot('pit-stop.snapshot'),
        carPit: () => snapshot('car-pit.snapshot'),
        standings: () => snapshot('standings.snapshot'),
      }),
  }),
  defineProcessor({
    channel: 'race-forecast.snapshot',
    // What the finish projection reads: it runs one of its own over the
    // whole class, so the two stand on the same five snapshots.
    dependencies: [
      'fuel.projection',
      'lap-times.snapshot',
      'pit-stop.snapshot',
      'car-pit.snapshot',
      'standings.snapshot',
    ],
    // As for the finish projection, and for one thing more: the place it
    // forecast some laps ago is remembered lap by lap.
    processWhileHidden: true,
    metricsPrefix: 'raceForecast',
    create: ({ snapshot }) =>
      new RaceForecastProcessor({
        fuel: () => snapshot('fuel.projection'),
        lapTimes: () => snapshot('lap-times.snapshot'),
        pitStop: () => snapshot('pit-stop.snapshot'),
        carPit: () => snapshot('car-pit.snapshot'),
        standings: () => snapshot('standings.snapshot'),
      }),
  }),
  defineProcessor({
    channel: 'track-profile.snapshot',
    metricsPrefix: 'trackProfile',
    create: () =>
      new TrackProfileProcessor(
        trackProfiles?.source,
        trackProfiles?.simulator
      ),
  }),
  defineProcessor({
    channel: 'cruise.snapshot',
    // The odometer counts what is driven while the overlay is hidden too,
    // and the session's figures outlast a widget being switched off.
    processWhileHidden: true,
    retainWhenInactive: true,
    metricsPrefix: 'cruise',
    create: ({ aggregateReplay }) =>
      new CruiseProcessor(
        // A replayed tape is somebody's old session: its metres are not the
        // player's to keep.
        aggregateReplay ? undefined : drivingTotals?.persistence,
        drivingTotals?.simulator
      ),
  }),
  defineProcessor({
    channel: 'flag-state.snapshot',
    // Speeds find the stopped car a yellow is for and say whether the car a
    // blue is for is closing.
    dependencies: ['car-speeds.snapshot'],
    metricsPrefix: 'flagState',
    create: ({ snapshot }) =>
      new FlagStateProcessor({
        carSpeeds: () =>
          snapshot('car-speeds.snapshot')?.carSpeeds ?? noCarSpeeds,
        tuning: flagTuning,
      }),
  }),
  defineProcessor({
    channel: 'traffic.snapshot',
    // Speeds say when a car behind reaches the player; measured lap times
    // turn seconds into laps and steady a forecast further off.
    dependencies: ['car-speeds.snapshot', 'lap-times.snapshot'],
    metricsPrefix: 'traffic',
    create: ({ snapshot }) =>
      new TrafficProcessor({
        carSpeeds: () =>
          snapshot('car-speeds.snapshot')?.carSpeeds ?? noCarSpeeds,
        lapTimes: () => (snapshot('lap-times.snapshot') ?? noLapTimes).lapTimes,
      }),
  }),
  defineProcessor({
    channel: 'reference-laps.snapshot',
    retainWhenInactive: true,
    metricsPrefix: 'referenceLap',
    create: ({ aggregateReplay }) =>
      new ReferenceLapProcessor(
        aggregateReplay
          ? { load: () => null, save: () => undefined }
          : referenceLapPersistence,
        // A replayed tape is somebody's old session: the player's laps are
        // not its to be measured by.
        aggregateReplay ? undefined : playerReferenceLaps,
        playerStints
      ),
  }),
  defineProcessor({
    channel: 'lap-delta.snapshot',
    dependencies: ['reference-laps.snapshot'],
    metricsPrefix: 'lapDelta',
    create: ({ snapshot }) =>
      new LapDeltaProcessor({
        snapshot: () => snapshot('reference-laps.snapshot') ?? noReferenceLaps,
      }),
  }),
  defineProcessor({
    channel: 'relative-gaps.snapshot',
    dependencies: ['reference-laps.snapshot'],
    metricsPrefix: 'relativeGap',
    create: ({ snapshot }) =>
      new RelativeGapProcessor({
        snapshot: () => snapshot('reference-laps.snapshot') ?? noReferenceLaps,
      }),
  }),
  defineProcessor({
    channel: 'sector-timing.snapshot',
    metricsPrefix: 'sectorTiming',
    // A replayed tape is somebody's old session: its sectors are not the
    // player's to keep.
    create: ({ aggregateReplay }) =>
      new SectorTimingProcessor(aggregateReplay ? undefined : sectorBests),
  }),
  defineProcessor({
    channel: 'standings.snapshot',
    metricsPrefix: 'standings',
    // Retain finish crossings when subscribed overlays are temporarily hidden.
    processWhileHidden: true,
    create: () => new StandingsProcessor(),
  }),
  defineProcessor({
    channel: 'radar.snapshot',
    metricsPrefix: 'radar',
    create: () => new RadarProcessor(radarTuning, radarPoleSides),
  }),
  defineProcessor({
    channel: 'radio.snapshot',
    metricsPrefix: 'radio',
    create: () => new RadioProcessor(),
  }),
  defineProcessor({
    channel: 'session-timing.snapshot',
    dependencies: ['lap-times.snapshot'],
    metricsPrefix: 'sessionTiming',
    create: ({ snapshot }) =>
      new SessionTimingProcessor(
        () => (snapshot('lap-times.snapshot') ?? noLapTimes).lapTimes
      ),
  }),
  defineProcessor({
    channel: 'session-bar.snapshot',
    metricsPrefix: 'sessionBar',
    create: () => new SessionBarProcessor(),
  }),
  defineProcessor({
    channel: 'car-systems.snapshot',
    metricsPrefix: 'carSystems',
    create: () => new CarSystemsProcessor(),
  }),
  defineProcessor({
    channel: 'hybrid.snapshot',
    // The lap's totals and the lap the next one is measured against are
    // built up over laps: the overlay going off the screen for a pause must
    // not throw them away.
    processWhileHidden: true,
    metricsPrefix: 'hybrid',
    create: () => new HybridProcessor(),
  }),
  defineProcessor({
    channel: 'driver-controls.snapshot',
    metricsPrefix: 'driverControls',
    create: () => new DriverControlsProcessor(),
  }),
  defineProcessor({
    channel: 'track-state.snapshot',
    metricsPrefix: 'trackState',
    create: () => new TrackStateProcessor(),
  }),
  defineProcessor({
    channel: 'tyre-state.snapshot',
    metricsPrefix: 'tyreState',
    create: () => new TyreStateProcessor(),
  }),
  defineProcessor({
    channel: 'wheel-dynamics.snapshot',
    metricsPrefix: 'wheelDynamics',
    create: () => new WheelDynamicsProcessor(),
  }),
  defineProcessor({
    channel: 'damage.snapshot',
    metricsPrefix: 'damage',
    create: () => new DamageProcessor(),
  }),
  defineProcessor({
    channel: 'system-performance.snapshot',
    metricsPrefix: 'systemPerformance',
    create: () => new SystemPerformanceProcessor(systemLoad),
  }),
  defineProcessor({
    channel: 'g-force.snapshot',
    // The held maxima outlast the overlay being hidden.
    retainWhenInactive: true,
    metricsPrefix: 'gForce',
    create: () => new GForceProcessor(),
  }),
  defineProcessor({
    channel: 'braking.snapshot',
    // So do the last zone and the bests it is measured against.
    retainWhenInactive: true,
    metricsPrefix: 'braking',
    create: () => new BrakingProcessor(),
  }),
  defineProcessor({
    channel: 'weather-forecast.snapshot',
    // The session bar measures how fast the in-game day runs, which turns
    // the minutes to a forecast point into the clock time it starts at.
    dependencies: ['session-bar.snapshot'],
    metricsPrefix: 'weatherForecast',
    create: ({ snapshot }) =>
      new WeatherForecastProcessor(
        () => snapshot('session-bar.snapshot')?.timeScale
      ),
  }),
  defineProcessor({
    channel: 'minimap.snapshot',
    metricsPrefix: 'minimap',
    create: () => new MinimapProcessor(),
  }),
  defineProcessor({
    channel: 'lap-trace.sample',
    metricsPrefix: 'lapTraceSample',
    create: () => new LapTraceSampleProcessor(),
  }),
  defineProcessor({
    channel: 'lap-log.snapshot',
    metricsPrefix: 'lapLog',
    create: () => new LapLogProcessor(),
  }),
  defineProcessor({
    channel: 'race-plan.progress',
    // Stint history is built over the whole race, so a minimised Gantry keeps it.
    processWhileHidden: true,
    metricsPrefix: 'racePlanProgress',
    create: ({ aggregateReplay, sourceReplay }) =>
      new RacePlanProgressProcessor({
        getPlan: racePlan?.getPlan ?? (() => null),
        persistence:
          racePlan && !aggregateReplay
            ? racePlan.persistence
            : noRacePlanHistory,
        now: racePlan?.now,
        // An aggregated tape replay is tracked like a live race.
        sourceReplay: sourceReplay && !aggregateReplay,
      }),
  }),
];

export const createDefaultProcessorHost = (
  options: DefaultProcessorHostOptions
): ProcessorHost =>
  new ProcessorHost({
    bus: options.bus,
    lifecycle: options.lifecycle,
    metrics: options.metrics,
    aggregateReplay: options.aggregateReplay,
    frameClock: options.frameClock,
    logError: options.logError,
    definitions: createProcessorDefinitions(options),
  });
