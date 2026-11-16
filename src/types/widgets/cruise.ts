import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'cruise',
  name: 'Cruise',
  category: 'Track & Navigation',
  enabled: false,
  layout: {
    x: 760,
    y: 150,
    // Three cells over two, each wide enough for "1234.5 km".
    width: 300,
    height: 92,
  },
  config: {
    background: { opacity: 80 },
    layout: 'grid',
    displayOrder: [
      'compass',
      'elevation',
      'odometer',
      'timeOnTrack',
      'lapDistance',
    ],
    compass: { enabled: true, dial: false },
    elevation: { enabled: true },
    odometer: { enabled: true, scope: 'allTime' },
    timeOnTrack: { enabled: true, scope: 'allTime' },
    lapDistance: { enabled: true },
    units: 'auto',
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
    layout: {
      type: 'enum',
      label: 'Layout',
      description: 'Two rows of cells, or one strip.',
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'row', label: 'Row' },
      ],
    },
    'compass.dial': {
      type: 'boolean',
      label: 'Compass Dial',
      description:
        'A compass rose that turns with the car, beside the cells, with a needle for the angle between where the car points and where it is going. The needle turns red beyond 10 degrees.',
    },
    'odometer.scope': {
      type: 'enum',
      label: 'Distance Driven',
      description:
        'Everything driven on this track in this car, or this session only.',
      options: [
        { value: 'allTime', label: 'All Time' },
        { value: 'session', label: 'Session' },
      ],
    },
    'timeOnTrack.scope': {
      type: 'enum',
      label: 'Time On Track',
      description:
        'Every session on this track in this car, or this session only. The clock runs while the car moves.',
      options: [
        { value: 'allTime', label: 'All Time' },
        { value: 'session', label: 'Session' },
      ],
    },
    units: {
      type: 'enum',
      label: 'Units',
      description:
        "Metres and kilometres, or feet and miles. Auto follows the simulator's own display units.",
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'Metric', label: 'Metric' },
        { value: 'Imperial', label: 'Imperial' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'If enabled, the widget is shown only while you drive. The figures are of your own driving, so it shows dashes while you watch another car.',
    },
  },
});
