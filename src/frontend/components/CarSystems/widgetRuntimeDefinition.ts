import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'carsystems',
  // The widget's session-visibility settings resolve the current session type
  // through SessionStore, which RendererDataProviders only mounts when a widget
  // in the window asks for session data. Without this the practice/qualifying/
  // race toggles silently do nothing in a window holding only this widget.
  // Under Le Mans Ultimate the session also carries the garage's regeneration
  // level, which is one of the columns.
  sessionData: true,
  // track-state carries the driving state the widget uses to hide itself.
  channels: ['car-systems.snapshot', 'track-state.snapshot'],
  ratePreset: 'static',
  // The channel's own default is 2 Hz, at which the highlight on a dial that
  // moved could start half a second late. The snapshot still publishes only
  // when something changes, so this bounds the delay rather than adding work.
  channelRates: { 'car-systems.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
