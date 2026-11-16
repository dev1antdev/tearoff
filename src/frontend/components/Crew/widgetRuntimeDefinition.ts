import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'crew',
  // The cars on offer, their numbers, teams and classes come from the
  // session's driver list, and session visibility from its session type.
  sessionData: true,
  channels: [
    // When the chosen car's records have changed and are to be read again,
    // and the pace of its stint against the driver before.
    'race-history.summary',
    // Every car's place, for the order the cars are offered in.
    'standings.snapshot',
    // The session clock, for the stint under way, and the driving state
    // the widget hides by.
    'track-state.snapshot',
  ],
  // Stints over hours of racing: once a second is more than they move.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
