import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'wear',
  name: 'Tyre & Brake Wear',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 260,
    y: 300,
    // Two sections of two rows. The tyre section alone wants about 130 px;
    // the brake section grows a line once its laps left come on screen.
    width: 260,
    height: 250,
  },
  config: {
    background: { opacity: 80 },
    tyres: {
      show: true,
      showPerLap: true,
      perLapSource: 'average',
      showLapsLeft: true,
      showMinutesLeft: false,
      showEndOfStint: true,
      // The sim does not say where a tyre is finished: worn to nothing,
      // until the driver knows better.
      floorPct: 0,
      warnPct: 30,
      warnLaps: 5,
      warnPerLapPct: 3,
    },
    brakes: {
      show: true,
      primary: 'thickness',
      showPerLap: true,
      showLapsLeft: true,
      showMinutesLeft: false,
      // 0: a thickness learned from a failed brake, else the figure for the
      // class (25 mm for a Hypercar or LMP2, 30 mm for a GT car).
      failureFrontMm: 0,
      failureRearMm: 0,
      warnLifePct: 30,
      warnLaps: 5,
    },
    showCompound: true,
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
    'tyres.show': {
      type: 'boolean',
      label: 'Show Tyres',
      description: 'Tread left on each wheel, with its forecast under it.',
    },
    'tyres.showPerLap': {
      type: 'boolean',
      label: 'Show Wear Per Lap',
      description: 'How much tread a lap costs, in percent.',
    },
    'tyres.perLapSource': {
      type: 'enum',
      label: 'Wear Per Lap',
      description:
        'Average is the figure the forecast uses: the middle one of your last five clean laps on this tyre. This Lap is what the lap under way is heading for, which moves with every lock-up. The laps left are counted from the average either way.',
      options: [
        { value: 'average', label: 'Average' },
        { value: 'thisLap', label: 'This Lap' },
      ],
    },
    'tyres.showLapsLeft': {
      type: 'boolean',
      label: 'Show Laps Left',
      description:
        'Whole laps until the tread reaches the end of life set below.',
    },
    'tyres.showMinutesLeft': {
      type: 'boolean',
      label: 'Show Minutes Left',
      description: 'Those laps at your pace over your last clean laps.',
    },
    'tyres.showEndOfStint': {
      type: 'boolean',
      label: 'Show Tread At End Of Stint',
      description:
        'The tread expected when the fuel or virtual energy on board runs out.',
    },
    'tyres.floorPct': {
      type: 'number',
      label: 'End Of Life',
      description:
        'Tread at which you call the tyre finished; the laps left are counted down to it. Le Mans Ultimate does not state one, so this is yours to set. At 0 the laps are counted to a tyre with no tread at all.',
      min: 0,
      max: 60,
      step: 1,
      units: '%',
    },
    'tyres.warnPct': {
      type: 'number',
      label: 'Low Tread At',
      description:
        'Tread at or below this is amber; at or below half of it, red.',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'tyres.warnLaps': {
      type: 'number',
      label: 'Few Laps Left At',
      description: 'Laps left at or below this are red.',
      min: 0,
      max: 50,
      step: 1,
      units: 'laps',
    },
    'tyres.warnPerLapPct': {
      type: 'number',
      label: 'High Wear Above',
      description: 'Wear per lap above this is amber.',
      min: 0,
      max: 20,
      step: 0.5,
      units: '%',
    },
    'brakes.show': {
      type: 'boolean',
      label: 'Show Brakes',
      description: 'Disc thickness on each wheel, with its forecast under it.',
    },
    'brakes.primary': {
      type: 'enum',
      label: 'Large Figure',
      description:
        'Thickness is the disc in millimetres. Life is the share of usable disc left, between a new disc and the failure thickness.',
      options: [
        { value: 'thickness', label: 'Thickness' },
        { value: 'life', label: 'Life' },
      ],
    },
    'brakes.showPerLap': {
      type: 'boolean',
      label: 'Show Wear Per Lap',
      description: 'How much disc a lap costs, in millimetres.',
    },
    'brakes.showLapsLeft': {
      type: 'boolean',
      label: 'Show Laps Left',
      description:
        'Whole laps until the disc reaches its failure thickness. Left out while it is 999 or more, which on a GT car is always.',
    },
    'brakes.showMinutesLeft': {
      type: 'boolean',
      label: 'Show Minutes Left',
      description: 'Those laps at your pace over your last clean laps.',
    },
    'brakes.failureFrontMm': {
      type: 'number',
      control: 'input',
      label: 'Front Failure Thickness',
      description:
        'Thickness at which a front disc fails. Le Mans Ultimate does not state one, so this is yours to set. At 0 the widget uses a thickness it saw a disc of this car stop wearing at, and failing that 25 mm for a Hypercar or LMP2 and 30 mm for a GT car, which are unconfirmed.',
      min: 0,
      max: 60,
      step: 0.5,
      units: 'mm',
    },
    'brakes.failureRearMm': {
      type: 'number',
      control: 'input',
      label: 'Rear Failure Thickness',
      description: 'The same for the rear discs.',
      min: 0,
      max: 60,
      step: 0.5,
      units: 'mm',
    },
    'brakes.warnLifePct': {
      type: 'number',
      label: 'Low Life At',
      description:
        'Usable disc at or below this is amber; at or below half of it, red.',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'brakes.warnLaps': {
      type: 'number',
      label: 'Few Laps Left At',
      description: 'Laps left at or below this are red.',
      min: 0,
      max: 50,
      step: 1,
      units: 'laps',
    },
    showCompound: {
      type: 'boolean',
      label: 'Show Compound',
      description: 'The compound fitted to each axle, between its two tyres.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
