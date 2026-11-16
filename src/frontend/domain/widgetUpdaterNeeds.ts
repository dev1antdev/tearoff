import type { DashboardWidget } from '@irdashies/types';

// Timing reads the channel itself; it is here for the thresholds the updater
// keeps in step with the Sector Delta settings, which colour its tiles too.
const SECTOR_WIDGETS = new Set(['sectordelta', 'map', 'flatmap', 'timing']);
const TABLE_WIDGETS = new Set(['standings', 'relative']);

/** Supporting renderer state belongs to the widget in this window, not the profile. */
export function widgetUpdaterNeeds(widget: DashboardWidget) {
  const type = widget.type ?? widget.id;
  const enabled = (property: string) => {
    const value = widget.config?.[property];
    return (
      typeof value === 'object' &&
      value !== null &&
      'enabled' in value &&
      value.enabled === true
    );
  };
  return {
    sectorTiming: SECTOR_WIDGETS.has(type),
    pushToPass: TABLE_WIDGETS.has(type) && enabled('pushToPass'),
    // The rivals box reads its stints from the per-car pit tracker's
    // channel, not from this store.
    pitLap: TABLE_WIDGETS.has(type) && enabled('pitStatus'),
  };
}
