import { STINT_TIMELINE_RIVALS_MAX } from '../widgetConfigs';
import { defineWidgetManifest } from './types';
import { numberOptions } from './properties';

export default defineWidgetManifest({
  id: 'stinttimeline',
  name: 'Stint Timeline',
  category: 'Fuel',
  enabled: false,
  layout: {
    x: 300,
    y: 800,
    // Three bars, the scale under them and the line that says what they
    // are.
    width: 700,
    height: 170,
  },
  config: {
    background: { opacity: 80 },
    rivals: 2,
    showDrivers: true,
    showLegend: true,
    // Off, so it can be read from the garage and the pit wall.
    showOnlyWhenOnTrack: false,
    sessionVisibility: {
      race: true,
      loneQualify: false,
      openQualify: false,
      practice: false,
      offlineTesting: false,
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
    rivals: {
      type: 'enum',
      label: 'Rivals',
      description:
        'Class cars drawn under your own: the nearest, taken from ahead and behind in turn. Two is the car ahead and the car behind.',
      options: numberOptions(0, STINT_TIMELINE_RIVALS_MAX),
    },
    showDrivers: {
      type: 'boolean',
      label: 'Driver Names',
      description:
        'Who drove each stint of your car, on its bar. A stint to come is not named: who drives it is not known.',
    },
    showLegend: {
      type: 'boolean',
      label: 'Legend',
      description: 'A line under the bars that says what they are.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
