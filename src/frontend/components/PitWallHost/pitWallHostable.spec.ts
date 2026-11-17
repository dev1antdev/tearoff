import { describe, expect, it } from 'vitest';
import { KNOWN_WIDGET_IDS, PIT_WALL_HOSTABLE_WIDGETS } from '@irdashies/types';
import { getWidget } from '../../WidgetIndex';
import { getWidgetRuntimeDefinition } from '../../widgetRuntime';

// The Custom layout can be given any of these, the widgets of the overlay
// the fixed layouts do not use among them. `src/pitWallChannels.spec.ts`
// follows what the panels of the fixed layouts read from end to end; here
// it is only that each widget on offer is one the page can draw at all.

describe('what a panel of the Custom layout can host', () => {
  it('is something, so that the cases below are about widgets', () => {
    expect(PIT_WALL_HOSTABLE_WIDGETS.length).toBeGreaterThan(10);
  });

  it.each(PIT_WALL_HOSTABLE_WIDGETS)(
    '%s is a widget the app knows and can draw',
    (widget) => {
      expect(KNOWN_WIDGET_IDS).toContain(widget);
      // What a panel is drawn through. A type with no component draws
      // nothing and says nothing.
      expect(getWidget(widget)).toBeDefined();
    }
  );

  it.each(PIT_WALL_HOSTABLE_WIDGETS)(
    '%s says how it is fed in a runtime definition of its own',
    (widget) => {
      // A widget with none is given the default one, and is then read at
      // whatever rates the page's header happens to use.
      expect(getWidgetRuntimeDefinition(widget).id).toBe(widget);
    }
  );
});
