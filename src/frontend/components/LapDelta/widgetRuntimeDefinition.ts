import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'lapdelta',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['lap-delta.snapshot', 'track-state.snapshot'],
  // No preset: the delta arrives at its channel's own rate, which is set for
  // a figure that has to be read.
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
