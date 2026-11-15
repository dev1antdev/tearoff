import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'weatherforecast',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // session-bar carries the sim's display units for the 'auto' setting, and
  // track-state the driving state the widget uses to hide itself.
  channels: [
    'weather-forecast.snapshot',
    'session-bar.snapshot',
    'track-state.snapshot',
  ],
  ratePreset: 'informational',
} satisfies WidgetRuntimeDefinition;
