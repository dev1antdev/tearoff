import type { ComponentType } from 'react';
import { Meta, StoryObj } from '@storybook/react-vite';
import { Battle } from './Battle';
import {
  CaptureChannelDecorator,
  ChannelSnapshotDecorator,
  LMU_STORY_CLASSES,
  TelemetryDecorator,
  buildStoryGrid,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
  type StoryGridCar,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  type BattleConfig,
  type CarPitSnapshot,
  type DashboardBridge,
  type LapHistorySnapshot,
  type RelativeGapsSnapshot,
  type Session,
  type StandingsSnapshot,
  type TrackStateSnapshot,
} from '@irdashies/types';

export default {
  component: Battle,
  title: 'widgets/Battle',
} as Meta<typeof Battle>;

type Story = StoryObj<typeof Battle>;

/** A recorded iRacing race: no stops, no energy, no pit state to show. */
export const Primary: Story = {
  render: () => <Battle />,
  decorators: [
    TelemetryDecorator('/test-data/1747384033336'),
    CaptureChannelDecorator('/test-data/1747384033336'),
  ],
};

/**
 * The rest are staged: an LMGT3 fight in a multi-class endurance race under
 * Le Mans Ultimate, built from a list of cars so that each story can put
 * its rivals where it wants them. Every name is invented.
 */

/** The widget's default box. */
const BOX = { width: 600, height: 104 };
/** Seconds of race time one lap of progress stands for, as in the grid. */
const LAP_SECONDS = 212;
const PLAYER = '77';
const PLAYER_PROGRESS = 30.41;

interface RivalPlan {
  number: string;
  driver: string;
  /** Seconds to the player now; ignored when `laps` is given. */
  gap: number;
  /** Whole laps apart, for a rival more than a lap away. */
  laps?: number;
  /** The gap over the line on the last laps, oldest first. */
  lineGaps: number[];
  lastLap: number;
  bestLap: number;
  /** Class place on the grid. */
  gridPlace: number;
  stintLaps: number;
  lapsLeft: number;
  stops: number;
  energy: number;
  usedLastLap: number;
  trackLimits?: number;
  /** Driving down the pit lane: seconds since it turned in. */
  inLaneSeconds?: number;
  /** Back out: seconds the stop took, and still on the lap it left on. */
  outAfterSeconds?: number;
  /** Has asked for a stop: will turn in this lap. */
  requested?: boolean;
  lastLapInvalid?: boolean;
  /** FL, FR, RL, RR compound indices. */
  wheels?: [number, number, number, number];
}

interface Scene {
  ahead?: RivalPlan;
  behind?: RivalPlan;
  /** The camera on this car instead of the player's. */
  watching?: string;
  /** The player's own figures. */
  player?: Partial<RivalPlan>;
  config?: Partial<BattleConfig>;
  trackState?: Partial<TrackStateSnapshot>;
  box?: { width: number; height: number };
}

const AHEAD: RivalPlan = {
  number: '92',
  driver: 'Lukas Brandner',
  gap: 3.42,
  lineGaps: [4.71, 4.32, 3.84, 3.45],
  lastLap: 237.612,
  bestLap: 236.98,
  gridPlace: 1,
  stintLaps: 9,
  lapsLeft: 4.6,
  stops: 2,
  energy: 0.34,
  usedLastLap: 0.0741,
};

const BEHIND: RivalPlan = {
  number: '777',
  driver: 'Kenji Watanabe',
  gap: 6.18,
  lineGaps: [5.02, 5.44, 5.71, 6.1],
  lastLap: 238.019,
  bestLap: 237.44,
  gridPlace: 4,
  stintLaps: 3,
  lapsLeft: 10.2,
  stops: 3,
  energy: 0.76,
  usedLastLap: 0.0745,
};

const PLAYER_PLAN: RivalPlan = {
  number: PLAYER,
  driver: 'Alex Mercer',
  gap: 0,
  lineGaps: [],
  lastLap: 237.288,
  bestLap: 237.288,
  gridPlace: 5,
  stintLaps: 9,
  lapsLeft: 5.3,
  stops: 2,
  energy: 0.39,
  usedLastLap: 0.0736,
};

/** The traffic the fight runs in: faster classes, nobody's rival. */
const OTHER_CLASSES: StoryGridCar[] = [
  {
    number: '8',
    driver: 'Dominik Gessler',
    team: 'Northstar Motorsport',
    carClass: 'Hypercar',
    progress: 34.4,
    lastLap: 209.214,
    bestLap: 208.455,
  },
  {
    number: '51',
    driver: 'Matteo Ferrante',
    team: 'Scuderia Monte Rosso',
    carClass: 'Hypercar',
    progress: 34.37,
    lastLap: 208.102,
    bestLap: 208.102,
  },
  {
    number: '22',
    driver: 'Jonas Lindqvist',
    team: 'United Nordic',
    carClass: 'LMP2',
    progress: 33.1,
    lastLap: 217.338,
    bestLap: 216.904,
  },
];

const story = ({
  ahead,
  behind,
  watching,
  player = {},
  config = {},
  trackState = {},
  box = BOX,
}: Scene = {}) => {
  const own: RivalPlan = { ...PLAYER_PLAN, ...player };
  const plans = [ahead, own, behind].filter(
    (plan): plan is RivalPlan => plan !== undefined
  );
  const progressOf = (plan: RivalPlan): number => {
    if (plan === own) return PLAYER_PROGRESS;
    const side = plan === ahead ? 1 : -1;
    return (
      PLAYER_PROGRESS +
      side *
        (plan.laps !== undefined ? plan.laps + 0.2 : plan.gap / LAP_SECONDS)
    );
  };

  const cars: StoryGridCar[] = [
    ...OTHER_CLASSES,
    ...plans.map((plan) => ({
      number: plan.number,
      driver: plan.driver,
      team: `Team ${plan.number}`,
      carClass: 'LMGT3',
      progress: progressOf(plan),
      lastLap: plan.lastLap,
      bestLap: plan.bestLap,
      lastLapInvalid: plan.lastLapInvalid,
    })),
  ];
  const grid = buildStoryGrid(LMU_STORY_CLASSES, cars, {
    player: PLAYER,
    watching,
  });
  const slots = cars.length;
  const planAt = (slot: number): RivalPlan | undefined =>
    plans.find((plan) => grid.slotOf(plan.number) === slot);
  const perCar = <T,>(value: (plan: RivalPlan | undefined) => T): T[] =>
    Array.from({ length: slots }, (_, slot) => value(planAt(slot)));

  const session = {
    ...grid.session,
    DriverInfo: {
      ...grid.session.DriverInfo,
      DriverTires: [
        { TireIndex: 0, TireCompoundType: 'Medium' },
        { TireIndex: 1, TireCompoundType: 'Hard' },
        { TireIndex: 2, TireCompoundType: 'Wet' },
      ],
    },
    QualifyResultsInfo: {
      Results: plans.map((plan) => ({
        CarIdx: grid.slotOf(plan.number),
        Position: 10 + plan.gridPlace,
        ClassPosition: plan.gridPlace - 1,
      })),
    },
  } as unknown as Session;

  const lap = Math.floor(PLAYER_PROGRESS);
  const standings: StandingsSnapshot = {
    ...grid.standings,
    carIdxOnPitRoad: perCar((plan) => plan?.inLaneSeconds !== undefined),
    carIdxTrackSurface: perCar((plan) =>
      plan?.inLaneSeconds !== undefined ? 2 : 3
    ),
    carIdxWheelCompounds: perCar((plan) => plan?.wheels ?? [0, 0, 0, 0]).flat(),
    carIdxEnergyRemaining: perCar((plan) => plan?.energy ?? 0.6),
    carIdxEnergyIsVirtual: perCar(() => true),
    carIdxTrackLimitsPoints: perCar((plan) => plan?.trackLimits ?? 0),
    trackLimitsPointsMax: 5,
    carIdxPitStops: perCar((plan) => plan?.stops ?? 2),
    carIdxPitState: perCar((plan) =>
      plan?.requested ? 1 : plan?.inLaneSeconds !== undefined ? 2 : 0
    ),
    carIdxInGarage: perCar(() => false),
    lastPitLap: perCar((plan) =>
      plan?.outAfterSeconds !== undefined || plan?.inLaneSeconds !== undefined
        ? lap
        : undefined
    ),
  };

  const carPit: CarPitSnapshot = {
    where: perCar((plan) =>
      plan?.inLaneSeconds !== undefined ? CAR_PIT_IN_LANE : CAR_PIT_ON_TRACK
    ),
    laneTimeS: perCar(
      (plan) => plan?.inLaneSeconds ?? plan?.outAfterSeconds ?? 0
    ),
    standingS: perCar(() => 0),
    stops: perCar((plan) => plan?.stops ?? 2),
    lastPitLap: perCar(() => -1),
    lastStopLap: perCar(() => -1),
    stintLaps: perCar((plan) => plan?.stintLaps ?? 12),
    longestStintLaps: perCar(() => 13),
    usedLastLap: perCar((plan) => plan?.usedLastLap ?? -1),
    usedAverage: perCar((plan) => plan?.usedLastLap ?? -1),
    lapsLeft: perCar((plan) => plan?.lapsLeft ?? -1),
    requested: perCar((plan) => !!plan?.requested),
    counts: {
      onTrack: slots,
      inLane: 0,
      standingInLane: 0,
      requested: 0,
      inGarage: 0,
    },
    sessionNum: 0,
    version: 1,
  };

  // Line crossings: the player's a lap apart, each rival's offset by its gap
  // over the line on that lap. The latest is the lap before the one the
  // cars are on.
  const capacity = 8;
  const history = {
    lap: new Array<number>(slots * capacity).fill(0),
    sessionTime: new Array<number>(slots * capacity).fill(0),
    count: new Array<number>(slots).fill(0),
  };
  const laps = Math.max(
    ahead?.lineGaps.length ?? 0,
    behind?.lineGaps.length ?? 0
  );
  const record = (plan: RivalPlan, offsets: number[]) => {
    const slot = grid.slotOf(plan.number);
    offsets.forEach((offset, index) => {
      const lapsAgo = offsets.length - 1 - index;
      history.lap[slot * capacity + index] = lap - 1 - lapsAgo;
      history.sessionTime[slot * capacity + index] =
        7000 - lapsAgo * LAP_SECONDS + offset;
    });
    history.count[slot] = offsets.length;
  };
  record(own, new Array<number>(laps).fill(0));
  if (ahead)
    record(
      ahead,
      ahead.lineGaps.map((gap) => -gap)
    );
  if (behind) record(behind, behind.lineGaps);
  const lapHistory: LapHistorySnapshot = {
    carCount: slots,
    capacity,
    count: history.count,
    start: new Array<number>(slots).fill(0),
    lap: history.lap,
    sessionTime: history.sessionTime,
    classPosition: new Array<number>(slots * capacity).fill(0),
    flags: new Array<number>(slots * capacity).fill(0),
    sessionNum: 0,
    version: 1,
  };

  const focus = grid.slotOf(watching ?? PLAYER);
  const relativeGaps: RelativeGapsSnapshot = {
    focusCarIdx: focus,
    relativePcts: perCar(() => 0),
    // The relative's live deltas are from the player's car. With the camera
    // on another car the story has none, and the race interval is shown.
    deltas: perCar((plan) =>
      watching !== undefined ||
      plan === undefined ||
      plan === own ||
      plan.laps !== undefined
        ? null
        : plan === ahead
          ? plan.gap
          : -plan.gap
    ),
    sessionNum: 0,
    version: 1,
  };

  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ battle: config }),
    getActiveSimulator: async () => 'lmu',
  };

  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The overlay clips each widget to its own box, as here. */}
          <div style={{ ...box, contain: 'layout style paint' }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'standings.snapshot': standings,
        'car-pit.snapshot': carPit,
        'lap-history.snapshot': lapHistory,
        'relative-gaps.snapshot': relativeGaps,
        'track-state.snapshot': {
          ...trackStateStorySnapshot,
          focusCarIdx: focus,
          ...trackState,
        },
      }),
    ],
  };
};

/**
 * Catching the car ahead and pulling away from the car behind: 3.4 s closing
 * at about 0.4 a lap is about eight laps. The car ahead is deep into its
 * stint, with four laps of energy left.
 */
export const Closing: Story = { ...story({ ahead: AHEAD, behind: BEHIND }) };

/**
 * The other way round: the car ahead is getting away and the car behind,
 * on fresh tyres three laps into its stint, will be there in about five.
 */
export const FallingBack: Story = {
  ...story({
    ahead: { ...AHEAD, gap: 7.9, lineGaps: [6.42, 6.95, 7.31, 7.84] },
    behind: { ...BEHIND, gap: 2.31, lineGaps: [3.91, 3.4, 2.92, 2.44] },
  }),
};

/**
 * The car ahead is in the pit lane, twelve seconds in: its gap is still the
 * race's, and nothing is forecast from a stop. The car behind has asked for
 * one, so its stop count is lit.
 */
export const RivalInThePits: Story = {
  ...story({
    ahead: { ...AHEAD, inLaneSeconds: 12.3, energy: 0.04, lapsLeft: 0.5 },
    behind: { ...BEHIND, requested: true, stintLaps: 12, lapsLeft: 0.8 },
  }),
};

/**
 * The car behind is back out after 41 seconds in the lane, on new tyres
 * with a full budget, and 45 s back where it was six. No trend and no
 * forecast until it has laps behind it again.
 */
export const RivalOnItsOutLap: Story = {
  ...story({
    ahead: AHEAD,
    behind: {
      ...BEHIND,
      gap: 44.6,
      outAfterSeconds: 41.2,
      stintLaps: 0,
      lapsLeft: 13.4,
      stops: 4,
      energy: 0.99,
      wheels: [1, 1, 1, 1],
    },
  }),
};

/**
 * More than a lap either way: the class leader is a lap up the road and the
 * car behind two laps back. Laps, and no trend or forecast: neither is a
 * fight on pace any more.
 */
export const LappedRival: Story = {
  ...story({
    ahead: { ...AHEAD, laps: 1 },
    behind: { ...BEHIND, laps: 2, lastLap: 251.3, lastLapInvalid: true },
  }),
};

/** Leading the class: nobody ahead, and the row stays so the box does not jump. */
export const ClassLeader: Story = {
  ...story({
    behind: { ...BEHIND, gap: 2.31, lineGaps: [3.91, 3.4, 2.92, 2.44] },
    player: { gridPlace: 3 },
  }),
};

/**
 * Two laps after the last stops: a trend from the one change there is, and
 * no forecast yet. Three laps in a row are needed before one is printed.
 */
export const NotEnoughLaps: Story = {
  ...story({
    ahead: { ...AHEAD, lineGaps: [3.84, 3.45], stintLaps: 2, lapsLeft: 11.3 },
    behind: { ...BEHIND, lineGaps: [5.71, 6.1], stintLaps: 2 },
    player: { stintLaps: 2, lapsLeft: 11.6, energy: 0.86 },
  }),
};

/** Every column: the grid change, usage a lap, best lap, speed, track limits. */
export const AllColumns: Story = {
  ...story({
    ahead: { ...AHEAD, trackLimits: 3.5 },
    behind: { ...BEHIND, trackLimits: 0.25, wheels: [0, 0, 1, 1] },
    config: {
      positionChange: { enabled: true },
      energyUse: { enabled: true },
      bestTime: { enabled: true, timeFormat: 'mixed' },
      trackLimits: { enabled: true },
    },
    box: { width: 760, height: 104 },
  }),
};

/** Watching the car ahead: the rivals are its own, and the player is one. */
export const Watching: Story = {
  ...story({
    ahead: AHEAD,
    behind: BEHIND,
    watching: AHEAD.number,
    trackState: { isOnTrack: false, watching: true, outOfCar: true },
  }),
};

/** Without the column labels: one line lower. */
export const WithoutLabels: Story = {
  ...story({
    ahead: AHEAD,
    behind: BEHIND,
    config: { header: { enabled: false } },
    box: { width: 600, height: 90 },
  }),
};
