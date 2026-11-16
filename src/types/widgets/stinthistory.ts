import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'stinthistory',
  name: 'Stint History',
  category: 'Fuel',
  enabled: false,
  layout: {
    x: 300,
    y: 380,
    // The stint under way and three finished ones, under the header.
    width: 380,
    height: 120,
  },
  config: {
    background: { opacity: 80 },
    historyCount: 3,
    showCurrent: true,
    thisSessionOnly: true,
    minLaps: 1,
    newestFirst: true,
    showLaps: true,
    showTime: true,
    showFuel: true,
    showFuelPerLap: false,
    showTyres: true,
    showWear: true,
    wearMode: 'average',
    showBrakes: false,
    showPace: true,
    showConsistency: false,
    showStop: true,
    showDriver: false,
    fuelUnits: 'L',
    // Off, so the table can be read in the garage after a stint.
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
    historyCount: {
      type: 'number',
      label: 'Finished Stints',
      description: 'How many finished stints are listed.',
      min: 1,
      max: 10,
      step: 1,
    },
    showCurrent: {
      type: 'boolean',
      label: 'Show The Stint Under Way',
      description:
        'A row for the stint you are driving, with its figures so far.',
    },
    thisSessionOnly: {
      type: 'boolean',
      label: 'This Session Only',
      description:
        'Leave out the stints of earlier sessions of the event: practice and qualifying, once the race is on.',
    },
    minLaps: {
      type: 'number',
      label: 'Shortest Stint Listed',
      description:
        'Finished stints with fewer laps than this are left out. 0 lists every one.',
      min: 0,
      max: 10,
      step: 1,
      units: 'laps',
    },
    newestFirst: {
      type: 'boolean',
      label: 'Newest At The Top',
      description: 'Turn off to list the stints oldest first.',
    },
    showLaps: {
      type: 'boolean',
      label: 'Laps',
      description: 'Laps completed in the stint.',
    },
    showTime: {
      type: 'boolean',
      label: 'Time',
      description: 'How long the stint ran on track.',
    },
    showFuel: {
      type: 'boolean',
      label: 'Fuel Or Energy Used',
      description:
        'A car that runs on virtual energy shows percent of its energy; any other shows fuel.',
    },
    showFuelPerLap: {
      type: 'boolean',
      label: 'Per Lap',
      description: 'Under the amount used, what a lap of the stint used.',
    },
    fuelUnits: {
      type: 'enum',
      label: 'Fuel Units',
      description: 'Virtual energy is always shown in percent.',
      options: [
        { value: 'L', label: 'Litres' },
        { value: 'gal', label: 'Gallons' },
      ],
    },
    showTyres: {
      type: 'boolean',
      label: 'Tyres',
      description:
        'The compound the stint was driven on, drawn as four dots for a mixed set.',
    },
    showWear: {
      type: 'boolean',
      label: 'Tyre Wear',
      description:
        'Tread worn over the stint, in percent: amber when a tyre lost more than 30 points, red above 50. Le Mans Ultimate only: iRacing reads tread in the pits, not on track.',
    },
    wearMode: {
      type: 'enum',
      label: 'Wear Of',
      description: 'The average of the four wheels, or the one that wore most.',
      options: [
        { value: 'average', label: 'Average' },
        { value: 'highest', label: 'Highest' },
      ],
    },
    showBrakes: {
      type: 'boolean',
      label: 'Brake Wear',
      description:
        'Brake disc worn over the stint, in millimetres. Le Mans Ultimate only.',
    },
    showPace: {
      type: 'boolean',
      label: 'Best Lap',
      description:
        "The stint's best clean lap, purple when it is your best of the session.",
    },
    showConsistency: {
      type: 'boolean',
      label: 'Consistency',
      description:
        'Under the best lap, how close the other clean laps of the stint came to it: the best lap as a percentage of their average.',
    },
    showStop: {
      type: 'boolean',
      label: 'Stop',
      description:
        'The stop that ended the stint: seconds in the pit lane, what went in, and whether tyres, brakes or the driver changed. A garage marks a stint that ended in the garage, a chequered flag one the session ended.',
    },
    showDriver: {
      type: 'boolean',
      label: 'Driver',
      description: "The driver's surname after the stint's number.",
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive, and while you watch your own car with a team-mate driving it.',
    },
  },
});
