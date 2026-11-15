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
  type ActiveSimulator,
  type CarPitSnapshot,
  type DashboardBridge,
  type PitLaneModel,
  type PitRejoinRival,
  type PitStopConfig,
  type PitStopParts,
  type PitStopSnapshot,
  type Session,
  type TrackStateSnapshot,
} from '@irdashies/types';
import { PitStop } from './PitStop';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 300, height: 170 };

const PLAYER = 0;

const entry = (
  carIdx: number,
  number: string,
  carClass: keyof typeof LMU_CLASS_COLOURS
) => ({
  CarIdx: carIdx,
  CarNumber: number,
  UserName: `Driver ${number}`,
  CarClassShortName: carClass,
  CarClassColor: LMU_CLASS_COLOURS[carClass],
});

/** A made-up three-class grid: only what the widget reads of it. */
const session = (sessionType = 'Race'): Session =>
  ({
    WeekendInfo: { NumCarClasses: 3 },
    SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: sessionType }] },
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: [
        entry(PLAYER, '77', 'LMGT3'),
        entry(1, '51', 'LMGT3'),
        entry(2, '92', 'LMGT3'),
        entry(3, '46', 'LMGT3'),
        entry(4, '27', 'LMGT3'),
        entry(5, '8', 'Hypercar'),
        entry(6, '22', 'LMP2'),
      ],
    },
  }) as unknown as Session;

const lane = (values: Partial<PitLaneModel> = {}): PitLaneModel => ({
  entryPct: 0.95,
  exitPct: 0.03,
  lengthM: 287.2,
  speedLimitMs: 16.6,
  speedLimitSource: 'measured',
  driveAtLimitS: 17.3,
  driveMeasuredS: 24.1,
  trackTimeS: 6.9,
  ...values,
});

const parts = (values: Partial<PitStopParts> = {}): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
  ...values,
});

const rival = (
  carIdx: number,
  gapS: number,
  values: Partial<PitRejoinRival> = {}
): PitRejoinRival => ({
  carIdx,
  gapS,
  sameClass: true,
  inPit: false,
  ...values,
});

/** Fifth in class with four of the class and two prototypes around. */
const LADDER = [
  rival(1, -6.2),
  rival(5, -1.8, { sameClass: false }),
  rival(2, 5.1),
  rival(6, 11.4, { sameClass: false }),
  rival(3, 19.6),
  rival(4, 44.8),
];

type Estimate = PitStopSnapshot['estimate'];

/** Fuel and energy side by side, as the recorded car's estimate has them. */
const estimate = (values: Partial<Estimate> = {}): Estimate => ({
  source: 'sim',
  standingS: 14.2,
  parts: parts({ fuel: 14.2, energy: 9.6 }),
  optionalRepairS: null,
  samples: 0,
  penalty: null,
  ...values,
});

const pitStop = (values: Partial<PitStopSnapshot> = {}): PitStopSnapshot => ({
  phase: 'planning',
  requested: false,
  lane: lane(),
  estimate: estimate(),
  planned: null,
  timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
  last: null,
  refuel: {
    isVirtualEnergy: true,
    target: 85,
    aboard: 21.4,
    toAdd: 63.6,
    toFinish: 41.3,
    runLaps: 36.5,
    runMinutes: 52.7,
  },
  rejoin: {
    position: 19,
    classPosition: 5,
    ladder: LADDER,
    driveToExitS: 52.4,
    passes: [],
  },
  sessionNum: 0,
  version: 1,
  ...values,
});

const carPit = (
  counts: Partial<CarPitSnapshot['counts']> = {},
  requested: boolean[] = [false]
): CarPitSnapshot => ({
  where: [],
  laneTimeS: [],
  standingS: [],
  stops: [],
  lastPitLap: [],
  lastStopLap: [],
  stintLaps: [],
  longestStintLaps: [],
  usedLastLap: [],
  usedAverage: [],
  lapsLeft: [],
  requested,
  counts: {
    onTrack: 33,
    inLane: 5,
    standingInLane: 2,
    requested: 3,
    inGarage: 0,
    ...counts,
  },
  sessionNum: 0,
  version: 1,
});

interface StoryOptions {
  config?: Partial<PitStopConfig>;
  simulator?: ActiveSimulator;
  sessionType?: string;
  trackState?: Partial<TrackStateSnapshot>;
  pits?: CarPitSnapshot;
}

const story = (
  snapshot: PitStopSnapshot | undefined,
  {
    config = {},
    simulator = 'lmu',
    sessionType = 'Race',
    trackState = {},
    pits = carPit(),
  }: StoryOptions = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ pitstop: config }),
    getActiveSimulator: async () => simulator,
  };
  return {
    // The grid the cars around the rejoin are named from.
    loaders: [
      async () => {
        useSessionStore.setState({ session: session(sessionType) });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The widget fills its overlay window, so the story supplies
              one of the default size and the overlay's own type scale. */}
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={BOX}
          >
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        ...(snapshot ? { 'pit-stop.snapshot': snapshot } : {}),
        'car-pit.snapshot': pits,
        'track-state.snapshot': { ...trackStateStorySnapshot, ...trackState },
      }),
    ],
  };
};

const meta: Meta<typeof PitStop> = {
  component: PitStop,
  title: 'widgets/PitStop',
};

export default meta;

type Story = StoryObj<typeof PitStop>;

/**
 * Out on the circuit in a race, with stops behind it on this track: the
 * loss is made of the sim's estimate and the lane as the player's own stops
 * drove it, so nothing here is marked as reckoned.
 */
export const Planning: Story = { ...story(pitStop()) };

/**
 * The first stint at a track: both lines have been seen but no stop has
 * been timed and the limiter has not been read, so the lane is its length
 * over an assumed 60 km/h and the loss carries a "~".
 */
export const PlanningFirstStop: Story = {
  ...story(
    pitStop({
      lane: lane({
        speedLimitMs: 16.67,
        speedLimitSource: 'assumed',
        driveAtLimitS: 17.2,
        driveMeasuredS: null,
      }),
    })
  ),
};

/** The sim has a stop requested for this car. */
export const Requested: Story = {
  ...story(pitStop({ requested: true }), {
    pits: carPit({}, [true]),
  }),
};

/**
 * A stop with tyres, a body repair and a driver change. Made up from the
 * service times the sim states (12 s for four tyres, 30 s for a repair,
 * 25 s for a driver): how the sim adds them to a total is not in any
 * recording, so the 61 s here is an assumption, drawn red as a long stop.
 */
export const RepairAndDriverChange: Story = {
  ...story(
    pitStop({
      estimate: estimate({
        standingS: 61.4,
        parts: parts({
          fuel: 19.4,
          energy: 14.1,
          tyres: 12,
          damage: 30,
          driverSwap: 25,
        }),
      }),
    })
  ),
};

/** Everything a stop can hold, to see the chips wrap. */
export const EveryPart: Story = {
  ...story(
    pitStop({
      estimate: estimate({
        standingS: 184,
        parts: parts({
          fuel: 19.4,
          energy: 14.1,
          tyres: 12,
          damage: 30,
          driverSwap: 25,
          brakes: 120,
          brakeDucts: 8,
          penalties: 10,
        }),
        penalty: 'SG',
      }),
    }),
    { config: { showOccupancy: false } }
  ),
};

/** A drive-through to serve: one chip, and the loss of a pass with no stop. */
export const DriveThrough: Story = {
  ...story(
    pitStop({
      estimate: estimate({
        standingS: 0,
        parts: parts(),
        penalty: 'DT',
      }),
      refuel: null,
    })
  ),
};

/** A rejoin that turns on a car inside the margin: the position is a "~". */
export const CloseCall: Story = {
  ...story(
    pitStop({
      rejoin: {
        position: 19,
        classPosition: 5,
        ladder: [
          rival(1, -6.2),
          rival(2, 5.1),
          rival(4, 20.3, { inPit: true }),
          rival(3, 32.2),
        ],
        driveToExitS: 52.4,
        passes: [],
      },
    })
  ),
};

/** Nobody close enough behind to get past: the place is kept, in green. */
export const KeepsThePlace: Story = {
  ...story(
    pitStop({
      rejoin: {
        position: 3,
        classPosition: 1,
        ladder: [rival(5, -12.4, { sameClass: false }), rival(1, 58.3)],
        driveToExitS: 52.4,
        passes: [],
      },
    })
  ),
};

/** The position counted over the whole field, which LMU's gaps make rougher. */
export const OverallPosition: Story = {
  ...story(pitStop(), { config: { rejoinScope: 'overall' } }),
};

/** Over the entry line and rolling down the lane: the whole stop still to go. */
export const InTheLane: Story = {
  ...story(
    pitStop({
      phase: 'lane',
      planned: { standingS: 14.2, driveS: 24.1 },
      timer: { enteredAt: 100, stoppedAt: null, standingS: 0, exitedAt: null },
      rejoin: {
        position: 19,
        classPosition: 5,
        ladder: LADDER,
        driveToExitS: 13.1,
        passes: [],
      },
    }),
    { trackState: { sessionTime: 106.4, onPitRoad: true } }
  ),
};

/** At the box with the work half done. */
export const AtTheBox: Story = {
  ...story(
    pitStop({
      phase: 'service',
      planned: { standingS: 14.2, driveS: 24.1 },
      timer: { enteredAt: 100, stoppedAt: 112, standingS: 0, exitedAt: null },
      rejoin: {
        position: 19,
        classPosition: 6,
        ladder: [
          rival(2, -4.9),
          rival(1, -16.2),
          rival(3, 9.6),
          rival(4, 34.8),
        ].sort((a, b) => a.gapS - b.gapS),
        driveToExitS: 8.6,
        passes: [],
      },
    }),
    { trackState: { sessionTime: 119.3, onPitRoad: true } }
  ),
};

/** The stop has run over its plan: the countdown goes on below zero, in red. */
export const Overrun: Story = {
  ...story(
    pitStop({
      phase: 'service',
      planned: { standingS: 14.2, driveS: 24.1 },
      timer: { enteredAt: 100, stoppedAt: 112, standingS: 0, exitedAt: null },
      rejoin: {
        position: 19,
        classPosition: 6,
        ladder: [rival(2, -11.9), rival(3, 2.6), rival(4, 27.8)],
        driveToExitS: 8.6,
        passes: [],
      },
    }),
    { trackState: { sessionTime: 130.1, onPitRoad: true } }
  ),
};

/**
 * In the pit lane without having been seen crossing the entry line: out of
 * the garage, or the widget switched on mid-stop. There is nothing to time
 * from.
 */
export const InTheLaneNoAnchor: Story = {
  ...story(pitStop({ phase: 'lane', rejoin: null }), {
    trackState: { sessionTime: 106.4, onPitRoad: true },
    sessionType: 'Practice',
  }),
};

/** Just out of the pits, the stop within a second of its plan. */
export const Result: Story = {
  ...story(
    pitStop({
      timer: {
        enteredAt: 100,
        stoppedAt: null,
        standingS: 14.6,
        exitedAt: 139.1,
      },
      last: { laneS: 39.1, standingS: 14.6, plannedStandingS: 14.2, lap: 21 },
      refuel: {
        isVirtualEnergy: true,
        target: 85,
        aboard: 84.6,
        toAdd: 0.4,
        toFinish: -22.1,
        runLaps: 36.5,
        runMinutes: 52.7,
      },
      rejoin: {
        position: 22,
        classPosition: 8,
        ladder: [rival(4, -0.6), rival(3, -19.2)].sort(
          (a, b) => a.gapS - b.gapS
        ),
        driveToExitS: 110,
        passes: [],
      },
    }),
    { trackState: { sessionTime: 143 }, config: { showRejoin: false } }
  ),
};

/** The same with the stop four seconds longer than planned, in amber. */
export const ResultOverPlan: Story = {
  ...story(
    pitStop({
      timer: {
        enteredAt: 100,
        stoppedAt: null,
        standingS: 18.4,
        exitedAt: 143,
      },
      last: { laneS: 43, standingS: 18.4, plannedStandingS: 14.2, lap: 21 },
      refuel: null,
      rejoin: null,
    }),
    { trackState: { sessionTime: 146 } }
  ),
};

/** The sim's REST API has not answered: no estimate, no refuel level. */
export const NoEstimate: Story = {
  ...story(
    pitStop({
      estimate: estimate({ source: null, standingS: null, parts: null }),
      refuel: null,
    })
  ),
};

/**
 * A track where no car has been seen crossing the pit lines yet: the loss
 * cannot be worked out, so the stop stands in for it and the widget says
 * why.
 */
export const LaneNotMeasured: Story = {
  ...story(
    pitStop({
      lane: lane({
        entryPct: null,
        exitPct: null,
        lengthM: null,
        speedLimitMs: 16.67,
        speedLimitSource: 'assumed',
        driveAtLimitS: null,
        driveMeasuredS: null,
        trackTimeS: null,
      }),
      rejoin: {
        position: 19,
        classPosition: 5,
        ladder: LADDER,
        driveToExitS: null,
        passes: [],
      },
    })
  ),
};

/** Practice: no race to rejoin, so the refuel and the pit lane are what is left. */
export const Practice: Story = {
  ...story(
    pitStop({
      refuel: {
        isVirtualEnergy: true,
        target: 45,
        aboard: 38.7,
        toAdd: 6.3,
        toFinish: null,
        runLaps: 19.3,
        runMinutes: 27.9,
      },
      estimate: estimate({
        standingS: 4.3,
        parts: parts({ fuel: 4.3, energy: 2.5 }),
      }),
      rejoin: {
        position: 19,
        classPosition: 5,
        ladder: [],
        driveToExitS: 52.4,
        passes: [],
      },
    }),
    { sessionType: 'Practice' }
  ),
};

/** A car on fuel: litres, and a level that falls short of the race. */
export const FuelCar: Story = {
  ...story(
    pitStop({
      estimate: estimate({
        standingS: 18.6,
        parts: parts({ fuel: 18.6, tyres: 12 }),
      }),
      refuel: {
        isVirtualEnergy: false,
        target: 60,
        aboard: 7.4,
        toAdd: 52.6,
        toFinish: 71.9,
        runLaps: 21.4,
        runMinutes: 34.2,
      },
    })
  ),
};

/**
 * iRacing gives no estimate: the standing time is the median of the
 * player's own stops here in this car, marked as learned, and the only
 * parts it names are the two repairs.
 */
export const IRacingLearned: Story = {
  ...story(
    pitStop({
      lane: lane({ speedLimitMs: 20.12, speedLimitSource: 'sim' }),
      estimate: estimate({
        source: 'learned',
        standingS: 33,
        parts: parts({ damage: 12 }),
        optionalRepairS: 20,
        samples: 3,
      }),
      refuel: {
        isVirtualEnergy: false,
        target: null,
        aboard: 12.3,
        toAdd: 45,
        toFinish: 38.4,
        runLaps: 22.9,
        runMinutes: 36.1,
      },
    }),
    { simulator: 'iracing', pits: carPit({}, []) }
  ),
};

/** iRacing before the first stop on a track: a dash for the stop. */
export const IRacingFirstStop: Story = {
  ...story(
    pitStop({
      lane: lane({
        speedLimitMs: 20.12,
        speedLimitSource: 'sim',
        driveAtLimitS: 14.3,
        driveMeasuredS: null,
      }),
      estimate: estimate({
        source: null,
        standingS: null,
        parts: parts(),
        optionalRepairS: 0,
      }),
      refuel: {
        isVirtualEnergy: false,
        target: null,
        aboard: 12.3,
        toAdd: 0,
        toFinish: 38.4,
        runLaps: 4.9,
        runMinutes: 7.7,
      },
    }),
    { simulator: 'iracing', pits: carPit({}, []) }
  ),
};

/**
 * A team-mate at the wheel, watched from the monitor with the camera on the
 * team car: the stop is the team car's and the widget stays up.
 */
export const TeamMateDriving: Story = {
  ...story(pitStop({ requested: true }), {
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: true,
      focusCarIdx: PLAYER,
    },
    pits: carPit({}, [true]),
  }),
};

/** The camera on a rival: the stop is not that car's, and the widget hides. */
export const WatchingARival: Story = {
  ...story(pitStop(), {
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: false,
      focusCarIdx: 5,
    },
  }),
};

/**
 * Out of the car with "show only when on track" off: the last plan, dimmed,
 * so the widget can still be placed.
 */
export const OutOfTheCar: Story = {
  ...story(pitStop({ phase: 'idle' }), {
    config: { showOnlyWhenOnTrack: false },
    trackState: { isOnTrack: false, outOfCar: true },
  }),
};

/** Before the first snapshot has arrived at all. */
export const NoSnapshot: Story = {
  ...story(undefined, { config: { showOnlyWhenOnTrack: false } }),
};

/** Only the loss and the rejoin: the rest switched off. */
export const Compact: Story = {
  ...story(pitStop(), {
    config: {
      showBreakdown: false,
      showRefuel: false,
      showOccupancy: false,
    },
  }),
};
