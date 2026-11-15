import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'frictioncircle',
  name: 'Friction Circle',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 260,
    y: 300,
    // Square: the circle fills it.
    width: 200,
    height: 200,
  },
  config: {
    background: { opacity: 80 },
    // Whole-g rings at 1, 2 and 3 with room past them for a Hypercar.
    scaleG: 3.5,
    orientation: 'force',
    showTrace: true,
    traceSeconds: 4,
    showRings: true,
    showSustainedRing: true,
    showReadings: true,
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
    scaleG: {
      type: 'number',
      label: 'Scale',
      description:
        'The g at the edge of the circle. A reading beyond it is drawn on the edge, with the dot in amber.',
      min: 1,
      max: 6,
      step: 0.5,
      units: 'g',
    },
    orientation: {
      type: 'enum',
      label: 'Direction',
      description:
        'Force shows where you are thrown: the dot goes up under braking and to the right in a left-hand corner. Acceleration shows where the car is being pushed: down under braking and to the left in a left-hand corner.',
      options: [
        { value: 'force', label: 'Force' },
        { value: 'acceleration', label: 'Acceleration' },
      ],
    },
    showTrace: {
      type: 'boolean',
      label: 'Trail',
      description: 'A fading line of where the dot has just been.',
    },
    traceSeconds: {
      type: 'number',
      label: 'Trail Length',
      description: 'How many seconds of driving the trail holds.',
      min: 1,
      max: 10,
      step: 1,
      units: 's',
    },
    showRings: {
      type: 'boolean',
      label: 'Rings',
      description: 'A ring at each whole g and a cross through the centre.',
    },
    showSustainedRing: {
      type: 'boolean',
      label: 'Sustained Grip Ring',
      description:
        'A dashed ring at the best lateral g the car has held through a corner lately. A kerb or a knock does not move it.',
    },
    showReadings: {
      type: 'boolean',
      label: 'Figures',
      description:
        'Lateral and longitudinal g in the top corners, and the highest of each over the last five seconds in the bottom corners.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
