import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type { SystemPerformanceSnapshot } from '@irdashies/types';
import { SystemPerformance } from './SystemPerformance';

const snapshot = (
  values: Partial<SystemPerformanceSnapshot> = {}
): SystemPerformanceSnapshot => ({
  systemCpuPercent: 23.4,
  systemMemoryUsedGb: 15.2,
  systemMemoryTotalGb: 31.8,
  appCpuPercent: 1.2,
  appMemoryMb: 412,
  simFps: 118,
  simCpuPercent: 46,
  simGpuPercent: 71,
  gpuPercent: null,
  version: 1,
  ...values,
});

/** What Le Mans Ultimate leaves of the snapshot: no meters of the sim's own. */
const lmuSnapshot = (
  values: Partial<SystemPerformanceSnapshot> = {}
): SystemPerformanceSnapshot =>
  snapshot({
    simFps: null,
    simCpuPercent: null,
    simGpuPercent: null,
    ...values,
  });

const story = (
  performance: SystemPerformanceSnapshot | undefined,
  config: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 240, height: 78 }
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      systemperformance: config,
    }),
    ChannelSnapshotDecorator(
      performance ? { 'system-performance.snapshot': performance } : {}
    ),
    // The widget fills its overlay window, so the story supplies one of the
    // default size and the overlay's own type scale.
    (Story: React.ComponentType) => (
      <div
        className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
        style={size}
      >
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof SystemPerformance> = {
  component: SystemPerformance,
  title: 'widgets/SystemPerformance',
};

export default meta;

type Story = StoryObj<typeof SystemPerformance>;

/** iRacing: the machine, Tearoff and the sim's own meters. */
export const IRacing: Story = {
  ...story(snapshot()),
};

/**
 * Le Mans Ultimate publishes no frame rate and no load figures, so the widget
 * is the machine and Tearoff.
 */
export const LeMansUltimate: Story = {
  ...story(lmuSnapshot()),
};

/** The same two rows in a window sized for them. */
export const LeMansUltimateCompact: Story = {
  ...story(lmuSnapshot(), {}, { width: 240, height: 54 }),
};

/**
 * A machine out of headroom: the CPU past the warning, the sim's main thread
 * and the GPU pegged, and the frame rate under half of the target.
 */
export const HighLoad: Story = {
  ...story(
    snapshot({
      systemCpuPercent: 91.3,
      systemMemoryUsedGb: 29.6,
      appCpuPercent: 3.8,
      appMemoryMb: 655,
      simFps: 27,
      simCpuPercent: 97.2,
      simGpuPercent: 99.5,
    })
  ),
};

/** A frame rate just under the target, with everything else at ease. */
export const FrameRateDip: Story = {
  ...story(snapshot({ simFps: 52, simGpuPercent: 88.4 })),
};

/**
 * Before the first reading, and with no sim to ask: the widget keeps its
 * shape so that it can still be placed.
 */
export const NoReading: Story = {
  ...story(undefined),
};

/** The first second: memory is known at once, CPU needs two readings. */
export const FirstReading: Story = {
  ...story(
    snapshot({
      systemCpuPercent: null,
      appCpuPercent: null,
    })
  ),
};

/** Everything on one strip, for the edge of the screen. */
export const Strip: Story = {
  ...story(snapshot(), { layout: 'inline' }, { width: 520, height: 30 }),
};

/** The strip under Le Mans Ultimate. */
export const StripLeMansUltimate: Story = {
  ...story(lmuSnapshot(), { layout: 'inline' }, { width: 340, height: 30 }),
};

/** Only the sim's row: a frame-rate counter with its two meters. */
export const SimOnly: Story = {
  ...story(
    snapshot(),
    { system: { enabled: false }, app: { enabled: false } },
    { width: 210, height: 30 }
  ),
};
