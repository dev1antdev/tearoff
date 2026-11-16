import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'carlaps',
  // The cars on offer, their numbers, teams and classes come from the
  // session's driver list, and session visibility from its session type.
  sessionData: true,
  channels: [
    // When the chosen car's records have changed and are to be read again.
    'race-history.summary',
    // Every car's place, for the order the cars are offered in, and the
    // best lap of the class, which a lap of the car may be.
    'standings.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // A lap a minute or two: once a second is more than the list moves.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
