import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'damage',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['damage.snapshot', 'track-state.snapshot'],
  // Five a second, so the impact wedge comes up as the car is hit.
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
