import { describe, expect, it } from 'vitest';
import type { DashboardLayout } from '@irdashies/types';
import { mergeBrowserPositions, readBrowserPosition } from './browserPositions';

const stored = (): DashboardLayout =>
  ({
    widgets: [
      {
        id: 'standings',
        enabled: true,
        layout: { x: 0, y: 0, width: 400, height: 600 },
        config: { background: { opacity: 80 } },
      },
      {
        id: 'relative',
        enabled: false,
        layout: { x: 10, y: 10, width: 300, height: 200 },
        config: { browserPosition: { x: 5, y: 6, width: 300, height: 200 } },
      },
    ],
    generalSettings: { fontSize: 'sm', enableNetworkAccess: false },
  }) as unknown as DashboardLayout;

const position = { x: 120, y: 40, width: 420, height: 640 };

describe('readBrowserPosition', () => {
  it('keeps the four numbers and drops anything beside them', () => {
    expect(readBrowserPosition({ ...position, extra: 'x' })).toEqual(position);
  });

  it.each([
    null,
    'x',
    [],
    { x: 1, y: 2, width: 3 },
    { ...position, x: '120' },
    { ...position, y: Number.NaN },
    { ...position, width: 0 },
    { ...position, height: -5 },
    { ...position, x: 1e9 },
    { ...position, width: Number.POSITIVE_INFINITY },
  ])('refuses %j', (value) => expect(readBrowserPosition(value)).toBeNull());
});

describe('mergeBrowserPositions', () => {
  it('lays a new position over the stored widget and leaves the rest alone', () => {
    const before = stored();
    const merged = mergeBrowserPositions(before, {
      widgets: [{ id: 'standings', config: { browserPosition: position } }],
    });

    expect(merged?.widgets[0].config).toEqual({
      background: { opacity: 80 },
      browserPosition: position,
    });
    expect(merged?.widgets[1]).toBe(before.widgets[1]);
    expect(merged?.generalSettings).toBe(before.generalSettings);
    // The stored dashboard itself is not touched.
    expect(before.widgets[0].config).toEqual({ background: { opacity: 80 } });
  });

  it('takes nothing but positions from what a page sends', () => {
    const merged = mergeBrowserPositions(stored(), {
      generalSettings: { enableNetworkAccess: true, enableWebServer: false },
      widgets: [
        {
          id: 'standings',
          enabled: false,
          layout: { x: 9, y: 9, width: 9, height: 9 },
          config: {
            background: { opacity: 0 },
            url: 'https://example.com',
            browserPosition: { ...position, script: 'x' },
          },
        },
        {
          id: 'invented',
          enabled: true,
          config: { browserPosition: position },
        },
      ],
    });

    expect(merged).toEqual({
      ...stored(),
      widgets: [
        {
          ...stored().widgets[0],
          config: { background: { opacity: 80 }, browserPosition: position },
        },
        stored().widgets[1],
      ],
    });
  });

  it('says nothing changed when the positions are the stored ones', () => {
    expect(
      mergeBrowserPositions(stored(), {
        widgets: [
          {
            id: 'relative',
            config: {
              browserPosition: { x: 5, y: 6, width: 300, height: 200 },
            },
          },
        ],
      })
    ).toBeNull();
  });

  it.each([
    undefined,
    null,
    'dashboard',
    {},
    { widgets: 'all' },
    { widgets: [] },
    { widgets: [null, 7, { id: 5 }, { id: 'standings' }] },
    { widgets: [{ id: 'standings', config: { browserPosition: 'left' } }] },
    { widgets: Array.from({ length: 2001 }, () => ({ id: 'standings' })) },
  ])('changes nothing for %j', (incoming) => {
    expect(mergeBrowserPositions(stored(), incoming)).toBeNull();
  });
});
