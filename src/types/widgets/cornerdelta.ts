import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'cornerdelta',
  name: 'Corner Delta',
  category: 'Lap Timing',
  enabled: false,
  layout: {
    x: 6,
    y: 500,
    width: 260,
    height: 190,
  },
  config: {
    background: { opacity: 80 },
    reference: 'sessionBest',
    cornerLabel: 'name',
    decimals: 2,
    showEntrySpeed: true,
    showExitSpeed: true,
    speedUnit: 'auto',
    // Through esses the next corner ends a second after the last, so the
    // one before stays readable underneath.
    historyCount: 2,
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
      label: 'Compare With',
      description:
        'All-time best is your reference lap on this track in this car, kept between sessions. Session best is your best clean lap since the session began. Last lap is the last time you drove the corner. Until the chosen one exists the deltas are dashes.',
      options: [
        { value: 'allTime', label: 'All-Time Best' },
        { value: 'sessionBest', label: 'Session Best' },
        { value: 'lastLap', label: 'Last Lap' },
      ],
    },
    cornerLabel: {
      type: 'enum',
      label: 'Corner Label',
      description:
        'Name shows the corner as the track data calls it. Number shows its turn number.',
      options: [
        { value: 'name', label: 'Name' },
        { value: 'number', label: 'Number' },
      ],
    },
    decimals: {
      type: 'enum',
      label: 'Time Precision',
      options: [
        { value: 2, label: '0.00' },
        { value: 3, label: '0.000' },
      ],
    },
    showEntrySpeed: {
      type: 'boolean',
      label: 'Entry Speed',
      description:
        'Your speed where the corner starts, and how much faster or slower that is than on the lap you compare with.',
    },
    showExitSpeed: {
      type: 'boolean',
      label: 'Exit Speed',
      description:
        'Your speed where the corner ends, and how much faster or slower that is than on the lap you compare with.',
    },
    speedUnit: {
      type: 'enum',
      label: 'Speed Unit',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'mph', label: 'MPH' },
        { value: 'km/h', label: 'KM/H' },
      ],
    },
    historyCount: {
      type: 'number',
      label: 'Earlier Corners',
      description:
        'How many corners before the last one stay listed underneath. Through esses and chicanes the next corner often ends within a second, so a short list keeps a sequence readable. 0 hides the list.',
      min: 0,
      max: 4,
      step: 1,
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description: 'Hide the widget while you are not driving.',
    },
  },
});
