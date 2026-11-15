import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'liftcoast',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // The lights read the driver-controls channel; track-state carries the
  // driving state the widget uses to hide itself.
  channels: ['driver-controls.snapshot', 'track-state.snapshot'],
  // 25 Hz: an assist light that comes on a frame late is still on in time.
  ratePreset: 'driverFocused',
} satisfies WidgetRuntimeDefinition;
