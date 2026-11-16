import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'stinttimeline',
  // Session visibility resolves the session type through SessionStore, and
  // the cars are numbered from the session's grid.
  sessionData: true,
  channels: [
    // Which cars are drawn, the scale, and the stints to come.
    'race-forecast.snapshot',
    // When a car's stints have changed and are to be asked for again.
    'race-history.summary',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // Bars over hours of racing: once a second is more than they move.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
