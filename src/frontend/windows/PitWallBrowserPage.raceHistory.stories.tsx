import { useMemo, type ComponentType } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  RACE_HISTORY_STAGE_FOR_CHARTS,
  RACE_HISTORY_STAGE_OWN_CAR,
  RaceHistoryBridgeDecorator,
  mockDashboardBridge,
  raceHistoryStage,
  raceHistoryStageBridge,
  sessionBarStorySnapshot,
} from '@irdashies/storybook';
import {
  DashboardProvider,
  RunningStateProvider,
  SessionTimingStoreUpdater,
  useDashboard,
  useSessionStore,
} from '@irdashies/context';
import {
  EMPTY_FLAG_STATE,
  getWidgetManifest,
  pitWallHostedDashboard,
  type BrowserConnection,
  type ChannelPayloads,
  type PitWallSlot,
  type RaceHistoryBridge,
} from '@irdashies/types';
import {
  PitWallConnection,
  usePitWallReconnecting,
} from '../components/PitWall/PitWallConnection';
import { PitWallHeader } from '../components/PitWall/components/PitWallHeader/PitWallHeader';
import { PitWallPanel } from '../components/PitWall/components/PitWallPanel/PitWallPanel';
import { usePitWallHeader } from '../components/PitWall/hooks/usePitWallHeader';
import { PanelContent } from '../components/PitWallHost/PitWallHost';
import { ThemeManager } from '../components/ThemeManager/ThemeManager';

/**
 * The Pit Wall page in a browser with the panels that read the race
 * history, which a browser page now reads over its socket.
 *
 * None of the page's three layouts holds these panels yet: a later stage
 * arranges them. So this is not `PitWallBrowserPage` itself but its parts,
 * put together the way the page puts them together: the page's own header
 * as a browser has it, and each widget in the page's own panel through the
 * page's own host. The page itself, with the panels its layouts do hold, is
 * in the Pit Wall's stories.
 *
 * On the staged eight-hour race of `.storybook/raceHistoryStage.ts`: every
 * lap and stint is a staged record, read through a stand-in for the bridge.
 *
 * Three of the five panels that read the history are here: Race Charts,
 * Car Laps, and Crew and Stints, which that one race is staged for. The
 * Stint Timeline and the Race Log are not. That race has no log, and its
 * forecast does not say when the race ends, which the timeline waits for
 * before it draws anything; each has a staged race of its own in its own
 * stories, and putting three races on one page would show nothing true.
 */

/** The eight hours of the staged race, and when it went green. */
const RACE_SECONDS = 8 * 3600;
const GREEN_AT = 200;

const staged = raceHistoryStage(RACE_HISTORY_STAGE_FOR_CHARTS);
const own = staged.slotOf(RACE_HISTORY_STAGE_OWN_CAR);
const standings = staged.snapshots['standings.snapshot'];
const ownClass = staged.session.DriverInfo.Drivers[own]?.CarClassID;

/** What the header reads, about the same moment of the same race. */
const headerSnapshots: Partial<ChannelPayloads> = {
  'session-bar.snapshot': {
    ...sessionBarStorySnapshot,
    sessionName: 'RACE',
    trackDisplayName: staged.session.WeekendInfo.TrackDisplayName,
    playerCarIdx: own,
    playerClassified: true,
    playerOverallPosition: standings?.carIdxPosition[own] ?? 0,
    playerClassPosition: standings?.carIdxClassPosition[own] ?? 0,
    playerClassSize: staged.session.DriverInfo.Drivers.filter(
      (driver) => driver.CarClassID === ownClass
    ).length,
    sessionNum: 0,
    version: 1,
  },
  'session-timing.snapshot': {
    sessionType: 'Race',
    state: 4,
    currentLap: 0,
    totalLaps: 0,
    time: staged.sessionTime,
    timeTotal: RACE_SECONDS,
    timeRemaining: RACE_SECONDS - (staged.sessionTime - GREEN_AT),
    greenFlagTimestamp: GREEN_AT,
    isFixedLapRace: false,
    totalRaceLaps: 0,
    totalRaceTime: 0,
    adjustedRaceTime: 0,
    sessionNum: 0,
    version: 1,
  },
  'flag-state.snapshot': {
    ...EMPTY_FLAG_STATE,
    kind: 'green',
    detail: 'trackClear',
    sessionNum: 0,
    version: 1,
  },
};

/** The panels, as a layout would name them, and where each goes. */
const SLOTS: readonly PitWallSlot[] = [
  { widget: 'racecharts', rows: 5, minWidth: 420 },
  { widget: 'carlaps', rows: 7, minWidth: 420 },
  { widget: 'crew', rows: 12, minWidth: 420 },
];
const HOSTED = new Set<string>(SLOTS.map((slot) => slot.widget));
const AREAS = [
  ...Array.from({ length: 5 }, () => '"racecharts crew"'),
  ...Array.from({ length: 7 }, () => '"carlaps crew"'),
].join(' ');

const nothing = () => undefined;

/**
 * The page's frame around the staged panels: the markup of the Pit Wall
 * page, with these panels in place of a layout's.
 */
const HistoryPage = () => {
  const { currentDashboard } = useDashboard();
  const header = usePitWallHeader();
  const reconnecting = usePitWallReconnecting();
  const hosted = useMemo(
    () => pitWallHostedDashboard(currentDashboard, HOSTED),
    [currentDashboard]
  );
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-settings-page text-white tabular-nums">
      <SessionTimingStoreUpdater enabled />
      {/* No gear: a browser has no settings window to open. */}
      <PitWallHeader
        data={header}
        layout="race"
        onLayoutChange={nothing}
        fullscreen={false}
        onToggleFullscreen={nothing}
        reconnecting={reconnecting}
      />
      <main
        className="grid min-h-0 flex-1 gap-3 p-3"
        style={{
          gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
          gridTemplateRows: 'repeat(12, minmax(0, 1fr))',
          gridTemplateAreas: AREAS,
        }}
      >
        {SLOTS.map((slot) => {
          const widget = currentDashboard?.widgets.find(
            (entry) => entry.id === slot.widget
          );
          return (
            <PitWallPanel
              key={slot.widget}
              title={getWidgetManifest(slot.widget)?.name ?? slot.widget}
              area={slot.widget}
            >
              {widget && (
                <PanelContent
                  widget={widget}
                  slot={slot}
                  running
                  hostedDashboard={hosted}
                />
              )}
            </PitWallPanel>
          );
        })}
      </main>
    </div>
  );
};

/** The page's socket, staged as up or as down and staying so. */
const socketThatIs = (connected: boolean): BrowserConnection => ({
  isConnected: () => connected,
  onConnectionChanged: () => () => undefined,
});

/** A bridge over a socket that answers nothing: every read rejects. */
const rejecting = (): RaceHistoryBridge => {
  const lost = () =>
    Promise.reject(
      new Error('The connection closed before the race history answered')
    );
  return {
    getCarLaps: lost,
    getCarStints: lost,
    getDriverChanges: lost,
    listRaces: lost,
    getEvents: lost,
  };
};

/** A dashboard bridge as a browser page has it: no way into the settings. */
const browserDashboard = {
  ...mockDashboardBridge,
  getActiveSimulator: async () => 'lmu' as const,
};

const runningSimulator = {
  onRunningState: (callback: (running: boolean) => void) => {
    callback(true);
    return () => undefined;
  },
  onSessionData: () => () => undefined,
  getRunningState: async () => true,
  stop: () => undefined,
};

interface PageStage {
  /** What the page's reads of the race history are answered by. */
  bridge: RaceHistoryBridge;
  /** Whether the page's socket is up. */
  connected?: boolean;
}

const page = ({ bridge, connected = true }: PageStage) => {
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={browserDashboard}>
        <RunningStateProvider bridge={runningSimulator}>
          <PitWallConnection connection={socketThatIs(connected)}>
            <ThemeManager>
              <Story />
            </ThemeManager>
          </PitWallConnection>
        </RunningStateProvider>
      </DashboardProvider>
    ),
    RaceHistoryBridgeDecorator(bridge),
    ChannelSnapshotDecorator({ ...staged.snapshots, ...headerSnapshots }),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: staged.session });
      },
    ],
    decorators,
  };
};

const meta: Meta<typeof HistoryPage> = {
  component: HistoryPage,
  title: 'widgets/PitWall/In a browser/Race history',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof HistoryPage>;

/**
 * The reads answered: Race Charts, Car Laps and Crew and Stints show the
 * same race as they do in the app's window, which is what a browser page
 * now gets over its socket. Here the answers are a stand-in's, not a
 * socket's.
 */
export const Answered: Story = {
  ...page({ bridge: raceHistoryStageBridge(staged.records) }),
};

/**
 * Every read rejected, as when the app refuses one or the socket drops
 * before the answer. The panels know a race is being recorded, from the
 * summary, and have no record to show: each goes on saying it is reading
 * until the car's records next change, when it asks again. They do not say
 * that a read failed, which is the panels' own wording and is as it is in
 * the app's window.
 */
export const EveryReadRejected: Story = { ...page({ bridge: rejecting() }) };

/**
 * The socket down after the panels were filled: they keep what they had,
 * and the header says the page is reconnecting.
 */
export const ReconnectingWithWhatItHad: Story = {
  ...page({
    bridge: raceHistoryStageBridge(staged.records),
    connected: false,
  }),
};
