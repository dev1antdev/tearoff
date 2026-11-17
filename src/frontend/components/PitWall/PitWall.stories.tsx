import type { Meta, StoryObj } from '@storybook/react-vite';
import { pitWallStage } from '@irdashies/storybook';
import type { BrowserConnection, IrSdkBridge } from '@irdashies/types';
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
