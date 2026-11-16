import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'ourcar',
  // Session visibility resolves the session type through SessionStore, and
  // the cars either side are named from the session's grid.
  sessionData: true,
  channels: [
    // The stint, the pit window, the stops, the forecast place, the rejoin
    // and the class cars either side.
    'race-forecast.snapshot',
    // Tread on each wheel and the laps it lasts.
    'wear.snapshot',
    // Whether the car is damaged, and the repair of the next stop.
    'damage.snapshot',
    // The stint before this one, for the mean of five to be read against.
    'race-history.summary',
    // The driving state the widget hides by, and who is at the wheel.
    'track-state.snapshot',
  ],
  // Laps to a stop that is minutes away: once a second.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
