export interface NumericSampleStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p1: number;
  p50: number;
  p95: number;
  p99: number;
}

export const PERF_RENDERER_LOG_PREFIX = '[PerfRenderer:JSON] ';

export interface RendererPerfSample {
  schemaVersion: 1;
  timestamp: string;
  runId: string;
  scenario: string;
  /**
   * The renderer's `process.pid`, read in the preload: `tools/perf` tells one
   * window's samples from another's by it. On Windows, where the app runs, it
   * is the same OS process id the main process's CPU and memory figures carry.
   */
  pid: number;
  route: string;
  /** DOM wrapper IDs at report time; does not prove visible pixels or active input. */
  widgetDomIds?: string[];
  visibilityState: DocumentVisibilityState;
  intervalMs: number;
  frameTimeMs: NumericSampleStats;
  telemetryCallbackMs?: NumericSampleStats;
  channelCallbackMs?: NumericSampleStats;
  trackMapAnimationFrameMs?: NumericSampleStats;
  trackMapCommitDrawMs?: NumericSampleStats;
  trackMapRafDrawMs?: NumericSampleStats;
  inputTraceFrameMs?: NumericSampleStats;
  radarFrameMs?: NumericSampleStats;
  standingsPlayerGapsMs?: NumericSampleStats;
  standingsFinalTimingMs?: NumericSampleStats;
  lapTraceFrameMs?: NumericSampleStats;
  lapTraceBrakeCueMs?: NumericSampleStats;
  frictionCircleFrameMs?: NumericSampleStats;
  widgetDragMs?: NumericSampleStats;
  telemetryWakeups?: number;
  channelWakeups?: number;
  framesOver25Ms: number;
  framesOver50Ms: number;
}

/** Every measure the renderer may report; the preload bridge drops any other. */
export const RENDERER_PERF_MEASURE_NAMES = [
  'trackMapAnimationFrame',
  'trackMapCommitDraw',
  'trackMapRafDraw',
  'inputTraceFrame',
  'radarFrame',
  'standingsPlayerGaps',
  'standingsFinalTiming',
  'lapTraceFrame',
  'lapTraceBrakeCue',
  'frictionCircleFrame',
  'widgetDrag',
] as const;

export type RendererPerfMeasureName =
  (typeof RENDERER_PERF_MEASURE_NAMES)[number];

export interface RendererPerfBridge {
  recordMeasure: (name: RendererPerfMeasureName, durationMs: number) => void;
}
