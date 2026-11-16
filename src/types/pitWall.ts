import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import {
  PIT_WALL_LAYOUT_IDS,
  type PitWallConfig,
  type PitWallLayoutId,
} from './widgetConfigs';
import {
  isWidgetDisabledForSim,
  type SimWidgetSupportConfig,
} from './simWidgetSupport';
import type { ActiveSimulator } from './simulators';
import type { WidgetId } from './widgetId';

/** The widget id, the page's hash route and the window's ready id. */
export const PIT_WALL_WIDGET_ID = 'pitwall';

export const DEFAULT_PIT_WALL_LAYOUT: PitWallLayoutId = 'race';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isPitWallLayoutId = (value: unknown): value is PitWallLayoutId =>
  (PIT_WALL_LAYOUT_IDS as readonly unknown[]).includes(value);

/**
 * Reads the saved Pit Wall config, which is untrusted. Anything that is not
 * one of the known layouts falls back to the default.
 */
export const sanitizePitWallConfig = (value: unknown): PitWallConfig => {
  const source = isRecord(value) ? value : {};
  return {
    layout: isPitWallLayoutId(source.layout)
      ? source.layout
      : DEFAULT_PIT_WALL_LAYOUT,
  };
};

/** Every column of a layout is this many grid rows tall. */
export const PIT_WALL_ROWS = 12;

/**
 * One panel of a layout. A widget type appears at most once in a layout, so
 * the type is also the panel's key and the name of its grid area.
 */
export interface PitWallSlot {
  /** The overlay widget the panel hosts. */
  widget: WidgetId;
  /** Rows of the column the panel takes while every panel of it is shown. */
  rows: number;
  /**
   * The narrowest the widget is laid out at, CSS pixels. A narrower panel
   * shows it scaled down instead of squeezed or cut.
   */
  minWidth: number;
  /**
   * Width over height of the box the widget is drawn in, for a widget whose
   * drawing grows with its height and pushes the rest out of a tall panel.
   * Left out, the widget gets the whole panel.
   */
  aspect?: number;
}

export interface PitWallColumn {
  /** Share of the page's width, as a `fr` figure. */
  width: number;
  /** Top to bottom. Their rows add up to PIT_WALL_ROWS. */
  slots: readonly PitWallSlot[];
}

export interface PitWallLayout {
  id: PitWallLayoutId;
  /** The header button's text. */
  label: string;
  /** What the layout is for, for the button's tooltip. */
  description: string;
  /** Left to right. */
  columns: readonly PitWallColumn[];
}

/**
 * The three fixed layouts, made of the widgets the app already has.
 *
 * - Race: the whole page for a second monitor while driving.
 * - Watching: for a team-mate's stint, with the lap-by-lap and car-state
 *   panels in place of the driver's aids.
 * - Compact: five panels for a small or touch screen.
 *
 * A slot whose widget the running sim cannot show is left out and the panels
 * that share its column take its rows (see `pitWallGrid`).
 */
export const PIT_WALL_LAYOUTS: Readonly<
  Record<PitWallLayoutId, PitWallLayout>
> = {
  race: {
    id: 'race',
    label: 'Race',
    description: 'The whole page, for a second monitor',
    columns: [
      { width: 1.5, slots: [{ widget: 'standings', rows: 12, minWidth: 520 }] },
      {
        width: 0.9,
        slots: [
          { widget: 'fuel', rows: 7, minWidth: 300 },
          { widget: 'pitstop', rows: 5, minWidth: 300 },
        ],
      },
      {
        width: 1.2,
        slots: [
          { widget: 'flagpanel', rows: 2, minWidth: 400 },
          { widget: 'finishorder', rows: 4, minWidth: 440 },
          { widget: 'stinthistory', rows: 3, minWidth: 380 },
          { widget: 'weatherforecast', rows: 3, minWidth: 300 },
        ],
      },
      {
        width: 0.9,
        slots: [
          { widget: 'map', rows: 4, minWidth: 260 },
          { widget: 'traffic', rows: 4, minWidth: 330 },
          { widget: 'wear', rows: 4, minWidth: 260 },
        ],
      },
    ],
  },
  watching: {
    id: 'watching',
    label: 'Watching',
    description: 'For the hours a team-mate drives',
    columns: [
      {
        width: 1.25,
        slots: [
          { widget: 'finishorder', rows: 4, minWidth: 440 },
          { widget: 'stinthistory', rows: 4, minWidth: 380 },
          { widget: 'pitstop', rows: 4, minWidth: 300 },
        ],
      },
      {
        width: 0.85,
        slots: [
          { widget: 'timing', rows: 3, minWidth: 300 },
          { widget: 'laptimelog', rows: 9, minWidth: 250 },
        ],
      },
      {
        width: 0.8,
        slots: [
          { widget: 'tyres', rows: 7, minWidth: 240 },
          // The car is drawn as tall as its box, with its figures beside it.
          { widget: 'damage', rows: 5, minWidth: 220, aspect: 5 / 3 },
        ],
      },
      {
        width: 1.6,
        slots: [
          { widget: 'standings', rows: 9, minWidth: 520 },
          { widget: 'weatherforecast', rows: 3, minWidth: 300 },
        ],
      },
    ],
  },
  compact: {
    id: 'compact',
    label: 'Compact',
    description: 'Five panels for a small or touch screen',
    columns: [
      { width: 1.7, slots: [{ widget: 'standings', rows: 12, minWidth: 520 }] },
      {
        width: 1,
        slots: [
          { widget: 'fuel', rows: 7, minWidth: 300 },
          { widget: 'pitstop', rows: 5, minWidth: 300 },
        ],
      },
      {
        width: 1.2,
        slots: [
          { widget: 'finishorder', rows: 6, minWidth: 440 },
          { widget: 'weather', rows: 6, minWidth: 170 },
        ],
      },
    ],
  },
};

/** The layouts in the order the header and the settings page list them. */
export const PIT_WALL_LAYOUT_LIST: readonly PitWallLayout[] =
  PIT_WALL_LAYOUT_IDS.map((id) => PIT_WALL_LAYOUTS[id]);

/** A layout as CSS grid properties, for the panels that are shown. */
export interface PitWallGrid {
  /** `grid-template-columns`. */
  columns: string;
  /** `grid-template-rows`. */
  rows: string;
  /** `grid-template-areas`; each panel's `grid-area` is its widget type. */
  areas: string;
  /** The shown slots, column by column, top to bottom. */
  slots: readonly PitWallSlot[];
}

/**
 * Shares PIT_WALL_ROWS between the weights in proportion, in whole rows.
 * The rows a division leaves over go to the largest remainders, earlier
 * slots first, so the result always adds up. A panel never gets fewer rows
 * than it has with its whole column shown, because leaving a panel out only
 * raises the share of the others.
 */
const shareRows = (weights: readonly number[]): number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (weight / total) * PIT_WALL_ROWS);
  const rows = exact.map((value) => Math.floor(value));
  let spare = PIT_WALL_ROWS - rows.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let turn = 0; spare > 0; turn++, spare--) {
    rows[byRemainder[turn % byRemainder.length].index] += 1;
  }
  return rows;
};

/**
 * The grid for a layout with some of its panels left out.
 *
 * A column's remaining panels share its rows in proportion to their own; a
 * column with no panel left is dropped and the others take its width.
 * `isShown` defaults to showing every panel.
 */
export const pitWallGrid = (
  layout: PitWallLayout,
  isShown: (slot: PitWallSlot) => boolean = () => true
): PitWallGrid => {
  const columns = layout.columns
    .map((column) => ({
      width: column.width,
      slots: column.slots.filter(isShown),
    }))
    .filter((column) => column.slots.length > 0);

  const columnAreas = columns.map((column) => {
    const rows = shareRows(column.slots.map((slot) => slot.rows));
    return column.slots.flatMap((slot, index) =>
      Array.from({ length: rows[index] }, () => slot.widget as string)
    );
  });

  return {
    columns: columns.map((column) => `minmax(0, ${column.width}fr)`).join(' '),
    rows: `repeat(${PIT_WALL_ROWS}, minmax(0, 1fr))`,
    areas: Array.from(
      { length: columns.length > 0 ? PIT_WALL_ROWS : 0 },
      (_, row) => `"${columnAreas.map((areas) => areas[row]).join(' ')}"`
    ).join(' '),
    slots: columns.flatMap((column) => column.slots),
  };
};

/**
 * - `ready`: the profile has a widget of the slot's type to host.
 * - `missing`: it has none, so the panel says so.
 */
export type ResolvedPitWallPanel =
  | { slot: PitWallSlot; status: 'ready'; widget: DashboardWidget }
  | { slot: PitWallSlot; status: 'missing' };

export interface ResolvedPitWall {
  layout: PitWallLayout;
  grid: PitWallGrid;
  /** One per shown slot, in the grid's order. */
  panels: ResolvedPitWallPanel[];
}

export interface PitWallSimFilter {
  support: SimWidgetSupportConfig;
  simulator: ActiveSimulator | null | undefined;
}

const typeOf = (widget: DashboardWidget) => widget.type || widget.id;

/**
 * The widget a panel hosts: the profile's own widget of that type, switched
 * on or not. Widgets read their settings from the entry whose id is the
 * type, so that one is taken first; a layout made only for the Gantry is
 * never taken.
 */
const findPanelWidget = (
  type: string,
  widgets: readonly DashboardWidget[]
): DashboardWidget | undefined =>
  widgets.find((widget) => widget.id === type && typeOf(widget) === type) ??
  widgets.find(
    (widget) => typeOf(widget) === type && widget.placement !== 'gantry'
  );

/**
 * Works out the page the saved dashboard describes: the chosen layout, its
 * grid, and the dashboard widget behind each panel. With `sim`, panels the
 * running sim cannot support are left out, as they are on the overlay.
 */
export const resolvePitWall = (
  dashboard: DashboardLayout | null | undefined,
  sim?: PitWallSimFilter
): ResolvedPitWall => {
  const widgets = dashboard?.widgets ?? [];
  const config = sanitizePitWallConfig(
    widgets.find((widget) => widget.id === PIT_WALL_WIDGET_ID)?.config
  );
  const layout = PIT_WALL_LAYOUTS[config.layout];
  const grid = pitWallGrid(
    layout,
    (slot) =>
      !sim || !isWidgetDisabledForSim(sim.support, slot.widget, sim.simulator)
  );

  return {
    layout,
    grid,
    panels: grid.slots.map((slot): ResolvedPitWallPanel => {
      const widget = findPanelWidget(slot.widget, widgets);
      return widget
        ? { slot, status: 'ready', widget }
        : { slot, status: 'missing' };
    }),
  };
};

/** Every session, for a page that is on screen whatever the session is. */
const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
  warmup: true,
};

/**
 * The dashboard as the hosted widgets read it.
 *
 * A widget's "only on track" switch and its list of sessions are there to
 * keep it off the game's screen at the wrong moment. The Pit Wall is a window
 * of its own that is always on show, so its panels are drawn with both rules
 * lifted; everything else of each widget's config is as the user saved it.
 * Only the widgets named in `hostedIds` are changed, and the input is not.
 */
export const pitWallHostedDashboard = (
  dashboard: DashboardLayout | null | undefined,
  hostedIds: ReadonlySet<string>
): DashboardLayout | undefined => {
  if (!dashboard) return undefined;
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) =>
      hostedIds.has(widget.id)
        ? {
            ...widget,
            config: {
              ...widget.config,
              showOnlyWhenOnTrack: false,
              sessionVisibility: ALL_SESSIONS,
            },
          }
        : widget
    ),
  };
};

/** What the Pit Wall settings page and the window's renderer call. */
export interface PitWallBridge {
  /**
   * Opens the Pit Wall window, or brings it to the front. Resolves false when
   * the widget is switched off or the running sim cannot show it, and
   * nothing was opened.
   */
  showWindow: () => Promise<boolean>;
}
