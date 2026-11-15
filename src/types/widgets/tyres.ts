import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'tyres',
  name: 'Tyres',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 6,
    y: 300,
    // Tall and narrow: an axle is one row, and the two axles stack.
    width: 240,
    height: 380,
  },
  config: {
    background: { opacity: 80 },
    temperatureSource: 'surface',
    temperatureUnit: 'celsius',
    pressureUnit: 'psi',
    tyreWindow: {
      followCompound: true,
      range: 10,
      min: 80,
      max: 100,
    },
    brakeWindow: { min: 300, max: 700 },
    pressureTarget: {
      enabled: false,
      // 27.0 psi and half a psi either side.
      front: 186,
      rear: 186,
      tolerance: 3.5,
    },
    pressureColdBelow: 65,
    // The three rows below are off so that a saved dashboard keeps its look
    // and the default height still fits; with load and deflection on, the
    // widget wants about 430 px.
    showPressureDeviation: false,
    showLoad: false,
    lowLoadThreshold: 1,
    showDeflection: false,
    liftOffThreshold: 1,
    showBrakes: true,
    showWear: false,
    showCompound: true,
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
    temperatureSource: {
      type: 'enum',
      label: 'Tyre Temperature',
      description:
        'Surface is the tread the road touches and swings with every corner. Inner layer is the rubber just under it. Carcass moves slowly and shows how the tyre is doing over a stint.',
      options: [
        { value: 'surface', label: 'Surface' },
        { value: 'innerLayer', label: 'Inner Layer' },
        { value: 'carcass', label: 'Carcass' },
      ],
    },
    temperatureUnit: {
      type: 'enum',
      label: 'Temperature Unit',
      options: [
        { value: 'celsius', label: '°C' },
        { value: 'fahrenheit', label: '°F' },
      ],
    },
    pressureUnit: {
      type: 'enum',
      label: 'Pressure Unit',
      options: [
        { value: 'psi', label: 'psi' },
        { value: 'kpa', label: 'kPa' },
        { value: 'bar', label: 'bar' },
      ],
    },
    'tyreWindow.followCompound': {
      type: 'boolean',
      label: 'Follow The Compound',
      description:
        'Centres the green window on the working temperature the sim states for the fitted compound. Turn off to set the window yourself.',
    },
    'tyreWindow.range': {
      type: 'number',
      label: 'Window Width',
      description: 'Degrees Celsius either side of the working temperature.',
      min: 2,
      max: 30,
      step: 1,
      units: '°C',
    },
    'tyreWindow.min': {
      type: 'number',
      control: 'input',
      label: 'Tyre Window From',
      description:
        'Used when not following the compound, or when the sim states no working temperature.',
      min: 0,
      max: 200,
      step: 1,
      units: '°C',
    },
    'tyreWindow.max': {
      type: 'number',
      control: 'input',
      label: 'Tyre Window To',
      min: 0,
      max: 200,
      step: 1,
      units: '°C',
    },
    'brakeWindow.min': {
      type: 'number',
      control: 'input',
      label: 'Brake Window From',
      description: 'Below this the brakes are drawn as cold.',
      min: 0,
      max: 1200,
      step: 10,
      units: '°C',
    },
    'brakeWindow.max': {
      type: 'number',
      control: 'input',
      label: 'Brake Window To',
      description: 'Above this the brakes are drawn as overheating.',
      min: 0,
      max: 1200,
      step: 10,
      units: '°C',
    },
    'pressureTarget.enabled': {
      type: 'boolean',
      label: 'Colour By Target Pressure',
      description:
        'Draws a pressure green when it is within the tolerance of the target, blue below it and red above it.',
    },
    'pressureTarget.front': {
      type: 'number',
      control: 'input',
      label: 'Front Target',
      min: 0,
      max: 400,
      step: 0.5,
      units: 'kPa',
    },
    'pressureTarget.rear': {
      type: 'number',
      control: 'input',
      label: 'Rear Target',
      min: 0,
      max: 400,
      step: 0.5,
      units: 'kPa',
    },
    'pressureTarget.tolerance': {
      type: 'number',
      control: 'input',
      label: 'Tolerance',
      min: 0,
      max: 50,
      step: 0.5,
      units: 'kPa',
    },
    pressureColdBelow: {
      type: 'number',
      control: 'input',
      label: 'Cold Tyre Below',
      description:
        'While the carcass of a tyre is under this temperature its pressure is drawn blue whatever the target says: a cold pressure cannot be judged against a hot target. 0 switches this off.',
      min: 0,
      max: 150,
      step: 1,
      units: '°C',
    },
    showPressureDeviation: {
      type: 'boolean',
      label: 'Show Pressure Deviation',
      description:
        'Under each pressure, how far it sits below the highest of the four, averaged over a few seconds. The highest wheel reads 0.0.',
    },
    showLoad: {
      type: 'boolean',
      label: 'Show Load Share',
      description:
        'A bar under each tyre for its share of the load on all four wheels, full at 50%. The share is taken from suspension load when the sim withholds tyre load, as Le Mans Ultimate does, which makes it an estimate: the split between left and right is sound, the split between front and rear is approximate.',
    },
    lowLoadThreshold: {
      type: 'number',
      control: 'input',
      label: 'Low Load At',
      description: 'At or below this share the bar and its figure turn red.',
      min: 0,
      max: 25,
      step: 1,
      units: '%',
    },
    showDeflection: {
      type: 'boolean',
      label: 'Show Tyre Deflection',
      description:
        'How far each tyre is squashed, in millimetres. A wheel in the air reads 0.',
    },
    liftOffThreshold: {
      type: 'number',
      control: 'input',
      label: 'Lift-Off At',
      description:
        'At or below this deflection the figure turns red: the wheel is off the ground, or all but.',
      min: 0,
      max: 20,
      step: 1,
      units: 'mm',
    },
    showBrakes: {
      type: 'boolean',
      label: 'Show Brake Temperature',
      description: 'The average of the two discs on each axle.',
    },
    showWear: {
      type: 'boolean',
      label: 'Show Tread Remaining',
      description: 'How much of each tyre is left, as a percentage.',
    },
    showCompound: {
      type: 'boolean',
      label: 'Show Compound',
      description: 'The compound fitted to each axle.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
