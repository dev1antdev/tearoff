import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'ourcar',
  name: 'Our Car',
  category: 'Fuel',
  enabled: false,
  layout: {
    x: 620,
    y: 480,
    // The budget and its bar, two rows of two tiles, and a line each for
    // the tyres and the damage. The four tiles of a team-mate's stint make
    // it taller, and the panel scrolls.
    width: 380,
    height: 400,
  },
  config: {
    background: { opacity: 80 },
    fuelUnits: 'L',
    showPace: 'watching',
    showStops: true,
    showForecast: true,
    showRejoin: true,
    showTyres: true,
    showDamage: true,
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
    fuelUnits: {
      type: 'enum',
      label: 'Fuel Units',
      description: 'Virtual energy is always counted in percent.',
      options: [
        { value: 'L', label: 'Litres' },
        { value: 'gal', label: 'Gallons' },
      ],
    },
    showPace: {
      type: 'enum',
      label: 'Gaps And Pace',
      description:
        'Four tiles over the rest: the gaps to the class cars ahead and behind with how fast each is closing, the last lap, and the mean of the last five clean laps. The closing rate is an estimate from the two cars’ means of five clean laps, not a measured change of the gap.',
      options: [
        { value: 'watching', label: 'While Watching' },
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' },
      ],
    },
    showStops: {
      type: 'boolean',
      label: 'Pit Window And Stops',
      description:
        'The laps the next stop can be made on without adding a stop to the race, the stops still owed, and what the next costs: the pit lane and the standing time the pit menu’s stop is estimated at, with no extra time added.',
    },
    showForecast: {
      type: 'boolean',
      label: 'Finish Forecast',
      description:
        'Your place among the running cars of the class if everything goes on as it has: each car keeps its measured pace and makes the stops it still owes, at the cost reckoned for it. A ~ and a quieter tone mean it rests on less than a reading for a car that decides your place.',
    },
    showRejoin: {
      type: 'boolean',
      label: 'After The Stop',
      description:
        'Where you rejoin in class if you stop now for the stop the pit menu is set to: the car you come out behind, and how far clear you are of the car behind. It assumes no rival stops in the meantime.',
    },
    showTyres: {
      type: 'boolean',
      label: 'Tyres',
      description:
        'Tread on each wheel and the laps it lasts, from Tyre & Brake Wear. Le Mans Ultimate only.',
    },
    showDamage: {
      type: 'boolean',
      label: 'Damage',
      description:
        'Whether the car is damaged, and the repair time of the next stop. Le Mans Ultimate only.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
