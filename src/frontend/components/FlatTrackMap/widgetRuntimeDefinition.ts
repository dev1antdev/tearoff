import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'flatmap',
  sessionData: true,
  channels: [
    'reference-laps.snapshot',
    'sector-timing.snapshot',
    'standings.snapshot',
    'track-state.snapshot',
    // Under Le Mans Ultimate: the sector under yellow, and where the
    // sectors start, which that sim leaves to be learned.
    'flag-state.snapshot',
    'track-profile.snapshot',
  ],
  // Read under Le Mans Ultimate only.
  conditionalChannels: ['flag-state.snapshot', 'track-profile.snapshot'],
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
