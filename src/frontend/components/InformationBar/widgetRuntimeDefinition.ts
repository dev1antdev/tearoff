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
    // The track's sunrise and sunset, for the in-game clock's countdown;
    // subscribed to only while that is switched on.
    'track-profile.snapshot',
  ],
  // Each read only while the item it is for is on the bar.
  conditionalChannels: ['standings.snapshot', 'track-profile.snapshot'],
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
