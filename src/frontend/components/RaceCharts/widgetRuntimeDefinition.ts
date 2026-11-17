import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'racecharts',
  // Each car's number comes from the session's driver list, and session
  // visibility from its session type.
  sessionData: true,
  channels: [
    // When a drawn car's records have changed and are to be read again.
    'race-history.summary',
    // The order of our class, for the cars around us.
    'race-forecast.snapshot',
    // Which car is ours.
    'session-bar.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // A lap a minute or two: once a second is more than a chart moves.
  ratePreset: 'informational',
  // Hiding when the car goes to its garage should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
