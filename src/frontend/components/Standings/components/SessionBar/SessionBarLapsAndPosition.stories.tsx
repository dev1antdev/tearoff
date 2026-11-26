import { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import { SessionBar } from './SessionBar';
import {
  DashboardProvider,
  SessionTimingStoreUpdater,
  useSessionStore,
} from '@irdashies/context';
import {
  ChannelSnapshotDecorator,
  LMU_STORY_PLAYER,
  lmuEnduranceGrid,
  mockDashboardBridge,
} from '@irdashies/storybook';
import {
  getWidgetDefaultConfig,
  type Session,
  type SessionBarConfig,
  type SessionBarSnapshot,
  type SessionTimingSnapshot,
} from '@irdashies/types';

/**
 * The session bar's laps and position items, on the staged endurance grid:
 * nineteen cars in three classes, the player third of eight LMGT3s and
 * fourteenth overall, having started fifth in class and seventeenth.
 */
const infobarDefaults = getWidgetDefaultConfig('infobar');
const standingsDefaults = getWidgetDefaultConfig('standings');
const player = lmuEnduranceGrid.slotOf(LMU_STORY_PLAYER);

/**
 * The cars in the order of `placeOf`, with the player moved to `place`, or
 * left out when he has no grid result.
 */
const gridOrder = (
  slots: number[],
  placeOf: readonly number[],
  place: number | undefined
): number[] => {
  const others = slots
    .filter((slot) => slot !== player)
    .sort((a, b) => placeOf[a] - placeOf[b]);
  if (place !== undefined) others.splice(place - 1, 0, player);
  return others;
};

/**
 * The session with a grid on it: every other car where it runs now, the
 * player where the story starts him.
 */
const sessionWithGrid = (
  playerGrid: { overall: number; inClass: number } | undefined
): Session => {
  const drivers = lmuEnduranceGrid.session.DriverInfo?.Drivers ?? [];
  const { carIdxPosition, carIdxClassPosition } = lmuEnduranceGrid.standings;
  const playerClass = drivers.find(
    (driver) => driver.CarIdx === player
  )?.CarClassID;
  const overall = gridOrder(
    drivers.map((driver) => driver.CarIdx),
    carIdxPosition,
    playerGrid?.overall
  );
  const classOrder = (classId: number) =>
    gridOrder(
      drivers
        .filter((driver) => driver.CarClassID === classId)
        .map((driver) => driver.CarIdx),
      carIdxClassPosition,
      classId === playerClass ? playerGrid?.inClass : undefined
    );
  return {
    ...lmuEnduranceGrid.session,
    QualifyResultsInfo: {
      Results: overall.map((slot, index) => ({
        CarIdx: slot,
        Position: index + 1,
        ClassPosition: classOrder(
          drivers.find((driver) => driver.CarIdx === slot)?.CarClassID ?? -1
        ).indexOf(slot),
      })),
    },
  } as unknown as Session;
};

const sessionBar: SessionBarSnapshot = {
  sessionName: 'Race',
  displayUnits: 1,
  brakeBiasIsClio: false,
  incidents: 0,
  trackWetness: 1,
  trackLimitsPoints: 1.25,
  trackLimitsPointsMax: 5,
  playerCarIdx: player,
  playerClassified: true,
  playerOverallPosition: lmuEnduranceGrid.standings.carIdxPosition[player],
  playerClassPosition: lmuEnduranceGrid.standings.carIdxClassPosition[player],
  playerClassSize: 8,
  competitorCarIds: [],
  competitorPositions: [],
  lastLapTopSpeed: null,
  sessionBestTopSpeed: null,
  sessionNum: 0,
  version: 1,
};

/** Two hours into a six-hour race on the clock. */
const timedRace: SessionTimingSnapshot = {
  sessionType: 'Race',
  state: 4,
  currentLap: 31,
  totalLaps: 0,
  time: 7200,
  timeTotal: 21600,
  timeRemaining: 14400,
  greenFlagTimestamp: 0,
  isFixedLapRace: false,
  totalRaceLaps: 102.4,
  totalRaceTime: 21600,
  adjustedRaceTime: 0,
  lapsCompleted: 30,
  lapProgress: 0.41,
  projectedLaps: 91.24,
  projectedLapsExact: false,
  extraLaps: 1,
  sessionNum: 0,
  version: 1,
};

const strip: SessionBarConfig = {
  ...infobarDefaults,
  sessionLaps: { enabled: true, format: 'progress', showExtraLaps: true },
  position: { enabled: true },
  classRank: { enabled: true },
  trackLimits: { enabled: true },
  positionChange: { enabled: true, scope: 'class' },
  displayOrder: [
    'sessionLaps',
    'position',
    'classRank',
    'trackLimits',
    'positionChange',
  ],
};

interface StoryOptions {
  timing?: Partial<SessionTimingSnapshot>;
  /** Where the player started; undefined leaves him off the grid list. */
  grid?: { overall: number; inClass: number } | null;
  width?: number;
  /** What the strip reads besides the race's own numbers. */
  sessionBar?: Partial<SessionBarSnapshot>;
}

const story = ({
  timing = {},
  grid = { overall: 17, inClass: 5 },
  width = 430,
  sessionBar: readings = {},
}: StoryOptions = {}) => ({
  loaders: [
    async () => {
      useSessionStore.setState({ session: sessionWithGrid(grid ?? undefined) });
    },
  ],
  decorators: [
    (Story: ComponentType) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <SessionTimingStoreUpdater enabled />
        <div style={{ width }} className="bg-slate-800/80 rounded-sm p-2">
          <Story />
        </div>
      </DashboardProvider>
    ),
    ChannelSnapshotDecorator({
      'standings.snapshot': lmuEnduranceGrid.standings,
      'session-bar.snapshot': { ...sessionBar, ...readings },
      'session-timing.snapshot': { ...timedRace, ...timing },
    }),
  ],
});

export default {
  component: SessionBar,
  title: 'widgets/Standings/components/SessionBar/LapsAndPosition',
} as Meta;

type Story = StoryObj<typeof SessionBar>;

/**
 * The strip an Information Bar makes of the five items: laps done against
 * the player's own distance at the flag (one more lap than the clock alone
 * gives, because the leader still has to finish his), the place overall and
 * in class, the track-limits points and the places gained since the grid.
 */
export const Strip: Story = {
  ...story(),
  args: { settings: strip, standalone: true },
};

/** A race decided by laps: the scheduled distance, whole, and no "about". */
export const LapRace: Story = {
  ...story({
    timing: {
      isFixedLapRace: true,
      totalLaps: 96,
      lapsCompleted: 12,
      lapProgress: 0.4,
      projectedLaps: 95,
      projectedLapsExact: true,
      extraLaps: 0,
      timeRemaining: 604800,
    },
  }),
  args: { settings: strip, standalone: true },
};

/** The last lap of a timed race: the clock is at zero, the item amber. */
export const FinalLap: Story = {
  ...story({
    timing: {
      timeRemaining: 0,
      lapsCompleted: 91,
      lapProgress: 0.63,
      projectedLaps: 91.63,
      extraLaps: 0,
    },
  }),
  args: { settings: strip, standalone: true },
};

/**
 * Past two thirds of the way to a drive-through: the track-limits item warns,
 * in the warning's amber rather than the player's, as the table's cell does.
 */
export const TrackLimitsNearTheCeiling: Story = {
  ...story({ sessionBar: { trackLimitsPoints: 4.5 } }),
  args: { settings: strip, standalone: true },
};

/** The first lap: no pace to project from, so the laps done stand alone. */
export const NoPaceYet: Story = {
  ...story({
    timing: {
      lapsCompleted: 0,
      lapProgress: 0.4,
      projectedLaps: 0,
      extraLaps: 0,
    },
  }),
  args: { settings: strip, standalone: true },
};

/** Started on the class pole and fell to third: two places lost, in red. */
export const PlacesLost: Story = {
  ...story({ grid: { overall: 12, inClass: 1 } }),
  args: { settings: strip, standalone: true },
};

/** Where he started: a dash. */
export const PlacesLevel: Story = {
  ...story({ grid: { overall: 14, inClass: 3 } }),
  args: { settings: strip, standalone: true },
};

/** Measured on the whole grid: seventeenth to fourteenth. */
export const OverallGrid: Story = {
  ...story(),
  args: {
    settings: {
      ...strip,
      positionChange: { enabled: true, scope: 'overall' },
    },
    standalone: true,
  },
};

/** No grid result for the car: the change is not drawn at all. */
export const NoGridResult: Story = {
  ...story({ grid: null }),
  args: { settings: strip, standalone: true },
};

/** The same items in the header bar of the standings, beside its own. */
export const InAHeaderBar: Story = {
  ...story({ width: 620 }),
  args: {
    settings: {
      ...standingsDefaults.headerBar,
      sessionLaps: { enabled: true, format: 'progress' },
      position: { enabled: true },
      positionChange: { enabled: true },
    },
    position: 'header',
  },
};
