import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'brakeperformance',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself,
  // and the units the sim is set to.
  channels: ['braking.snapshot', 'track-state.snapshot'],
  // Nothing moves between braking zones; inside one the channel's own ten a
  // second is as fast as the running figures can be read.
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
