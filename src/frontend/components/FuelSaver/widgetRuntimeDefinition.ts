import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'fuelsaver',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // The projection for the table, the stint for its captions, track-state
  // for the driving state it hides by, and the pit stop channel for the pit
  // entry, which is only subscribed to while that allowance is switched on.
  channels: [
    'fuel.projection',
    'player-stint.snapshot',
    'pit-stop.snapshot',
    'track-state.snapshot',
  ],
  // The same rate as the fuel calculator, so the two read alike.
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
