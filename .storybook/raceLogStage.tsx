import type { Decorator } from '@storybook/react-vite';
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import {
  CLASS_COLOURS_FASTEST_FIRST,
  RACE_LOG_PAGE_EVENTS,
  RACE_LOG_SNAPSHOT_EVENTS,
  getWidgetManifest,
  pitWallHostedDashboard,
  type ChannelPayloads,
  type DashboardLayout,
  type RaceEvent,
  type RaceHistoryBridge,
  type RaceLogConfig,
  type Session,
} from '@irdashies/types';
import { defaultDashboard } from '../src/app/storage/defaultDashboard';
import {
  DashboardProvider,
  HostedDashboardProvider,
  useDashboard,
  useSessionStore,
} from '../src/frontend/context';
import { PitWallPanel } from '../src/frontend/components/PitWall/components/PitWallPanel/PitWallPanel';
import { HostedWidget } from '../src/frontend/components/WidgetPanelHost/HostedWidget';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import {
  buildStoryGrid,
  LMU_STORY_CARS,
  LMU_STORY_PLAYER,
  lmuEnduranceGrid,
  type StoryGrid,
} from './lmuEnduranceGrid';
import { mockDashboardBridge } from './mockDashboardBridge';
import { PressButtons } from './PressButtons';
import { sessionBarStorySnapshot } from './sessionBarSnapshot';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * A staged race log for the Race Log's stories: the made-up endurance grid
 * four and a half hours into an eight-hour race, with everything that has
 * happened to it since the green flag. Every event is invented: no recorded
 * race has a pit stop, a driver change, a caution or a penalty in it.
 *
 * The log is long enough that the channel carries only its most recent
 * events, as in a real race: the ones before are served a page at a time by
 * a stand-in for the race history's bridge.
 */

/** The same grid as iRacing would class and colour it. */
const IRACING_CLASSES = {
  GTP: { id: 1, color: CLASS_COLOURS_FASTEST_FIRST[0], relSpeed: 5 },
  LMP2: { id: 2, color: CLASS_COLOURS_FASTEST_FIRST[1], relSpeed: 4 },
  GT3: { id: 3, color: CLASS_COLOURS_FASTEST_FIRST[2], relSpeed: 2 },
};
const IRACING_CLASS_OF: Record<string, keyof typeof IRACING_CLASSES> = {
  Hypercar: 'GTP',
  LMP2: 'LMP2',
  LMGT3: 'GT3',
};
const iracingGrid = buildStoryGrid(
  IRACING_CLASSES,
  LMU_STORY_CARS.map((car) => ({
    ...car,
    carClass: IRACING_CLASS_OF[car.carClass],
  })),
  { player: LMU_STORY_PLAYER }
);

/** The moment the log is looked at: session clock, and the clock in the sim. */
const NOW_SESSION = 16_524;
const NOW_CLOCK = 18 * 3600 + 33 * 60 + 20;
/** The green flag, minutes ago. */
const GREEN_MINUTES_AGO = 273;

/** Who shares each car: the driver the grid names, and one more. */
const CO_DRIVERS: Record<string, string> = {
  '8': 'Luca Hartmann',
  '51': 'Niccolo Sartori',
  '6': 'Erik Sandberg',
  '15': 'Antoine Verdier',
  '99': 'Mikkel Rasmussen',
  '311': 'Owen Bradshaw',
  '22': 'Aksel Nyberg',
  '37': 'Diego Salvatierra',
  '28': 'Pawel Zielinski',
  '10': 'Jannik Voss',
  '183': 'Thibault Renard',
  '92': 'Florian Adler',
  '46': 'Paolo Ricci',
  [LMU_STORY_PLAYER]: 'Andrei Petrov',
  '777': 'Haruto Sakai',
  '54': 'Giorgio Marino',
  '27': 'Callum Reid',
  '85': 'Elodie Fournier',
  '61': 'Rohan Iyer',
};

/** Minutes of a stint, and seconds of a stop in the lane, by class. */
const STINT: Record<string, { minutes: number; laneS: number }> = {
  Hypercar: { minutes: 40, laneS: 62.4 },
  LMP2: { minutes: 44, laneS: 66.1 },
  LMGT3: { minutes: 50, laneS: 58.4 },
};

/** An event as it is staged: what happened, and how long ago. */
type Unstamped<Event> = Event extends RaceEvent
  ? Omit<Event, 'seq' | 'sessionTime' | 'timeOfDay'> & { minutesAgo: number }
  : never;
type Staged = Unstamped<RaceEvent>;

export interface RaceLogStage {
  /** iRacing: black flags for penalties, no forecast, its own class colours. */
  iracing?: boolean;
  /** What the log holds: the whole race, nothing yet, or no race at all. */
  log?: 'race' | 'empty' | 'none';
  /** Leave the clock in the sim out of every event, as a sim without one. */
  noClock?: boolean;
}

const stagedEvents = (grid: StoryGrid, iracing: boolean): Staged[] => {
  const slot = grid.slotOf;
  const own = slot(LMU_STORY_PLAYER);
  const classPlace = grid.standings.carIdxClassPosition;
  const events: Staged[] = [];

  // Every car's stops since the green flag: in, out, and every second time
  // another driver.
  LMU_STORY_CARS.forEach((car, carIdx) => {
    // The car in the garage stopped racing two hours ago.
    const until = car.retired ? 125 : 12;
    const { minutes, laneS } = STINT[car.carClass];
    const stops: number[] = [];
    for (
      let ago = GREEN_MINUTES_AGO - minutes - ((carIdx * 1.7) % 6);
      ago > until;
      ago -= minutes + ((carIdx + stops.length) % 3) - 1
    ) {
      // Our own last stop is written out below.
      if (carIdx === own && ago < 60) break;
      stops.push(ago);
    }
    // The two drivers take turns, and the one the grid names is in the car
    // now: counted back from the last change, ours being the one below.
    let changesLeft = Math.floor(stops.length / 2) + (carIdx === own ? 1 : 0);
    stops.forEach((ago, index) => {
      const stop = index + 1;
      const swap = stop % 2 === 0;
      if (swap) changesLeft -= 1;
      const intoTheCar = changesLeft % 2 === 0;
      const lane = laneS + ((carIdx * 7 + stop * 3) % 9) * 0.7 + (swap ? 9 : 0);
      events.push({
        minutesAgo: ago,
        carIdx,
        kind: 'pit-entry',
        classPosition: Math.max(
          1,
          (classPlace[carIdx] ?? 1) + ((stop + carIdx) % 3) - 1
        ),
      });
      events.push({
        minutesAgo: ago - lane / 60,
        carIdx,
        kind: 'pit-exit',
        standingTime: Math.round((lane - 31.2) * 10) / 10,
        laneTime: Math.round(lane * 10) / 10,
        driverFrom: !swap
          ? ''
          : intoTheCar
            ? CO_DRIVERS[car.number]
            : car.driver,
        driverTo: !swap ? '' : intoTheCar ? car.driver : CO_DRIVERS[car.number],
      });
    });
  });

  const flag = (
    minutesAgo: number,
    flagName: 'green' | 'caution' | 'red' | 'chequered',
    after: 'start' | 'caution' | 'red' | null = null,
    durationS: number | null = null
  ): Staged => ({
    minutesAgo,
    carIdx: null,
    kind: 'flag',
    flag: flagName,
    after,
    durationS,
    late: false,
  });
  const fastest = (
    minutesAgo: number,
    car: string,
    lap: number,
    lapTime: number
  ): Staged => ({
    minutesAgo,
    carIdx: slot(car),
    kind: 'fastest-lap',
    lap,
    lapTime,
    driver: LMU_STORY_CARS[slot(car)].driver,
  });

  events.push(
    flag(GREEN_MINUTES_AGO, 'green', 'start'),
    // Each class's fastest lap as its third lap came in, and since.
    fastest(262, '8', 3, 209.812),
    fastest(261.4, '22', 3, 218.204),
    fastest(260.2, '92', 3, 238.44),
    fastest(231, '51', 11, 208.977),
    fastest(204, '37', 18, 217.02),
    fastest(188, '777', 21, 237.44),
    fastest(142, '8', 36, 208.455),
    fastest(96, '46', 44, 236.98),
    fastest(71, '37', 55, 216.59),
    fastest(53, '46', 53, 236.705),
    fastest(31, '51', 68, 208.102),
    // A full-course yellow, six minutes of it.
    flag(51, 'caution'),
    flag(45, 'green', 'caution', 362),
    // Our own car: in from fourth, out with the other driver, and a place
    // gained once the stops had shaken out.
    {
      minutesAgo: 34,
      carIdx: own,
      kind: 'pit-entry',
      classPosition: 4,
    },
    {
      minutesAgo: 33,
      carIdx: own,
      kind: 'pit-exit',
      standingTime: 27.2,
      laneTime: 58.4,
      driverFrom: CO_DRIVERS[LMU_STORY_PLAYER],
      driverTo: LMU_STORY_CARS[own].driver,
    },
    { minutesAgo: 25, carIdx: own, kind: 'position', from: 4, to: 3 },
    { minutesAgo: 168, carIdx: own, kind: 'position', from: 3, to: 4 },
    // A car that went to its garage for a quarter of an hour and came back.
    { minutesAgo: 88, carIdx: slot('311'), kind: 'retired', reason: 'garage' },
    { minutesAgo: 75, carIdx: slot('311'), kind: 'rejoined', awayS: 1085 },
    // One with a driver named late, at no stop anyone saw.
    {
      minutesAgo: 117,
      carIdx: slot('28'),
      kind: 'driver-change',
      driverFrom: CO_DRIVERS['28'],
      driverTo: LMU_STORY_CARS[slot('28')].driver,
    },
    // The newest lines.
    {
      minutesAgo: 6.2,
      carIdx: slot('54'),
      kind: 'drive-through',
      laneTime: 24.3,
    },
    { minutesAgo: 2, carIdx: slot('183'), kind: 'pit-entry', classPosition: 5 }
  );

  if (iracing) {
    const black = (
      minutesAgo: number,
      car: string,
      change: 'given' | 'served'
    ): Staged => ({
      minutesAgo,
      carIdx: slot(car),
      kind: 'penalty',
      change,
      penalty: 'black',
      seconds: null,
      pending: null,
    });
    events.push(
      black(12, '54', 'given'),
      black(5.8, '54', 'served'),
      black(151, '15', 'given'),
      black(146, '15', 'served'),
      // iRacing says nothing of a car that has stopped but that it is gone.
      { minutesAgo: 120, carIdx: slot('61'), kind: 'retired', reason: 'gone' }
    );
  } else {
    const penalty = (
      minutesAgo: number,
      car: string,
      rest: Pick<
        Extract<RaceEvent, { kind: 'penalty' }>,
        'change' | 'penalty' | 'seconds' | 'pending'
      >
    ): Staged => ({ minutesAgo, carIdx: slot(car), kind: 'penalty', ...rest });
    events.push(
      penalty(12, '54', {
        change: 'given',
        penalty: 'DT',
        seconds: null,
        pending: 1,
      }),
      penalty(5.8, '54', {
        change: 'served',
        penalty: '',
        seconds: null,
        pending: 0,
      }),
      penalty(151, '15', {
        change: 'given',
        penalty: 'TIME',
        seconds: 10,
        pending: 1,
      }),
      { minutesAgo: 124, carIdx: slot('61'), kind: 'retired', reason: 'dnf' },
      // Le Mans Ultimate's forecast, changed a quarter of an hour ago.
      {
        minutesAgo: 14,
        carIdx: null,
        kind: 'forecast',
        rain: true,
        inMinutes: 118,
        rainChance: 0.85,
      }
    );
  }
  return events;
};

/** The staged log, oldest first, numbered as the recorder would number it. */
export const raceLogStageEvents = ({
  iracing = false,
  noClock = false,
}: RaceLogStage = {}): RaceEvent[] =>
  stagedEvents(iracing ? iracingGrid : lmuEnduranceGrid, iracing)
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
    .map(({ minutesAgo, ...rest }, index) => ({
      ...rest,
      seq: index + 1,
      sessionTime: Math.round((NOW_SESSION - minutesAgo * 60) * 10) / 10,
      timeOfDay: noClock ? null : Math.round(NOW_CLOCK - minutesAgo * 60),
    })) as RaceEvent[];

/**
 * A stand-in for the race history's bridge that serves the log's earlier
 * pages, as the main process would from memory.
 */
const logBridge = (events: readonly RaceEvent[]): RaceHistoryBridge => ({
  getCarLaps: async () => ({ laps: [], missingLaps: [], revision: 0 }),
  getCarStints: async () => [],
  getDriverChanges: async () => [],
  listRaces: async () => [],
  getEvents: async (_raceId, before) => {
    const earlier =
      before === undefined
        ? events
        : events.filter((event) => event.seq < before);
    return earlier.slice(-RACE_LOG_PAGE_EVENTS);
  },
});

const RaceHistoryBridgeDecorator = (
  events: readonly RaceEvent[]
): Decorator => {
  const bridge = logBridge(events);
  const DecoratorComponent: Decorator = (Story) => {
    const previous = useRef(window.raceHistoryBridge);
    window.raceHistoryBridge = bridge;
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

/** The channels the widget reads, for a stage. */
export const raceLogStageSnapshots = (
  stage: RaceLogStage = {}
): {
  session: Session;
  snapshots: Partial<ChannelPayloads>;
  events: RaceEvent[];
} => {
  const grid = stage.iracing ? iracingGrid : lmuEnduranceGrid;
  const own = grid.slotOf(LMU_STORY_PLAYER);
  const events =
    stage.log === 'empty' || stage.log === 'none'
      ? []
      : raceLogStageEvents(stage);
  return {
    session: grid.session,
    events,
    snapshots: {
      'race-log.snapshot': {
        raceToken: stage.log === 'none' ? '' : 'story:1',
        events: events.slice(-RACE_LOG_SNAPSHOT_EVENTS),
        total: events.length,
        sessionNum: stage.log === 'none' ? null : 0,
        version: 1,
      },
      'session-bar.snapshot': {
        ...sessionBarStorySnapshot,
        playerCarIdx: own,
        sessionTimeOfDay: NOW_CLOCK,
        sessionNum: 0,
        version: 1,
      },
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        focusCarIdx: own,
        sessionTime: NOW_SESSION,
      },
    },
  };
};

// About a second and a half of frames: long enough for a page of earlier
// events to arrive and be drawn.
const END_FRAMES = 90;

/**
 * Keeps the story's list scrolled to its end while it settles, for a story
 * about what is at the end of it: the button for the events before, and
 * the first lines of the race. Then it leaves the list alone.
 */
const ScrolledToTheEnd = ({ children }: { children: ReactNode }) => {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let frames = 0;
    const pin = () => {
      const list = container.current?.querySelector(
        '[data-testid="race-log-list"]'
      );
      if (list) list.scrollTop = list.scrollHeight;
      frames += 1;
      if (frames < END_FRAMES) frame = requestAnimationFrame(pin);
    };
    pin();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={container} className="h-full">
      {children}
    </div>
  );
};

/** The page's margin around a panel: `p-3`. */
const PAGE_MARGIN_PX = 12;

export interface RaceLogStoryOptions {
  stage?: RaceLogStage;
  config?: Partial<RaceLogConfig>;
  /** The box the widget is drawn in; its default overlay size without. */
  size?: { width: number; height: number };
  /**
   * Draw it in a panel of the Pit Wall of this size instead: through the
   * panel host, as the page does, with the overlay's hide rules lifted.
   */
  panel?: { width: number; height: number };
  /** Open the story on the end of the list, where the oldest lines are. */
  atTheEnd?: boolean;
  /** Buttons to press once they are drawn, by their text, in order. */
  press?: readonly string[];
}

const stageDashboard = (config: Partial<RaceLogConfig>): DashboardLayout => ({
  ...defaultDashboard,
  widgets: defaultDashboard.widgets.map((widget) =>
    widget.id === 'racelog'
      ? { ...widget, enabled: true, config: { ...widget.config, ...config } }
      : widget
  ),
});

/** The widget in a panel of the Pit Wall, as the page's host draws it. */
const PanelHost = () => {
  const { currentDashboard } = useDashboard();
  const widget = currentDashboard?.widgets.find(
    (entry) => entry.id === 'racelog'
  );
  if (!widget) return null;
  return (
    <PitWallPanel
      title={getWidgetManifest('racelog')?.name ?? 'Race Log'}
      onOpenSettings={() => undefined}
    >
      <HostedDashboardProvider
        dashboard={pitWallHostedDashboard(
          currentDashboard,
          new Set(['racelog'])
        )}
      >
        <HostedWidget
          widget={widget}
          running
          host="pitwall"
          waitingMessage="Waiting for the simulator."
          scale={100}
          scroll={{ emptyMessage: 'Nothing to show right now.' }}
        />
      </HostedDashboardProvider>
    </PitWallPanel>
  );
};

/**
 * Everything a story of the Race Log needs around it: the staged session,
 * its channels, the race history's bridge and a dashboard with the widget's
 * config. With `panel`, the story draws the widget inside a Pit Wall panel
 * and needs no component of its own.
 */
export const raceLogStory = ({
  stage = {},
  config = {},
  size,
  panel,
  atTheEnd = false,
  press = [],
}: RaceLogStoryOptions = {}) => {
  const { session, snapshots, events } = raceLogStageSnapshots(stage);
  const dashboard = stageDashboard(config);
  const bridge = {
    ...mockDashboardBridge,
    getActiveSimulator: async () =>
      stage.iracing ? ('iracing' as const) : ('lmu' as const),
    dashboardUpdated: (
      callback: Parameters<typeof mockDashboardBridge.dashboardUpdated>[0]
    ) => {
      callback(dashboard, undefined);
      return () => undefined;
    },
  };
  const layout = getWidgetManifest('racelog')?.layout;
  const box = size ?? {
    width: layout?.width ?? 460,
    height: layout?.height ?? 300,
  };
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={bridge}>
        {panel ? (
          // A grid, as the page is: the panel takes the size of its cell,
          // inside the page's own margin.
          <div
            className="grid bg-settings-page p-3"
            style={{
              width: panel.width + PAGE_MARGIN_PX * 2,
              height: panel.height + PAGE_MARGIN_PX * 2,
            }}
          >
            <PanelHost />
          </div>
        ) : (
          // The widget fills its overlay window, so the story supplies one
          // with the overlay's own type scale.
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={box}
          >
            <PressButtons labels={press}>
              {atTheEnd ? (
                <ScrolledToTheEnd>
                  <Story />
                </ScrolledToTheEnd>
              ) : (
                <Story />
              )}
            </PressButtons>
          </div>
        )}
      </DashboardProvider>
    ),
    RaceHistoryBridgeDecorator(events),
    ChannelSnapshotDecorator(snapshots),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session });
      },
    ],
    decorators,
  };
};
