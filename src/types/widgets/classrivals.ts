import { CLASS_RIVALS_PER_SIDE_MAX } from '../widgetConfigs';
import { defineWidgetManifest } from './types';
import { numberOptions } from './properties';

/** The whole class, then one to ten cars a side. */
const perSideOptions = [
  { value: 0, label: 'All' },
  ...numberOptions(1, CLASS_RIVALS_PER_SIDE_MAX),
];

export default defineWidgetManifest({
  id: 'classrivals',
  name: 'Class Rivals',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 300,
    y: 520,
    // Wide enough for every column, and high enough for the captions,
    // seven cars and the lines that say what the columns are. A larger
    // class scrolls under the captions.
    width: 790,
    height: 290,
  },
  config: {
    background: { opacity: 80 },
    carsAhead: 0,
    carsBehind: 0,
    showStops: true,
    showNextStop: true,
    showNetGap: true,
    showPace: true,
    showTyres: true,
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
    carsAhead: {
      type: 'enum',
      label: 'Cars Ahead',
      description:
        'Class cars listed ahead of you. All lists the whole class, and the list scrolls.',
      options: perSideOptions,
      control: 'select',
    },
    carsBehind: {
      type: 'enum',
      label: 'Cars Behind',
      description: 'Class cars listed behind you.',
      options: perSideOptions,
      control: 'select',
    },
    showStops: {
      type: 'boolean',
      label: 'Stops',
      description:
        'The stops each car has made, the lap of the last one with its time in the pit lane, and the laps since. A stop made before Tearoff began watching has no lap to show.',
    },
    showNextStop: {
      type: 'boolean',
      label: 'Next Stop',
      description:
        'The lap each car’s next stop is due, marked ~ as the estimate it is: the last lap its energy or fuel completes where the sim gives it (Le Mans Ultimate offline), else the end of the longest stint it has been seen to drive, else of a stint as long as its class has shown. Your own row shows your pit window.',
    },
    showNetGap: {
      type: 'boolean',
      label: 'Net Gap',
      description:
        'The gap once both cars have made the stops they still owe, each at the cost reckoned for it: green when you end ahead. No extra time is added to a stop, so it is Finish Projection’s After column with Extra Time at 0. It reads -- where a stop cannot be costed.',
    },
    showPace: {
      type: 'boolean',
      label: 'Pace 5',
      description:
        'Each car’s mean of its last five clean laps against yours, green when you are the faster. Your own row shows your mean.',
    },
    showTyres: {
      type: 'boolean',
      label: 'Tyres',
      description:
        'The compound each car is on, the laps it has run on the set and the tread left. No sim says that a rival changed tyres, so the laps come with how sure they are. Bare: another compound was seen on the car after a stop, or it has not stopped. With ?: told from how long it stood at a stop. With +: at least that many. The tread is an estimate marked ~: what a lap costs your own car on that compound, times those laps; another car wears its tyres differently. It reads -- until your own car has three clean laps on the compound. Your own row shows your real tread. What a tyre change is taken to last is set once, on the Timing Tower’s page: Tyre Change Takes.',
    },
    showLegend: {
      type: 'boolean',
      label: 'Legend',
      description:
        'A line under the table that says what Net Gap, Pace 5 and the marks in Tyres are. It is drawn where the cars listed fit over it: a list that would have to scroll for it has its room instead.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
