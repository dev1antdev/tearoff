import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'timing',
  // The session names the driver classes the session best is taken over, and
  // session visibility resolves the session type through it.
  sessionData: true,
  channels: [
    // Delta, predicted lap and the all-time best.
    'lap-delta.snapshot',
    // Last and best lap, every car's best, the current lap time, the void
    // flags, and the session clock for the hold after the line.
    'lap-log.snapshot',
    // The sector tiles.
    'sector-timing.snapshot',
    // The lap number.
    'session-timing.snapshot',
    // The driving state the widget uses to hide itself.
    'track-state.snapshot',
    // Pace; subscribed only while that tile is on.
    'lap-times.snapshot',
  ],
  // No preset: the delta arrives at its channel's own rate, which is set for
  // a figure that has to be read, and the sector times arrive as they change.
  ratePreset: 'static',
  channelRates: {
    // Tenths on the current lap time; the channel offers 25.
    'lap-log.snapshot': 10,
    'session-timing.snapshot': 5,
    'track-state.snapshot': 5,
    'lap-times.snapshot': 5,
  },
} satisfies WidgetRuntimeDefinition;
