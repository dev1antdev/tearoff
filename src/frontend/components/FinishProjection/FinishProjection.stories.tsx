import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  LMU_CLASS_COLOURS,
  type FinishCar,
  type FinishProjectionConfig,
  type FinishProjectionSnapshot,
  type FinishRival,
  type Session,
  type TrackStateSnapshot,
} from '@irdashies/types';
import { FinishProjection } from './FinishProjection';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 440, height: 230 };

const PLAYER = 0;
const LEADER = 9;

const entry = (
  carIdx: number,
  number: string,
  name: string,
  carClass: keyof typeof LMU_CLASS_COLOURS
) => ({
  CarIdx: carIdx,
  CarNumber: number,
  UserName: name,
  CarClassShortName: carClass,
  CarClassColor: LMU_CLASS_COLOURS[carClass],
});

/** A made-up multi-class grid: only what the widget reads of it. */
const session = (sessionType = 'Race', classes = 3): Session =>
  ({
    WeekendInfo: { NumCarClasses: classes },
    SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: sessionType }] },
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: [
        entry(PLAYER, '77', 'Sam Driver', 'LMGT3'),
        entry(1, '92', 'Mika Christensen', 'LMGT3'),
        entry(2, '46', 'Valentin Rossi', 'LMGT3'),
        entry(3, '27', 'Ian James', 'LMGT3'),
        entry(4, '85', 'Sarah Bovy', 'LMGT3'),
        entry(5, '54', 'Francesco Castellacci', 'LMGT3'),
        entry(6, '31', 'Augusto Farfus', 'LMGT3'),
        entry(LEADER, '8', 'Brendon Hartley', 'Hypercar'),
      ],
    },
  }) as unknown as Session;

const car = (
  carIdx: number,
  paceS: number,
  progress: number,
  lastStopLossS = 0
): FinishCar => ({ carIdx, paceS, progress, lastStopLossS });

const rival = (
  carIdx: number,
  classPosition: number,
  gapS: number,
  values: Partial<FinishRival> = {}
): FinishRival => ({
  carIdx,
  classPosition,
  ahead: gapS < 0,
  gapS,
  lapsLeft: 26.6,
  stopsOwed: 1,
  stopLossS: 40.8,
  basis: 'energy',
  projectedGapS: gapS,
  paceDeltaS: 0,
  inPit: false,
  ...values,
});

/** Fifth of its class, with two class cars either side. */
const RIVALS = [
  rival(2, 4, -3.4, { projectedGapS: 2.2, stopLossS: 46.2, paceDeltaS: -4.1 }),
  rival(1, 3, -14.2, { projectedGapS: -12.7, paceDeltaS: -9.8 }),
  rival(5, 2, -31.9, { projectedGapS: -30.4 }),
  rival(3, 6, 5.1, {
    stopsOwed: 2,
    projectedGapS: 46.6,
    stopLossS: 41.5,
    paceDeltaS: 6.3,
  }),
  rival(4, 7, 11.8, { projectedGapS: 11.2, paceDeltaS: 12.4 }),
  rival(6, 8, 48.3, { projectedGapS: 49.9 }),
];

/** The hoses of the recorded car: energy, and the fuel that goes with it. */
const ENERGY_LINES = [
  { fixedS: 0, perUnitS: 0.4 },
  { fixedS: 2.42, perUnitS: 0.3029 },
];

/**
 * A timed race with three quarters of an hour to run: a Hypercar leading at
 * 91.2 s a lap, the player's LMGT3 at 104.8 s, on virtual energy, with a
 * stop still to make.
 */
const snapshot = (
  values: Partial<FinishProjectionSnapshot> = {}
): FinishProjectionSnapshot => ({
  valid: true,
  reason: null,
  raceType: 'time',
  timeLeftS: 2695,
  lapLimit: null,
  leader: car(LEADER, 91.2, 31.2),
  player: car(PLAYER, 104.8, 27.38),
  lapsToGo: 26.62,
  energy: { isVirtualEnergy: true, perLap: 2.31, aboard: 38.4, capacity: 100 },
  laneLossS: 17.2,
  plannedStandingS: 21.4,
  refuelLines: ENERGY_LINES,
  separateS: 0,
  overlapS: 0,
  playerStopsOwed: 1,
  rivals: RIVALS,
  sessionNum: 0,
  version: 1,
  ...values,
});

const invalid = (
  reason: FinishProjectionSnapshot['reason']
): FinishProjectionSnapshot =>
  snapshot({
    valid: false,
    reason,
    timeLeftS: null,
    leader: null,
    player: null,
    lapsToGo: null,
    energy: null,
    laneLossS: null,
    plannedStandingS: null,
    refuelLines: null,
    playerStopsOwed: null,
    rivals: [],
  });

interface StoryOptions {
  config?: Partial<FinishProjectionConfig>;
  sessionType?: string;
  classes?: number;
  trackState?: Partial<TrackStateSnapshot>;
  size?: { width: number; height: number };
}

const story = (
  finish: FinishProjectionSnapshot | undefined,
  {
    config = {},
    sessionType = 'Race',
    classes = 3,
    trackState = {},
    size = BOX,
  }: StoryOptions = {}
) => {
  const bridge = createMockBridgeWithConfig({ finishorder: config });
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: session(sessionType, classes) });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The widget fills its overlay window, so the story supplies
              one of the default size and the overlay's own type scale. */}
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={size}
          >
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        ...(finish ? { 'finish-projection.snapshot': finish } : {}),
        'track-state.snapshot': { ...trackStateStorySnapshot, ...trackState },
      }),
    ],
  };
};

const meta: Meta<typeof FinishProjection> = {
  component: FinishProjection,
  title: 'widgets/FinishProjection',
};

export default meta;

type Story = StoryObj<typeof FinishProjection>;

/**
 * The default: no stop, four stop lengths, the planned stop and the stop
 * that adds exactly what the finish needs, with two class cars either side.
 * A stop of 50 s or more for the leader moves it within seconds of a line
 * as the clock runs out, and the planned stop does the same to the player.
 */
export const TimedRace: Story = { ...story(snapshot()) };

/**
 * A finish that hangs on a few seconds: the leader takes the flag 2 s after
 * the clock, and the player's last crossing before it is 16 s earlier, so a
 * little slower is one lap fewer. A stop of 30 s is safely inside the lap.
 */
export const NearALine: Story = {
  ...story(
    snapshot({
      timeLeftS: 655,
      leader: car(LEADER, 76.6, 3.42),
      player: car(PLAYER, 86.7, 2.61),
      lapsToGo: 8.39,
      energy: {
        isVirtualEnergy: true,
        perLap: 2.33,
        aboard: 38.7,
        capacity: 100,
      },
      playerStopsOwed: 0,
      rivals: RIVALS.map((entry) => ({
        ...entry,
        lapsLeft: 8.4,
        stopsOwed: 0,
        projectedGapS: entry.gapS,
      })),
    }),
    { config: { leaderStops: 'none' } }
  ),
};

/**
 * The fuel projection still holding a lap the sums have given up: the
 * first column keeps it, in amber with the arrow down, and the stop columns
 * show the lap fewer.
 */
export const HeldLap: Story = {
  ...story(
    snapshot({
      timeLeftS: 2690,
      player: car(PLAYER, 104.8, 27.05),
      lapsToGo: 26.95,
    })
  ),
};

/** Leading the race: there is no leader to wait for, and the flag is the player's. */
export const Leading: Story = {
  ...story(
    snapshot({
      leader: null,
      player: car(PLAYER, 104.8, 27.38),
      lapsToGo: 26.62,
      rivals: RIVALS.filter((entry) => !entry.ahead).map((entry, index) => ({
        ...entry,
        classPosition: index + 2,
      })),
    }),
    { classes: 1 }
  ),
};

/** A race run to a lap count: the leader has no margin on a clock. */
export const LapRace: Story = {
  ...story(
    snapshot({
      raceType: 'laps',
      timeLeftS: null,
      lapLimit: 30,
      leader: car(LEADER, 90, 20.5),
      player: car(PLAYER, 92, 19.9),
      lapsToGo: 10.1,
      energy: {
        isVirtualEnergy: false,
        perLap: 2.9,
        aboard: 21.4,
        capacity: 110,
      },
      refuelLines: [{ fixedS: 2, perUnitS: 0.2941 }],
      playerStopsOwed: 1,
    })
  ),
};

/** A race run to laps and time, with the clock the one that ends it. */
export const LapsAndTime: Story = {
  ...story(
    snapshot({
      raceType: 'lapsAndTime',
      timeLeftS: 700,
      lapLimit: 30,
      leader: car(LEADER, 90, 20.5),
      player: car(PLAYER, 92, 19.9),
      lapsToGo: 9.1,
      energy: {
        isVirtualEnergy: false,
        perLap: 2.9,
        aboard: 21.4,
        capacity: 110,
      },
      refuelLines: [{ fixedS: 2, perUnitS: 0.2941 }],
      playerStopsOwed: 1,
    })
  ),
};

/** A car on fuel, in litres, after both it and the leader have stopped. */
export const FuelCarAfterAStop: Story = {
  ...story(
    snapshot({
      leader: car(LEADER, 91.2, 31.2, 58.6),
      player: car(PLAYER, 104.8, 27.38, 64.3),
      energy: {
        isVirtualEnergy: false,
        perLap: 3.42,
        aboard: 71.8,
        capacity: 110,
      },
      refuelLines: [{ fixedS: 2, perUnitS: 0.2941 }],
      playerStopsOwed: 1,
    }),
    { size: { width: 480, height: 230 } }
  ),
};

/** The same in gallons, with the whole amount needed and no extra row. */
export const FuelCarGallonsTotal: Story = {
  ...story(
    snapshot({
      energy: {
        isVirtualEnergy: false,
        perLap: 3.42,
        aboard: 71.8,
        capacity: 110,
      },
      refuelLines: [{ fixedS: 2, perUnitS: 0.2941 }],
    }),
    {
      config: {
        fuelUnits: 'gal',
        refuelDisplay: 'total',
        showExtraRefuel: false,
      },
      size: { width: 440, height: 214 },
    }
  ),
};

/**
 * Three hours to run: the finish needs more than the car holds, so the stop
 * that would add it all is red, and both cars owe several stops.
 */
export const LongRace: Story = {
  ...story(
    snapshot({
      timeLeftS: 10_895,
      lapsToGo: 104.6,
      playerStopsOwed: 3,
      rivals: [
        rival(2, 4, -3.4, {
          stopsOwed: 3,
          projectedGapS: 12.8,
          lapsLeft: 104.9,
        }),
        rival(1, 3, -14.2, {
          stopsOwed: 2,
          projectedGapS: -55,
          lapsLeft: 105.1,
        }),
        rival(3, 6, 5.1, { stopsOwed: 3, projectedGapS: 7.2, lapsLeft: 104.2 }),
        rival(4, 7, 71.8, {
          stopsOwed: 4,
          projectedGapS: 119.5,
          lapsLeft: 103.9,
        }),
      ],
    })
  ),
};

/** Enough aboard to finish: nothing to add in any column, and no stop owed. */
export const EnoughAboard: Story = {
  ...story(
    snapshot({
      timeLeftS: 890,
      leader: car(LEADER, 91.2, 51.2),
      player: car(PLAYER, 104.8, 44.9),
      lapsToGo: 9.1,
      energy: {
        isVirtualEnergy: true,
        perLap: 2.31,
        aboard: 38.4,
        capacity: 100,
      },
      playerStopsOwed: 0,
      rivals: RIVALS.map((entry) => ({
        ...entry,
        lapsLeft: 9.2,
        stopsOwed: entry.carIdx === 3 ? 1 : 0,
        projectedGapS: entry.carIdx === 3 ? entry.gapS + 41.5 : entry.gapS,
      })),
    })
  ),
};

/**
 * iRacing, or Le Mans Ultimate online: no refuelling rates, so no stop to
 * finish; the rivals' stops come from the stints they have been seen to
 * drive, one is only assumed, and one is in the pit lane.
 */
export const ObservedRivals: Story = {
  ...story(
    snapshot({
      energy: {
        isVirtualEnergy: false,
        perLap: 3.42,
        aboard: 41.6,
        capacity: 110,
      },
      refuelLines: null,
      rivals: [
        rival(2, 4, -3.4, { basis: 'observed', projectedGapS: 2.2 }),
        rival(1, 3, -41.7, {
          basis: 'observed',
          stopsOwed: 0,
          projectedGapS: -82.5,
          inPit: true,
        }),
        rival(3, 6, 5.1, { basis: 'assumed', projectedGapS: 5.1 }),
        rival(4, 7, 11.8, {
          basis: 'observed',
          stopsOwed: 2,
          projectedGapS: 53.3,
        }),
      ],
    })
  ),
};

/** Before the pit lane of the track is known: no planned stop, and a gap that cannot be costed. */
export const PitLaneNotKnown: Story = {
  ...story(
    snapshot({
      laneLossS: null,
      rivals: RIVALS.map((entry) => ({
        ...entry,
        stopLossS: null,
        projectedGapS: null,
      })),
    })
  ),
};

/**
 * Before a lap has been measured: laps to go, and dashes for what to put
 * in, for the stops the player owes and for the gaps they would leave.
 */
export const NoUsageYet: Story = {
  ...story(
    snapshot({
      energy: null,
      playerStopsOwed: null,
      rivals: RIVALS.map((entry) => ({ ...entry, projectedGapS: null })),
    })
  ),
};

/** Alone in the class: the rivals section goes. */
export const NoRivals: Story = {
  ...story(snapshot({ rivals: [] }), { size: { width: 440, height: 140 } }),
};

/** Six stop lengths and the two lap fractions: the most the table holds. */
export const WidestTable: Story = {
  ...story(snapshot({ leader: car(LEADER, 91.2, 31.2, 58.6) }), {
    config: {
      scenarios: [20, 30, 40, 50, 60, 90],
      showLapFractions: true,
      extraLaps: 2,
      showRivals: false,
    },
    size: { width: 520, height: 180 },
  }),
};

/** Only the table: no rivals, no extra row, the leader not stopping. */
export const TableOnly: Story = {
  ...story(snapshot(), {
    config: {
      showRivals: false,
      showExtraRefuel: false,
      showPlanned: false,
      showToFinish: false,
      leaderStops: 'none',
      scenarios: [25, 45],
    },
    size: { width: 300, height: 110 },
  }),
};

/** Three rivals each side, with the pace over the laps left added in. */
export const IncludingPace: Story = {
  ...story(snapshot(), {
    config: { rivalsAhead: 3, rivalsBehind: 3, includePace: true },
    size: { width: 440, height: 270 },
  }),
};

/** A practice session it is set to show in: there is nothing to project. */
export const NotARace: Story = {
  ...story(invalid('notRace'), {
    sessionType: 'Practice',
    config: {
      sessionVisibility: {
        race: true,
        loneQualify: false,
        openQualify: false,
        practice: true,
        offlineTesting: false,
      },
    },
  }),
};

/** On the grid. */
export const BeforeTheStart: Story = { ...story(invalid('notStarted')) };

/** Racing, before the leader or the player has a lap time. */
export const WaitingForALapTime: Story = { ...story(invalid('noPace')) };

/** The flag is out. */
export const Finished: Story = { ...story(invalid('finished')) };

/**
 * A team-mate at the wheel with the camera on the team car: it stays up.
 * The sim does not send the fuel in the tank of a car the user is not in,
 * so there is no stop to finish to cost.
 */
export const TeamMateDriving: Story = {
  ...story(snapshot({ refuelLines: null }), {
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: true,
      focusCarIdx: PLAYER,
    },
  }),
};

/** The camera on a rival: the figures are not that car's, and it hides. */
export const WatchingARival: Story = {
  ...story(snapshot(), {
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: false,
      focusCarIdx: 5,
    },
  }),
};
