import type {
  SystemPerformanceConfig,
  SystemPerformanceSnapshot,
} from '@irdashies/types';

/**
 * Pure display logic for the system performance widget: which rows are drawn,
 * how each figure is written and what colour it takes. Kept apart from the
 * component so each rule can be tested without rendering anything.
 */

/** Shown where there is no reading. */
export const NO_READING = '--';

/** From here a CPU or GPU figure is red, wherever the warning is set. */
export const LOAD_CRITICAL_PERCENT = 95;

/**
 * `none` is a figure that is not there. The rest say how a figure stands
 * against its threshold: the widget is white until one is crossed.
 */
export type PerformanceTone = 'none' | 'normal' | 'caution' | 'critical';

/** A share of something busy: amber from the warning, red from 95. */
export const loadTone = (
  percent: number | null | undefined,
  warnPercent: number
): PerformanceTone => {
  if (typeof percent !== 'number') return 'none';
  if (percent >= LOAD_CRITICAL_PERCENT) return 'critical';
  return percent >= warnPercent ? 'caution' : 'normal';
};

/** A frame rate: amber below the warning, red below half of it. */
export const frameRateTone = (
  fps: number | null | undefined,
  warnFps: number
): PerformanceTone => {
  if (typeof fps !== 'number') return 'none';
  if (fps < warnFps / 2) return 'critical';
  return fps < warnFps ? 'caution' : 'normal';
};

/**
 * One decimal below ten and none from there, so the figure is never wider
 * than four characters with its sign: `1.2`, `9.9`, `23`, `100`. Tearoff's
 * own share lives below ten, where the decimal is most of the figure.
 */
export const formatPercent = (value: number | null | undefined): string => {
  if (typeof value !== 'number') return NO_READING;
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
};

export const formatGigabytes = (value: number | null | undefined): string =>
  typeof value === 'number' ? value.toFixed(1) : NO_READING;

export const formatWhole = (value: number | null | undefined): string =>
  typeof value === 'number' ? Math.round(value).toString() : NO_READING;

export type PerformanceMetricKind = 'cpu' | 'memory' | 'fps' | 'gpu';
export type PerformanceGroupKey = 'system' | 'app' | 'sim';

export interface PerformanceMetric {
  kind: PerformanceMetricKind;
  /** The figure, or the placeholder. */
  value: string;
  unit: string;
  tone: PerformanceTone;
}

export interface PerformanceGroup {
  key: PerformanceGroupKey;
  label: string;
  metrics: PerformanceMetric[];
}

const load = (
  kind: 'cpu' | 'gpu',
  percent: number | null | undefined,
  warnPercent: number
): PerformanceMetric => ({
  kind,
  value: formatPercent(percent),
  unit: '%',
  tone: loadTone(percent, warnPercent),
});

/** Memory is a quantity, not a condition: it is never coloured. */
const memory = (value: string, unit: string): PerformanceMetric => ({
  kind: 'memory',
  value,
  unit,
  tone: value === NO_READING ? 'none' : 'normal',
});

/**
 * The rows to draw, top to bottom.
 *
 * The machine and Tearoff can always be read, so their rows are drawn
 * whenever they are switched on and hold placeholders until the first
 * reading: the widget keeps its shape and can be placed in edit mode. The
 * sim's row is different. A sim that publishes no meters (Le Mans Ultimate)
 * never will, so the row is left out altogether rather than drawn as three
 * dashes for the whole race.
 */
export const performanceGroups = (
  snapshot: SystemPerformanceSnapshot | undefined,
  settings: SystemPerformanceConfig
): PerformanceGroup[] => {
  const groups: PerformanceGroup[] = [];
  const warnPercent = settings.warn.cpuPercent;

  if (settings.system.enabled) {
    groups.push({
      key: 'system',
      label: 'System',
      metrics: [
        load('cpu', snapshot?.systemCpuPercent, warnPercent),
        memory(formatGigabytes(snapshot?.systemMemoryUsedGb), 'GB'),
      ],
    });
  }

  if (settings.app.enabled) {
    groups.push({
      key: 'app',
      label: 'Tearoff',
      metrics: [
        load('cpu', snapshot?.appCpuPercent, warnPercent),
        memory(formatWhole(snapshot?.appMemoryMb), 'MB'),
      ],
    });
  }

  const simPublishes =
    typeof snapshot?.simFps === 'number' ||
    typeof snapshot?.simCpuPercent === 'number' ||
    typeof snapshot?.simGpuPercent === 'number';
  if (settings.sim.enabled && simPublishes) {
    groups.push({
      key: 'sim',
      label: 'Sim',
      metrics: [
        {
          kind: 'fps',
          value: formatWhole(snapshot?.simFps),
          unit: 'fps',
          tone: frameRateTone(snapshot?.simFps, settings.warn.fps),
        },
        load('cpu', snapshot?.simCpuPercent, warnPercent),
        load('gpu', snapshot?.simGpuPercent, warnPercent),
      ],
    });
  }

  return groups;
};
