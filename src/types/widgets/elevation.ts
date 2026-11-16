import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'elevation',
  name: 'Elevation',
  category: 'Track & Navigation',
  enabled: false,
  layout: {
    x: 760,
    y: 60,
    width: 400,
    height: 70,
  },
  config: {
    background: { opacity: 80 },
    showProgress: true,
    showSectors: true,
    showReading: true,
    showRange: true,
    zero: 'lowest',
    unit: 'auto',
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
    showProgress: {
      type: 'boolean',
      label: 'Lap Progress',
      description: 'Tint the part of the lap already driven.',
    },
    showSectors: {
      type: 'boolean',
      label: 'Sector Lines',
      description: 'A dashed line where each sector starts.',
    },
    showReading: {
      type: 'boolean',
      label: 'Current Height',
      description:
        'The height of the track where the car is, in the top left corner.',
    },
    showRange: {
      type: 'boolean',
      label: 'Height Range',
      description:
        'The difference between the highest and the lowest point of the lap, in the top right corner.',
    },
    zero: {
      type: 'enum',
      label: 'Measured From',
      description:
        'What the current height is measured from: the lowest point of the lap, or the start/finish line. From the line it is signed, so a negative height is below the line.',
      options: [
        { value: 'lowest', label: 'Lowest Point' },
        { value: 'line', label: 'Start/Finish' },
      ],
    },
    unit: {
      type: 'enum',
      label: 'Units',
      description: "Auto follows the simulator's own display units.",
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'm', label: 'm' },
        { value: 'ft', label: 'ft' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track.',
    },
  },
});
