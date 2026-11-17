import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'pitstop',
  name: 'Pit Stop',
  category: 'Fuel',
  enabled: false,
  layout: {
    x: 620,
    y: 300,
    // The loss large with the stop and the lane beside it, then a line each
    // for the parts, the refuel, the rejoin and the pit lane.
    width: 300,
    height: 170,
  },
  config: {
    background: { opacity: 80 },
    extraTime: 2,
    longStopThreshold: 60,
    showBreakdown: true,
    showRefuel: true,
    showRunLength: true,
    showRejoin: true,
    rejoinScope: 'class',
    showOccupancy: true,
    resultHold: 10,
    showMode: 'always',
    showOnlyWhenOnTrack: true,
    sessionVisibility: {
      race: true,
      loneQualify: false,
      openQualify: false,
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
    extraTime: {
      type: 'number',
      label: 'Extra Time',
      description:
        'Added to every stop that stands, for your reaction and the crew. A drive-through gets none. Our Car and Class Rivals cost a stop without it, so their figure for the same stop is lower by this much.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    longStopThreshold: {
      type: 'number',
      label: 'Long Stop',
      description: 'The standing time turns red at or above this.',
      min: 10,
      max: 300,
      step: 5,
      units: 's',
    },
    showBreakdown: {
      type: 'boolean',
      label: 'Breakdown',
      description:
        'A chip for each part of the stop that takes time: fuel, energy, tyres, repairs, a driver change, brakes and a penalty. iRacing names the repairs only.',
    },
    showRefuel: {
      type: 'boolean',
      label: 'Refuel',
      description:
        'What the stop adds, and what the race still needs when the level set falls short of it.',
    },
    showRunLength: {
      type: 'boolean',
      label: 'Run Length',
      description: 'Laps and minutes the level set lasts.',
    },
    showRejoin: {
      type: 'boolean',
      label: 'Rejoin',
      description:
        'Your position after the stop, and the cars that will be ahead and behind. Races only. It assumes no rival stops in the meantime.',
    },
    rejoinScope: {
      type: 'enum',
      label: 'Rejoin Position',
      description:
        'In class is the reliable one. Under Le Mans Ultimate the gaps between classes are approximate, so a position in the whole field is marked as such.',
      options: [
        { value: 'class', label: 'In Class' },
        { value: 'overall', label: 'Overall' },
      ],
    },
    showOccupancy: {
      type: 'boolean',
      label: 'Pit Lane',
      description:
        'Cars standing in the pit lane over cars in it, and the stops asked for (Le Mans Ultimate).',
    },
    resultHold: {
      type: 'number',
      label: 'Hold The Result',
      description:
        'How long the finished stop stays on screen after the pit exit.',
      min: 0,
      max: 60,
      step: 1,
      units: 's',
    },
    showMode: {
      type: 'enum',
      label: 'Show',
      description:
        'When Pitting shows the widget only with a stop requested (Le Mans Ultimate), in the pit lane, and while the finished stop is held.',
      options: [
        { value: 'always', label: 'Always' },
        { value: 'whenPitting', label: 'When Pitting' },
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
