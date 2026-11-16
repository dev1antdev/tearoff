import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'infobar',
  sessionData: true,
  channels: [
    'session-timing.snapshot',
    'session-bar.snapshot',
    // The focus car's place, for the position items; subscribed to only
    // while one of them is on the bar.
    'standings.snapshot',
  ],
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
