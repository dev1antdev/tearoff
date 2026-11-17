import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type {
  ActiveSimulator,
  DashboardLayout,
  DashboardWidget,
  PitWallCustomPanel,
  ResolvedPitWallPanel,
} from '@irdashies/types';

// The layout the user arranges: the edit mode of the page, driven the way a
// hand drives it, with pointer events and keys, in the app's own window and
// in a browser. Whether a panel may have the cells asked for is proved in
// `src/types/pitWallCustom.spec.ts`, and the arithmetic of a drag in
// `pitWallCustomEdit.spec.ts`; here it is that the page wires the two.

const mocks = vi.hoisted(() => ({
  openWidgetSettings: vi.fn(),
  onDashboardUpdated: vi.fn(),
  /** A browser's bridge has no call that opens the settings window. */
  inBrowser: false,
  running: true,
  simulator: null as ActiveSimulator | null,
  dashboard: undefined as DashboardLayout | undefined,
  /** Goes up when the dashboard under a drawn page has changed. */
  version: 0,
  listeners: new Set<() => void>(),
}));

vi.mock('@irdashies/context', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useDashboard: () => {
      // Drawn again when the dashboard changes, as it is when the provider
      // hands over a saved one.
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener);
          return () => mocks.listeners.delete(listener);
        },
        () => mocks.version
      );
      return {
        bridge: mocks.inBrowser
          ? {}
          : { openWidgetSettings: mocks.openWidgetSettings },
        currentDashboard: mocks.dashboard,
        onDashboardUpdated: mocks.onDashboardUpdated,
      };
    },
    useActiveSimulator: () => mocks.simulator,
    useSimWidgetSupport: () => ({
      message: '',
      disabledWidgets: { iracing: ['weatherforecast', 'wear'], lmu: [] },
    }),
    useRunningState: () => ({ running: mocks.running }),
    useSessionDrivers: () => [
      { CarIdx: 0, CarNumber: '77', UserName: 'Alex Mercer' },
    ],
    useDriverCarIdx: () => 0,
    useDrivingState: () => ({ isDriving: true }),
    useSessionBarSelector: () => undefined,
    useChannelSelector: () => undefined,
    useSessionTimeTiming: () => ({
      sessionType: 'Race',
      time: 0,
      timeRemaining: 0,
      timeTotal: 0,
      state: 4,
      greenFlagTimestamp: 0,
      isFixedLapRace: false,
      totalRaceTime: 0,
      adjustedRaceTime: 0,
    }),
    trackStateSelectors: { notInSession: 'notInSession' },
    useTrackStateSelector: () => undefined,
    SessionTimingStoreUpdater: () => null,
  };
});

vi.mock('@irdashies/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PIT_WALL_CUSTOM_START } from '@irdashies/types';
import { PitWall } from './PitWall';
import {
  PIT_WALL_DEVICE_LAYOUT_KEY,
  PIT_WALL_DEVICE_TAB_KEY,
  PitWallDeviceLayout,
} from './PitWallDeviceLayout';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

const panelOn = (
  type: string,
  x: number,
  y: number,
  w: number,
  h: number
): PitWallCustomPanel => ({ widget: type, x, y, w, h }) as PitWallCustomPanel;

/**
 * A page with room on it: the tower on the left, Our Car and the Race Log
 * beside it, and the right third and the foot of the page free.
 *
 *   tower   0..9  x 0..7     ourcar 10..15 x 0..5
 *                            racelog 10..15 x 6..9
 */
const TOWER = panelOn('timingtower', 0, 0, 10, 8);
const OUR_CAR = panelOn('ourcar', 10, 0, 6, 6);
const RACE_LOG = panelOn('racelog', 10, 6, 6, 4);
const ARRANGED = [TOWER, OUR_CAR, RACE_LOG];

const PROFILE = [
  'timingtower',
  'ourcar',
  'racelog',
  'map',
  'classrivals',
  'crew',
  'racecharts',
  'weatherforecast',
  'standings',
  'fuel',
];

const dashboardWith = (
  config: Record<string, unknown>,
  types: readonly string[] = PROFILE
): DashboardLayout => ({
  widgets: [
    widget('pitwall', { enabled: true, config }),
    ...types.map((type) => widget(type)),
  ],
});

/** Hands the drawn page another dashboard, as a save from elsewhere does. */
const changeDashboard = (dashboard: DashboardLayout) =>
  act(() => {
    mocks.dashboard = dashboard;
    mocks.version += 1;
    mocks.listeners.forEach((listener) => listener());
  });

// The page is drawn in a box whose cells, with the gap beside each, are 62
// pixels across and 42 down: 24 by 16 of them, less one gap, plus nothing,
// since the margin is a gap each side and the cells have one gap fewer.
const PITCH = { x: 62, y: 42 };
const PAGE = { width: 24 * PITCH.x + 12, height: 16 * PITCH.y + 12 };

const pitWallConfig = () =>
  mocks.dashboard?.widgets.find((saved) => saved.id === 'pitwall')?.config;

const region = (name: string) => screen.getByRole('region', { name });
const cellsOf = (name: string) => region(name).getAttribute('data-cells');
const moveHandle = (name: string) =>
  screen.getByRole('button', { name: `Move ${name}` });
const sizeHandle = (name: string) =>
  screen.getByRole('button', { name: `Size ${name}` });
const target = () => document.querySelector('[data-item="target"]');
const message = () =>
  document.querySelector('[data-item="edit-message"]')?.textContent ?? '';
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const startEditing = () => press('Edit layout');

const START = { x: 300, y: 200 };

/** Where a pointer is after being taken so many cells from where it went down. */
const after = (cellsAcross: number, cellsDown: number) => ({
  clientX: START.x + cellsAcross * PITCH.x,
  clientY: START.y + cellsDown * PITCH.y,
});

const pointerDown = (handle: Element, init: Record<string, unknown> = {}) =>
  fireEvent.pointerDown(handle, {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: START.x,
    clientY: START.y,
    ...init,
  });

// Once down, the pointer is anywhere on the page: it is followed on the
// window, so the events are sent there and not to the handle.
const pointerMove = (cellsAcross: number, cellsDown: number, init = {}) =>
  fireEvent.pointerMove(document.body, {
    pointerId: 1,
    buttons: 1,
    ...after(cellsAcross, cellsDown),
    ...init,
  });

const pointerUp = (cellsAcross: number, cellsDown: number, init = {}) =>
  fireEvent.pointerUp(document.body, {
    pointerId: 1,
    ...after(cellsAcross, cellsDown),
    ...init,
  });

/** Down on a handle, taken so many cells away, and let go of there. */
const drag = (handle: Element, cellsAcross: number, cellsDown: number) => {
  pointerDown(handle);
  pointerMove(cellsAcross, cellsDown);
  pointerUp(cellsAcross, cellsDown);
};

const renderInWindow = (props: Parameters<typeof PitWall>[0] = {}) =>
  render(<PitWall {...props} />);

const renderInBrowser = () => {
  mocks.inBrowser = true;
  return render(
    <PitWallDeviceLayout>
      <PitWall />
    </PitWallDeviceLayout>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inBrowser = false;
  mocks.running = true;
  mocks.simulator = null;
  mocks.dashboard = dashboardWith({ layout: 'custom', custom: ARRANGED });
  // A save is taken at once, as the app's provider takes one.
  mocks.onDashboardUpdated.mockImplementation((next: DashboardLayout) => {
    mocks.dashboard = next;
    mocks.version += 1;
    mocks.listeners.forEach((listener) => listener());
  });
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PAGE.width,
    bottom: PAGE.height,
    width: PAGE.width,
    height: PAGE.height,
    toJSON: () => ({}),
  } as DOMRect);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('the Custom layout in the app’s window', () => {
  it('is the fourth layout of the header’s switch', () => {
    renderInWindow();
    const layouts = within(screen.getByRole('navigation', { name: 'Layout' }));
    expect(
      layouts.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Race', 'Watching', 'Compact', 'Custom']);
    expect(layouts.getByRole('button', { name: 'Custom' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
  });

  it('draws the saved panels where the user put them, and no tab bar', () => {
    renderInWindow();
    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);
    expect(region('Our Car').style.gridArea).toBe('ourcar');
    // Every cell a track. (jsdom writes the nought with its unit.)
    expect(screen.getByRole('main').style.gridTemplateColumns).toMatch(
      /^repeat\(24, minmax\(0(px)?, 1fr\)\)$/
    );
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
  });

  it('starts as the copy of Race in a profile that has arranged nothing', () => {
    mocks.dashboard = dashboardWith({ layout: 'custom' });
    renderInWindow();
    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual([
      'Timing Tower',
      'Race Charts',
      'Our Car',
      'Track Map',
      'Class Rivals',
      'Crew and Stints',
      'Race Log',
      'Weather Forecast',
    ]);
  });

  it('has an Edit layout button, which the fixed layouts have not', () => {
    renderInWindow();
    expect(screen.getByRole('button', { name: 'Edit layout' })).toBeVisible();

    for (const fixed of ['race', 'watching', 'compact']) {
      changeDashboard(dashboardWith({ layout: fixed, custom: ARRANGED }));
      expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
    }
  });

  it('saves a choice of Custom into the profile like any layout', () => {
    mocks.dashboard = dashboardWith({ layout: 'race' });
    renderInWindow();

    press('Custom');

    expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
    expect(pitWallConfig()).toEqual({ layout: 'custom' });
    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
  });

  it('says so, and how to mend it, on a page with no panel', () => {
    mocks.dashboard = dashboardWith({ layout: 'custom', custom: [] });
    renderInWindow();
    expect(screen.queryByRole('main')).toBeNull();
    expect(
      screen.getByText(
        /The Custom layout has no panel to show\. Choose Edit layout/
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit layout' })).toBeVisible();
  });
});

describe('arranging the Custom layout', () => {
  it('shows Done, Cancel, Add panel and Reset, and no choice of layout meanwhile', () => {
    renderInWindow();
    expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();

    startEditing();

    const bar = within(screen.getByRole('group', { name: 'Edit layout' }));
    for (const name of ['Add panel', 'Reset', 'Cancel', 'Done']) {
      expect(bar.getByRole('button', { name })).toBeVisible();
    }
    expect(screen.getByRole('main')).toHaveAttribute('data-editing', 'true');
    // The edit is ended before the page is turned to another layout, and
    // is not begun twice.
    expect(screen.queryByRole('navigation', { name: 'Layout' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
    // The header keeps the rest of its controls.
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Pit Wall settings' })
    ).toBeVisible();
  });

  it('makes each panel a thing to move: handles, a way off the page, its name and its size', () => {
    renderInWindow();
    startEditing();

    for (const name of ['Timing Tower', 'Our Car', 'Race Log']) {
      const panel = within(region(name));
      expect(panel.getByRole('button', { name: `Move ${name}` })).toBeVisible();
      expect(panel.getByRole('button', { name: `Size ${name}` })).toBeVisible();
      expect(
        panel.getByRole('button', { name: `Remove ${name}` })
      ).toBeVisible();
      // No gear while arranging: the title bar is the handle.
      expect(panel.queryByRole('button', { name: /settings/i })).toBeNull();
    }
    expect(cellsOf('Timing Tower')).toBe('0,0,10,8');
    expect(cellsOf('Our Car')).toBe('10,0,6,6');
    const placeholder = region('Our Car').querySelector(
      '[data-item="placeholder"]'
    );
    expect(placeholder).toHaveTextContent('Our Car');
    expect(placeholder).toHaveTextContent('6 × 6 cells');
    // Placed by its cells, not by a named area, on a grid whose every
    // cell is a track: from row 1 and column 11, six rows and six columns.
    expect(region('Our Car').style.gridArea).toBe('1 / 11 / span 6 / span 6');
    expect(screen.getByRole('main').style.gridTemplateAreas).toBe('');
    expect(screen.getByRole('main').style.gridTemplateRows).toMatch(
      /^repeat\(16, minmax\(0(px)?, 1fr\)\)$/
    );
  });

  it('keeps the finger that drags from scrolling the page, on both handles', () => {
    renderInWindow();
    startEditing();
    expect(moveHandle('Our Car')).toHaveClass('touch-none');
    expect(sizeHandle('Our Car')).toHaveClass('touch-none');
    // The corner is sized from the keyboard through the title bar.
    expect(sizeHandle('Our Car')).toHaveAttribute('tabindex', '-1');
    expect(moveHandle('Our Car')).not.toHaveAttribute('tabindex');
  });

  it('draws the cells of the page behind the panels', () => {
    renderInWindow();
    expect(document.querySelector('[data-item="cells"]')).toBeNull();
    startEditing();
    expect(
      document.querySelector('[data-item="cells"]')?.children
    ).toHaveLength(24 * 16);
  });

  it('can be begun with no sim running: the page is placed before a race too', () => {
    mocks.running = false;
    renderInWindow();
    expect(screen.getByText(/No simulator is running\./)).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();

    startEditing();

    expect(screen.queryByText(/No simulator is running\./)).toBeNull();
    expect(cellsOf('Timing Tower')).toBe('0,0,10,8');
    drag(moveHandle('Race Log'), 6, 0);
    expect(cellsOf('Race Log')).toBe('16,6,6,4');

    press('Cancel');
    expect(screen.getByText(/No simulator is running\./)).toBeInTheDocument();
  });

  describe('moving a panel with a pointer', () => {
    it('shows the cells it would take while it is held, and puts it there when let go of', () => {
      renderInWindow();
      startEditing();
      expect(target()).toBeNull();

      pointerDown(moveHandle('Race Log'));
      // Held, with its own cells marked before it has gone anywhere.
      expect(region('Race Log')).toHaveAttribute('data-held', 'true');
      expect(target()).toHaveAttribute('data-cells', '10,6,6,4');

      pointerMove(6, 0);
      expect(target()).toHaveAttribute('data-cells', '16,6,6,4');
      expect(target()).toHaveAttribute('data-verdict', 'fits');
      expect(target()).toHaveClass('border-emerald-400');
      // Not moved yet: only the mark has.
      expect(cellsOf('Race Log')).toBe('10,6,6,4');

      pointerUp(6, 0);
      expect(cellsOf('Race Log')).toBe('16,6,6,4');
      expect(target()).toBeNull();
      expect(region('Race Log')).not.toHaveAttribute('data-held');
      expect(message()).toBe('');
    });

    it('snaps to whole cells: the nearest to where the pointer is', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));

      pointerMove(0.4, 0.4);
      expect(target()).toHaveAttribute('data-cells', '10,6,6,4');
      pointerMove(0.6, 0.4);
      expect(target()).toHaveAttribute('data-cells', '11,6,6,4');
      pointerMove(5.6, 1.6);
      expect(target()).toHaveAttribute('data-cells', '16,8,6,4');
      pointerMove(5.4, 1.4);
      expect(target()).toHaveAttribute('data-cells', '15,7,6,4');

      // Let go of between cells, it lands on the nearest.
      pointerUp(7.6, 5.7);
      expect(cellsOf('Race Log')).toBe('18,12,6,4');
    });

    it('marks cells another panel has in red, and puts the panel back when dropped there', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Our Car'));

      // Three cells left: onto the tower.
      pointerMove(-3, 0);
      expect(target()).toHaveAttribute('data-cells', '7,0,6,6');
      expect(target()).toHaveAttribute('data-verdict', 'overlap');
      expect(target()).toHaveClass('border-red-400');
      expect(target()).toHaveTextContent('No room here');

      pointerUp(-3, 0);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(target()).toBeNull();
      expect(message()).toBe(
        'Our Car was put back: it has another panel in the way.'
      );
    });

    it('marks cells off the page in red, and puts the panel back when dropped there', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Our Car'));

      // Ten cells right: four of its six columns are past the edge.
      pointerMove(10, 0);
      expect(target()).toHaveAttribute('data-cells', '20,0,6,6');
      expect(target()).toHaveAttribute('data-verdict', 'outside');
      expect(target()).toHaveTextContent('Off the page');
      // Only the part on the page can be drawn.
      expect((target() as HTMLElement).style.gridColumn).toBe('21 / span 4');

      pointerUp(10, 0);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe('Our Car was put back: it would leave the page.');
    });

    it('has no mark for a panel dragged wholly off the page, and puts it back', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Our Car'));

      pointerMove(40, 30);
      expect(target()).toBeNull();
      expect(region('Our Car')).toHaveAttribute('data-held', 'true');

      pointerUp(40, 30);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
    });

    it('goes from red to green and back as the panel is carried over the page', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));

      pointerMove(0, -2);
      expect(target()).toHaveAttribute('data-verdict', 'overlap');
      pointerMove(6, -2);
      expect(target()).toHaveAttribute('data-verdict', 'fits');
      pointerMove(6, 8);
      expect(target()).toHaveAttribute('data-verdict', 'outside');
      pointerMove(6, 6);
      expect(target()).toHaveAttribute('data-verdict', 'fits');

      pointerUp(6, 6);
      expect(cellsOf('Race Log')).toBe('16,12,6,4');
    });

    it('lets a panel be put back down where it was', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Our Car'), 0, 0);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe('');
    });

    it('moves nothing else: no panel is pushed aside', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, -6);
      expect(cellsOf('Race Log')).toBe('16,0,6,4');
      expect(cellsOf('Timing Tower')).toBe('0,0,10,8');
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
    });

    it('takes a second drag from where the first one left the panel', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);
      drag(moveHandle('Race Log'), 2, 6);
      expect(cellsOf('Race Log')).toBe('18,12,6,4');
      // The cells it left are free for another.
      drag(moveHandle('Our Car'), 0, 4);
      expect(cellsOf('Our Car')).toBe('10,4,6,6');
    });
  });

  describe('sizing a panel with a pointer', () => {
    it('sizes it by its lower right corner, to whole cells', () => {
      renderInWindow();
      startEditing();
      pointerDown(sizeHandle('Race Log'));

      pointerMove(3.4, 2.6);
      expect(target()).toHaveAttribute('data-cells', '10,6,9,7');
      expect(target()).toHaveAttribute('data-verdict', 'fits');
      expect(target()).toHaveTextContent('9 × 7');

      pointerUp(3.4, 2.6);
      expect(cellsOf('Race Log')).toBe('10,6,9,7');
      expect(
        region('Race Log').querySelector('[data-item="placeholder"]')
      ).toHaveTextContent('9 × 7 cells');
    });

    it('refuses a size that takes it onto another panel', () => {
      renderInWindow();
      startEditing();
      // Our Car, grown a row: onto the Race Log under it.
      pointerDown(sizeHandle('Our Car'));
      pointerMove(0, 1);
      expect(target()).toHaveAttribute('data-verdict', 'overlap');
      pointerUp(0, 1);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe(
        'Our Car was put back: it has another panel in the way.'
      );
    });

    it('refuses a size past the edge of the page', () => {
      renderInWindow();
      startEditing();
      pointerDown(sizeHandle('Race Log'));
      pointerMove(9, 0);
      expect(target()).toHaveAttribute('data-verdict', 'outside');
      pointerUp(9, 0);
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
    });

    it('refuses a size under the least the widget may have, and says what that is', () => {
      renderInWindow();
      startEditing();
      // Our Car may be four cells by four and no less.
      pointerDown(sizeHandle('Our Car'));
      pointerMove(-2, -2);
      expect(target()).toHaveAttribute('data-cells', '10,0,4,4');
      expect(target()).toHaveAttribute('data-verdict', 'fits');
      pointerMove(-3, -2);
      expect(target()).toHaveAttribute('data-cells', '10,0,3,4');
      expect(target()).toHaveAttribute('data-verdict', 'small');
      expect(target()).toHaveTextContent('Too small');

      pointerUp(-3, -2);
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe(
        'Our Car was put back: it cannot be smaller than 4 by 4 cells.'
      );

      drag(sizeHandle('Our Car'), -2, -2);
      expect(cellsOf('Our Car')).toBe('10,0,4,4');
    });

    it('never asks for less than a cell, however far the corner is dragged back', () => {
      renderInWindow();
      startEditing();
      pointerDown(sizeHandle('Race Log'));
      pointerMove(-30, -30);
      expect(target()).toHaveAttribute('data-cells', '10,6,1,1');
      expect(target()).toHaveAttribute('data-verdict', 'small');
      pointerUp(-30, -30);
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
    });
  });

  describe('a drag that is not carried through', () => {
    it('is dropped on Escape: the panel is where it was, and the release that follows does nothing', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      pointerMove(6, 0);
      expect(target()).toHaveAttribute('data-verdict', 'fits');

      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(target()).toBeNull();
      expect(region('Race Log')).not.toHaveAttribute('data-held');
      expect(cellsOf('Race Log')).toBe('10,6,6,4');

      pointerMove(6, 0);
      pointerUp(6, 0);
      expect(target()).toBeNull();
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
      // Still arranging: Escape ended the drag, not the edit.
      expect(screen.getByRole('group', { name: 'Edit layout' })).toBeVisible();
    });

    it('keeps Escape to itself while a panel is held', () => {
      renderInWindow();
      startEditing();
      pointerDown(sizeHandle('Race Log'));

      const escape = createEvent.keyDown(document.body, { key: 'Escape' });
      fireEvent(document.body, escape);

      expect(escape.defaultPrevented).toBe(true);
    });

    it('is dropped when the browser takes the pointer away', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      pointerMove(6, 0);

      // As a touch is, when the system claims it for a gesture of its own.
      fireEvent.pointerCancel(document.body, { pointerId: 1 });

      expect(target()).toBeNull();
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
    });

    it('is dropped when the button turns out to have been let go of where the page could not see', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      pointerMove(6, 0);

      // The pointer comes back over the window with no button down.
      pointerMove(6, 0, { buttons: 0 });

      expect(target()).toBeNull();
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
    });

    it('is not begun by another button of the mouse, or by a second finger', () => {
      renderInWindow();
      startEditing();

      pointerDown(moveHandle('Race Log'), { button: 2 });
      expect(target()).toBeNull();
      pointerDown(moveHandle('Race Log'), { pointerId: 5, isPrimary: false });
      expect(target()).toBeNull();
    });

    it('follows the pointer that began it and no other', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));

      // A second finger moves and lifts elsewhere on the page.
      pointerMove(6, 0, { pointerId: 7 });
      expect(target()).toHaveAttribute('data-cells', '10,6,6,4');
      pointerUp(6, 0, { pointerId: 7 });
      expect(region('Race Log')).toHaveAttribute('data-held', 'true');
      // And cannot begin a drag of its own while the first is held.
      pointerDown(moveHandle('Our Car'), { pointerId: 7 });
      expect(region('Our Car')).not.toHaveAttribute('data-held');

      pointerMove(6, 0);
      pointerUp(6, 0);
      expect(cellsOf('Race Log')).toBe('16,6,6,4');
    });

    it('goes on without capture where the browser will not give it', () => {
      Element.prototype.setPointerCapture = vi.fn(() => {
        throw new DOMException('No such pointer', 'NotFoundError');
      });
      Element.prototype.releasePointerCapture = vi.fn(() => {
        throw new DOMException('No such pointer', 'NotFoundError');
      });
      renderInWindow();
      startEditing();

      drag(moveHandle('Race Log'), 6, 0);

      expect(cellsOf('Race Log')).toBe('16,6,6,4');
    });

    it('asks the browser to keep the pointer for the handle, and gives it back', () => {
      renderInWindow();
      startEditing();
      const handle = moveHandle('Race Log');

      pointerDown(handle);
      expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
      pointerUp(0, 0);
      expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('is not begun on a page that has not been laid out', () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 0,
        height: 0,
        left: 0,
        top: 0,
      } as DOMRect);
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      expect(target()).toBeNull();
    });

    it('stops listening when the page goes with a panel still held', () => {
      const removed = vi.spyOn(AbortController.prototype, 'abort');
      const { unmount } = renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      expect(removed).not.toHaveBeenCalled();

      unmount();

      expect(removed).toHaveBeenCalledTimes(1);
    });
  });

  describe('from the keyboard', () => {
    const key = (name: string, keyName: string, init = {}) => {
      const event = createEvent.keyDown(moveHandle(name), {
        key: keyName,
        ...init,
      });
      fireEvent(moveHandle(name), event);
      return event;
    };

    it('moves the panel in focus a cell for an arrow key', () => {
      renderInWindow();
      startEditing();

      key('Race Log', 'ArrowRight');
      expect(cellsOf('Race Log')).toBe('11,6,6,4');
      key('Race Log', 'ArrowDown');
      key('Race Log', 'ArrowDown');
      expect(cellsOf('Race Log')).toBe('11,8,6,4');
      key('Race Log', 'ArrowLeft');
      key('Race Log', 'ArrowUp');
      expect(cellsOf('Race Log')).toBe('10,7,6,4');
      expect(message()).toBe('');
    });

    it('sizes it by a cell with Shift held', () => {
      renderInWindow();
      startEditing();

      key('Race Log', 'ArrowRight', { shiftKey: true });
      key('Race Log', 'ArrowDown', { shiftKey: true });
      expect(cellsOf('Race Log')).toBe('10,6,7,5');
      key('Race Log', 'ArrowLeft', { shiftKey: true });
      key('Race Log', 'ArrowUp', { shiftKey: true });
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
    });

    it('holds a key to the rule a drag is held to, and says why it did nothing', () => {
      renderInWindow();
      startEditing();

      // Onto the tower.
      key('Our Car', 'ArrowLeft');
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe('Our Car has another panel in the way.');
      // Off the top of the page.
      key('Our Car', 'ArrowUp');
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe('Our Car would leave the page.');
      // Grown onto the log under it.
      key('Our Car', 'ArrowDown', { shiftKey: true });
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(message()).toBe('Our Car has another panel in the way.');
      // Shrunk to its least, and no further.
      key('Our Car', 'ArrowLeft', { shiftKey: true });
      key('Our Car', 'ArrowLeft', { shiftKey: true });
      expect(cellsOf('Our Car')).toBe('10,0,4,6');
      expect(message()).toBe('');
      key('Our Car', 'ArrowLeft', { shiftKey: true });
      expect(cellsOf('Our Car')).toBe('10,0,4,6');
      expect(message()).toBe('Our Car cannot be smaller than 4 by 4 cells.');
    });

    it('says the refusal to a reader too, from a region that was there before', () => {
      renderInWindow();
      startEditing();
      const status = within(
        screen.getByRole('group', { name: 'Edit layout' })
      ).getByRole('status');
      expect(status).toBeEmptyDOMElement();

      key('Our Car', 'ArrowLeft');

      expect(status).toHaveTextContent('Our Car has another panel in the way.');
    });

    it('takes the arrows for the panel and leaves every other key alone', () => {
      renderInWindow();
      startEditing();

      expect(key('Race Log', 'ArrowRight').defaultPrevented).toBe(true);
      // Refused, and still not the page's to scroll by.
      expect(key('Our Car', 'ArrowLeft').defaultPrevented).toBe(true);
      for (const other of ['Tab', 'Enter', ' ', 'a', 'Home']) {
        expect(key('Race Log', other).defaultPrevented).toBe(false);
      }
      expect(cellsOf('Race Log')).toBe('11,6,6,4');
      // With Ctrl, Alt or the Windows key an arrow is somebody else's.
      for (const held of ['ctrlKey', 'altKey', 'metaKey']) {
        expect(
          key('Race Log', 'ArrowRight', { [held]: true }).defaultPrevented
        ).toBe(false);
      }
      expect(cellsOf('Race Log')).toBe('11,6,6,4');
    });

    it('points each panel at the words that say how it is arranged by keyboard', () => {
      renderInWindow();
      startEditing();
      const hint = document.getElementById(
        moveHandle('Our Car').getAttribute('aria-describedby') ?? ''
      );
      expect(hint).toHaveTextContent(/arrow keys move it/);
      expect(hint).toHaveTextContent(/Shift with an arrow key sizes it/);
    });

    it('does nothing to a panel the pointer holds', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));

      key('Race Log', 'ArrowRight');
      expect(cellsOf('Race Log')).toBe('10,6,6,4');

      pointerUp(6, 0);
      expect(cellsOf('Race Log')).toBe('16,6,6,4');
    });
  });

  describe('taking a panel off the page and putting one on', () => {
    const addList = () => document.querySelector('[data-item="add-list"]');
    const offered = () =>
      within(addList() as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));

    it('takes a panel off with the button on its title bar', () => {
      renderInWindow();
      startEditing();

      press('Remove Our Car');

      expect(
        screen.getAllByRole('region').map((panel) => panel.ariaLabel)
      ).toEqual(['Timing Tower', 'Race Log']);
    });

    it('leaves the keyboard on the page when the panel in focus is taken off', () => {
      renderInWindow();
      startEditing();
      const remove = screen.getByRole('button', { name: 'Remove Our Car' });
      remove.focus();

      fireEvent.click(remove);

      // Not on the body, from where Tab would start at the header again.
      expect(screen.getByRole('main')).toHaveFocus();
      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    });

    it('lists what the page can host and does not: its own panels first, then the overlay’s widgets', () => {
      renderInWindow();
      startEditing();
      expect(addList()).toBeNull();

      press('Add panel');

      const groups = within(addList() as HTMLElement).getAllByRole('group');
      expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
        'Pit Wall panels',
        'Overlay widgets',
      ]);
      // The three on the page are not offered.
      expect(offered()).toEqual([
        'Add Class Rivals',
        'Add Stint Timeline',
        'Add Crew and Stints',
        'Add Car Laps',
        'Add Race Charts',
        'Add Track Map',
        'Add Weather Forecast',
        'Add Standings',
        'Add Fuel Calculator',
        'Add Pit Stop',
        'Add Finish Projection',
        'Add Stint History',
        'Add Tyre & Brake Wear',
        'Add Traffic',
        'Add Flag Panel',
        'Add Timing',
        'Add Lap Timer',
        'Add Tyres',
        'Add Damage',
        'Add Weather',
      ]);
      expect(screen.getByRole('button', { name: 'Add panel' })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });

    it('puts the chosen widget in the first free place it fits, at its least size, and closes the list', () => {
      renderInWindow();
      startEditing();
      press('Add panel');

      press('Add Track Map');

      // Three by three, at the top, beside Our Car.
      expect(cellsOf('Track Map')).toBe('16,0,3,3');
      expect(addList()).toBeNull();

      // The next goes beside it, and a wider one where there is the width.
      press('Add panel');
      expect(offered()).not.toContain('Add Track Map');
      press('Add Class Rivals');
      expect(cellsOf('Class Rivals')).toBe('19,0,5,3');
      press('Add panel');
      press('Add Standings');
      expect(cellsOf('Standings')).toBe('16,3,6,3');
    });

    it('offers a panel again once it is off the page, and puts it back at its least size', () => {
      renderInWindow();
      startEditing();
      press('Remove Our Car');
      press('Add panel');
      expect(offered()[0]).toBe('Add Our Car');

      press('Add Our Car');

      expect(cellsOf('Our Car')).toBe('10,0,4,4');
    });

    it('says there is no room, in the list and in the bar, and puts nothing on the page', () => {
      // A page with one free strip, a column wide.
      mocks.dashboard = dashboardWith({
        layout: 'custom',
        custom: [panelOn('timingtower', 0, 0, 23, 16)],
      });
      renderInWindow();
      startEditing();
      press('Add panel');
      expect(offered()).toContain('Add Our Car: no room');
      expect(
        within(addList() as HTMLElement).getByRole('button', {
          name: 'Add Our Car: no room',
        })
      ).toHaveTextContent('no room for 4 × 4');

      press('Add Our Car: no room');

      expect(screen.queryByRole('region', { name: 'Our Car' })).toBeNull();
      expect(message()).toBe(
        'No room for Our Car: it needs 4 by 4 free cells. Move, size or remove a panel to make room.'
      );
      // Left open: another may be tried.
      expect(addList()).not.toBeNull();
    });

    it('has room again once a panel is made smaller', () => {
      mocks.dashboard = dashboardWith({
        layout: 'custom',
        custom: [panelOn('timingtower', 0, 0, 23, 16)],
      });
      renderInWindow();
      startEditing();
      drag(sizeHandle('Timing Tower'), -3, 0);
      press('Add panel');

      press('Add Our Car');

      expect(cellsOf('Our Car')).toBe('20,0,4,4');
      expect(message()).toBe('');
    });

    it('says so when everything is on the page', () => {
      mocks.dashboard = dashboardWith({ layout: 'custom', custom: [] });
      renderInWindow();
      startEditing();
      // Every hostable widget, one after another: each has room on an
      // empty page at its least size.
      for (;;) {
        press('Add panel');
        const next = within(addList() as HTMLElement).queryAllByRole(
          'button'
        )[0];
        if (!next) break;
        fireEvent.click(next);
      }
      expect(addList()).toHaveTextContent(
        'Every panel the page can host is on it already.'
      );
      expect(screen.getAllByRole('region')).toHaveLength(23);
    });

    it('closes the list on Escape, on a press elsewhere, and on its own button', () => {
      renderInWindow();
      startEditing();

      press('Add panel');
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(addList()).toBeNull();

      press('Add panel');
      fireEvent.pointerDown(region('Timing Tower'));
      expect(addList()).toBeNull();

      press('Add panel');
      // A press inside the list is not a press elsewhere.
      fireEvent.pointerDown(addList() as HTMLElement);
      expect(addList()).not.toBeNull();
      press('Add panel');
      expect(addList()).toBeNull();
    });

    it('notes what the running sim cannot show, in the list and on the panel', () => {
      mocks.simulator = 'iracing';
      mocks.dashboard = dashboardWith({
        layout: 'custom',
        custom: [...ARRANGED, panelOn('weatherforecast', 16, 0, 8, 3)],
      });
      renderInWindow();
      // Left out of the page as it is shown.
      expect(screen.queryByRole('region', { name: 'Weather Forecast' })).toBe(
        null
      );

      startEditing();

      // There to be moved, with a word of why it is not seen.
      expect(cellsOf('Weather Forecast')).toBe('16,0,8,3');
      expect(region('Weather Forecast')).toHaveTextContent(
        'Not shown under iRacing'
      );
      expect(region('Our Car')).not.toHaveTextContent('Not shown');
      press('Add panel');
      expect(
        within(addList() as HTMLElement).getByRole('button', {
          name: 'Add Tyre & Brake Wear',
        })
      ).toHaveTextContent('not under iRacing');
      // It can be placed all the same, for the other sim.
      press('Add Tyre & Brake Wear');
      expect(cellsOf('Tyre & Brake Wear')).toBe('16,3,3,3');
    });
  });

  describe('Reset', () => {
    it('asks first, and leaves the page as it is on Keep editing', () => {
      renderInWindow();
      startEditing();

      press('Reset');

      expect(
        screen.getByText(
          'Bring back the panels this layout starts with, a copy of Race?'
        )
      ).toBeVisible();
      // Nothing has changed yet, and the other buttons wait.
      expect(screen.getAllByRole('region')).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

      press('Keep editing');

      expect(screen.getAllByRole('region')).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
    });

    it('brings back the copy of Race once it is confirmed, and saves nothing yet', () => {
      renderInWindow();
      startEditing();
      press('Reset');

      press('Reset layout');

      expect(
        screen.getAllByRole('region').map((panel) => panel.ariaLabel)
      ).toEqual([
        'Timing Tower',
        'Race Charts',
        'Our Car',
        'Track Map',
        'Class Rivals',
        'Crew and Stints',
        'Race Log',
        'Weather Forecast',
      ]);
      for (const start of PIT_WALL_CUSTOM_START) {
        expect(
          document.querySelector(
            `[data-cells="${start.x},${start.y},${start.w},${start.h}"]`
          )
        ).not.toBeNull();
      }
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
    });

    it('is undone by Cancel like anything else', () => {
      renderInWindow();
      startEditing();
      press('Reset');
      press('Reset layout');

      press('Cancel');

      expect(
        screen.getAllByRole('region').map((panel) => panel.ariaLabel)
      ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    });
  });

  describe('Done and Cancel', () => {
    it('saves nothing while panels are moved, sized, added and removed', () => {
      renderInWindow();
      startEditing();

      drag(moveHandle('Race Log'), 6, 0);
      drag(sizeHandle('Race Log'), 2, 2);
      fireEvent.keyDown(moveHandle('Our Car'), { key: 'ArrowDown' });
      press('Remove Timing Tower');
      press('Add panel');
      press('Add Standings');

      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    });

    it('saves the arrangement once on Done, into the page’s own config and nothing else', () => {
      const before = mocks.dashboard as DashboardLayout;
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);
      drag(sizeHandle('Our Car'), 0, 4);
      press('Add panel');
      press('Add Track Map');

      press('Done');

      expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
      // In the order the panels are read on the page.
      expect(pitWallConfig()).toEqual({
        layout: 'custom',
        custom: [
          panelOn('timingtower', 0, 0, 10, 8),
          panelOn('ourcar', 10, 0, 6, 10),
          panelOn('map', 16, 0, 3, 3),
          panelOn('racelog', 16, 6, 6, 4),
        ],
      });
      const saved = mocks.onDashboardUpdated.mock
        .calls[0][0] as DashboardLayout;
      expect(saved.widgets.slice(1)).toEqual(before.widgets.slice(1));
      expect(saved.widgets[0]).toMatchObject({ id: 'pitwall', enabled: true });
    });

    it('ends the edit, and shows the page as saved', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);

      press('Done');

      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
      expect(screen.getByRole('main')).not.toHaveAttribute('data-editing');
      expect(screen.getByRole('navigation', { name: 'Layout' })).toBeVisible();
      expect(region('Race Log').style.gridArea).toBe('racelog');
      expect(
        screen.queryByRole('button', { name: 'Move Race Log' })
      ).toBeNull();
      expect(document.querySelector('[data-item="cells"]')).toBeNull();
    });

    it('saves nothing on Done when nothing was changed', () => {
      renderInWindow();
      startEditing();
      // Moved and moved back.
      drag(moveHandle('Race Log'), 6, 0);
      drag(moveHandle('Race Log'), -6, 0);

      press('Done');

      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
    });

    it('saves nothing on Cancel, and puts the page back as it was', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);
      press('Remove Our Car');
      press('Add panel');
      press('Add Standings');

      press('Cancel');

      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
      expect(
        screen.getAllByRole('region').map((panel) => panel.ariaLabel)
      ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);

      // And a new edit starts from what is saved, not from what was dropped.
      startEditing();
      expect(cellsOf('Race Log')).toBe('10,6,6,4');
      expect(cellsOf('Our Car')).toBe('10,0,6,6');
      expect(screen.queryByRole('region', { name: 'Standings' })).toBeNull();
    });

    it('drops a panel that is held when the edit is ended', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      pointerMove(6, 0);

      press('Done');

      expect(target()).toBeNull();
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      // The release that comes after moves nothing.
      pointerUp(6, 0);
      expect(pitWallConfig()).toEqual({ layout: 'custom', custom: ARRANGED });
    });

    it('saves the first arrangement of a profile that had none', () => {
      mocks.dashboard = dashboardWith({ layout: 'custom', tab: 'overview' });
      renderInWindow();
      startEditing();
      press('Remove Weather Forecast');

      press('Done');

      expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
      const config = pitWallConfig() as { custom: PitWallCustomPanel[] };
      expect(config).toMatchObject({ layout: 'custom', tab: 'overview' });
      expect(config.custom.map((panel) => panel.widget).sort()).toEqual(
        PIT_WALL_CUSTOM_START.map((panel) => panel.widget)
          .filter((type) => type !== 'weatherforecast')
          .sort()
      );
    });

    it('leaves a profile that had no list without one when the copy of Race is left as it is', () => {
      mocks.dashboard = dashboardWith({ layout: 'custom' });
      renderInWindow();
      startEditing();

      press('Done');

      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      expect(pitWallConfig()).toEqual({ layout: 'custom' });
    });

    it('takes the saved list out of the profile when the page is reset to the copy of Race', () => {
      // So that the layout is Race as each version has it again, as it was
      // before the user arranged it.
      renderInWindow();
      startEditing();
      press('Reset');
      press('Reset layout');

      press('Done');

      expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
      expect(pitWallConfig()).toEqual({ layout: 'custom' });
      expect(pitWallConfig()).not.toHaveProperty('custom');
      expect(screen.getAllByRole('region')).toHaveLength(8);
    });

    it('saves an emptied page as an empty list', () => {
      renderInWindow();
      startEditing();
      for (const name of ['Timing Tower', 'Our Car', 'Race Log']) {
        press(`Remove ${name}`);
      }

      press('Done');

      expect(pitWallConfig()).toEqual({ layout: 'custom', custom: [] });
      expect(
        screen.getByText(/The Custom layout has no panel to show\./)
      ).toBeInTheDocument();
    });

    it('hands the keyboard to the bar when the edit begins, and back to the button when it ends', () => {
      renderInWindow();
      startEditing();
      expect(screen.getByRole('button', { name: 'Add panel' })).toHaveFocus();

      press('Cancel');
      expect(screen.getByRole('button', { name: 'Edit layout' })).toHaveFocus();

      startEditing();
      press('Done');
      expect(screen.getByRole('button', { name: 'Edit layout' })).toHaveFocus();
    });
  });

  describe('when the page changes under the edit', () => {
    it('drops the edit when the page is turned to another layout from elsewhere', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);

      // As the settings window does.
      changeDashboard(dashboardWith({ layout: 'race', custom: ARRANGED }));

      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
      expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'race');
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();

      // Back on Custom the page is the saved one, and not being arranged.
      changeDashboard(dashboardWith({ layout: 'custom', custom: ARRANGED }));
      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
      expect(region('Race Log').style.gridArea).toBe('racelog');
    });

    it('drops the edit when the saved arrangement is changed from elsewhere, as by another profile', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);

      changeDashboard(
        dashboardWith({
          layout: 'custom',
          custom: [panelOn('standings', 0, 0, 24, 16)],
        })
      );

      expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
      expect(
        screen.getAllByRole('region').map((panel) => panel.ariaLabel)
      ).toEqual(['Standings']);
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    });

    it('goes on through a change that is not of the arrangement', () => {
      renderInWindow();
      startEditing();
      drag(moveHandle('Race Log'), 6, 0);

      // A setting of some widget saved from the settings window.
      changeDashboard(
        dashboardWith({ layout: 'custom', custom: ARRANGED }, [
          ...PROFILE,
          'flagpanel',
        ])
      );

      expect(screen.getByRole('group', { name: 'Edit layout' })).toBeVisible();
      expect(cellsOf('Race Log')).toBe('16,6,6,4');
    });

    it('drops a panel that is held along with the edit', () => {
      renderInWindow();
      startEditing();
      pointerDown(moveHandle('Race Log'));
      pointerMove(6, 0);

      changeDashboard(dashboardWith({ layout: 'race', custom: ARRANGED }));
      pointerUp(6, 0);

      expect(target()).toBeNull();
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    });
  });
});

/** What a panel hosts, noting when it is drawn for the first time and when it goes. */
const hosted = { mounted: [] as string[], unmounted: [] as string[] };
const Probe = ({ type }: { type: string }) => {
  useEffect(() => {
    hosted.mounted.push(type);
    return () => {
      hosted.unmounted.push(type);
    };
  }, [type]);
  return <div data-testid={`hosted-${type}`} />;
};
const renderProbe = (panel: ResolvedPitWallPanel) => (
  <Probe type={panel.slot.widget} />
);

describe('what the panels hold while the page is arranged', () => {
  beforeEach(() => {
    hosted.mounted.length = 0;
    hosted.unmounted.length = 0;
  });

  it('stays as it was: nothing a panel holds is unmounted by beginning an edit', () => {
    renderInWindow({ renderPanel: renderProbe });
    expect(hosted.mounted).toEqual(['timingtower', 'ourcar', 'racelog']);

    startEditing();

    expect(hosted.unmounted).toEqual([]);
    expect(hosted.mounted).toHaveLength(3);
    for (const type of ['timingtower', 'ourcar', 'racelog']) {
      expect(screen.getByTestId(`hosted-${type}`)).toBeInTheDocument();
    }
  });

  it('is behind the placeholder, unseen and out of reach', () => {
    renderInWindow({ renderPanel: renderProbe });
    const body = screen.getByTestId('hosted-ourcar').parentElement;
    expect(body).not.toHaveAttribute('inert');

    startEditing();

    // The same element, with the placeholder after what it held.
    expect(screen.getByTestId('hosted-ourcar').parentElement).toBe(body);
    expect(body).toHaveAttribute('inert');
    expect(body).toHaveClass('invisible');
    expect(body?.lastElementChild).toHaveAttribute('data-item', 'placeholder');
    expect(body?.lastElementChild).toHaveClass('visible');
  });

  it('is not unmounted by a panel being moved, sized, or carried about', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();

    drag(moveHandle('Race Log'), 6, 0);
    drag(sizeHandle('Race Log'), 2, 2);
    fireEvent.keyDown(moveHandle('Our Car'), { key: 'ArrowDown' });
    pointerDown(moveHandle('Timing Tower'));
    pointerMove(3, 3);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(hosted.unmounted).toEqual([]);
    expect(hosted.mounted).toHaveLength(3);
  });

  it('is kept, unseen, for a panel taken off the page until the edit is over', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();

    press('Remove Our Car');

    // Gone from the page as far as anyone can see or reach.
    expect(screen.queryByRole('region', { name: 'Our Car' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Our Car' })).toBeNull();
    // And still there, where it was, with what it held.
    expect(hosted.unmounted).toEqual([]);
    const parked = screen.getByTestId('hosted-ourcar').closest('section');
    expect(parked).toHaveAttribute('aria-hidden', 'true');
    expect(parked).toHaveAttribute('inert');
    expect(parked).toHaveClass('invisible', 'pointer-events-none');
    expect(parked).toHaveAttribute('data-cells', '10,0,6,6');
    // Its cells are free for another all the same.
    drag(moveHandle('Race Log'), 0, -6);
    expect(cellsOf('Race Log')).toBe('10,0,6,4');
  });

  it('comes back with nothing lost when the edit is cancelled', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();
    press('Remove Our Car');
    drag(moveHandle('Race Log'), 6, 0);

    press('Cancel');

    expect(hosted.unmounted).toEqual([]);
    expect(hosted.mounted).toEqual(['timingtower', 'ourcar', 'racelog']);
    expect(region('Our Car')).not.toHaveAttribute('aria-hidden');
    expect(region('Our Car')).not.toHaveAttribute('inert');
    expect(
      within(region('Our Car')).getByTestId('hosted-ourcar')
    ).toBeInTheDocument();
  });

  it('is the same again for a panel taken off and put back within the edit', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();
    press('Remove Our Car');
    press('Add panel');
    press('Add Our Car');

    expect(hosted.unmounted).toEqual([]);
    expect(region('Our Car')).not.toHaveAttribute('aria-hidden');
    expect(
      within(region('Our Car')).getByTestId('hosted-ourcar')
    ).toBeInTheDocument();
  });

  it('goes only on Done, and only for the panel taken off', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();
    press('Remove Our Car');
    drag(moveHandle('Race Log'), 6, 0);
    expect(hosted.unmounted).toEqual([]);

    press('Done');

    expect(hosted.unmounted).toEqual(['ourcar']);
    expect(screen.queryByTestId('hosted-ourcar')).toBeNull();
    expect(screen.getByTestId('hosted-timingtower')).toBeInTheDocument();
    expect(screen.getByTestId('hosted-racelog')).toBeInTheDocument();
  });

  it('draws a panel put on the page only once it is saved', () => {
    renderInWindow({ renderPanel: renderProbe });
    startEditing();
    press('Add panel');
    press('Add Track Map');

    // A placeholder and nothing behind it: the page hosts what is saved.
    expect(screen.queryByTestId('hosted-map')).toBeNull();
    expect(region('Track Map')).toHaveTextContent('3 × 3 cells');

    press('Done');

    expect(screen.getByTestId('hosted-map')).toBeInTheDocument();
    expect(hosted.unmounted).toEqual([]);
    expect(hosted.mounted).toEqual(['timingtower', 'ourcar', 'racelog', 'map']);
  });

  it('holds nothing behind a placeholder while no session is running', () => {
    mocks.running = false;
    renderInWindow({ renderPanel: renderProbe });
    startEditing();

    expect(hosted.mounted).toEqual([]);
    expect(region('Our Car')).toHaveTextContent('6 × 6 cells');
  });
});

describe('the Custom layout in a browser', () => {
  const choose = (name: string) =>
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Layout' })).getByRole(
        'button',
        { name }
      )
    );

  it('shows the arrangement as the profile saved it', () => {
    renderInBrowser();

    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);
    expect(region('Race Log').style.gridArea).toBe('racelog');
  });

  it('has no Edit layout button, and nothing else to arrange the page with', () => {
    renderInBrowser();

    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Edit layout' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Size / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    // The switch between layouts is there, with Custom in it.
    expect(
      within(screen.getByRole('navigation', { name: 'Layout' })).getByRole(
        'button',
        { name: 'Custom' }
      )
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a choice of Custom on the device, and takes its panels from the profile', () => {
    mocks.dashboard = dashboardWith({ layout: 'race', custom: ARRANGED });
    renderInBrowser();
    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'race');

    choose('Custom');

    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);
    // The choice is the device's; of the arrangement the browser keeps
    // nothing, and the profile is left as it is.
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBe('custom');
    expect(localStorage).toHaveLength(1);
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });

  it('opens on Custom where it was chosen last time, with the panels the profile has now', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'custom');
    mocks.dashboard = dashboardWith({ layout: 'watching', custom: ARRANGED });
    renderInBrowser();
    expect(screen.getAllByRole('region')).toHaveLength(3);

    // Arranged again in the window: the browser shows the new arrangement.
    changeDashboard(
      dashboardWith({
        layout: 'watching',
        custom: [panelOn('standings', 0, 0, 24, 16)],
      })
    );

    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual(['Standings']);
  });

  it('reads no arrangement from what the browser kept, whatever is there', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'custom');
    for (const key of [
      'irdashies:pitwall:custom',
      'irdashies:pitwall:panels',
      'custom',
    ]) {
      localStorage.setItem(
        key,
        JSON.stringify([panelOn('standings', 0, 0, 24, 16)])
      );
    }

    renderInBrowser();

    expect(
      screen.getAllByRole('region').map((panel) => panel.ariaLabel)
    ).toEqual(['Timing Tower', 'Our Car', 'Race Log']);
  });

  it('shows the copy of Race for a profile that has arranged nothing', () => {
    mocks.dashboard = dashboardWith({ layout: 'custom' });
    renderInBrowser();
    expect(screen.getAllByRole('region')).toHaveLength(8);
  });

  it('says where an empty page is arranged, and offers nothing', () => {
    mocks.dashboard = dashboardWith({ layout: 'custom', custom: [] });
    renderInBrowser();
    expect(
      screen.getByText(
        'The Custom layout has no panel to show. It is arranged in the Pit Wall window of Tearoff.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });

  it('keeps the tab of Compact through a turn to Custom and back', () => {
    renderInBrowser();
    choose('Compact');
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole(
        'button',
        { name: 'Crew' }
      )
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_TAB_KEY)).toBe('crew');

    choose('Custom');
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(3);

    choose('Compact');
    expect(screen.getByRole('main')).toHaveAttribute('data-tab', 'crew');
  });
});

describe('where the page may be arranged', () => {
  it('is not a page whose bridge cannot open the settings window, as the settings preview’s cannot', () => {
    // No device layout around it, and no way to the settings: the preview
    // frame, which is handed a dashboard it cannot save.
    mocks.inBrowser = true;
    renderInWindow();
    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });

  it('is not a page whose layout is a choice of the device, whatever its bridge can do', () => {
    render(
      <PitWallDeviceLayout>
        <PitWall />
      </PitWallDeviceLayout>
    );
    expect(screen.getByRole('main')).toHaveAttribute('data-layout', 'custom');
    expect(
      screen.getByRole('button', { name: 'Pit Wall settings' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });
});
