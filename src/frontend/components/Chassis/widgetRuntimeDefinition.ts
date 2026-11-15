import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'chassis',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['wheel-dynamics.snapshot', 'track-state.snapshot'],
  ratePreset: 'static',
  // Figures to read: ten a second is as fast as a number can be followed,
  // and the processor has already smoothed what needs smoothing.
  channelRates: { 'wheel-dynamics.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
