import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'cornerdelta',
  // The track's name finds its corners, and session visibility resolves the
  // session type, both through SessionStore.
  sessionData: true,
  channels: [
    // The car's position, speed and clock from one frame: what a corner is
    // timed from.
    'lap-trace.sample',
    // The laps a corner is measured against.
    'reference-laps.snapshot',
    // The driving state the widget hides itself by, and the display units.
    'track-state.snapshot',
  ],
  // The widget redraws once per corner, so nothing it shows needs a rate of
  // its own...
  ratePreset: 'static',
  // ...but a corner's two ends are placed between the frames either side of
  // them, and the closer those are the better: the sim's native rate.
  channelRates: { 'lap-trace.sample': 60 },
} satisfies WidgetRuntimeDefinition;
