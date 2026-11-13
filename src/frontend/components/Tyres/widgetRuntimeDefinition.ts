import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'tyres',
  // Session visibility resolves the session type through SessionStore, and the
  // compound glyph reads the session's tyre list from it.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['tyre-state.snapshot', 'track-state.snapshot'],
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
