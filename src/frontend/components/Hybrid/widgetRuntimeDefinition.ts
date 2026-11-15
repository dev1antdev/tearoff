import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'hybrid',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['hybrid.snapshot', 'track-state.snapshot'],
  ratePreset: 'static',
  // The channel's own default, stated: ten a second keeps the tenths of the
  // charge legible. The snapshot still publishes only when a figure moves.
  channelRates: { 'hybrid.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
