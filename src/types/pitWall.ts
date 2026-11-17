import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import {
  PIT_WALL_LAYOUT_IDS,
  PIT_WALL_TAB_IDS,
  type PitWallConfig,
  type PitWallLayoutId,
  type PitWallTabId,
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

/** The tab every layout has, and the one in front until another is chosen. */
export const DEFAULT_PIT_WALL_TAB: PitWallTabId = 'overview';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isPitWallLayoutId = (value: unknown): value is PitWallLayoutId =>
  (PIT_WALL_LAYOUT_IDS as readonly unknown[]).includes(value);

export const isPitWallTabId = (value: unknown): value is PitWallTabId =>
  (PIT_WALL_TAB_IDS as readonly unknown[]).includes(value);

/**
 * Reads the saved Pit Wall config, which is untrusted. Anything that is not
 * one of the known layouts or tabs falls back to the default, and nothing
 * else is kept.
 */
export const sanitizePitWallConfig = (value: unknown): PitWallConfig => {
  const source = isRecord(value) ? value : {};
  return {
    layout: isPitWallLayoutId(source.layout)
      ? source.layout
      : DEFAULT_PIT_WALL_LAYOUT,
    tab: isPitWallTabId(source.tab) ? source.tab : DEFAULT_PIT_WALL_TAB,
  };
};

/** Every column of a tab is this many grid rows tall. */
export const PIT_WALL_ROWS = 12;

/** The gap between two panels, and the page's margin around them, CSS pixels. */
export const PIT_WALL_GAP_PX = 12;

/** What a panel's frame takes of its width: a border of a pixel each side. */
const PANEL_FRAME_PX = 2;

/**
 * A page narrower than this, in CSS pixels, is a phone's: it is given the
 * tabs with their panels one under another.
 */
export const PIT_WALL_PHONE_MAX_WIDTH = 700;

/** The layout whose tabs a phone is given, whatever layout is chosen. */
export const PIT_WALL_PHONE_LAYOUT: PitWallLayoutId = 'compact';

/**
 * One panel of a layout. A widget type appears at most once on a tab, so
 * the type is also the panel's key and the name of its grid area.
 */
export interface PitWallSlot {
  /** The overlay widget the panel hosts. */
  widget: WidgetId;
  /** Rows of the column the panel takes while every panel of it is shown. */
  rows: number;
  /**
   * The narrowest the widget is laid out at, CSS pixels. The grid keeps the
   * panel this wide for as long as the page has the room, at the cost of
   * the columns that can spare some (see `pitWallGrid`); on a page too
   * narrow for that the widget is drawn scaled down instead of squeezed or
   * cut. Kept at the width the widget can still be read at by its own means
   * (columns left out, a table that scrolls sideways), because scaling
   * takes its small print under ten pixels.
   */
  minWidth: number;
  /**
   * Width over height of the box the widget is drawn in, for a widget whose
   * drawing grows with its height and pushes the rest out of a tall panel.
   * Left out, the widget gets the whole panel.
   */
  aspect?: number;
  /**
   * The panel keeps its rows when another of its column is left out: the
   * rows freed go to the panels that can use them. For a panel that is
   * whole at the height it has, beside ones that only show more.
   */
  rigid?: boolean;
}

/**
 * One band of a column: a panel across the whole column, or panels side by
 * side that share it equally and take the same rows. Side by side is how a
 * panel elsewhere in the column comes to span the panels above or below it.
 */
export type PitWallBand = PitWallSlot | readonly PitWallSlot[];

export interface PitWallColumn {
  /** Share of the page's width, as a `fr` figure. */
  width: number;
  /** Top to bottom. Their rows add up to PIT_WALL_ROWS. */
  bands: readonly PitWallBand[];
}

/** One page of a layout. */
export interface PitWallTab {
  id: PitWallTabId;
  /** The tab's text in the tab bar. */
  label: string;
  /** Left to right. */
  columns: readonly PitWallColumn[];
}

export interface PitWallLayout {
  id: PitWallLayoutId;
  /** The header button's text. */
  label: string;
  /** What the layout is for, for the button's tooltip. */
  description: string;
  /**
   * What the page shows, one tab at a time, each with a different id. A
   * layout of one tab is the whole page and has no tab bar.
   */
  tabs: readonly PitWallTab[];
}

/** The panels of a band, left to right. */
export const pitWallBandSlots = (band: PitWallBand): readonly PitWallSlot[] =>
  Array.isArray(band)
    ? (band as readonly PitWallSlot[])
    : [band as PitWallSlot];

/** Every panel of a tab, column by column, top to bottom, left to right. */
export const pitWallTabSlots = (tab: PitWallTab): PitWallSlot[] =>
  tab.columns.flatMap((column) => column.bands.flatMap(pitWallBandSlots));

/*
 * The panels, each with the width it is still itself at. Every one of these
 * widgets fits a narrow panel by its own means, so the widths are low: the
 * Timing Tower leaves columns out, Class Rivals, Crew and Stints and Car
 * Laps scroll sideways below the width of their tables, and the Race Log
 * wraps its lines. A layout names a lower one where the panel shares a band.
 */
const slotOf =
  (widget: WidgetId, width: number) =>
  (rows: number, minWidth = width): PitWallSlot => ({
    widget,
    rows,
    minWidth,
  });
const tower = slotOf('timingtower', 420);
const ourCar = slotOf('ourcar', 320);
const classRivals = slotOf('classrivals', 420);
const stintTimeline = slotOf('stinttimeline', 420);
const crew = slotOf('crew', 360);
const carLaps = slotOf('carlaps', 360);
const raceCharts = slotOf('racecharts', 320);
const raceLog = slotOf('racelog', 280);
const trackMap = slotOf('map', 220);
const forecast = slotOf('weatherforecast', 300);

/** The same panel, keeping its rows when a neighbour is left out. */
const rigid = (slot: PitWallSlot): PitWallSlot => ({ ...slot, rigid: true });

/**
 * The three fixed layouts, as the design drew them.
 *
 * - Race: the whole page for a second monitor while driving. On the left
 *   the Timing Tower over the Race Charts, which need the column's width
 *   for a plot worth reading; on the right Our Car and the Track Map, Class
 *   Rivals across, Crew and Stints with the Race Log, and the Weather
 *   Forecast across. This is where the page leaves the design, which had
 *   the charts in half the right side and the tower's lower half empty.
 * - Watching: for a team-mate's stint. Our Car and the laps of a car; the
 *   Stint Timeline and Crew and Stints; our class in the tower, the
 *   forecast and the log.
 * - Compact: a page of tabs for a small or touch screen. Overview has the
 *   tower, Our Car, the forecast and the log; each other tab gives its
 *   panels the whole page. A phone is given these tabs whatever layout is
 *   chosen, with the panels of a tab one under another.
 *
 * A slot whose widget the running sim cannot show is left out and its
 * neighbours take its room (see `pitWallGrid`).
 */
export const PIT_WALL_LAYOUTS: Readonly<
  Record<PitWallLayoutId, PitWallLayout>
> = {
  race: {
    id: 'race',
    label: 'Race',
    description: 'The whole page, for a second monitor',
    tabs: [
      {
        id: 'overview',
        label: 'Race',
        columns: [
          // Eight rows hold a class of fourteen without scrolling.
          { width: 4, bands: [tower(8), raceCharts(4)] },
          {
            width: 3,
            bands: [
              // Our Car is whole in four rows: without the forecast, as
              // under iRacing, its rows go to the two bands that scroll.
              [rigid(ourCar(4)), rigid(trackMap(4))],
              classRivals(3),
              // Half the column is narrower than the crew's table at any
              // window size: it scrolls sideways here.
              [crew(3, 320), raceLog(3)],
              forecast(2),
            ],
          },
        ],
      },
    ],
  },
  watching: {
    id: 'watching',
    label: 'Watching',
    description: 'For the hours a team-mate drives',
    tabs: [
      {
        id: 'overview',
        label: 'Watching',
        columns: [
          { width: 5, bands: [ourCar(6), carLaps(6)] },
          { width: 5, bands: [stintTimeline(3), crew(9)] },
          { width: 3, bands: [tower(7), forecast(2), raceLog(3)] },
        ],
      },
    ],
  },
  compact: {
    id: 'compact',
    label: 'Compact',
    description: 'A page of tabs for a small or touch screen',
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        columns: [
          { width: 1.9, bands: [tower(12)] },
          { width: 1, bands: [ourCar(6), forecast(3), raceLog(3)] },
        ],
      },
      {
        id: 'timing',
        label: 'Timing',
        columns: [{ width: 1, bands: [tower(12)] }],
      },
      {
        id: 'strategy',
        label: 'Strategy',
        columns: [{ width: 1, bands: [classRivals(8), stintTimeline(4)] }],
      },
      {
        id: 'crew',
        label: 'Crew',
        columns: [
          { width: 1.15, bands: [crew(12)] },
          { width: 1, bands: [carLaps(12)] },
        ],
      },
      {
        id: 'map',
        label: 'Map',
        columns: [{ width: 1, bands: [trackMap(12)] }],
      },
      {
        id: 'charts',
        label: 'Charts',
        columns: [{ width: 1, bands: [raceCharts(12)] }],
      },
      {
        id: 'log',
        label: 'Log',
        columns: [{ width: 1, bands: [raceLog(12)] }],
      },
    ],
  },
};

/** The layouts in the order the header and the settings page list them. */
export const PIT_WALL_LAYOUT_LIST: readonly PitWallLayout[] =
  PIT_WALL_LAYOUT_IDS.map((id) => PIT_WALL_LAYOUTS[id]);

/** Every widget some tab of some layout hosts, each once. */
export const PIT_WALL_HOSTED_WIDGETS: readonly WidgetId[] = [
  ...new Set(
    PIT_WALL_LAYOUT_LIST.flatMap((layout) =>
      layout.tabs.flatMap((tab) =>
        pitWallTabSlots(tab).map((slot) => slot.widget)
      )
    )
  ),
];

/** A tab as CSS grid properties, for the panels that are shown. */
export interface PitWallGrid {
  /** `grid-template-columns`. */
  columns: string;
  /** `grid-template-rows`. */
  rows: string;
  /** `grid-template-areas`; each panel's `grid-area` is its widget type. */
  areas: string;
  /** The shown slots, column by column, top to bottom, left to right. */
  slots: readonly PitWallSlot[];
}

/**
 * Shares so many rows between the weights in proportion, in whole rows.
 * The rows a division leaves over go to the largest remainders, earlier
 * bands first, so the result always adds up.
 */
const inProportion = (weights: readonly number[], count: number): number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (weight / total) * count);
  const rows = exact.map((value) => Math.floor(value));
  let spare = count - rows.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let turn = 0; spare > 0; turn++, spare--) {
    rows[byRemainder[turn % byRemainder.length].index] += 1;
  }
  return rows;
};

/**
 * Shares PIT_WALL_ROWS between the bands of a column. A rigid band keeps
 * its rows and the others share the rest in proportion to their own; a
 * column of rigid bands alone shares like any other, since somebody has to
 * take the rows. A band never gets fewer rows than it has with its whole
 * column shown, because leaving a band out only raises the share of the
 * others.
 */
const shareRows = (
  bands: readonly { rows: number; rigid: boolean }[]
): number[] => {
  const kept = bands
    .filter((band) => band.rigid)
    .reduce((sum, band) => sum + band.rows, 0);
  const free = bands.filter((band) => !band.rigid);
  if (free.length === 0 || kept >= PIT_WALL_ROWS) {
    return inProportion(
      bands.map((band) => band.rows),
      PIT_WALL_ROWS
    );
  }
  const shared = inProportion(
    free.map((band) => band.rows),
    PIT_WALL_ROWS - kept
  );
  let next = 0;
  return bands.map((band) => (band.rigid ? band.rows : shared[next++]));
};

const greatestCommonDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestCommonDivisor(b, a % b);

/** A figure without the tail a division leaves. */
const tidy = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * The grid for a tab with some of its panels left out.
 *
 * A band's remaining panels share its width, and a band with none left is
 * dropped; a column's remaining bands share its rows in proportion to their
 * own, and a column with none left is dropped and the others take its
 * width. So no panel left out leaves a hole. `isShown` defaults to showing
 * every panel.
 *
 * A column is as many grid tracks as its bands need to be split evenly:
 * two for a column whose widest band holds two panels, where a panel that
 * has the column to itself covers both.
 *
 * A track is its column's share of the page, and never narrower than the
 * widest `minWidth` of the panels in it while the page has room for every
 * track's: on a narrower page the columns with width to spare give it up
 * first, which is the Timing Tower leaving columns out before Our Car is
 * drawn smaller. Where the page has not even that room, each track's least
 * width is its share of the page, so the grid never grows wider than the
 * page.
 */
export const pitWallGrid = (
  tab: Pick<PitWallTab, 'columns'>,
  isShown: (slot: PitWallSlot) => boolean = () => true
): PitWallGrid => {
  const columns = tab.columns
    .map((column) => ({
      width: column.width,
      bands: column.bands
        .map((band) => pitWallBandSlots(band).filter(isShown))
        .filter((slots) => slots.length > 0),
    }))
    .filter((column) => column.bands.length > 0)
    .map((column) => ({
      ...column,
      // The fewest tracks every band of the column divides evenly.
      tracks: column.bands.reduce(
        (tracks, slots) =>
          (tracks * slots.length) / greatestCommonDivisor(tracks, slots.length),
        1
      ),
    }))
    .map((column) => ({
      ...column,
      // The least a track may be for every panel over it to have its
      // width inside its frame: a panel over several tracks has the gaps
      // between them too.
      trackMin: Math.max(
        0,
        ...column.bands.flatMap((slots) => {
          const span = column.tracks / slots.length;
          return slots.map(
            (slot) =>
              (slot.minWidth + PANEL_FRAME_PX - (span - 1) * PIT_WALL_GAP_PX) /
              span
          );
        })
      ),
    }));

  const trackCount = columns.reduce((sum, column) => sum + column.tracks, 0);
  const minTotal = columns.reduce(
    (sum, column) => sum + column.tracks * column.trackMin,
    0
  );
  const gaps = Math.max(0, trackCount - 1) * PIT_WALL_GAP_PX;
  /** A track's least width: its panels', or its share of a narrower page. */
  const least = (trackMin: number): string =>
    minTotal > 0 && trackMin > 0
      ? `min(${tidy(trackMin)}px, calc((100% - ${gaps}px) * ${tidy(trackMin / minTotal)}))`
      : '0';

  // Each column as its rows, each row as the area of every track.
  const columnAreas = columns.map((column) => {
    const rows = shareRows(
      column.bands.map((slots) => ({
        rows: slots[0].rows,
        // One panel of a band that keeps its rows holds the band to them.
        rigid: slots.some((slot) => slot.rigid === true),
      }))
    );
    return column.bands.flatMap((slots, index) => {
      const each = column.tracks / slots.length;
      const row = Array.from(
        { length: column.tracks },
        (_, track) => slots[Math.floor(track / each)].widget as string
      );
      return Array.from({ length: rows[index] }, () => row);
    });
  });

  return {
    columns: columns
      .flatMap((column) =>
        Array.from(
          { length: column.tracks },
          () =>
            `minmax(${least(column.trackMin)}, ${tidy(column.width / column.tracks)}fr)`
        )
      )
      .join(' '),
    rows: `repeat(${PIT_WALL_ROWS}, minmax(0, 1fr))`,
    areas: Array.from(
      { length: columns.length > 0 ? PIT_WALL_ROWS : 0 },
      (_, row) => `"${columnAreas.flatMap((areas) => areas[row]).join(' ')}"`
    ).join(' '),
    slots: columns.flatMap((column) => column.bands.flat()),
  };
};

/**
 * What a row of a panel comes to where a tab's panels are one under
 * another, CSS pixels: the height a panel of so many rows has in its
 * column on a tablet, which is the height its widget was arranged for.
 */
const STACK_ROW_PX = 60;

/**
 * The most of the page's height a stacked panel takes, percent: little
 * enough that the top of the next panel shows there is one.
 */
const STACK_MAX_PERCENT = 86;

/**
 * How tall each panel is where they are stacked, as a CSS length to grow
 * from: a panel alone has the whole page, and the others the height of
 * their rows, never so much of the page that the next panel is out of
 * sight. Together they may come to more than the page, which then scrolls.
 */
export const pitWallStack = (slots: readonly PitWallSlot[]): string[] =>
  slots.length === 1
    ? ['100%']
    : slots.map(
        (slot) => `min(${slot.rows * STACK_ROW_PX}px, ${STACK_MAX_PERCENT}%)`
      );

/**
 * - `ready`: the profile has a widget of the slot's type to host.
 * - `missing`: it has none, so the panel says so.
 */
export type ResolvedPitWallPanel =
  | { slot: PitWallSlot; status: 'ready'; widget: DashboardWidget }
  | { slot: PitWallSlot; status: 'missing' };

export interface ResolvedPitWall {
  /** The layout whose tabs are shown: on a phone, the one made of tabs. */
  layout: PitWallLayout;
  /** The tabs to choose from. One tab is the whole page, and has no bar. */
  tabs: readonly PitWallTab[];
  /** The tab in front. */
  tab: PitWallTab;
  /** The tab's grid, for a page wide enough for one. */
  grid: PitWallGrid;
  /**
   * On a phone, the height each panel has at the least, as a CSS length,
   * in the panels' order: they are drawn one under another at the page's
   * width and the grid is not used. Undefined on a page wide enough for a
   * grid.
   */
  stack?: readonly string[];
  /** One per shown slot, in the grid's order. */
  panels: ResolvedPitWallPanel[];
  /**
   * The profile's widget behind every panel of every tab of the layout,
   * in front or not, each once, less what the running sim cannot show:
   * what the page reads for as long as it is open, whichever tab is shown.
   */
  hosted: readonly DashboardWidget[];
}

export interface PitWallSimFilter {
  support: SimWidgetSupportConfig;
  simulator: ActiveSimulator | null | undefined;
}

/**
 * What is chosen where the page is shown, in place of or beside what the
 * profile saved. All of it is as untrusted as the profile.
 */
export interface PitWallView {
  /**
   * A layout chosen on this device instead of in the profile, as a browser
   * on another device does. Anything that is not a layout is ignored.
   */
  layout?: PitWallLayoutId;
  /**
   * The tab in front, chosen on this device. Anything that is not a tab of
   * the layout shown is ignored.
   */
  tab?: PitWallTabId;
  /** The page is as narrow as a phone (see PIT_WALL_PHONE_MAX_WIDTH). */
  phone?: boolean;
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
 * Works out the page the saved dashboard describes: the chosen layout, the
 * tab in front, its grid, and the dashboard widget behind each panel. With
 * `sim`, panels the running sim cannot support are left out, as they are on
 * the overlay.
 *
 * `view` is what was chosen where the page is shown. On a phone the tabs
 * are those of the layout made of tabs, whichever layout is chosen, and the
 * panels of the tab in front are stacked.
 */
export const resolvePitWall = (
  dashboard: DashboardLayout | null | undefined,
  sim?: PitWallSimFilter,
  view: PitWallView = {}
): ResolvedPitWall => {
  const widgets = dashboard?.widgets ?? [];
  const config = sanitizePitWallConfig(
    widgets.find((widget) => widget.id === PIT_WALL_WIDGET_ID)?.config
  );
  const layout =
    PIT_WALL_LAYOUTS[
      view.phone
        ? PIT_WALL_PHONE_LAYOUT
        : isPitWallLayoutId(view.layout)
          ? view.layout
          : config.layout
    ];
  const wanted = isPitWallTabId(view.tab) ? view.tab : config.tab;
  const tab =
    layout.tabs.find((entry) => entry.id === wanted) ?? layout.tabs[0];
  const isShown = (slot: PitWallSlot) =>
    !sim || !isWidgetDisabledForSim(sim.support, slot.widget, sim.simulator);
  const grid = pitWallGrid(tab, isShown);

  // Each type once, in the order the tabs first show it.
  const hosted = new Map<string, DashboardWidget>();
  for (const slot of layout.tabs.flatMap(pitWallTabSlots).filter(isShown)) {
    const widget = findPanelWidget(slot.widget, widgets);
    if (widget && !hosted.has(slot.widget)) hosted.set(slot.widget, widget);
  }

  return {
    layout,
    tabs: layout.tabs,
    tab,
    grid,
    ...(view.phone ? { stack: pitWallStack(grid.slots) } : {}),
    panels: grid.slots.map((slot): ResolvedPitWallPanel => {
      const widget = findPanelWidget(slot.widget, widgets);
      return widget
        ? { slot, status: 'ready', widget }
        : { slot, status: 'missing' };
    }),
    hosted: [...hosted.values()],
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
