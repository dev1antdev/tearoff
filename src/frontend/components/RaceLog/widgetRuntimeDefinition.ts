import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'racelog',
  // Session visibility resolves the session type through SessionStore, and
  // each car's number and class colour come from the session's grid.
  sessionData: true,
  channels: [
    // The most recent events. Subscribing is also what keeps the race
    // logged while the widget is the only reader.
    'race-log.snapshot',
    // Which car is ours, for the amber lines and the two narrower lists.
    'session-bar.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // A few lines a minute at the most: once a second is the channel's own
  // pace.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
