import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'tracknotes',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // The notes themselves, and track-state for where the car is, how fast,
  // whether it is on pit road, and the driving state the widget hides on.
  channels: ['track-profile.snapshot', 'track-state.snapshot'],
  // A note is due at a point on the lap: positional, like the maps.
  ratePreset: 'driverFocused',
} satisfies WidgetRuntimeDefinition;
