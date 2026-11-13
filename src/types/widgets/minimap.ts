import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'minimap',
  name: 'Minimap',
  category: 'Track & Navigation',
  enabled: false,
  layout: {
    x: 6,
    y: 6,
    // Square: the map is a circle and fills the shorter side.
    width: 300,
    height: 300,
  },
  config: {
    background: { opacity: 60 },
    range: 200,
    orientation: 'fixed',
    label: 'position',
    markerSize: 22,
    // Wider than a real track on purpose: the line has to read at a glance,
    // and the markers sit on it rather than hanging off its edges.
    trackWidth: 24,
    useClassColors: true,
    showStartFinish: true,
    dimCarsInPits: true,
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
      description: 'Opacity of the disc behind the track.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    range: {
      type: 'number',
      label: 'Range',
      description:
        'How far the map reaches from your car to its edge. Smaller shows the cars around you larger; bigger shows more of the track.',
      min: 75,
      max: 800,
      step: 25,
      units: 'm',
    },
    orientation: {
      type: 'enum',
      label: 'Orientation',
      description:
        'Fixed keeps the track the way the full map draws it. Heading up turns the map so your car always points to the top.',
      options: [
        { value: 'fixed', label: 'Fixed' },
        { value: 'heading', label: 'Heading Up' },
      ],
    },
    label: {
      type: 'enum',
      label: 'Marker Label',
      description: 'What is written in each car marker.',
      options: [
        { value: 'position', label: 'Position' },
        { value: 'classPosition', label: 'Class Position' },
        { value: 'carNumber', label: 'Car Number' },
        { value: 'none', label: 'None' },
      ],
    },
    markerSize: {
      type: 'number',
      label: 'Marker Size',
      min: 10,
      max: 48,
      step: 1,
      units: 'px',
    },
    trackWidth: {
      type: 'number',
      label: 'Track Width',
      description:
        'How wide the track is drawn, in metres of real track. A real track is 10 to 15 m wide; the default is wider so the line is easy to read.',
      min: 4,
      max: 40,
      step: 1,
      units: 'm',
    },
    useClassColors: {
      type: 'boolean',
      label: 'Colour By Class',
      description: 'Fills each marker with the colour of the car class.',
    },
    showStartFinish: {
      type: 'boolean',
      label: 'Show Start/Finish Line',
    },
    dimCarsInPits: {
      type: 'boolean',
      label: 'Dim Cars In The Pits',
      description:
        'Cars on pit road are drawn faded. They are placed along the track, as the map has no pit lane of its own.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
