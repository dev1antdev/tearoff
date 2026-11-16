import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'pitwall',
  name: 'Pit Wall',
  category: 'Standings',
  enabled: false,
  // The page reads no lap history itself. It is a page for whole races:
  // while it is switched on, the crossings of a race are kept from the
  // start of it, for whichever of its panels comes to show them.
  usesLapHistory: true,
  // Never drawn on the overlay: this is the size the settings preview shows
  // the page at, which is the window's own default size.
  layout: {
    x: 0,
    y: 0,
    width: 1600,
    height: 900,
  },
  config: {
    layout: 'race',
  },
  properties: {
    layout: {
      type: 'enum',
      label: 'Layout',
      description:
        'Race is the full page for a second monitor. Watching is for the hours a team-mate drives. Compact fits a small or touch screen. The header of the window switches between them too.',
      options: [
        { value: 'race', label: 'Race' },
        { value: 'watching', label: 'Watching' },
        { value: 'compact', label: 'Compact' },
      ],
    },
  },
});
