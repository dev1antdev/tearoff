import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'chassis',
  name: 'Chassis',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    // Beside the tyres, which it is read together with.
    x: 252,
    y: 300,
    width: 240,
    height: 220,
  },
  config: {
    background: { opacity: 80 },
    showRideHeight: true,
    rideHeightScale: 100,
    // 0 only catches a corner below the road. 10 mm catches a kerb strike.
    bottomingFront: 0,
    bottomingRear: 0,
    showRake: true,
    // The sim publishes no wheelbase and no track widths. These are round
    // figures for a GT or prototype; the angles are as good as the numbers.
    wheelbase: 2800,
    showRoll: true,
    trackFront: 1800,
    trackRear: 1800,
    showRollShare: false,
    showCamber: true,
    showToe: true,
    toeDisplay: 'axle',
    showSuspension: false,
    layout: 'column',
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
    showRideHeight: {
      type: 'boolean',
      label: 'Show Ride Height',
      description:
        'Millimetres between the road and the car at each of the four corners, with a bar each.',
    },
    rideHeightScale: {
      type: 'number',
      control: 'input',
      label: 'Full Bar At',
      description: 'The ride height at which a bar is full.',
      min: 20,
      max: 300,
      step: 10,
      units: 'mm',
    },
    bottomingFront: {
      type: 'number',
      control: 'input',
      label: 'Front Bottoming Below',
      description:
        'Below this ride height a front corner is drawn red. 0 only catches a corner that reads below the road; 10 catches a hard kerb strike.',
      min: 0,
      max: 100,
      step: 1,
      units: 'mm',
    },
    bottomingRear: {
      type: 'number',
      control: 'input',
      label: 'Rear Bottoming Below',
      description: 'The same for a rear corner.',
      min: 0,
      max: 100,
      step: 1,
      units: 'mm',
    },
    showRake: {
      type: 'boolean',
      label: 'Show Rake',
      description:
        'How much higher the rear rides than the front, as an angle and in millimetres. Blue when the nose is the higher end.',
    },
    wheelbase: {
      type: 'number',
      control: 'input',
      label: 'Wheelbase',
      description:
        'The distance between the axles, which turns the rake into an angle. The sim does not publish it: enter the figure for your car, or leave the round one and read the millimetres.',
      min: 1000,
      max: 5000,
      step: 10,
      units: 'mm',
    },
    showRoll: {
      type: 'boolean',
      label: 'Show Roll',
      description:
        'How far the car leans at the front and at the rear axle. Positive is the right side higher, which is what a right-hand corner does.',
    },
    trackFront: {
      type: 'number',
      control: 'input',
      label: 'Front Track',
      description:
        'The distance between the two front wheels, which turns the front roll into an angle. The sim does not publish it.',
      min: 1000,
      max: 3000,
      step: 10,
      units: 'mm',
    },
    trackRear: {
      type: 'number',
      control: 'input',
      label: 'Rear Track',
      description: 'The same between the two rear wheels.',
      min: 1000,
      max: 3000,
      step: 10,
      units: 'mm',
    },
    showRollShare: {
      type: 'boolean',
      label: 'Show Roll Share',
      description:
        'The share of the roll the front axle takes, in percent, after the two angles. Reads 50% while the axles lean opposite ways.',
    },
    showCamber: {
      type: 'boolean',
      label: 'Show Camber',
      description:
        'Camber at each wheel, in degrees: negative with the top of the wheel leaning in. Amber at zero or above.',
    },
    showToe: {
      type: 'boolean',
      label: 'Show Toe',
      description: 'Whether the wheels point inwards or outwards, in degrees.',
    },
    toeDisplay: {
      type: 'enum',
      label: 'Toe',
      description:
        'Per axle is the total toe of the two wheels, in or out, which leaves the steering angle out. Per wheel is each of the four, toe-in positive; the fronts then include the steering.',
      options: [
        { value: 'axle', label: 'Per Axle' },
        { value: 'wheel', label: 'Per Wheel' },
      ],
    },
    showSuspension: {
      type: 'boolean',
      label: 'Show Suspension Travel',
      description: 'Damper position at each corner, in millimetres.',
    },
    layout: {
      type: 'enum',
      label: 'Layout',
      description:
        'The blocks one under another, in two rows, or all in one row. A row wants a wider, lower widget: resize it after choosing one. A block never shrinks below its figures; a row too wide for the widget wraps.',
      options: [
        { value: 'column', label: 'Column' },
        { value: 'twoRows', label: 'Two Rows' },
        { value: 'oneRow', label: 'One Row' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
