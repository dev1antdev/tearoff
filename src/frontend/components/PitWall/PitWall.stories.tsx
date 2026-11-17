import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  PitWallEditSteps,
  pitWallStage,
  type PitWallEditStep,
} from '@irdashies/storybook';
import type {
  BrowserConnection,
  IrSdkBridge,
  PitWallCustomPanel,
} from '@irdashies/types';
import { PitWallBrowserPage } from '../../windows/PitWallBrowserPage';
import { PitWallContent } from '../../windows/PitWallWindow';
import { PitWall } from './PitWall';

/**
 * The stage hands the session to its store, so the page's own session
 * source has nothing to add: it is one that never speaks.
 */
const silentSession = {
  onSessionData: () => () => undefined,
} as unknown as IrSdkBridge;

/** The page's socket, staged as up or as down and staying so. */
const socketThatIs = (connected: boolean): BrowserConnection => ({
  isConnected: () => connected,
  onConnectionChanged: () => () => undefined,
});
const socketUp = socketThatIs(true);
const socketDown = socketThatIs(false);

const inABrowser = () => (
  <div className="h-screen w-screen">
    <PitWallBrowserPage bridge={silentSession} connection={socketUp} />
  </div>
);

const inABrowserReconnecting = () => (
  <div className="h-screen w-screen">
    <PitWallBrowserPage bridge={silentSession} connection={socketDown} />
  </div>
);

/**
 * The window's page with things done to it once it is drawn: the buttons
 * of an edit pressed, a panel taken hold of. Nothing is staged; the page is
 * driven as a hand drives it.
 */
const arranging = (steps: readonly PitWallEditStep[]) => () => (
  <div className="h-screen w-screen">
    <PitWallEditSteps steps={steps}>
      <PitWallContent />
    </PitWallEditSteps>
  </div>
);

/**
 * A page somebody arranged: the Standings of the overlay down the left in
 * place of the tower, Our Car and the tyre wear, Class Rivals, the Race Log
 * and the damage, and a strip four cells wide left free on the right.
 */
const ARRANGED: readonly PitWallCustomPanel[] = [
  { widget: 'standings', x: 0, y: 0, w: 11, h: 16 },
  { widget: 'ourcar', x: 11, y: 0, w: 5, h: 6 },
  { widget: 'wear', x: 16, y: 0, w: 4, h: 6 },
  { widget: 'classrivals', x: 11, y: 6, w: 9, h: 4 },
  { widget: 'racelog', x: 11, y: 10, w: 5, h: 6 },
  { widget: 'damage', x: 16, y: 10, w: 4, h: 6 },
];

/**
 * The Pit Wall as its window shows it: the page with its panels filled by
 * the host. The stories fill the browser, so the viewport is the window:
 * Race and Watching are drawn for 1920 by 1080, Compact for 1180 by 820 and
 * the phone for 390 by 844.
 *
 * Every panel is fed from one staged eight-hour race
 * (`.storybook/pitWallRaceStage.ts`), so the cars, their order, the gaps and
 * the clock are the same in every panel of a page.
 */
const meta: Meta<typeof PitWall> = {
  component: PitWall,
  title: 'widgets/PitWall',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="h-screen w-screen">
      <PitWallContent />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof PitWall>;

/**
 * The Race layout under Le Mans Ultimate, five and a quarter hours into the
 * race with the user back at the wheel: on the left the Timing Tower over
 * the Race Charts; on the right Our Car and the Track Map, Class Rivals
 * across, Crew and Stints with the Race Log, and the Weather Forecast
 * across.
 */
export const Race: Story = { ...pitWallStage({ layout: 'race' }) };

/**
 * The Race layout under iRacing, which gives no forecast: its rows go to
 * Class Rivals and to Crew and Stints with the Race Log, and the panels
 * have no sectors, no virtual energy, no tread and no damage to show.
 */
export const RaceIRacing: Story = {
  ...pitWallStage({ layout: 'race', simulator: 'iracing' }),
};

/**
 * The Watching layout during a team-mate's stint, four and a half hours in:
 * the header names who is at the wheel and says the user is watching, and
 * Our Car leads with the gaps and the pace.
 */
export const Watching: Story = {
  ...pitWallStage({ layout: 'watching', watching: true }),
};

/**
 * The Watching layout under iRacing, without the forecast: the tower and
 * the Race Log share the right side. The user is at the wheel here, since
 * the app has no watching under iRacing yet.
 */
export const WatchingIRacing: Story = {
  ...pitWallStage({ layout: 'watching', simulator: 'iracing' }),
};

/**
 * The Compact layout, made for a tablet of 1180 by 820, on its first tab:
 * the Timing Tower, Our Car, the Weather Forecast and the Race Log.
 */
export const Compact: Story = { ...pitWallStage({ layout: 'compact' }) };

/** Compact under iRacing: Our Car and the Race Log share the right side. */
export const CompactIRacing: Story = {
  ...pitWallStage({ layout: 'compact', simulator: 'iracing' }),
};

/** The Timing tab: the tower alone, wide enough for every column. */
export const CompactTiming: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'timing' }),
};

/** The Strategy tab: Class Rivals over the Stint Timeline. */
export const CompactStrategy: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'strategy' }),
};

/** The Crew tab: Crew and Stints beside Car Laps. */
export const CompactCrew: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'crew' }),
};

/** The Map tab: the Track Map with the whole page. */
export const CompactMap: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'map' }),
};

/** The Charts tab: the Race Charts with the whole page. */
export const CompactCharts: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'charts' }),
};

/** The Log tab: the Race Log with the whole page. */
export const CompactLog: Story = {
  ...pitWallStage({ layout: 'compact', tab: 'log' }),
};

/** The page at 125 %: the header and every panel grow together. */
export const Scaled: Story = {
  ...pitWallStage({ layout: 'compact', scale: 125 }),
};

/** No simulator is running: the header keeps its controls, the page waits. */
export const NoSimulator: Story = { ...pitWallStage({ running: false }) };

/** A simulator is running and is in no session yet. */
export const NoSession: Story = { ...pitWallStage({ inSession: false }) };

/**
 * A profile that has lost three of its widgets: their panels say so and
 * offer the widget's settings page, where saving a setting puts it back.
 */
export const MissingWidgets: Story = {
  ...pitWallStage({
    layout: 'race',
    without: ['ourcar', 'racecharts', 'racelog'],
  }),
};

/**
 * The page alone, as the widget registry hands it out: without a host the
 * panels only name what they hold.
 */
export const WithoutHost: Story = {
  ...pitWallStage({ layout: 'race' }),
  render: () => (
    <div className="h-screen w-screen">
      <PitWall />
    </div>
  ),
};

/**
 * The page as a browser shows it, at the 1180 by 820 of a tablet: the same
 * page as the window, with no gear in the header or on a panel, because a
 * browser has no settings window to open. The layout switch and the tab bar
 * work here and keep their choices in the browser.
 */
export const InABrowser: Story = {
  ...pitWallStage({ layout: 'compact', browser: true }),
  render: inABrowser,
};

/**
 * The page in a browser while its socket is down: it keeps what it last
 * had, every panel as it was, and a mark says it is reconnecting. On a
 * layout of tabs the mark hangs under the tab bar, so it covers neither the
 * tabs nor the layout switch. The mark goes when the socket is back.
 */
export const InABrowserReconnecting: Story = {
  ...pitWallStage({ layout: 'compact', browser: true }),
  render: inABrowserReconnecting,
};

/**
 * The same on the Race layout, which has no tab bar: the mark hangs from
 * the header's lower right corner.
 */
export const InABrowserReconnectingRace: Story = {
  ...pitWallStage({ layout: 'race', browser: true }),
  render: inABrowserReconnecting,
};

/** In a browser, a profile that has lost a widget says so and offers nothing. */
export const InABrowserMissingWidgets: Story = {
  ...pitWallStage({
    layout: 'compact',
    browser: true,
    without: ['ourcar', 'racelog'],
  }),
  render: inABrowser,
};

/**
 * The page on a phone held upright, 390 by 844. A phone is given the tabs
 * whatever layout is chosen (here Race is saved), with the panels of a tab
 * one under another at the page's width. Overview: the tower, and under it,
 * down the page, Our Car, the forecast and the log.
 */
export const OnAPhone: Story = {
  ...pitWallStage({ layout: 'race', browser: true }),
  render: inABrowser,
};

/**
 * A phone whose socket is down: the mark hangs under the tab bar, clear of
 * every tab.
 */
export const OnAPhoneReconnecting: Story = {
  ...pitWallStage({ layout: 'race', browser: true }),
  render: inABrowserReconnecting,
};

/** A phone under iRacing: Overview without the forecast. */
export const OnAPhoneIRacing: Story = {
  ...pitWallStage({ layout: 'race', browser: true, simulator: 'iracing' }),
  render: inABrowser,
};

/** A phone on the Timing tab: the tower has the page, less the columns that do not fit. */
export const OnAPhoneTiming: Story = {
  ...pitWallStage({ layout: 'race', tab: 'timing', browser: true }),
  render: inABrowser,
};

/** A phone on the Strategy tab: Class Rivals scrolls sideways inside its panel. */
export const OnAPhoneStrategy: Story = {
  ...pitWallStage({ layout: 'race', tab: 'strategy', browser: true }),
  render: inABrowser,
};

/** A phone on the Crew tab: Crew and Stints, and Car Laps under it. */
export const OnAPhoneCrew: Story = {
  ...pitWallStage({ layout: 'race', tab: 'crew', browser: true }),
  render: inABrowser,
};

/** A phone on the Map tab. */
export const OnAPhoneMap: Story = {
  ...pitWallStage({ layout: 'race', tab: 'map', browser: true }),
  render: inABrowser,
};

/** A phone on the Charts tab. */
export const OnAPhoneCharts: Story = {
  ...pitWallStage({ layout: 'race', tab: 'charts', browser: true }),
  render: inABrowser,
};

/** A phone on the Log tab. */
export const OnAPhoneLog: Story = {
  ...pitWallStage({ layout: 'race', tab: 'log', browser: true }),
  render: inABrowser,
};

/**
 * The Custom layout as it starts, in a profile that has arranged nothing:
 * the Race layout put on the grid of 24 cells by 16. The header has a
 * fourth layout and, in the window, an Edit layout button.
 */
export const Custom: Story = { ...pitWallStage({ layout: 'custom' }) };

/**
 * A page the user arranged, with widgets of the overlay the fixed layouts
 * do not use and room left free on the right.
 */
export const CustomArranged: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
};

/**
 * The edit begun and nothing touched yet: the bar under the header, the
 * cells of the page behind the panels, and each panel with its name and
 * size in place of its widget, a title bar to move it by, a cross to take
 * it off the page and a corner to size it by.
 */
export const CustomEditing: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([{ press: 'Edit layout' }]),
};

/** The same on the copy of Race, which fills the page: there is no free cell. */
export const CustomEditingTheStart: Story = {
  ...pitWallStage({ layout: 'custom' }),
  render: arranging([{ press: 'Edit layout' }]),
};

/**
 * A panel held over a place it fits: the tyre wear taken four cells to the
 * right, into the free strip. Its cells there are marked green; the panel
 * itself, dimmed, is still where it was until it is let go of.
 */
export const CustomDragFits: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Move Tyre & Brake Wear', across: 4, down: 0 },
  ]),
};

/**
 * A panel held over others: the tyre wear taken left and down, onto Our
 * Car and Class Rivals. The cells are marked red; let go of there, the
 * panel stays where it was.
 */
export const CustomDragOverlaps: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Move Tyre & Brake Wear', across: -2, down: 3 },
  ]),
};

/**
 * A panel held half off the page: only the part of its cells that is on
 * the page can be marked, in red.
 */
export const CustomDragOffThePage: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Move Damage', across: 6, down: 0 },
  ]),
};

/** A panel sized by its corner into free room: Class Rivals, four cells wider. */
export const CustomSizeFits: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Size Class Rivals', across: 4, down: 0 },
  ]),
};

/**
 * A panel sized under the least its widget may have: Our Car at three
 * cells by three, where four by four is the least.
 */
export const CustomSizeTooSmall: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Size Our Car', across: -2, down: -3 },
  ]),
};

/**
 * The Add panel list: what the page can host and does not, the panels of
 * the fixed layouts first and the widgets of the overlay after them, each
 * with the size it is added at.
 */
export const CustomAddPanel: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([{ press: 'Edit layout' }, { press: 'Add panel' }]),
};

/**
 * No room: on the copy of Race, which fills the page, nothing can be added.
 * The list says so for every widget, and the bar says what the one chosen
 * would need.
 */
export const CustomNoRoom: Story = {
  ...pitWallStage({ layout: 'custom' }),
  render: arranging([
    { press: 'Edit layout' },
    { press: 'Add panel' },
    { press: 'Add Standings: no room' },
  ]),
};

/** Reset asks before it brings back the copy of Race. */
export const CustomResetAsking: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED }),
  render: arranging([{ press: 'Edit layout' }, { press: 'Reset' }]),
};

/**
 * A page with a widget the profile lacks and widgets the running sim cannot
 * show: under iRacing the tyre wear and the damage are left out and their
 * cells stay empty, since nothing on this page moves that the user did not
 * move; Our Car says the profile has no such widget.
 */
export const CustomMissingAndUnsupported: Story = {
  ...pitWallStage({
    layout: 'custom',
    custom: ARRANGED,
    simulator: 'iracing',
    without: ['ourcar'],
  }),
};

/**
 * The same page being arranged: the panels iRacing cannot show are there to
 * be moved, with a word of why they are not seen, and the list marks the
 * widgets that are not shown under iRacing.
 */
export const CustomEditingUnsupported: Story = {
  ...pitWallStage({
    layout: 'custom',
    custom: ARRANGED,
    simulator: 'iracing',
    without: ['ourcar'],
  }),
  render: arranging([{ press: 'Edit layout' }, { press: 'Add panel' }]),
};

/**
 * Arranged with no sim running: the page is placed before a race as well
 * as during one.
 */
export const CustomEditingNoSimulator: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED, running: false }),
  render: arranging([{ press: 'Edit layout' }]),
};

/** The arranged page at 125 %: the header and every panel grow together. */
export const CustomScaled: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED, scale: 125 }),
};

/**
 * Arranged with the page at 125 %: the cells are a quarter larger on the
 * screen, and a panel dragged still snaps to them.
 */
export const CustomEditingScaled: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED, scale: 125 }),
  render: arranging([
    { press: 'Edit layout' },
    { hold: 'Move Tyre & Brake Wear', across: 4, down: 0 },
  ]),
};

/** A page the user emptied: it says so, and where to put panels on it. */
export const CustomEmpty: Story = {
  ...pitWallStage({ layout: 'custom', custom: [] }),
};

/**
 * The Custom layout in a browser: the arrangement as the window saved it,
 * with no Edit layout button. A page in a browser changes nothing of a
 * profile.
 */
export const CustomInABrowser: Story = {
  ...pitWallStage({ layout: 'custom', custom: ARRANGED, browser: true }),
  render: inABrowser,
};
