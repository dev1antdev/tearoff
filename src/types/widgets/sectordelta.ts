import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'sectordelta',
  name: 'Sector Delta',
  category: 'Lap Timing',
  enabled: false,
  layout: {
    x: 6,
    y: 800,
    width: 300,
    height: 60,
  },
  config: {
    background: { opacity: 80 },
    timeFormat: 'seconds-full',
    ghostComparison: 'prefer-ghost',
    showTargetLap: false,
    targetFreezeSeconds: 5,
    trackIncidentSectors: true,
    alwaysScroll: false,
    maxSectorsShown: null,
    thresholds: null,
    showOnlyWhenOnTrack: true,
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      description: 'Opacity of the widget background.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    timeFormat: {
      type: 'enum',
      label: 'Time Format',
      description:
        'Decimal precision for sector times and deltas. Always shown as total seconds.',
      options: [
        { value: 'seconds-full', label: '42.123' },
        { value: 'seconds-2', label: '42.12' },
        { value: 'seconds-mixed', label: '42.1' },
      ],
      control: 'select',
    },
    ghostComparison: {
      type: 'enum',
      label: 'Comparison Source',
      description:
        'What each sector is compared with. Best Sectors are your best time for each sector on its own, which add up to the theoretical best lap; Best Lap is the sectors of your best whole lap. All-Time is kept for this track and car between sessions, and takes only sectors driven clean and off pit road.',
      options: [
        { value: 'prefer-ghost', label: 'Ghost When Available' },
        { value: 'session-best-only', label: 'Session Best Sectors' },
        { value: 'session-best-lap', label: 'Session Best Lap' },
        { value: 'all-time-best', label: 'All-Time Best Sectors' },
        { value: 'all-time-best-lap', label: 'All-Time Best Lap' },
      ],
      control: 'select',
    },
    showTargetLap: {
      type: 'boolean',
      label: 'Target Lap',
      description:
        'A row above the sectors with the time the comparison adds up to as far as the sector you are in, and your running lap time beside it. The target is marked TB for best sectors, PB for a best lap and REF for the ghost. Make the widget about 24 px taller for it.',
    },
    targetFreezeSeconds: {
      type: 'number',
      label: 'Hold The Gap After A Sector',
      description:
        'For this long after each sector the row shows how far up or down the lap is on the target so far, and the lap time at that point. Never more than half the sector you have just entered. 0 switches it off.',
      min: 0,
      max: 10,
      step: 1,
      units: 's',
    },
    trackIncidentSectors: {
      type: 'boolean',
      label: 'Track incident sectors',
      description:
        'When enabled, sectors with incidents are recorded and shown with a warning icon. When disabled, sectors with incidents are discarded.',
    },
    alwaysScroll: {
      type: 'boolean',
      label: 'Always scroll',
      description:
        'Keep the strip continuously scrolling with your position pinned to the center, even when all sectors fit in the widget.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
