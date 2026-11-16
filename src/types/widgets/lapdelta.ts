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
    secondary: {
      sessionBest: false,
      allTime: false,
      stintBest: false,
      lastLap: false,
    },
    freezeSeconds: 3,
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
        'The lap the large figure, the trend bar and the predicted lap are measured against. Session best is your best clean lap since the session began. All-time best is your best clean lap on this track in this car, kept between sessions. Stint best is your best clean lap since your last stop. Last lap is the lap you have just driven, clean or not. Until the chosen lap exists the widget shows dashes.',
      options: [
        { value: 'sessionBest', label: 'Session Best' },
        { value: 'allTime', label: 'All-Time Best' },
        { value: 'stintBest', label: 'Stint Best' },
        { value: 'lastLap', label: 'Last Lap' },
      ],
    },
    'secondary.sessionBest': {
      type: 'boolean',
      label: 'Session Best',
      description: 'S: the delta to your best clean lap of the session.',
    },
    'secondary.allTime': {
      type: 'boolean',
      label: 'All-Time Best',
      description:
        'A: the delta to your best clean lap on this track in this car.',
    },
    'secondary.stintBest': {
      type: 'boolean',
      label: 'Stint Best',
      description: 'T: the delta to your best clean lap since your last stop.',
    },
    'secondary.lastLap': {
      type: 'boolean',
      label: 'Last Lap',
      description: 'L: the delta to the lap you have just driven.',
    },
    freezeSeconds: {
      type: 'number',
      label: 'Hold The Result After The Line',
      description:
        'For this long after the line the widget shows how the lap you just finished ended against each lap, before going back to the live delta. 0 switches it off.',
      min: 0,
      max: 10,
      step: 1,
      units: 's',
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
      description:
        'Hidden in the garage and in the menus. Shown while you drive, and while you watch your own car with a team-mate driving it.',
    },
  },
});
