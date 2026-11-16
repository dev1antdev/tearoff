import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'battle',
  sessionData: true,
  channels: [
    'car-pit.snapshot',
    'car-speeds.snapshot',
    'lap-history.snapshot',
    'relative-gaps.snapshot',
    'standings.snapshot',
    'track-state.snapshot',
  ],
  ratePreset: 'driverFocused',
  channelRates: {
    'car-pit.snapshot': 5,
    'car-speeds.snapshot': 10,
    'lap-history.snapshot': 2,
    // A gap printed to hundredths: ten a second is as fast as it reads.
    'relative-gaps.snapshot': 10,
    'standings.snapshot': 5,
  },
} satisfies WidgetRuntimeDefinition;
