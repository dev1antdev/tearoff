/**
 * The channel each processor's timing section belongs to, for the perf
 * report: how often a channel's processor ran beside how often the channel
 * published, and whether a processor ran while every window was hidden.
 *
 * A section is named by the processor's `metricsPrefix` and `Processing`,
 * as `ProcessorHost` names it. A processor missing from here runs unseen by
 * that check; `processorRegistry.spec.ts` holds the table to the registry.
 */
export const PROCESSOR_CHANNELS: Readonly<Record<string, string>> = {
  blindSpotProcessing: 'blind-spot.snapshot',
  brakingProcessing: 'braking.snapshot',
  carPitProcessing: 'car-pit.snapshot',
  carSectorsProcessing: 'car-sectors.snapshot',
  carSpeedsProcessing: 'car-speeds.snapshot',
  carSystemsProcessing: 'car-systems.snapshot',
  cruiseProcessing: 'cruise.snapshot',
  damageProcessing: 'damage.snapshot',
  driverControlsProcessing: 'driver-controls.snapshot',
  finishProjectionProcessing: 'finish-projection.snapshot',
  flagStateProcessing: 'flag-state.snapshot',
  fuelProjectionProcessing: 'fuel.projection',
  gForceProcessing: 'g-force.snapshot',
  hybridProcessing: 'hybrid.snapshot',
  lapDeltaProcessing: 'lap-delta.snapshot',
  lapLogProcessing: 'lap-log.snapshot',
  lapTimesProcessing: 'lap-times.snapshot',
  lapTraceSampleProcessing: 'lap-trace.sample',
  minimapProcessing: 'minimap.snapshot',
  pitStopEstimateProcessing: 'pit-stop.snapshot',
  raceForecastProcessing: 'race-forecast.snapshot',
  racePlanProgressProcessing: 'race-plan.progress',
  radarProcessing: 'radar.snapshot',
  radioProcessing: 'radio.snapshot',
  referenceLapProcessing: 'reference-laps.snapshot',
  relativeGapProcessing: 'relative-gaps.snapshot',
  sectorTimingProcessing: 'sector-timing.snapshot',
  sessionBarProcessing: 'session-bar.snapshot',
  sessionTimingProcessing: 'session-timing.snapshot',
  standingsProcessing: 'standings.snapshot',
  systemPerformanceProcessing: 'system-performance.snapshot',
  trackProfileProcessing: 'track-profile.snapshot',
  trackStateProcessing: 'track-state.snapshot',
  trafficProcessing: 'traffic.snapshot',
  tyreStateProcessing: 'tyre-state.snapshot',
  weatherForecastProcessing: 'weather-forecast.snapshot',
  wheelDynamicsProcessing: 'wheel-dynamics.snapshot',
};
