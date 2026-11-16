import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'wear',
  // Session visibility resolves the session type through SessionStore, and the
  // compound glyph reads the session's tyre list from it.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['wear.snapshot', 'track-state.snapshot'],
  // Tread moves a tenth of a percent in a quarter of a lap: the channel's own
  // two a second is more than a figure like that needs.
  ratePreset: 'static',
  // Only the driving state is read from it, which changes a few times a
  // stint.
  channelRates: { 'track-state.snapshot': 5 },
} satisfies WidgetRuntimeDefinition;
