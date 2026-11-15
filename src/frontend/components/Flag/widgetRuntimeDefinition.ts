import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'flag',
  sessionData: true,
  // The flag itself, and track-state for the driving state it hides on.
  channels: ['flag-state.snapshot', 'track-state.snapshot'],
  ratePreset: 'driverFocused',
} satisfies WidgetRuntimeDefinition;
