import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'liftcoast',
  name: 'Lift and Coast Lights',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    // A strip near the top of the screen, where a shift light would sit.
    x: 430,
    y: 60,
    width: 340,
    height: 44,
  },
  config: {
    // Lights on their own: nothing behind them unless asked for.
    background: { opacity: 0 },
    ledCount: 10,
    direction: 'right',
    mirrored: false,
    criticalFraction: 0.8,
    showLiftAndCoast: true,
    showTc: true,
    showAbs: true,
    showWheelLock: false,
    showWheelSlip: false,
    lockThreshold: 0.3,
    slipThreshold: 0.1,
    hideWhenDark: false,
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
      description: 'Opacity of the box behind the lights.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    ledCount: {
      type: 'number',
      label: 'Number Of Lights',
      min: 3,
      max: 20,
      step: 1,
    },
    direction: {
      type: 'enum',
      label: 'Fill Direction',
      description: 'Which way the strip fills as the signal rises.',
      options: [
        { value: 'right', label: 'Right' },
        { value: 'left', label: 'Left' },
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
      ],
    },
    mirrored: {
      type: 'boolean',
      label: 'Mirrored Second Strip',
      description:
        'A second strip on the opposite side. With Right or Down the two fill toward each other from the outer ends of the box; with Left or Up they fill outward from the middle.',
    },
    criticalFraction: {
      type: 'number',
      label: 'Lift Now From',
      description:
        'Above this share of the signal the lit lights change from violet to pink. 0.8 is the point TinyPedal changes colour at; what the sim itself does there is not confirmed.',
      min: 0.5,
      max: 1,
      step: 0.05,
    },
    showLiftAndCoast: {
      type: 'boolean',
      label: 'Lift And Coast',
      description:
        "The strip fills with the sim's own lift-and-coast signal, which follows the energy-saving target set in the car. Dark while no target is set.",
    },
    showTc: {
      type: 'boolean',
      label: 'Traction Control',
      description: 'The whole strip turns blue while traction control cuts.',
    },
    showAbs: {
      type: 'boolean',
      label: 'ABS',
      description: 'The whole strip turns yellow while ABS works.',
    },
    showWheelLock: {
      type: 'boolean',
      label: 'Wheel Lock',
      description: 'The whole strip turns red while a wheel is locked.',
    },
    showWheelSlip: {
      type: 'boolean',
      label: 'Wheelspin',
      description: 'The whole strip turns orange while a wheel spins.',
    },
    lockThreshold: {
      type: 'number',
      label: 'Lock From',
      description: 'How far below road speed a wheel turns to count as locked.',
      min: 0.05,
      max: 1,
      step: 0.05,
    },
    slipThreshold: {
      type: 'number',
      label: 'Wheelspin From',
      description:
        'How far above road speed a wheel turns to count as spinning.',
      min: 0.05,
      max: 1,
      step: 0.05,
    },
    hideWhenDark: {
      type: 'boolean',
      label: 'Hide While Dark',
      description: 'Draws nothing while no light is lit.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
