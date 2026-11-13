import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'lapdelta',
  name: 'Lap Delta',
  category: 'Lap Timing',
  enabled: false,
  layout: {
    x: 6,
    y: 700,
    width: 220,
    height: 130,
  },
  config: {
    background: { opacity: 80 },
    reference: 'sessionBest',
    decimals: 2,
    showTrend: true,
    // A car a third of a second a second off its reference is deep in a
    // mistake; most of a lap sits inside a tenth of that.
    trendRange: 0.3,
    showPredictedLap: true,
    showReferenceLap: true,
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
    reference: {
      type: 'enum',
      label: 'Reference Lap',
      description:
        'Session best is your best clean lap since the session began. All-time best is your best clean lap on this track in this car, kept between sessions. Until the chosen lap exists the widget shows dashes.',
      options: [
        { value: 'sessionBest', label: 'Session Best' },
        { value: 'allTime', label: 'All-Time Best' },
      ],
    },
    decimals: {
      type: 'enum',
      label: 'Delta Precision',
      options: [
        { value: 2, label: '0.00' },
        { value: 3, label: '0.000' },
      ],
    },
    showTrend: {
      type: 'boolean',
      label: 'Trend Bar',
      description:
        'A bar that grows green while you are gaining on the reference and red while you are losing to it.',
    },
    trendRange: {
      type: 'number',
      label: 'Trend Bar Range',
      description:
        'The rate that fills the bar, in seconds gained or lost per second. Lower makes the bar more sensitive.',
      min: 0.1,
      max: 1,
      step: 0.05,
      units: 's/s',
    },
    showPredictedLap: {
      type: 'boolean',
      label: 'Predicted Lap',
      description:
        'The lap time you are heading for: the reference lap plus the current delta.',
    },
    showReferenceLap: {
      type: 'boolean',
      label: 'Reference Lap Time',
      description: 'The time of the lap the delta is measured against.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description: 'Hide the widget while you are not driving.',
    },
  },
});
