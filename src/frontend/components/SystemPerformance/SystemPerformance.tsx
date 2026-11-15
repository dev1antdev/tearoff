import { Fragment, memo } from 'react';
import {
  CpuIcon,
  GaugeIcon,
  GraphicsCardIcon,
  MemoryIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  useDrivingState,
  useSessionVisibility,
  useSystemPerformanceSnapshot,
} from '@irdashies/context';
import { useSystemPerformanceSettings } from './hooks/useSystemPerformanceSettings';
import {
  performanceGroups,
  type PerformanceGroupKey,
  type PerformanceMetricKind,
  type PerformanceTone,
} from './systemPerformanceDisplay';

const METRIC_ICON: Record<PerformanceMetricKind, Icon> = {
  cpu: CpuIcon,
  memory: MemoryIcon,
  fps: GaugeIcon,
  gpu: GraphicsCardIcon,
};

/** What the icon stands for, for a reader that cannot see it. */
const METRIC_NAME: Record<PerformanceMetricKind, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  fps: 'Frame rate',
  gpu: 'GPU',
};

/** White until a threshold is crossed: the widget sits in a corner all race. */
const TONE_CLASS: Record<PerformanceTone, string> = {
  none: 'text-slate-500',
  normal: 'text-white',
  caution: 'text-amber-300',
  critical: 'text-red-400',
};

interface MetricProps {
  group: PerformanceGroupKey;
  kind: PerformanceMetricKind;
  value: string;
  unit: string;
  tone: PerformanceTone;
  /** Lets the wider of two figures take the room of a third. */
  wide: boolean;
}

/**
 * One figure with its icon. Takes strings rather than the snapshot so that a
 * reading whose digits did not move re-renders nothing.
 */
const Metric = memo(({ group, kind, value, unit, tone, wide }: MetricProps) => {
  const MetricIcon = METRIC_ICON[kind];
  return (
    <span
      data-testid={`system-performance-${group}-${kind}`}
      data-tone={tone}
      aria-label={METRIC_NAME[kind]}
      className={`flex min-w-0 items-center gap-1 ${wide ? 'col-span-2' : ''}`}
    >
      <MetricIcon
        size="1em"
        className="flex-none text-white/50"
        aria-hidden="true"
      />
      <span
        className={`whitespace-nowrap font-semibold tabular-nums ${TONE_CLASS[tone]}`}
      >
        {value}
        {/* A unit after the placeholder would read as a value. */}
        {tone !== 'none' && (
          <span className="ml-0.5 text-[0.8em] font-normal text-white/50">
            {unit}
          </span>
        )}
      </span>
    </span>
  );
});
Metric.displayName = 'Metric';

/**
 * The machine's CPU and memory, Tearoff's own, and the sim's frame rate and
 * meters where the sim publishes them.
 *
 * Under Le Mans Ultimate the sim publishes none, and the widget is the first
 * two rows. Nothing here is about the car, so it reads the same whether the
 * user is driving, watching a team-mate or sitting in the garage.
 */
export const SystemPerformance = () => {
  const settings = useSystemPerformanceSettings();
  const snapshot = useSystemPerformanceSnapshot();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatching)) return <></>;

  const groups = performanceGroups(snapshot, settings);
  if (groups.length === 0) return <></>;

  const inline = settings.layout === 'inline';

  return (
    <div
      data-testid="system-performance"
      data-layout={settings.layout}
      className="flex h-full w-full flex-col justify-center overflow-hidden rounded bg-slate-800/(--bg-opacity) p-2 text-sm leading-none text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {inline ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {groups.map((group) => (
            <div
              key={group.key}
              data-testid={`system-performance-${group.key}`}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-white/60">{group.label}</span>
              {group.metrics.map((metric) => (
                <Metric
                  key={metric.kind}
                  group={group.key}
                  kind={metric.kind}
                  value={metric.value}
                  unit={metric.unit}
                  tone={metric.tone}
                  wide={false}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        // One grid for every row, so the figures line up in columns: equal
        // ones while there is room, and never narrower than a figure, so a
        // tight window clips at its edge rather than running figures together.
        // A row of two figures gives its second the room of a third.
        <div className="grid grid-cols-[auto_repeat(3,minmax(max-content,1fr))] items-center gap-x-2.5 gap-y-1.5">
          {groups.map((group) => (
            <Fragment key={group.key}>
              <span
                data-testid={`system-performance-${group.key}`}
                className="text-xs text-white/60"
              >
                {group.label}
              </span>
              {group.metrics.map((metric, index) => (
                <Metric
                  key={metric.kind}
                  group={group.key}
                  kind={metric.kind}
                  value={metric.value}
                  unit={metric.unit}
                  tone={metric.tone}
                  wide={group.metrics.length === 2 && index === 1}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
