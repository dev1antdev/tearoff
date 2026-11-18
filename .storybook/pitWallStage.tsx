import type { Decorator } from '@storybook/react-vite';
import { useEffect, useRef, type ComponentType } from 'react';
import type {
  ActiveSimulator,
  DashboardBridge,
  DashboardLayout,
  PitWallCustomPanel,
  PitWallLayoutChoice,
  PitWallTabId,
  RaceHistoryBridge,
} from '@irdashies/types';
import {
  DashboardProvider,
  RunningStateProvider,
  useSessionStore,
} from '../src/frontend/context';
import {
  PIT_WALL_DEVICE_LAYOUT_KEY,
  PIT_WALL_DEVICE_TAB_KEY,
} from '../src/frontend/components/PitWall/PitWallDeviceLayout';
import { defaultDashboard } from '../src/app/storage/defaultDashboard';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import { mockDashboardBridge } from './mockDashboardBridge';
import { pitWallRace } from './pitWallRaceStage';

/**
 * What a Pit Wall story is staged with. The race itself, one for every
 * panel, is `pitWallRaceStage.ts`; this is the page around it: the profile,
 * the layout and tab chosen, the simulator, and where the page is shown.
 */
export interface PitWallStage {
  layout?: PitWallLayoutChoice;
  /**
   * The panels the profile saved for the Custom layout. Left out, the
   * profile has arranged nothing and the layout is shown as it starts.
   */
  custom?: readonly PitWallCustomPanel[];
  /** The tab in front, for a layout made of tabs; the first without. */
  tab?: PitWallTabId;
  /**
   * The sim the page believes is running; null for none detected. Under
   * iRacing the race is staged as iRacing gives one.
   */
  simulator?: ActiveSimulator | null;
  /** False stages the app with no sim running. */
  running?: boolean;
  /** False stages a running sim that is in no session. */
  inSession?: boolean;
  /**
   * A team-mate drives and the user watches. The race is then taken forty
   * minutes earlier, in the stint the user's team-mate drove. Not under
   * iRacing, where the app has no watching yet.
   */
  watching?: boolean;
  /** Widget ids to take out of the profile, to stage a missing widget. */
  without?: readonly string[];
  /** The Pit Wall's own content scale, percent. */
  scale?: number;
  /**
   * Stages the page as a browser has it: a dashboard bridge with no way to
   * open the settings window, as the one over a socket has none.
   */
  browser?: boolean;
}

/** Our car's laps where the user drives, and where a team-mate does. */
const OWN_LAPS = { driving: 162, watching: 141 };

/**
 * A dashboard bridge that keeps what is saved to it, so the header's layout
 * switch and the tab bar work in a story as they do in the app.
 */
const stageBridge = ({
  layout = 'race',
  custom,
  tab,
  simulator = 'lmu',
  without = [],
  scale,
  browser = false,
}: PitWallStage): DashboardBridge => {
  let dashboard: DashboardLayout = {
    ...defaultDashboard,
    widgets: defaultDashboard.widgets
      .filter((widget) => !without.includes(widget.id))
      .map((widget) =>
        widget.id === 'pitwall'
          ? {
              ...widget,
              enabled: true,
              scale,
              config: {
                layout,
                ...(tab ? { tab } : {}),
                ...(custom ? { custom } : {}),
              },
            }
          : widget
      ),
  };
  const listeners = new Set<
    Parameters<DashboardBridge['dashboardUpdated']>[0]
  >();
  return {
    ...mockDashboardBridge,
    getActiveSimulator: async () => simulator,
    ...(browser ? {} : { openWidgetSettings: async () => undefined }),
    resetDashboard: async () => dashboard,
    saveDashboard: (next) => {
      dashboard = next;
      listeners.forEach((listener) => listener(dashboard, undefined));
    },
    dashboardUpdated: (callback) => {
      listeners.add(callback);
      callback(dashboard, undefined);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};

/**
 * Hands the page the race history's bridge for as long as the story is
 * shown, or takes it away where nothing is staged, and puts back what was
 * there. The window has the bridge from its preload and a page in a browser
 * has it over its socket, so a story of either is given one.
 */
const RaceHistoryDecorator = (
  bridge: RaceHistoryBridge | undefined
): Decorator => {
  const DecoratorComponent: Decorator = (Story) => {
    const previous = useRef(window.raceHistoryBridge);
    // Before the first draw: a panel asks for its car's records as it mounts.
    window.raceHistoryBridge = bridge as RaceHistoryBridge;
    useEffect(
      () => () => {
        window.raceHistoryBridge = previous.current;
      },
      []
    );
    return <Story />;
  };
  return DecoratorComponent;
};

/**
 * Everything a Pit Wall story needs around it: the staged session, the
 * channels, the race history, a dashboard with the page's layout chosen,
 * and whether a sim is running. The story itself only renders the page.
 */
export const pitWallStage = (stage: PitWallStage = {}) => {
  const {
    running = true,
    inSession = true,
    watching = false,
    simulator = 'lmu',
  } = stage;
  const bridge = stageBridge(stage);
  const race = pitWallRace({
    ownLaps: watching ? OWN_LAPS.watching : OWN_LAPS.driving,
    watching,
    iracing: simulator === 'iracing',
  });
  const staged = running && inSession;
  const runningState = {
    onRunningState: (callback: (running: boolean) => void) => {
      callback(running);
      return () => undefined;
    },
    onSessionData: () => () => undefined,
    getRunningState: async () => running,
    stop: () => undefined,
  };
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={bridge}>
        <RunningStateProvider bridge={runningState}>
          {/* The Pit Wall window sits in the overlay theme (ThemeManager in
              PitWallWindow), so its panels' text follows the overlay scale.
              The default size, and the palette the classes are written in. */}
          <div className="contents overlay-window overlay-theme-sm overlay-theme-color-default overlay-theme-font-face-lato overlay-theme-font-weight-normal">
            <Story />
          </div>
        </RunningStateProvider>
      </DashboardProvider>
    ),
    ChannelSnapshotDecorator(staged ? race.snapshots : {}),
    RaceHistoryDecorator(staged ? race.historyBridge : undefined),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: staged ? race.session : null });
        // What an earlier story chose in this browser is not this story's.
        localStorage.removeItem(PIT_WALL_DEVICE_LAYOUT_KEY);
        localStorage.removeItem(PIT_WALL_DEVICE_TAB_KEY);
      },
    ],
    decorators,
  };
};
