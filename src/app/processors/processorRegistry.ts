import type {
  FlagProcessorTuning,
  LapTimesSnapshot,
  RadarProcessorTuning,
  ReferenceLapsSnapshot,
  Telemetry,
} from '@irdashies/types';
import type {
  PlayerReferenceLapSource,
  ReferenceLapPersistence,
} from './ReferenceLapProcessor';
import { CarSpeedsProcessor } from './CarSpeedsProcessor';
import { BlindSpotProcessor } from './BlindSpotProcessor';
import { DriverControlsProcessor } from './DriverControlsProcessor';
import { FlagStateProcessor } from './FlagStateProcessor';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';
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
import { TyreStateProcessor } from './TyreStateProcessor';
import { SystemPerformanceProcessor } from './SystemPerformanceProcessor';
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
  radarTuning,
  radarPoleSides,
  flagTuning,
  systemLoad,
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
        aggregateReplay ? undefined : playerReferenceLaps
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
    create: () => new SectorTimingProcessor(),
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
    channel: 'system-performance.snapshot',
    metricsPrefix: 'systemPerformance',
    create: () => new SystemPerformanceProcessor(systemLoad),
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
