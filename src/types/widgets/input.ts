import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'input',
  name: 'Input Traces',
  category: 'Car & Controls',
  menuLabel: 'Input',
  enabled: true,
  layout: {
    x: 622,
    y: 864,
    width: 396,
    height: 92,
  },
  config: {
    useRawValues: false,
    trace: {
      enabled: true,
      includeThrottle: true,
      includeBrake: true,
      includeAbs: true,
      includeTc: true,
      absStyle: 'overlay',
      includeSteer: true,
      includeClutch: false,
      strokeWidth: 3,
      maxSamples: 400,
    },
    bar: {
      enabled: true,
      includeClutch: true,
      includeBrake: true,
      includeThrottle: true,
      includeAbs: true,
      includeTc: true,
      dual: false,
      brakeFromPressure: false,
      showMaxMarker: true,
      includeFfb: false,
    },
    gear: {
      enabled: true,
      size: 100,
      showspeed: true,
      showspeedunit: true,
      swapSpeedUnit: false,
      unit: 'auto',
    },
    abs: {
      enabled: false,
    },
    steer: {
      enabled: true,
      config: {
        style: 'default',
        color: 'light',
      },
      angleReadout: 'beyond270',
      rotationArc: 'never',
      rangeDeg: 0,
      showWheelAngle: false,
    },
    steerMeter: {
      enabled: false,
      markDeg: 90,
      showAngle: true,
    },
    background: {
      opacity: 80,
    },
    showOnlyWhenOnTrack: true,
    displayOrder: ['trace', 'bar', 'gear', 'steer'],
    shiftFlash: {
      enabled: false,
      source: 'redline',
      color: '#9333ea',
    },
    gearFlash: {
      enabled: false,
      upColor: '#22c55e',
      downColor: '#ef4444',
    },
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    // Drawn on the settings page as the two-way Input source choice, Car or
    // Pedals; on is Pedals.
    useRawValues: {
      type: 'boolean',
      label: 'Input source: pedals',
      description:
        'Show the raw pedal position, before the assists, instead of what the car receives after traction control, ABS and shift cuts.',
    },
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'trace.includeClutch': { type: 'boolean', label: 'Show Clutch Trace' },
    'trace.includeThrottle': { type: 'boolean', label: 'Show Throttle Trace' },
    'trace.includeBrake': { type: 'boolean', label: 'Show Brake Trace' },
    'trace.includeAbs': { type: 'boolean', label: 'Show ABS' },
    'trace.includeTc': {
      type: 'boolean',
      label: 'Show Traction Control',
      description:
        'Mark the throttle trace while traction control is cutting power. Le Mans Ultimate only: iRacing does not report it.',
    },
    'trace.absStyle': {
      type: 'enum',
      label: 'ABS and Traction Control Style',
      description: 'How ABS and traction control are marked in the trace',
      options: [
        { value: 'overlay', label: 'Overlay' },
        { value: 'bar', label: 'Bar (fill under curve)' },
      ],
      control: 'select',
    },
    'trace.includeSteer': { type: 'boolean', label: 'Show Steering Trace' },
    'trace.strokeWidth': {
      type: 'number',
      label: 'Stroke Width',
      min: 0,
      max: 10,
      step: 1,
      units: 'px',
    },
    'trace.maxSamples': {
      type: 'number',
      label: 'Max Samples',
      min: 40,
      max: 1000,
      step: 1,
      units: ' samples',
    },
    'bar.includeClutch': { type: 'boolean', label: 'Show Clutch Bar' },
    'bar.includeThrottle': { type: 'boolean', label: 'Show Throttle Bar' },
    'bar.includeBrake': { type: 'boolean', label: 'Show Brake Bar' },
    'bar.includeAbs': { type: 'boolean', label: 'Show ABS Indicator' },
    'bar.includeTc': {
      type: 'boolean',
      label: 'Show Traction Control Indicator',
      description:
        'Mark the throttle bar while traction control is cutting power. Le Mans Ultimate only: iRacing does not report it.',
    },
    'bar.dual': {
      type: 'boolean',
      label: 'Pedal and Car Side by Side',
      description:
        'Draw each pedal as a narrow strip of pedal travel beside a wide strip of what the car received, whatever the input source.',
    },
    'bar.brakeFromPressure': {
      type: 'boolean',
      label: 'Brake Pressure as the Car Strip',
      description:
        "The brake's wide strip shows the brake line pressure, scaled to the hardest application of the session, instead of the brake the car received.",
    },
    'bar.showMaxMarker': {
      type: 'boolean',
      label: 'Show Full Travel Marker',
      description: 'A cap above each pedal bar, lit while the pedal is flat.',
    },
    'bar.includeFfb': {
      type: 'boolean',
      label: 'Show Force Feedback Bar',
      description:
        'A fourth bar with the size of the force feedback. It turns amber while the force is clipping.',
    },
    'steer.angleReadout': {
      type: 'enum',
      label: 'Angle Readout',
      description: 'When the wheel shows its angle in degrees',
      options: [
        { value: 'beyond270', label: 'Past 270°' },
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' },
      ],
    },
    'steer.rotationArc': {
      type: 'enum',
      label: 'Rotation Arc',
      description:
        'An arc around the wheel from the top, as long as the wheel is turned',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'stationary', label: 'Stationary' },
        { value: 'always', label: 'Always' },
      ],
    },
    'steer.rangeDeg': {
      type: 'number',
      label: 'Wheel Rotation Range',
      description:
        "Your wheel's rotation from lock to lock. Leave at 0 to use the car's own range as the sim states it.",
      min: 0,
      max: 1440,
      step: 10,
      units: '°',
    },
    'steer.showWheelAngle': {
      type: 'boolean',
      label: 'Show Front Wheel Angle',
      description:
        'The front wheel angle and the steering ratio under the wheel. Le Mans Ultimate only.',
    },
    'steerMeter.markDeg': {
      type: 'number',
      label: 'Scale Mark Spacing',
      description: 'Degrees of wheel angle between the marks',
      min: 30,
      max: 180,
      step: 10,
      units: '°',
    },
    'steerMeter.showAngle': {
      type: 'boolean',
      label: 'Show Angle',
      description: 'Whole degrees at the steered end',
    },
    'steer.config.style': {
      type: 'enum',
      label: 'Wheel Style',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'formula', label: 'Formula' },
        { value: 'lmp', label: 'LMP' },
        { value: 'nascar', label: 'NASCAR' },
        { value: 'ushape', label: 'U-Shape' },
        { value: 'ring', label: 'Ring (gear inside)' },
      ],
      control: 'select',
    },
    'steer.config.color': {
      type: 'enum',
      label: 'Wheel Color',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      control: 'select',
    },
    'gear.size': {
      type: 'number',
      label: 'Gear Display Scale',
      description: 'Relative size of the gear number display',
      min: 50,
      max: 150,
      step: 1,
      units: '%',
    },
    'gear.showspeed': {
      type: 'boolean',
      label: 'Show Speed',
      description: 'Show the current speed beneath the gear number',
    },
    'gear.unit': {
      type: 'enum',
      label: 'Speed Unit',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'mph', label: 'MPH' },
        { value: 'km/h', label: 'KM/H' },
      ],
    },
    'gear.showspeedunit': { type: 'boolean', label: 'Show Speed Unit Label' },
    'gear.swapSpeedUnit': { type: 'boolean', label: 'Swap Speed & Unit' },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        "Hidden in the garage and in the menus. Shown while you drive, and while you watch your own car with a team-mate driving it, where the sim sends that car's pedals.",
    },
  },
});
