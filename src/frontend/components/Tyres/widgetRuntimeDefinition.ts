import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'tyres',
  // Session visibility resolves the session type through SessionStore, and the
  // compound glyph reads the session's tyre list from it.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  // wheel-dynamics is only subscribed to while the load bar or the tyre
  // deflection is switched on.
  channels: [
    'tyre-state.snapshot',
    'wheel-dynamics.snapshot',
    'track-state.snapshot',
  ],
  ratePreset: 'static',
  // Load and deflection move with every kerb; ten a second is as fast as a
  // figure can be read.
  channelRates: { 'wheel-dynamics.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
