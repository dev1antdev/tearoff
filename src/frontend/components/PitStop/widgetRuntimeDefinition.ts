import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'pitstop',
  // Session visibility resolves the session type through SessionStore, and
  // the cars around the rejoin are named from the session's grid.
  sessionData: true,
  channels: ['pit-stop.snapshot', 'car-pit.snapshot', 'track-state.snapshot'],
  // Gaps and a stop time, read to a tenth: five a second.
  ratePreset: 'gapTiming',
  // The timer's anchors are subtracted from the session clock, which has to
  // move in tenths for the countdown to.
  channelRates: { 'track-state.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
