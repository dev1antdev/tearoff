import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'pitwall',
  name: 'Pit Wall',
  category: 'Standings',
  enabled: false,
  // No lap history is kept for the page. Its panels that show laps, stints
  // and stops read the history of races, which is recorded while the page is
  // switched on (`raceHistoryDemand.ts`); none reads `lap-history.snapshot`.
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
    // Which tab of a layout with tabs is in front. The page changes it; the
    // settings page has no row for it.
    tab: 'overview',
    // The panels of the Custom layout are saved here as `custom` once the
    // user has arranged it, and are left out until then: the layout is
    // then shown as it starts (PIT_WALL_CUSTOM_START).
  },
  properties: {
    layout: {
      type: 'enum',
      label: 'Layout',
      description:
        'Race is the full page for a second monitor. Watching is for the hours a team-mate drives. Compact is a page of tabs for a small or touch screen. Custom is a page you arrange yourself: choose it, then press Edit layout, the pencil beside the layout switch in the header of the window. The header switches between the four too.',
      options: [
        { value: 'race', label: 'Race' },
        { value: 'watching', label: 'Watching' },
        { value: 'compact', label: 'Compact' },
        { value: 'custom', label: 'Custom' },
      ],
    },
  },
});
