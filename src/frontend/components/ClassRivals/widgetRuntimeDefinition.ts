import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'classrivals',
  // Session visibility resolves the session type through SessionStore, and
  // the cars are named and coloured from the session's grid.
  sessionData: true,
  channels: [
    // Every row is made of this one channel.
    'race-forecast.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // Gaps and laps to a stop that is minutes away: once a second.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
