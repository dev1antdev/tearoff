import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'systemperformance',
  name: 'System Performance',
  category: 'Session & Weather',
  enabled: false,
  layout: {
    x: 6,
    y: 6,
    // Three rows of one line each; the single-strip layout wants it wider
    // and a third of the height.
    width: 240,
    height: 78,
  },
  config: {
    background: { opacity: 80 },
    system: { enabled: true },
    app: { enabled: true },
    sim: { enabled: true },
    layout: 'rows',
    warn: { cpuPercent: 85, fps: 60 },
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
    'system.enabled': {
      type: 'boolean',
      label: 'System',
      description:
        'CPU load of the whole machine, across all cores, and the memory in use.',
    },
    'app.enabled': {
      type: 'boolean',
      label: 'Tearoff',
      description:
        "Tearoff's own CPU load, as a share of the whole machine, and its memory: all of its windows and processes together.",
    },
    'sim.enabled': {
      type: 'boolean',
      label: 'Sim',
      description:
        "The sim's frame rate and its own CPU and GPU meters. iRacing only: Le Mans Ultimate publishes none of them, so the row is not drawn there.",
    },
    layout: {
      type: 'enum',
      label: 'Layout',
      description:
        'Rows gives each group a line of its own. Strip puts everything on one line, for the edge of the screen.',
      options: [
        { value: 'rows', label: 'Rows' },
        { value: 'inline', label: 'Strip' },
      ],
    },
    'warn.cpuPercent': {
      type: 'number',
      label: 'Load Warning',
      description:
        'A CPU or GPU figure turns amber from this value and red from 95%.',
      min: 50,
      max: 100,
      step: 5,
      units: '%',
    },
    'warn.fps': {
      type: 'number',
      label: 'Frame Rate Warning',
      description:
        'The frame rate turns amber below this value and red below half of it.',
      min: 20,
      max: 240,
      step: 5,
      units: 'fps',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while you are neither driving nor watching a car.',
    },
  },
});
