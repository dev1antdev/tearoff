import { describe, expect, it } from 'vitest';
import { WIDGET_MANIFESTS } from '@irdashies/types';
import { isMenuItemActive } from './menuItemActive';

const row = (id: string, groupTypes?: string[]) => ({
  path: `/${id}`,
  ...(groupTypes && { groupTypes }),
});

describe('isMenuItemActive', () => {
  it('marks the row whose page is open', () => {
    expect(isMenuItemActive(row('flag'), '/settings/flag', [])).toBe(true);
    expect(isMenuItemActive(row('wind'), '/settings/flag', [])).toBe(false);
  });

  it.each([
    ['flag', 'flagpanel'],
    ['weather', 'weatherforecast'],
    ['fuel', 'fuelsaver'],
  ])('keeps %s apart from %s, whose id begins with it', (short, long) => {
    expect(isMenuItemActive(row(short), `/settings/${long}`, [])).toBe(false);
    expect(isMenuItemActive(row(long), `/settings/${long}`, [])).toBe(true);
    expect(isMenuItemActive(row(short), `/settings/${short}`, [])).toBe(true);
    expect(isMenuItemActive(row(long), `/settings/${short}`, [])).toBe(false);
  });

  it('marks exactly one row for every widget page there is', () => {
    const rows = WIDGET_MANIFESTS.filter((m) => !m.hideInMenu).map((m) => ({
      id: m.id,
      ...row(m.id, m.groupTypes),
    }));
    for (const manifest of WIDGET_MANIFESTS) {
      // The Telemetry Inspector has no row and no page of its own.
      if (manifest.id === 'telemetryinspector') continue;
      const active = rows
        .filter((item) =>
          isMenuItemActive(item, `/settings/${manifest.id}`, [])
        )
        .map((item) => item.id);
      const grouped = rows.find((item) =>
        item.groupTypes?.includes(manifest.id)
      );
      expect(active, manifest.id).toEqual([grouped?.id ?? manifest.id]);
    }
  });

  it("marks a layout copy's type, by the layout and not by its id", () => {
    const widgets = [
      { id: 'flag' },
      // Named after one widget, a copy of another: the layout decides.
      { id: 'flag-x1', type: 'flagpanel' },
      { id: 'fuel-ab12', type: 'fuel' },
    ];
    expect(isMenuItemActive(row('fuel'), '/settings/fuel-ab12', widgets)).toBe(
      true
    );
    expect(
      isMenuItemActive(row('fuelsaver'), '/settings/fuel-ab12', widgets)
    ).toBe(false);
    expect(
      isMenuItemActive(row('flagpanel'), '/settings/flag-x1', widgets)
    ).toBe(true);
    expect(isMenuItemActive(row('flag'), '/settings/flag-x1', widgets)).toBe(
      false
    );
  });

  it('does not mark a row for a copy the layout no longer has', () => {
    expect(isMenuItemActive(row('fuel'), '/settings/fuel-ab12', [])).toBe(
      false
    );
    expect(
      isMenuItemActive(row('fuel'), '/settings/fuel-ab12', undefined)
    ).toBe(false);
  });

  it('marks the group row on the page of a widget grouped under it', () => {
    const broadcast = row('broadcast', ['broadcast', 'broadcastticker']);
    expect(isMenuItemActive(broadcast, '/settings/broadcastticker', [])).toBe(
      true
    );
    expect(isMenuItemActive(broadcast, '/settings/broadcast', [])).toBe(true);
    // Begins with the group's id and is not in the group.
    expect(isMenuItemActive(broadcast, '/settings/broadcastx', [])).toBe(false);
  });

  it('matches app and tool pages whole, with or without a trailing slash', () => {
    expect(isMenuItemActive(row('general'), '/settings/general', [])).toBe(
      true
    );
    expect(isMenuItemActive(row('profiles'), '/settings/profiles/', [])).toBe(
      true
    );
    expect(isMenuItemActive(row('laps'), '/settings/laptimelog', [])).toBe(
      false
    );
    expect(isMenuItemActive(row('general'), '/settings', [])).toBe(false);
  });
});
