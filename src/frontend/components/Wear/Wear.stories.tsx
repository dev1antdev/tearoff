import type { ComponentType } from 'react';
import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  EMPTY_WEAR,
  type Session,
  type WearSnapshot,
  type WearWheelSnapshot,
} from '@irdashies/types';
import { Wear } from './Wear';

/** A wheel with a clean lap on its tyre and its disc measured this stint. */
const wheel = (over: Partial<WearWheelSnapshot> = {}): WearWheelSnapshot => ({
  treadPct: 97.4,
  treadLapPct: 0.25,
  treadProjectedPct: 0.47,
  treadPerLapPct: 0.49,
  treadRateSource: 'tyre',
  treadLapsLeft: 197,
  treadEndOfStintPct: 89.2,
  compound: 1,
  flat: false,
  brakeMm: 36,
  brakeLifePct: 99.9,
  brakeLapMm: 0.0011,
  brakePerLapMm: 0.0018,
  brakeRateSource: 'stint',
  brakeLapsLeft: 999,
  brakeFailed: false,
  ...over,
});

const snapshot = (
  wheels: WearWheelSnapshot[],
  over: Partial<WearSnapshot> = {}
): WearSnapshot => ({
  available: true,
  wheels,
  paceLapTime: 86.7,
  budgetLapsLeft: 16.6,
  brakeNewMm: [36, 32],
  brakeFailureMm: [30, 30],
  brakeFailureSource: ['class', 'class'],
  brakeStale: false,
  sessionNum: 0,
  version: 1,
  ...over,
});

/**
 * The recorded race as its last frame has it: an LMGT3 on mediums with one
 * clean lap driven, discs of 36 and 32 mm that have barely worn.
 */
const recorded = [
  wheel(),
  wheel({
    treadPct: 97.1,
    treadPerLapPct: 0.53,
    treadProjectedPct: 0.55,
    treadLapsLeft: 181,
    treadEndOfStintPct: 88.3,
    brakeMm: 35.99,
    brakePerLapMm: 0.0026,
  }),
  wheel({
    treadPct: 97,
    treadPerLapPct: 0.5,
    treadProjectedPct: 0.54,
    treadLapsLeft: 193,
    treadEndOfStintPct: 88.6,
    brakeMm: 32,
    brakePerLapMm: 0.0008,
  }),
  wheel({
    treadPct: 96.9,
    treadPerLapPct: 0.48,
    treadProjectedPct: 0.52,
    treadLapsLeft: 201,
    treadEndOfStintPct: 88.8,
    brakeMm: 32,
    brakePerLapMm: 0.001,
  }),
];

/**
 * In the car, in a race under Le Mans Ultimate. Only what the widget reads
 * of a session: its type, and the compounds the glyphs are coloured by.
 */
const lmuSession = {
  WeekendInfo: {},
  SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Race' }] },
  DriverInfo: {
    DriverCarIdx: 0,
    Drivers: [{ CarIdx: 0 }],
    DriverTires: [
      { TireIndex: 0, TireCompoundType: 'Soft' },
      { TireIndex: 1, TireCompoundType: 'Medium' },
      { TireIndex: 2, TireCompoundType: 'Hard' },
      { TireIndex: 3, TireCompoundType: 'Wet' },
    ],
  },
} as unknown as Session;

const story = (
  wear: WearSnapshot,
  config: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 260, height: 250 }
) => {
  const bridge = createMockBridgeWithConfig({ wear: config });
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: lmuSession });
      },
    ],
    decorators: [
      // The widget fills its overlay window, so the story supplies one of
      // the default size and the overlay's own type scale.
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={size}
          >
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'wear.snapshot': wear,
        // The widget hides while the player is not driving.
        'track-state.snapshot': trackStateStorySnapshot,
      }),
    ],
  };
};

const meta: Meta<typeof Wear> = {
  component: Wear,
  title: 'widgets/Wear',
};

export default meta;

type Story = StoryObj<typeof Wear>;

/**
 * Fresh tyres with a lap measured on them: about half a percent a lap, two
 * hundred laps to nothing, and the tread the energy on board will leave.
 * The discs of a GT car barely wear, so their laps left stay off screen.
 */
export const FreshTyres: Story = {
  ...story(snapshot(recorded)),
};

/**
 * A set near its end, counted down to a tread of 10 percent: amber at or
 * under 30, red at or under 15 and for five laps or fewer. The right front
 * will not last the stint.
 */
export const WornNearTheEnd: Story = {
  ...story(
    snapshot(
      [
        wheel({
          treadPct: 21.4,
          treadPerLapPct: 0.62,
          treadLapsLeft: 18,
          treadEndOfStintPct: 13.3,
        }),
        wheel({
          treadPct: 12.9,
          treadPerLapPct: 0.71,
          treadLapsLeft: 4,
          treadEndOfStintPct: 3.7,
        }),
        wheel({
          treadPct: 33.8,
          treadPerLapPct: 0.55,
          treadLapsLeft: 43,
          treadEndOfStintPct: 26.7,
        }),
        wheel({
          treadPct: 28.2,
          treadPerLapPct: 0.58,
          treadLapsLeft: 31,
          treadEndOfStintPct: 20.7,
        }),
      ],
      { budgetLapsLeft: 13 }
    ),
    { tyres: { floorPct: 10 } }
  ),
};

const noRate: Partial<WearWheelSnapshot> = {
  treadLapPct: 0.04,
  treadProjectedPct: null,
  treadPerLapPct: null,
  treadRateSource: null,
  treadLapsLeft: null,
  treadEndOfStintPct: null,
  brakeLapMm: 0.0001,
  brakePerLapMm: null,
  brakeRateSource: null,
  brakeLapsLeft: null,
  brakeLifePct: 100,
};

/**
 * A few corners into the first lap: what is left is read, and how fast it
 * is going is not known yet.
 */
export const NoLapYet: Story = {
  ...story(
    snapshot(
      [
        wheel({ ...noRate, treadPct: 98.4 }),
        wheel({ ...noRate, treadPct: 98.4 }),
        wheel({ ...noRate, treadPct: 98.3, brakeMm: 32 }),
        wheel({ ...noRate, treadPct: 98.3, brakeMm: 32 }),
      ],
      { paceLapTime: null, budgetLapsLeft: null }
    )
  ),
};

/**
 * Gathering laps. The fronts were changed two laps ago and have a clean lap
 * of their own; the rears are a new set with none, forecast in italics from
 * what the lap under way is heading for.
 */
export const GatheringLaps: Story = {
  ...story(
    snapshot([
      wheel({ treadPct: 98.9, treadLapsLeft: 201, treadEndOfStintPct: 90.8 }),
      wheel({
        treadPct: 98.8,
        treadPerLapPct: 0.53,
        treadLapsLeft: 186,
        treadEndOfStintPct: 90,
      }),
      wheel({
        treadPct: 99.7,
        treadPerLapPct: 0.47,
        treadRateSource: 'projected',
        treadLapsLeft: 212,
        treadEndOfStintPct: 91.9,
        brakeMm: 32,
        brakePerLapMm: 0.0008,
      }),
      wheel({
        treadPct: 99.7,
        treadPerLapPct: 0.6,
        treadRateSource: 'projected',
        treadLapsLeft: 166,
        treadEndOfStintPct: 89.7,
        brakeMm: 32,
        brakePerLapMm: 0.001,
      }),
    ])
  ),
};

/** A prototype late in a long race: carbon discs counted down to 25 mm. */
const wornDiscs = [
  wheel({
    brakeMm: 27.82,
    brakeLifePct: 23.5,
    brakePerLapMm: 0.0412,
    brakeLapsLeft: 68,
  }),
  wheel({
    brakeMm: 26.31,
    brakeLifePct: 10.9,
    brakePerLapMm: 0.0447,
    brakeLapsLeft: 29,
  }),
  wheel({
    brakeMm: 28.9,
    brakeLifePct: 55.7,
    brakePerLapMm: 0.0195,
    brakeLapsLeft: 200,
  }),
  wheel({
    brakeMm: 25.08,
    brakeLifePct: 1.1,
    brakePerLapMm: 0.0203,
    brakeLapsLeft: 3,
  }),
];

const prototype: Partial<WearSnapshot> = {
  brakeNewMm: [37, 32],
  brakeFailureMm: [25, 25],
  brakeFailureSource: ['class', 'class'],
  paceLapTime: 212.4,
};

/**
 * Worn brakes: life under 30 percent is amber, under 15 red, and three laps
 * to the failure thickness are red too.
 */
export const WornBrakes: Story = {
  ...story(snapshot(wornDiscs, prototype)),
};

/**
 * The same discs with life as the large figure, minutes beside the laps, and
 * the right rear gone: it reached its failure thickness.
 */
export const BrakeFailed: Story = {
  ...story(
    snapshot(
      [
        ...wornDiscs.slice(0, 3),
        wheel({
          brakeMm: 24.98,
          brakeLifePct: 0,
          brakePerLapMm: 0.0203,
          brakeLapsLeft: 0,
          brakeFailed: true,
        }),
      ],
      prototype
    ),
    { brakes: { primary: 'life', showMinutesLeft: true } },
    { width: 260, height: 290 }
  ),
};

const noDisc: Partial<WearWheelSnapshot> = {
  brakeMm: null,
  brakeLifePct: null,
  brakeLapMm: null,
  brakePerLapMm: null,
  brakeRateSource: null,
  brakeLapsLeft: null,
  brakeFailed: false,
};

/**
 * The sim's REST API gave disc thicknesses and has stopped answering: the
 * brakes show dashes rather than the last reading, and say why. The tyres
 * are read from shared memory and carry on.
 */
export const StaleBrakes: Story = {
  ...story(
    snapshot(
      recorded.map((each) => ({ ...each, ...noDisc })),
      { brakeStale: true }
    )
  ),
};

/**
 * No REST API at all, or a build of the sim without one: the brake section
 * keeps its place with dashes and no forecast.
 */
export const BrakesWithoutRest: Story = {
  ...story(
    snapshot(
      recorded.map((each) => ({ ...each, ...noDisc })),
      { brakeNewMm: [null, null] }
    )
  ),
};

/**
 * A class with no failure thickness on record (LMP3): thickness and wear per
 * lap are shown, life and laps left are not.
 */
export const NoFailureThickness: Story = {
  ...story(
    snapshot(
      recorded.map((each) => ({
        ...each,
        brakeLifePct: null,
        brakeLapsLeft: null,
      })),
      { brakeFailureMm: [null, null], brakeFailureSource: [null, null] }
    )
  ),
};

/** Out of the car: no wheel data, and the widget keeps its shape. */
export const NoData: Story = {
  ...story(EMPTY_WEAR, { showOnlyWhenOnTrack: false }),
};

/** A flat right front, and the wear this lap in place of the average. */
export const FlatTyre: Story = {
  ...story(
    snapshot(
      recorded.map((each, index) =>
        index === 1 ? { ...each, flat: true, treadPct: 96.2 } : each
      )
    ),
    { tyres: { perLapSource: 'thisLap' } }
  ),
};

/** Minutes beside the laps: the small line wraps where it has to. */
export const WithMinutes: Story = {
  ...story(
    snapshot(recorded),
    { tyres: { showMinutesLeft: true } },
    { width: 260, height: 270 }
  ),
};

/** The tyre section alone, at the size it wants. */
export const TyresOnly: Story = {
  ...story(
    snapshot(recorded),
    { brakes: { show: false } },
    { width: 260, height: 130 }
  ),
};

/** The brake section alone. */
export const BrakesOnly: Story = {
  ...story(
    snapshot(wornDiscs, prototype),
    { tyres: { show: false } },
    { width: 260, height: 130 }
  ),
};
