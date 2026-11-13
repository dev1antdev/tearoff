import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'minimap',
  // The track line, the driver list and the class colours all come from the
  // session, and session visibility resolves the session type through it.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['minimap.snapshot', 'track-state.snapshot'],
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
