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
    // The pace of each car's stint against an earlier one, for the "vs
    // stint" column; subscribed to only while that column is on, because
    // reading it is what has a race recorded.
    'race-history.summary',
  ],
  ratePreset: 'gapTiming',
  channelRates: { 'radio.snapshot': 25, 'race-history.summary': 1 },
} satisfies WidgetRuntimeDefinition;
