import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'flagpanel',
  // The number, driver, team and class of the car a blue is for are looked up
  // in the session, and session visibility resolves the session type from it.
  sessionData: true,
  channels: [
    // The flag in force and the car a blue is for.
    'flag-state.snapshot',
    // The sim's display units, and the driving state the widget hides on.
    'track-state.snapshot',
  ],
  ratePreset: 'gapTiming',
  // The metres to the car behind are a figure to read; the channel offers 10.
  channelRates: { 'flag-state.snapshot': 10 },
} satisfies WidgetRuntimeDefinition;
