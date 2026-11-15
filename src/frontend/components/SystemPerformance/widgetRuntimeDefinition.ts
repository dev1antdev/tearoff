import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'systemperformance',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['system-performance.snapshot', 'track-state.snapshot'],
  // The machine is read once a second, and nothing here is driven to.
  ratePreset: 'informational',
} satisfies WidgetRuntimeDefinition;
