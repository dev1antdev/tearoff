import { numberOptions } from './properties';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'classfields',
  name: 'Class Fields',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 300,
    y: 20,
    // Three chips in a row: a three-class grid, each "12/14".
    width: 330,
    height: 44,
  },
  config: {
    background: { opacity: 80 },
    orientation: 'horizontal',
    maxClasses: 5,
    order: 'leaderPosition',
    showTotal: true,
    showInactive: false,
    showInPitLane: false,
    highlightOwnClass: true,
    showOnlyWhenOnTrack: false,
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
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    orientation: {
      type: 'enum',
      label: 'Orientation',
      description: 'The classes side by side, or one under another.',
      options: [
        { value: 'horizontal', label: 'Row' },
        { value: 'vertical', label: 'Column' },
      ],
    },
    maxClasses: {
      type: 'enum',
      control: 'select',
      label: 'Classes To Show',
      description:
        'The most classes shown at once. Your own class is always one of them.',
      options: numberOptions(2, 20),
    },
    order: {
      type: 'enum',
      label: 'Class Order',
      description:
        "By the overall place of each class's leader, or fastest class first as the Standings list them.",
      options: [
        { value: 'leaderPosition', label: 'Leader Place' },
        { value: 'classSpeed', label: 'Class Speed' },
      ],
    },
    showTotal: {
      type: 'boolean',
      label: 'Show Cars Entered',
      description:
        'The cars still running of the cars entered, "12/14", rather than the cars running alone.',
    },
    showInactive: {
      type: 'boolean',
      label: 'Show Cars Out',
      description:
        'The number of cars no longer running: in the garage, retired, disqualified or gone from the session.',
    },
    showInPitLane: {
      type: 'boolean',
      label: 'Show Cars In The Pit Lane',
      description:
        "The number of the class's running cars in the pit lane or stopped at their box.",
    },
    highlightOwnClass: {
      type: 'boolean',
      label: 'Highlight Your Class',
      description:
        'Outlines the class of your car, or of the car you are watching.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track.',
    },
  },
});
