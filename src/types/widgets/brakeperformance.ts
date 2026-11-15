import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'brakeperformance',
  name: 'Brake Performance',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 260,
    y: 510,
    width: 280,
    height: 96,
  },
  config: {
    background: { opacity: 80 },
    reference: 'rolling',
    deltaUnit: 'percent',
    showZoneDetail: true,
    speedUnit: 'auto',
    showLockTime: true,
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
    reference: {
      type: 'enum',
      label: 'Measured Against',
      description:
        'Rolling best is your hardest stop of roughly the last minute, so it follows the tyres and the fuel load. Session best is your hardest stop since the session began or the car last left the garage.',
      options: [
        { value: 'rolling', label: 'Rolling Best' },
        { value: 'session', label: 'Session Best' },
      ],
    },
    deltaUnit: {
      type: 'enum',
      label: 'Difference',
      description:
        'How far the last stop was from the best: as a share of it, or in g.',
      options: [
        { value: 'percent', label: '%' },
        { value: 'g', label: 'g' },
      ],
    },
    showZoneDetail: {
      type: 'boolean',
      label: 'Zone Detail',
      description:
        'The speed the stop began and ended at, how far and how long it ran, its average deceleration and the time the ABS was working.',
    },
    speedUnit: {
      type: 'enum',
      label: 'Speed Unit',
      description: 'Auto follows the units the sim is set to.',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'km/h', label: 'km/h' },
        { value: 'mph', label: 'mph' },
      ],
    },
    showLockTime: {
      type: 'boolean',
      label: 'Wheel Lock Time',
      description:
        'How long a front and a rear wheel were locked under braking on this lap. Le Mans Ultimate only: iRacing publishes no wheel speeds.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
