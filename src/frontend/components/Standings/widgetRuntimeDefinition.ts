import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'standings',
  sessionData: true,
  pitLaneData: true,
  channels: [
    'lap-times.snapshot',
    'reference-laps.snapshot',
    'radio.snapshot',
    'session-timing.snapshot',
    'session-bar.snapshot',
    'standings.snapshot',
    'track-state.snapshot',
    // The track's sunrise and sunset, for the in-game clock's countdown in
    // the header and footer bars; subscribed to only while that is on.
    'track-profile.snapshot',
  ],
  ratePreset: 'gapTiming',
  channelRates: { 'radio.snapshot': 25 },
} satisfies WidgetRuntimeDefinition;
