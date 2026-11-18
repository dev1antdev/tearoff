import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'widgetgroup',
  name: 'Widget Group',
  category: 'Car & Controls',
  enabled: false,
  // Up with no sim running, so that a member that stays up then can do so.
  // The others are held back one by one, as they are on the overlay.
  alwaysEnabled: true,
  layout: {
    x: 100,
    y: 100,
    width: 600,
    height: 300,
  },
  config: {
    members: [],
    // Off, so that each widget inside follows its own rule by default.
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
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hides the whole group in the garage and the menus. Each widget inside also keeps its own setting.',
    },
  },
});
