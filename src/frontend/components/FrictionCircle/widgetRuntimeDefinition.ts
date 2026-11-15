import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'frictioncircle',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['g-force.snapshot', 'track-state.snapshot'],
  ratePreset: 'driverFocused',
  // The dot moves like a pedal trace; the processor measures at sixty.
  channelRates: { 'g-force.snapshot': 30 },
} satisfies WidgetRuntimeDefinition;
