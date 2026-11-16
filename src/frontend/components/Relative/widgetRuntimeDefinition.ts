import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'relative',
  sessionData: true,
  pitLaneData: true,
  channels: [
    'lap-times.snapshot',
    'radio.snapshot',
    'session-timing.snapshot',
    'session-bar.snapshot',
    'relative-gaps.snapshot',
    'standings.snapshot',
    'track-state.snapshot',
    // The flag contour.
    'flag-state.snapshot',
    // The track's sunrise and sunset, for the in-game clock's countdown in
    // the header and footer bars; subscribed to only while that is on.
    'track-profile.snapshot',
  ],
  ratePreset: 'gapTiming',
  channelRates: { 'radio.snapshot': 25 },
} satisfies WidgetRuntimeDefinition;
