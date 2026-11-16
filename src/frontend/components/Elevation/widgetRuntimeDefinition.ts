import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'elevation',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // The profile itself, and track-state for where the car is on it, the
  // display units and the driving state the widget hides on.
  channels: ['track-profile.snapshot', 'track-state.snapshot'],
  // The mark follows the car: positional, like the maps.
  ratePreset: 'driverFocused',
} satisfies WidgetRuntimeDefinition;
