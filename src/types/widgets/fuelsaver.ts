import { defineWidgetManifest } from './types';
import { numberOptions } from './properties';

export default defineWidgetManifest({
  id: 'fuelsaver',
  name: 'Fuel Saver',
  category: 'Fuel',
  enabled: false,
  layout: {
    x: 620,
    y: 480,
    // A caption line, a column per target, and the line for dropping a stop.
    width: 300,
    height: 112,
  },
  config: {
    background: { opacity: 80 },
    basis: 'projected',
    averageLaps: 5,
    reserve: 0.2,
    moreLaps: 3,
    fewerLaps: 0,
    showLast: true,
    showStopTarget: true,
    pitEntryAllowance: false,
    reachShare: 15,
    fuelUnits: 'L',
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
    basis: {
      type: 'enum',
      label: 'Compared With',
      description:
        'The consumption the targets are measured against. Projected follows the lap you are on, so lifting and coasting shows before the line.',
      options: [
        { value: 'projected', label: 'Projected' },
        { value: 'last', label: 'Last Lap' },
        { value: 'average', label: 'Average' },
      ],
    },
    averageLaps: {
      type: 'number',
      label: 'Laps In The Average',
      description: 'Laps through the pits are left out.',
      min: 2,
      max: 10,
      step: 1,
    },
    reserve: {
      type: 'number',
      label: 'Reserve',
      description:
        'Kept back and never counted, in the unit shown: litres, gallons, or percent for a car on virtual energy.',
      min: 0,
      max: 10,
      step: 0.1,
    },
    moreLaps: {
      type: 'enum',
      label: 'Laps More',
      description: 'A column for each lap the stint could be stretched by.',
      options: numberOptions(1, 5),
    },
    fewerLaps: {
      type: 'enum',
      label: 'Laps Fewer',
      description: 'A column for each lap the stint could be cut by.',
      options: numberOptions(0, 3),
    },
    showLast: {
      type: 'boolean',
      label: 'Last Lap',
      description: "The last lap's consumption, beside the current figure.",
    },
    showStopTarget: {
      type: 'boolean',
      label: 'One Stop Fewer',
      description:
        'In a race that still needs a stop: the consumption that would make one stop fewer enough. Left out when no driving style could reach it.',
    },
    pitEntryAllowance: {
      type: 'boolean',
      label: 'Count To Pit Entry',
      description:
        "Count the stint's last lap only as far as the pit entry. Needs the pit entry of this track, which is learned when a car is first seen crossing it.",
    },
    reachShare: {
      type: 'number',
      label: 'Within Reach',
      description:
        'A saving above this share of what the car uses now is drawn as out of reach.',
      min: 5,
      max: 30,
      step: 1,
      units: '%',
    },
    fuelUnits: {
      type: 'enum',
      label: 'Fuel Units',
      description: 'Virtual energy is always in percent.',
      options: [
        { value: 'L', label: 'Litres' },
        { value: 'gal', label: 'Gallons' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
