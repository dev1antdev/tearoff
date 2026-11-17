import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'racecharts',
  name: 'Race Charts',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 300,
    y: 300,
    // Forty laps at a width each can be pointed at, and a legend of one line.
    width: 720,
    height: 320,
  },
  config: {
    background: { opacity: 80 },
    tab: 'pace',
    laps: 40,
    others: 'around',
    carNumbers: '',
    // Off, so it can be read from the garage and the pit wall.
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
    tab: {
      type: 'enum',
      label: 'Opens On',
      description:
        'The chart shown when the widget opens. The buttons over the chart change it for as long as it is on screen; that choice is not saved. Usage is drawn under Le Mans Ultimate only, and the widget opens on Pace where there is none.',
      options: [
        { value: 'pace', label: 'Pace' },
        { value: 'gap', label: 'Gap' },
        { value: 'usage', label: 'Usage' },
      ],
    },
    laps: {
      type: 'enum',
      label: 'Laps Drawn',
      description:
        'How many of your car’s most recent laps the chart covers when it opens. The buttons over the chart change it, and that choice is not saved either.',
      options: [
        { value: 20, label: '20' },
        { value: 40, label: '40' },
        { value: 80, label: '80' },
        { value: 0, label: 'Whole Race' },
      ],
    },
    others: {
      type: 'enum',
      label: 'Other Cars',
      description:
        'The cars drawn beside your own, three at the most. Around Us is the leader of your class, the car a place ahead of you and the car a place behind, fewer where two of those are one car; they are taken from the race forecast, so there are none outside a race or before its start. Chosen draws the cars whose numbers you enter below, in any session. A car keeps its line while it is drawn.',
      options: [
        { value: 'around', label: 'Around Us In Class' },
        { value: 'chosen', label: 'Chosen' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
