import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import {
  DashboardProvider,
  usePitLaneStore,
  useSessionStore,
} from '@irdashies/context';
import {
  EMPTY_TRAFFIC,
  LMU_CLASS_COLOURS,
  type Session,
  type TrackStateSnapshot,
  type TrafficCar,
  type TrafficConfig,
  type TrafficForecast,
  type TrafficPick,
  type TrafficSnapshot,
} from '@irdashies/types';
import { Traffic } from './Traffic';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 330, height: 184 };

const PLAYER = 0;
const LMP2_LEADER = 1;
const LMP2_SECOND = 2;
const HYPERCAR = 3;
const GT3_RIVAL = 4;
const GT3_SLOWER = 5;
const LMP2_LONG_NAME = 6;
const HYPERCAR_SECOND = 7;

const entry = (
  carIdx: number,
  number: string,
  driver: string,
  carClass: keyof typeof LMU_CLASS_COLOURS
) => ({
  CarIdx: carIdx,
  CarNumber: number,
  UserName: driver,
  TeamName: '',
  CarClassShortName: carClass,
  CarClassColor: LMU_CLASS_COLOURS[carClass],
});

/**
 * A three-class Le Mans Ultimate grid at Laguna Seca, made up. Only what the
 * widget reads: the number, driver and class of each entry, and the track
 * its corner names, length and pit speed limit come from.
 */
const multiClassSession = {
  WeekendInfo: {
    NumCarClasses: 3,
    TrackName: 'WeatherTech Raceway Laguna Seca',
    TrackLength: '3.59 km',
    TrackPitSpeedLimit: '60.00 kph',
    TrackID: 694510461,
  },
  SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Race' }] },
  DriverInfo: {
    DriverCarIdx: PLAYER,
    Drivers: [
      entry(PLAYER, '77', 'Alex Mercer', 'LMGT3'),
      entry(LMP2_LEADER, '22', 'Jonas Lindqvist', 'LMP2'),
      entry(LMP2_SECOND, '31', 'Rafael Monteiro', 'LMP2'),
      entry(HYPERCAR, '8', 'Dominik Gessler', 'Hypercar'),
      entry(GT3_RIVAL, '54', 'Kenji Watanabe', 'LMGT3'),
      entry(GT3_SLOWER, '91', 'Piotr Zielinski', 'LMGT3'),
      entry(
        LMP2_LONG_NAME,
        '183',
        'Matteo Alessandro Ferrante-Villanova di Castelnuovo',
        'LMP2'
      ),
      entry(HYPERCAR_SECOND, '51', 'Lucas Brandt', 'Hypercar'),
    ],
  },
} as unknown as Session;

const practiceSession = {
  ...multiClassSession,
  SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Practice' }] },
} as unknown as Session;

const unknownTrackSession = {
  ...multiClassSession,
  WeekendInfo: {
    ...multiClassSession.WeekendInfo,
    TrackName: 'A Track Nobody Has Mapped',
  },
} as unknown as Session;

const car = (overrides: Partial<TrafficCar>): TrafficCar => ({
  carIdx: LMP2_LEADER,
  relation: 'lapping',
  distanceM: 230,
  gapS: 4.2,
  measured: true,
  closingS: 0.17,
  lapsAhead: 1,
  ...overrides,
});

const pick = (overrides: Partial<TrafficPick>): TrafficPick => ({
  carIdx: LMP2_LEADER,
  gapS: 48.2,
  laps: 4.6,
  thisLap: false,
  ...overrides,
});

const forecast = (
  overrides: Partial<TrafficForecast> = {}
): TrafficForecast => ({
  carIdx: LMP2_LEADER,
  etaS: 18,
  lowS: 14,
  highS: 23,
  steady: true,
  laps: 0.2,
  // 18 s on from 36 % round an 88 s lap: Turn 6.
  meetPct: 0.555,
  meetLowPct: 0.51,
  meetHighPct: 0.6,
  ...overrides,
});

/** The table as it reads through most of a race. */
const table = {
  slowerAhead: pick({ carIdx: GT3_SLOWER, gapS: 6.4, laps: 2.3 }),
  leader: pick({ carIdx: HYPERCAR, gapS: 61.0, laps: 3.1 }),
  fasterBehind: pick({ carIdx: LMP2_LEADER, gapS: 48.2, laps: 4.6 }),
};

const traffic = (overrides: Partial<TrafficSnapshot>): TrafficSnapshot => ({
  ...EMPTY_TRAFFIC,
  ...table,
  lapS: 88,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

interface StoryOptions {
  config?: Partial<TrafficConfig>;
  session?: Session;
  trackState?: Partial<TrackStateSnapshot>;
  /** Where the pit lane is on the lap; null for a track not seen yet. */
  pitLane?: { pitEntryPct: number | null; pitExitPct: number | null };
  box?: { width: number; height: number };
}

const story = (
  snapshot: TrafficSnapshot,
  {
    config = {},
    session = multiClassSession,
    trackState = {},
    // Laguna Seca's, from the bundled track data.
    pitLane = { pitEntryPct: 0.87, pitExitPct: 0.154 },
    box = BOX,
  }: StoryOptions = {}
) => {
  const bridge = createMockBridgeWithConfig({ traffic: config });
  return {
    // The grid the cars are looked up in, and the pit lane of the track.
    loaders: [
      async () => {
        useSessionStore.setState({ session });
        usePitLaneStore.setState(pitLane);
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
        'traffic.snapshot': snapshot,
        'track-state.snapshot': {
          ...trackStateStorySnapshot,
          sessionTime: 1000,
          ...trackState,
        },
      }),
    ],
  };
};

const meta: Meta<typeof Traffic> = {
  component: Traffic,
  title: 'widgets/Traffic',
};

export default meta;

type Story = StoryObj<typeof Traffic>;

/**
 * An LMP2 a lap ahead, 4.2 s behind and gaining fifteen seconds a lap, with
 * the forecast of where it arrives.
 */
export const PrototypeClosing: Story = {
  ...story(
    traffic({
      behind: [car({})],
      forecast: forecast(),
      leader: pick({
        carIdx: LMP2_LEADER,
        gapS: 4.2,
        laps: 0.2,
        thisLap: true,
      }),
      fasterBehind: pick({
        carIdx: LMP2_LEADER,
        gapS: 4.2,
        laps: 0.2,
        thisLap: true,
      }),
    })
  ),
};

/** Three prototypes in a queue, and two more behind them. */
export const QueueOfThree: Story = {
  ...story(
    traffic({
      behind: [
        car({ carIdx: HYPERCAR, gapS: 1.4, closingS: 0.22, distanceM: 80 }),
        car({ carIdx: LMP2_LEADER, gapS: 2.9, closingS: 0.12 }),
        car({
          carIdx: LMP2_LONG_NAME,
          relation: 'fasterClass',
          gapS: 5.1,
          closingS: 0.04,
          lapsAhead: 0,
        }),
      ],
      moreBehind: 2,
      forecast: forecast({
        carIdx: HYPERCAR,
        etaS: 6,
        lowS: 5,
        highS: 8,
        laps: 0.07,
        meetPct: 0.43,
        meetLowPct: 0.41,
        meetHighPct: 0.46,
      }),
    })
  ),
};

/**
 * A prototype that has just come into range: it is listed with its gap, and
 * until its closing has been measured for a few seconds there is no arrow
 * and no forecast.
 */
export const ClosingNoForecastYet: Story = {
  ...story(
    traffic({
      behind: [car({ gapS: 7.6, closingS: null, distanceM: 410 })],
    })
  ),
};

/**
 * A car of the player's own class on the same lap, right behind: racing
 * them for position, not traffic. Muted, tagged, and no blue.
 */
export const RivalNotTraffic: Story = {
  ...story(
    traffic({
      behind: [
        car({
          carIdx: GT3_RIVAL,
          relation: 'position',
          gapS: 0.8,
          closingS: 0.01,
          lapsAhead: 0,
          distanceM: 34,
        }),
      ],
    })
  ),
};

/**
 * A rival right behind and a prototype coming up on both. The forecast is
 * for the prototype, so the line names it.
 */
export const RivalAheadOfPrototype: Story = {
  ...story(
    traffic({
      behind: [
        car({
          carIdx: GT3_RIVAL,
          relation: 'position',
          gapS: 1.1,
          closingS: -0.03,
          lapsAhead: 0,
        }),
        car({ carIdx: LMP2_SECOND, gapS: 3.4, closingS: 0.19 }),
      ],
      forecast: forecast({
        carIdx: LMP2_SECOND,
        etaS: 15,
        lowS: 11,
        highS: 19,
        laps: 0.17,
        meetPct: 0.7,
        meetLowPct: 0.67,
        meetHighPct: 0.74,
      }),
    })
  ),
};

/**
 * The closing rate has swung, or the arrival is further off than it was
 * measured for: a range, and no place.
 */
export const ForecastAsARange: Story = {
  ...story(
    traffic({
      behind: [car({ gapS: 7.0, closingS: 0.25 })],
      forecast: forecast({
        etaS: 28,
        lowS: 14,
        highS: 42,
        steady: false,
        laps: 0.32,
        meetPct: null,
        meetLowPct: null,
        meetHighPct: null,
      }),
    })
  ),
};

/** A prototype closing at 1.3 s a lap: three laps off, and no corner. */
export const ForecastInLaps: Story = {
  ...story(
    traffic({
      behind: [
        car({
          gapS: 4.2,
          closingS: 0.01,
          relation: 'fasterClass',
          lapsAhead: 0,
        }),
      ],
      forecast: forecast({
        etaS: 284,
        lowS: 213,
        highS: 355,
        laps: 3.23,
        meetPct: null,
        meetLowPct: null,
        meetHighPct: null,
      }),
    })
  ),
};

/** The last seconds: the gap in red and the forecast in amber. */
export const Arriving: Story = {
  ...story(
    traffic({
      behind: [car({ gapS: 0.6, closingS: 0.14, distanceM: 28 })],
      forecast: forecast({
        etaS: 4,
        lowS: 3,
        highS: 5,
        laps: 0.05,
        meetPct: 0.28,
        meetLowPct: 0.27,
        meetHighPct: 0.3,
      }),
    })
  ),
};

/** Nobody inside the listing window: the table still says who is coming. */
export const ClearRoad: Story = { ...story(traffic({})) };

/** Corners by number, as the setting asks. */
export const CornersByNumber: Story = {
  ...story(traffic({ behind: [car({})], forecast: forecast() }), {
    config: { cornerLabel: 'number' },
  }),
};

/** A track with no corner list: the forecast says how far round the lap. */
export const UnknownTrack: Story = {
  ...story(traffic({ behind: [car({})], forecast: forecast() }), {
    session: unknownTrackSession,
  }),
};

/** Class names in place of drivers, and the leader's column only. */
export const ClassLabelsOneColumn: Story = {
  ...story(
    traffic({
      behind: [
        car({ carIdx: HYPERCAR, gapS: 2.2, closingS: 0.2 }),
        car({ carIdx: LMP2_SECOND, gapS: 4.9, closingS: 0.11 }),
      ],
      forecast: forecast({ carIdx: HYPERCAR, etaS: 11, lowS: 8, highS: 14 }),
    }),
    {
      config: {
        label: 'class',
        showSlowerAhead: false,
        showFasterBehind: false,
        showClosingRate: false,
      },
    }
  ),
};

/** Before any lap is on record: gaps, and dashes for laps. */
export const NoLapTimeYet: Story = {
  ...story(
    traffic({
      lapS: null,
      behind: [car({ gapS: 3.1, measured: false, closingS: null })],
      slowerAhead: pick({ carIdx: GT3_SLOWER, gapS: 6.4, laps: null }),
      leader: pick({ carIdx: HYPERCAR, gapS: 61, laps: null }),
      fasterBehind: null,
    })
  ),
};

/** Nothing from the sim yet: the shape stays, to be placed in edit mode. */
export const NoData: Story = { ...story(EMPTY_TRAFFIC) };

const inLane = {
  onPitRoad: true,
  // 180 m short of the exit line, rolling at the limit.
  lapDistPct: 0.104,
  speed: 16.7,
};

/**
 * In the pit lane, 11 s from the exit line: one car goes by before the
 * player gets there, one arrives 1.4 s after. Amber.
 */
export const PitExit: Story = {
  ...story(
    traffic({
      inPitLane: true,
      arriving: [
        { carIdx: GT3_RIVAL, gapS: 4.2, speedMs: 62 },
        { carIdx: LMP2_LEADER, gapS: 9.6, speedMs: 68 },
        { carIdx: HYPERCAR, gapS: 15.8, speedMs: 71 },
        { carIdx: LMP2_SECOND, gapS: 41, speedMs: 66 },
      ],
      nearestBehind: { carIdx: GT3_RIVAL, gapS: 4.2 },
    }),
    { trackState: inLane }
  ),
};

/** A car arriving half a second after the player reaches the line. Red. */
export const PitExitDanger: Story = {
  ...story(
    traffic({
      inPitLane: true,
      arriving: [
        { carIdx: HYPERCAR, gapS: 8.8, speedMs: 71 },
        { carIdx: LMP2_SECOND, gapS: 12, speedMs: 66 },
      ],
    }),
    { trackState: inLane }
  ),
};

/** Nobody within the window either side. Green. */
export const PitExitClear: Story = {
  ...story(
    traffic({
      inPitLane: true,
      arriving: [{ carIdx: LMP2_SECOND, gapS: 44, speedMs: 66 }],
    }),
    { trackState: inLane }
  ),
};

/**
 * A track whose pit exit has not been seen yet: the cars behind by how far
 * back they are now, and a note saying so.
 */
export const PitExitNotMeasured: Story = {
  ...story(
    traffic({
      inPitLane: true,
      arriving: [
        { carIdx: GT3_RIVAL, gapS: 6.2, speedMs: 62 },
        { carIdx: LMP2_LEADER, gapS: 11.6, speedMs: 68 },
      ],
    }),
    {
      trackState: inLane,
      pitLane: { pitEntryPct: null, pitExitPct: null },
    }
  ),
};

/** Four seconds out of the pit lane: the block stays, on the gaps behind. */
export const JustLeftThePits: Story = {
  ...story(
    traffic({
      exitedAt: 996,
      arriving: [
        { carIdx: LMP2_LEADER, gapS: 1.6, speedMs: 68 },
        { carIdx: HYPERCAR, gapS: 7.4, speedMs: 71 },
      ],
    })
  ),
};

/** Slow on the track after a spin, with a car 0.7 s away. */
export const RejoinAfterASpin: Story = {
  ...story(
    traffic({
      slowAt: 999,
      arriving: [
        { carIdx: GT3_RIVAL, gapS: 0.7, speedMs: 55 },
        { carIdx: LMP2_LEADER, gapS: 3.2, speedMs: 68 },
      ],
    })
  ),
};

/**
 * Practice, with the setting that shows the cars behind outside a race:
 * a car on a quicker lap counts as traffic there.
 */
export const PracticeClosingCar: Story = {
  ...story(
    traffic({
      behind: [
        car({
          carIdx: GT3_RIVAL,
          relation: 'closing',
          gapS: 2.6,
          closingS: 0.09,
          lapsAhead: 0,
        }),
      ],
      forecast: forecast({
        carIdx: GT3_RIVAL,
        etaS: 29,
        lowS: 20,
        highS: 40,
        steady: false,
        meetPct: null,
        meetLowPct: null,
        meetHighPct: null,
      }),
      slowerAhead: null,
      leader: null,
      fasterBehind: null,
    }),
    { session: practiceSession, config: { showOutsideRace: true } }
  ),
};

/** A narrow box: names give way before the figures do. */
export const NarrowBox: Story = {
  ...story(
    traffic({
      behind: [
        car({ carIdx: LMP2_LONG_NAME, gapS: 1.9, closingS: 0.21 }),
        car({
          carIdx: HYPERCAR_SECOND,
          gapS: 6.4,
          closingS: 0.03,
          relation: 'fasterClass',
          lapsAhead: 0,
        }),
      ],
      forecast: forecast({ carIdx: LMP2_LONG_NAME }),
    }),
    { box: { width: 250, height: 170 } }
  ),
};
