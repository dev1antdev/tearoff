import { useEffect, useRef } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  GForceSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { FrictionCircle } from './FrictionCircle';

interface Reading {
  latG: number;
  longG: number;
}

/** In the car, on track: what the widget's driving gate reads. */
const trackState: TrackStateSnapshot = trackStateStorySnapshot;

/** Readings a second. */
const RATE_HZ = 30;
/** Seconds the two maxima are held, as in the processor. */
const MAX_HOLD_S = 5;

const lerp = (from: number, to: number, share: number): number =>
  from + (to - from) * Math.min(Math.max(share, 0), 1);

/** A little of the noise a real car reads with. */
const ripple = (t: number, size: number): number =>
  size * (Math.sin(t * 23) * 0.6 + Math.sin(t * 41 + 1) * 0.4);

/**
 * Eight seconds of a lap, over and over: hard on the brakes in a straight
 * line, trailing them round the edge of the circle into a left-hander,
 * through it at 2.3 g, out under power, then a quick flick to the right.
 */
const lap = (clock: number): Reading => {
  const t = clock % 8;
  let latG: number;
  let longG: number;
  if (t < 1.5) {
    latG = 0;
    longG = lerp(0.5, -1.9, t / 0.4);
  } else if (t < 2.7) {
    // Trading braking for cornering: a quarter of the way round, and a
    // little inside the best the tyres do at either alone.
    const angle = ((t - 1.5) / 1.2) * (Math.PI / 2);
    const combined = 1 - 0.12 * Math.sin(2 * angle);
    latG = 2.3 * Math.sin(angle) * combined;
    longG = -1.9 * Math.cos(angle) * combined;
  } else if (t < 4.2) {
    latG = lerp(2.3, 2.25, (t - 2.7) / 1.5);
    longG = lerp(0, 0.25, (t - 2.7) / 1.5);
  } else if (t < 5.3) {
    const angle = ((t - 4.2) / 1.1) * (Math.PI / 2);
    latG = 2.25 * Math.cos(angle);
    longG = 0.25 + 0.65 * Math.sin(angle);
  } else if (t < 6.4) {
    latG = 0;
    longG = lerp(0.9, 0.6, (t - 5.3) / 1.1);
  } else {
    const share = (t - 6.4) / 1.6;
    latG = -1.7 * Math.sin(share * Math.PI);
    longG = lerp(0.6, 0.5, share);
  }
  return {
    latG: latG + ripple(clock, 0.03),
    longG: longG + ripple(clock + 3, 0.03),
  };
};

/** A straight: off the throttle, onto the brakes, and back to the throttle. */
const straight = (clock: number): Reading => {
  const t = clock % 6;
  const longG =
    t < 2
      ? lerp(0.7, 0.4, t / 2)
      : t < 4.2
        ? lerp(0.4, -2.4, (t - 2) / 0.35)
        : lerp(-2.4, 0.7, (t - 4.2) / 0.6);
  return { latG: ripple(clock, 0.05), longG: longG + ripple(clock + 3, 0.03) };
};

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Plays a script of readings onto the g-force channel, thirty a second, with
 * the maxima a processor would hold alongside them. The driving state comes
 * from a fixed track-state snapshot.
 */
const GForcePlayback = (
  script: (clock: number) => Reading,
  sustainedLatG: number
): Decorator => {
  const DecoratorComponent: Decorator = (Story) => {
    const previousBridge = useRef(window.channelBridge);
    const listeners = useRef(new Set<(payload: GForceSnapshot) => void>());
    const latest = useRef<GForceSnapshot | null>(null);

    const bridge: ChannelBridge = {
      subscribe: <K extends ChannelName>(
        channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        if (channel === 'track-state.snapshot') {
          callback(trackState as ChannelPayloads[K]);
          return () => undefined;
        }
        if (channel !== 'g-force.snapshot') return () => undefined;
        const listener = callback as (payload: GForceSnapshot) => void;
        listeners.current.add(listener);
        if (latest.current) listener(latest.current);
        return () => listeners.current.delete(listener);
      },
    };
    window.channelBridge = bridge;

    useEffect(() => {
      const startedAt = performance.now();
      const history: { at: number; lat: number; long: number }[] = [];
      let version = 0;
      const tick = () => {
        const clock = (performance.now() - startedAt) / 1000;
        const { latG, longG } = script(clock);
        history.push({ at: clock, lat: Math.abs(latG), long: Math.abs(longG) });
        while (history.length > 0 && clock - history[0].at > MAX_HOLD_S) {
          history.shift();
        }
        version += 1;
        const snapshot: GForceSnapshot = {
          available: true,
          latG: round(latG),
          longG: round(longG),
          maxLatG: round(Math.max(...history.map(({ lat }) => lat))),
          maxLongG: round(Math.max(...history.map(({ long }) => long))),
          sustainedLatG,
          sessionNum: 0,
          version,
        };
        latest.current = snapshot;
        for (const listener of listeners.current) listener(snapshot);
      };
      tick();
      const timer = window.setInterval(tick, 1000 / RATE_HZ);
      return () => window.clearInterval(timer);
    }, []);

    useEffect(
      () => () => {
        if (previousBridge.current === undefined) {
          Reflect.deleteProperty(window, 'channelBridge');
        } else {
          window.channelBridge = previousBridge.current;
        }
      },
      []
    );
    return <Story />;
  };
  return DecoratorComponent;
};

/** The widget fills its overlay window, so the story supplies one. */
const sized =
  (width: number, height: number): Decorator =>
  (Story) => (
    <div style={{ width, height }}>
      <Story />
    </div>
  );

const playing = (
  script: (clock: number) => Reading,
  config: Record<string, unknown> = {},
  { sustainedLatG = 2.31, width = 200, height = 200 } = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      frictioncircle: config,
    }),
    GForcePlayback(script, sustainedLatG),
    sized(width, height),
  ],
});

const still = (
  gForce: GForceSnapshot,
  config: Record<string, unknown> = {},
  { width = 200, height = 200 } = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      frictioncircle: config,
    }),
    ChannelSnapshotDecorator({
      'g-force.snapshot': gForce,
      'track-state.snapshot': trackStateStorySnapshot,
    }),
    sized(width, height),
  ],
});

const reading = (extra: Partial<GForceSnapshot> = {}): GForceSnapshot => ({
  available: true,
  latG: 1.42,
  longG: -1.18,
  maxLatG: 2.36,
  maxLongG: 2.21,
  sustainedLatG: 2.31,
  sessionNum: 0,
  version: 1,
  ...extra,
});

const meta: Meta<typeof FrictionCircle> = {
  component: FrictionCircle,
  title: 'widgets/FrictionCircle',
};

export default meta;

type Story = StoryObj<typeof FrictionCircle>;

/**
 * A lap in progress: the trail of the last four seconds behind the dot, the
 * rings at 1, 2 and 3 g, and the dashed ring of the sustained lateral grip.
 */
export const Cornering: Story = {
  ...playing(lap),
};

/** A straight and its braking zone: the trail runs up and down the middle. */
export const BrakingInAStraightLine: Story = {
  ...playing(straight, {}, { sustainedLatG: 0 }),
};

/**
 * The other way up: the dot goes where the car is being pushed, down under
 * braking and to the left in a left-hand corner.
 */
export const AccelerationOrientation: Story = {
  ...playing(lap, { orientation: 'acceleration' }),
};

/** Ten seconds of trail: more than a whole lap of the script. */
export const LongTrail: Story = {
  ...playing(lap, { traceSeconds: 10 }),
};

/** A tighter scale: the corner at 2.3 g is past the rim, and the dot says so. */
export const BeyondTheScale: Story = {
  ...playing(lap, { scaleG: 2 }),
};

/** A Hypercar's scale, with a ring at each of five whole g. */
export const WideScale: Story = {
  ...playing(lap, { scaleG: 6 }),
};

/** One reading, no trail yet: trail-braking into a left-hander. */
export const SingleReading: Story = {
  ...still(reading()),
};

/** The circle on its own: no rings, no trail, no sustained ring, no figures. */
export const DotOnly: Story = {
  ...playing(lap, {
    showRings: false,
    showTrace: false,
    showSustainedRing: false,
    showReadings: false,
  }),
};

/** In a box that is not square, the circle keeps to the largest square. */
export const WideBox: Story = {
  ...playing(lap, {}, { width: 320, height: 200 }),
};

/** Larger, as a driver might set it beside the pedals. */
export const Large: Story = {
  ...playing(lap, {}, { width: 320, height: 320 }),
};

/**
 * Out of the car: the sim publishes no reading, and the widget keeps its
 * shape so that it can still be placed.
 */
export const NoReading: Story = {
  ...still(
    reading({
      available: false,
      latG: 0,
      longG: 0,
      maxLatG: 0,
      maxLongG: 0,
      sustainedLatG: 0,
    }),
    { showOnlyWhenOnTrack: false }
  ),
};
