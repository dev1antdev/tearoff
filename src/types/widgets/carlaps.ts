import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'carlaps',
  name: 'Car Laps',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 300,
    y: 300,
    // Every column, and a dozen laps without scrolling.
    width: 620,
    height: 420,
  },
  config: {
    background: { opacity: 80 },
    showSectors: true,
    showEnergy: true,
    // Off, so it can be read from the garage and the pit wall.
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
      description: 'Opacity of the widget background.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    showSectors: {
      type: 'boolean',
      label: 'Sectors',
      description:
        'S1, S2 and S3 of each lap, with the best of the stint in each green. Le Mans Ultimate only: iRacing times nobody else’s sectors, and the columns are left out there.',
    },
    showEnergy: {
      type: 'boolean',
      label: 'Energy',
      description:
        'What each lap used, in percent of a full budget: virtual energy for a car that runs on it, fuel otherwise. It reads "refilled" for a lap the car ended with more than it began, and -- for a lap with no reading. Le Mans Ultimate only: the column is left out under iRacing, and for a car the sim publishes neither for.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
