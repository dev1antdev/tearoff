import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'pitwall',
  // The header finds our car's number, class and driver in the session.
  sessionData: true,
  // What the header reads. The widgets in the panels declare their own
  // channels and rates, each in its own runtime definition.
  channels: [
    'session-bar.snapshot',
    'session-timing.snapshot',
    'flag-state.snapshot',
    'track-state.snapshot',
  ],
  // A header of figures that change with the second at the fastest.
  ratePreset: 'informational',
  channelRates: {
    // The flag is the one item that should not wait for the next second.
    'flag-state.snapshot': 5,
  },
} satisfies WidgetRuntimeDefinition;
