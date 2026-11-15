import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import {
  LEDGER_LAP_VOIDED,
  type StintHistoryConfig,
  type TrackStateSnapshot,
} from '@irdashies/types';
import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
  type SampleLedger,
  type SampleStint,
} from '@irdashies/domain/ledger/ledgerSample';
import { StintHistory } from './StintHistory';

/** The widget's default size: the stint under way and three finished ones. */
const DEFAULT_SIZE = { width: 380, height: 120 };

/**
 * The widget as an overlay window has it, fed the two ledger channels. No
 * sample leaves the channels silent, as before the sim is running.
 */
const story = (
  sample: SampleLedger | null,
  config: Partial<StintHistoryConfig> = {},
  size = DEFAULT_SIZE,
  trackState?: TrackStateSnapshot
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      stinthistory: config,
    }),
    ChannelSnapshotDecorator({
      ...(sample
        ? {
            'player-ledger.snapshot': sample.ledger,
            'player-stint.snapshot': sample.live,
          }
        : {}),
      ...(trackState ? { 'track-state.snapshot': trackState } : {}),
    }),
    // The widget fills its overlay window, so the story supplies one.
    (Story: React.ComponentType) => (
      <div style={size}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof StintHistory> = {
  component: StintHistory,
  title: 'widgets/StintHistory',
};

export default meta;

type Story = StoryObj<typeof StintHistory>;

/** An endurance race two stops in, in a car that runs on virtual energy. */
const race = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

/**
 * Several stints with their stops, as a saved dashboard draws them: the
 * stint under way first, then the last three. The second stop took fuel
 * only; the others changed all four tyres as well. The best lap of the race
 * so far is the current stint's, in purple.
 */
export const EnergyCar: Story = { ...story(race) };

/**
 * The first stint of a race, a few laps in: one row, with nothing finished
 * under it yet.
 */
export const OneOpenStint: Story = {
  ...story(sampleLedger({ stints: [{ laps: 2 }] })),
};

/** The same race in a car that runs on fuel, counted in litres. */
export const FuelCar: Story = {
  ...story(sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS, budget: 'fuel' })),
};

/** A fuel car in gallons, with what a lap used under each total. */
export const FuelCarGallonsPerLap: Story = {
  ...story(
    sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS, budget: 'fuel' }),
    { fuelUnits: 'gal', showFuelPerLap: true },
    { width: 380, height: 170 }
  ),
};

const changeable: readonly SampleStint[] = [
  {
    laps: 9,
    closedBy: 'service',
    stop: { fuelAdded: 22, energyAdded: 0.2, tyresChanged: 0b0011 },
  },
  {
    laps: 7,
    compounds: ['Wet', 'Wet', 'Medium', 'Medium'],
    closedBy: 'service',
    stop: { fuelAdded: 18, energyAdded: 0.16, tyresChanged: 0b1100 },
  },
  {
    laps: 8,
    compounds: ['Wet', 'Wet', 'Wet', 'Wet'],
    closedBy: 'service',
    stop: { fuelAdded: 20, energyAdded: 0.18, tyresChanged: 0b1111 },
  },
  { laps: 3, compounds: ['Hard', 'Hard', 'Soft', 'Soft'] },
];

/**
 * A mixed set of tyres draws as four dots laid out as the car: wet fronts
 * on medium rears as the rain came, and hard fronts on soft rears now.
 */
export const MixedCompounds: Story = {
  ...story(sampleLedger({ stints: changeable })),
};

const everyColumn: Partial<StintHistoryConfig> = {
  showFuelPerLap: true,
  showBrakes: true,
  showConsistency: true,
  showDriver: true,
};

/**
 * Every column on: the driver, the use per lap, the brake discs and the
 * consistency. It wants a wider and taller window than the default.
 */
export const EveryColumn: Story = {
  ...story(race, everyColumn, { width: 520, height: 180 }),
};

/**
 * The ways a stint ends other than at a stop for fuel or tyres: back in the
 * garage, with its session, and with a stop that changed the driver and the
 * brake discs.
 */
export const HowStintsEnd: Story = {
  ...story(
    sampleLedger({
      stints: [
        { laps: 6, closedBy: 'garage' },
        {
          laps: 14,
          closedBy: 'service',
          stop: {
            pitLaneTime: 71.3,
            fuelAdded: 41,
            energyAdded: 0.34,
            tyresChanged: 0b1111,
            brakesChanged: true,
            driverChanged: true,
          },
        },
        { laps: 9, closedBy: 'session' },
        { laps: 2 },
      ],
    })
  ),
};

/**
 * Long stints on soft tyres: the wear is amber once a tyre has lost more
 * than 30 points, and red above 50.
 */
export const HardOnTyres: Story = {
  ...story(
    sampleLedger({
      stints: [
        {
          laps: 26,
          closedBy: 'service',
          stop: { fuelAdded: 50, energyAdded: 0.6, tyresChanged: 0b1111 },
        },
        {
          laps: 17,
          closedBy: 'service',
          stop: { fuelAdded: 40, energyAdded: 0.4, tyresChanged: 0b1111 },
        },
        { laps: 6 },
      ],
      treadPerLap: 0.019,
      energyPerLap: 0.021,
      fuelPerLap: 1.9,
    }),
    { wearMode: 'highest' }
  ),
};

/**
 * iRacing: no virtual energy, tread read only in the pits and no brake
 * discs. The wear cell keeps its place with a dash.
 */
export const NoLiveWear: Story = {
  ...story(
    sampleLedger({
      stints: ENDURANCE_SAMPLE_STINTS,
      budget: 'fuel',
      treadPerLap: null,
      brakePerLap: null,
    }),
    { showBrakes: true },
    { width: 420, height: 120 }
  ),
};

/** Oldest first, with five finished stints asked for. */
export const OldestFirst: Story = {
  ...story(
    race,
    { newestFirst: false, historyCount: 5 },
    { width: 380, height: 120 }
  ),
};

/** A stint whose laps were all voided has no best lap to show. */
export const NoCleanLap: Story = {
  ...story(
    sampleLedger({
      stints: [
        {
          laps: 3,
          flags: { 2: LEDGER_LAP_VOIDED, 3: LEDGER_LAP_VOIDED },
          closedBy: 'garage',
        },
        { laps: 1 },
      ],
    })
  ),
};

/**
 * Before the sim is running, and out of any session: the header alone, so
 * the widget can still be placed.
 */
export const NoData: Story = { ...story(null) };

/**
 * A team-mate has the car. The widget stays up with the stints the user
 * drove, says whose they are, and has no row for the stint under way: none
 * of what it shows is growing.
 */
export const TeamMateDriving: Story = {
  ...story(
    {
      // The user's fourth stint ended at the stop where they got out.
      ledger: {
        ...race.ledger,
        stints: race.live.stint
          ? [
              {
                ...race.live.stint,
                closedBy: 'service',
                stop: {
                  pitLaneTime: 63.9,
                  stationaryTime: 48.2,
                  fuelAdded: 38,
                  energyAdded: 0.33,
                  tyresChanged: 0b1111,
                  brakesChanged: false,
                  driverChanged: true,
                  simEstimate: null,
                },
              },
              ...race.ledger.stints,
            ]
          : race.ledger.stints,
      },
      // The fifth is under way, and is not the user's.
      live: {
        ...race.live,
        stint: race.live.stint && {
          ...race.live.stint,
          id: 'sample:2:5',
          ordinal: 5,
          driver: 'Jamie Taylor',
          own: false,
          laps: 7,
        },
      },
    },
    {},
    DEFAULT_SIZE,
    {
      ...trackStateStorySnapshot,
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: true,
    }
  ),
};
