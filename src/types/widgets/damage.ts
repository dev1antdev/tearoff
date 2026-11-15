import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'damage',
  name: 'Damage',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 260,
    y: 300,
    // The car on the left, its four figures beside it and one line for the
    // repair underneath.
    width: 220,
    height: 132,
  },
  config: {
    background: { opacity: 80 },
    diagram: { enabled: true, reading: 'aero', showDamage: false },
    impact: { enabled: true },
    flashDetached: true,
    overheating: { enabled: true },
    stats: {
      enabled: true,
      aeroWarn: 50,
      bodyWarn: 50,
      suspensionWarn: 70,
      tyreWarn: 20,
    },
    repair: { enabled: true },
    hideWhenUndamaged: false,
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
    'diagram.enabled': {
      type: 'boolean',
      label: 'Car Diagram',
      description:
        'The car seen from above, nose up: eight body zones that turn amber and red as they are dented, and the four wheels.',
    },
    'diagram.reading': {
      type: 'enum',
      label: 'Figure In The Car',
      description:
        "Aero is the sim's own aero damage figure and shows the body until the sim has answered. Body is worked out from the dents.",
      options: [
        { value: 'aero', label: 'Aero' },
        { value: 'body', label: 'Body' },
        { value: 'none', label: 'None' },
      ],
    },
    'diagram.showDamage': {
      type: 'boolean',
      label: 'Count Damage, Not Integrity',
      description:
        'The figure in the car reads 0% for a sound car and rises with damage, instead of falling from 100%.',
    },
    'impact.enabled': {
      type: 'boolean',
      label: 'Last Impact',
      description:
        'A red wedge towards where the car was hit, for 15 seconds. A touch too light to be contact, such as a kerb, is not marked unless it left damage.',
    },
    flashDetached: {
      type: 'boolean',
      label: 'Pulse Detached Parts',
      description: 'A wheel or bodywork that has come off pulses.',
    },
    'overheating.enabled': {
      type: 'boolean',
      label: 'Overheating Warning',
      description:
        'A thermometer in the middle of the car while the sim shows its overheating warning. Not yet seen in a recorded session, so untested.',
    },
    'stats.enabled': {
      type: 'boolean',
      label: 'Figures',
      description:
        'Aero, body and suspension integrity and the tread left on the most worn tyre, each in per cent.',
    },
    'stats.aeroWarn': {
      type: 'number',
      label: 'Aero Warning',
      description: 'The figure turns red at or below this value.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    'stats.bodyWarn': {
      type: 'number',
      label: 'Body Warning',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    'stats.suspensionWarn': {
      type: 'number',
      label: 'Suspension Warning',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    'stats.tyreWarn': {
      type: 'number',
      label: 'Tyre Warning',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    'repair.enabled': {
      type: 'boolean',
      label: 'Repair',
      description:
        'What the pit menu is set to repair and the time it adds to the next stop. Shown once there is something to repair.',
    },
    hideWhenUndamaged: {
      type: 'boolean',
      label: 'Show Only When Damaged',
      description:
        'Hide the widget while the car is sound, nothing has hit it in the last 15 seconds and no repair is set.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description: 'Hide the widget while you are not driving.',
    },
  },
});
