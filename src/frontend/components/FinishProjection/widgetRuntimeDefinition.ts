import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'finishorder',
  // Session visibility resolves the session type through SessionStore, and
  // the rivals are named from the session's grid.
  sessionData: true,
  channels: [
    // Everything the table and the rivals are made of. It carries the laps
    // to go the fuel projection publishes, so that channel is not read
    // here a second time.
    'finish-projection.snapshot',
    // The driving state the widget hides by.
    'track-state.snapshot',
  ],
  // Laps to a finish that is minutes away: once a second.
  ratePreset: 'informational',
  // Hiding when the camera goes to another car should not wait a second.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
