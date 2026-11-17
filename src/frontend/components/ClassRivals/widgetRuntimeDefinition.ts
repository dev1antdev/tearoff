import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'classrivals',
  // Session visibility resolves the session type through SessionStore, and
  // the cars are named and coloured from the session's grid.
  sessionData: true,
  channels: [
    // Every row is made of this channel, but for its tyres.
    'race-forecast.snapshot',
    // The compound each car is on, the laps on the set and the tread left.
    // Read only while the Tyres column is on: reading it has the race
    // recorded.
    'class-tyres.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // Read only while the Tyres column is on.
  conditionalChannels: ['class-tyres.snapshot'],
  // Gaps and laps to a stop that is minutes away: once a second.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
