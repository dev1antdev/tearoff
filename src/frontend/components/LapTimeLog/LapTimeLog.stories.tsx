import type { Meta, StoryObj } from '@storybook/react-vite';
import { LapTimeLogDisplay } from './LapTimeLog';
import type { LapTimeLogConfig } from '@irdashies/types';
import { TelemetryDecorator } from '@irdashies/storybook';
import { isCleanLap } from '@irdashies/shared';
import {
  lapEntries,
  liveLapEntry,
  shownLapTime,
} from '@irdashies/domain/ledger';
import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
  type SampleLedgerOptions,
} from '@irdashies/domain/ledger/ledgerSample';
import type { LapEntry } from './demoData';

const meta: Meta<typeof LapTimeLogDisplay> = {
  title: 'widgets/LapTimeLog',
  component: LapTimeLogDisplay,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    TelemetryDecorator(),
    // The widget's default width, unless a story asks for another.
    (Story, context) => (
      <div style={{ width: `${context.parameters.widgetWidth ?? 250}px` }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof LapTimeLogDisplay>;

// --- Mocks ---
const mockConfig = (
  overrides: Partial<LapTimeLogConfig> = {}
): LapTimeLogConfig => {
  const baseConfig: LapTimeLogConfig = {
    background: { opacity: 80 },
    foreground: { opacity: 70 },
    scale: 100,
    alignment: 'top',
    reverse: false,
    showCurrentLap: true,
    showPredictedLap: true,
    showLastLap: true,
    showBestLap: true,
    showAllTimeLap: false,
    delta: {
      enabled: true,
      method: 'bestlap',
    },
    history: {
      enabled: true,
      count: 5,
    },
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
    showOnlyWhenOnTrack: true,
  };

  return {
    ...baseConfig,
    ...overrides,
    // Deep merge for nested objects
    delta: { ...baseConfig.delta, ...overrides.delta },
    history: { ...baseConfig.history, ...overrides.history },
  };
};

const baseHistory: LapEntry[] = [
  { lap: 10, time: 92.1, delta: 0.6 },
  { lap: 9, time: 91.5, delta: 0.0 },
  { lap: 8, time: 91.8, delta: 0.3 },
  { lap: 7, time: 92.5, delta: 1.0 },
  { lap: 6, time: 91.9, delta: 0.4 },
];

const baseArgs = {
  current: 88.123,
  lastlap: 92.1,
  bestlap: 91.5,
  alltimelap: 91.3,
  reference: 91.5,
  delta: 0.2,
  overall: 91.0,
  history: baseHistory,
};

// --- Stories ---

export const Default: Story = {
  name: 'Default View',
  args: {
    ...baseArgs,
    settings: mockConfig(),
  },
};

export const NewPersonalBest: Story = {
  name: 'Flash: New Personal Best',
  args: {
    ...baseArgs,
    current: 4.5, // within 5 seconds
    lastlap: 91.2,
    bestlap: 91.2,
    alltimelap: 91.2, // new personal best
    settings: mockConfig({
      showAllTimeLap: true,
    }),
  },
};

export const NewSessionBest: Story = {
  name: 'Flash: New Session Best',
  args: {
    ...baseArgs,
    current: 3.2, // within 5 seconds
    lastlap: 90.9,
    bestlap: 90.9, // new session best
    overall: 90.2,
    settings: mockConfig(),
  },
};

export const NewOverallBest: Story = {
  name: 'Flash: New Overall Best',
  args: {
    ...baseArgs,
    current: 3.2, // within 5 seconds
    lastlap: 90.9, // new overall best
    bestlap: 90.9,
    overall: 90.9,
    settings: mockConfig(),
  },
};

export const CurrentLapOnly: Story = {
  name: 'Minimal',
  args: {
    ...baseArgs,
    settings: mockConfig({
      showPredictedLap: false,
      showLastLap: false,
      showBestLap: false,
      history: { enabled: false, count: 5 },
    }),
  },
};

export const CompactAndPredicted: Story = {
  name: 'Current and Predicted',
  args: {
    ...baseArgs,
    settings: mockConfig({
      delta: { enabled: true, method: 'lastlap' },
      showLastLap: false,
      showBestLap: false,
      history: { enabled: false, count: 5 },
    }),
  },
};

export const DirtyLap: Story = {
  name: 'Invalid Dirty Lap',
  args: {
    ...baseArgs,
    dirty: true,
    settings: mockConfig({
      delta: { enabled: true, method: 'lastlap' },
      showLastLap: false,
      showBestLap: false,
      history: { enabled: false, count: 5 },
    }),
  },
};

export const HistoryView: Story = {
  name: 'History Only View',
  args: {
    ...baseArgs,
    history: [
      ...baseHistory,
      { lap: 5, time: 92.2, delta: 0.7 },
      { lap: 4, time: 91.6, delta: 0.1 },
      { lap: 3, time: 93.1, delta: 1.6 },
      { lap: 2, time: 92.0, delta: 0.5 },
      { lap: 1, time: 91.7, delta: 0.2 },
    ],
    settings: mockConfig({
      showCurrentLap: false,
      showPredictedLap: false,
      showLastLap: false,
      showBestLap: false,
      history: { enabled: true, count: 10 },
    }),
  },
};

export const HistoryChart: Story = {
  name: 'History As Graph',
  args: {
    ...baseArgs,
    history: [
      ...baseHistory,
      { lap: 5, time: 92.2, delta: 0.7 },
      { lap: 4, time: 91.6, delta: 0.1 },
      { lap: 3, time: 93.1, delta: 1.6 },
      { lap: 2, time: 92.0, delta: 0.5 },
      { lap: 1, time: 91.7, delta: 0.2 },
    ],
    settings: mockConfig({
      history: { enabled: true, count: 10, style: 'chart' },
    }),
  },
};

/**
 * A practice stint with two stops, shaped like the one a user reported: the pit
 * laps are ~12s slower, which stretches the y-axis and pulls the average away
 * from the laps being compared.
 */
const pitStintHistory = [
  { lap: 12, time: 31.2, delta: 0.0 },
  { lap: 11, time: 31.3, delta: 0.1 },
  { lap: 10, time: 43.2, delta: 12.0, pitted: true },
  { lap: 9, time: 38.9, delta: 7.7, pitted: true },
  { lap: 8, time: 31.4, delta: 0.2 },
  { lap: 7, time: 31.2, delta: 0.0 },
  { lap: 6, time: 31.5, delta: 0.3 },
  { lap: 5, time: 43.6, delta: 12.4, pitted: true },
  { lap: 4, time: 31.6, delta: 0.4 },
  { lap: 3, time: 31.3, delta: 0.1 },
];

export const PittedLapsShown: Story = {
  name: 'Pit Laps Shown (default)',
  args: {
    ...baseArgs,
    history: pitStintHistory,
    settings: mockConfig({
      history: {
        enabled: true,
        count: 10,
        style: 'chart',
        hidePittedLaps: false,
      },
    }),
  },
};

export const PittedLapsHidden: Story = {
  name: 'Pit Laps Hidden',
  args: {
    ...baseArgs,
    history: pitStintHistory,
    settings: mockConfig({
      history: {
        enabled: true,
        count: 10,
        style: 'chart',
        hidePittedLaps: true,
      },
    }),
  },
};

const cautionStintHistory: LapEntry[] = [
  { lap: 12, time: 31.2 },
  { lap: 11, time: 31.3 },
  { lap: 10, time: 64.2, caution: true },
  { lap: 9, time: 65.1, caution: true },
  { lap: 8, time: 31.4 },
  { lap: 7, time: 31.2 },
  { lap: 6, time: 31.5 },
  { lap: 5, time: 31.1 },
  { lap: 4, time: 31.6 },
  { lap: 3, time: 31.3 },
];

export const CautionLapsShown: Story = {
  name: 'Caution Laps Shown (default)',
  args: {
    ...baseArgs,
    current: 20.3,
    lastlap: 31.2,
    bestlap: 31.1,
    reference: 31.1,
    delta: 0.1,
    overall: 31.0,
    history: cautionStintHistory,
    settings: mockConfig({
      history: {
        enabled: true,
        count: 10,
        style: 'chart',
        hideCautionLaps: false,
      },
    }),
  },
};

export const CautionLapsHidden: Story = {
  args: {
    ...CautionLapsShown.args,
    settings: mockConfig({
      history: {
        enabled: true,
        count: 10,
        style: 'chart',
        hideCautionLaps: true,
      },
    }),
  },
};

export const NoDelta: Story = {
  name: 'Delta Disabled',
  args: {
    ...baseArgs,
    settings: mockConfig({
      delta: { enabled: false, method: 'bestlap' },
    }),
  },
};

// --- The history as the player's ledger gives it ---

/** The width that suits every column of the history. */
const WIDE = { widgetWidth: 320 };

/**
 * An endurance race two stops in, as the ledger rows it: a stint from the
 * start, one with a yellow and a full-course caution, one into the rain with
 * a lap the sim voided, and five laps into the fourth.
 */
const ledgerStory = (
  sample: Partial<SampleLedgerOptions>,
  history: Partial<LapTimeLogConfig['history']>,
  config: Partial<LapTimeLogConfig> = {}
): Story => {
  const { ledger, live } = sampleLedger({
    stints: ENDURANCE_SAMPLE_STINTS,
    ...sample,
  });
  const entries = lapEntries(ledger.laps, {
    sessionNum: ledger.sessionNum,
    deltaMethod: 'bestlap',
    wearMode: history.wearMode,
  });
  const cleanTimes = ledger.laps
    .filter((lap) => isCleanLap(lap.flags))
    .map(shownLapTime);
  const best = Math.min(...cleanTimes);
  return {
    parameters: WIDE,
    args: {
      current: 41.7,
      lastlap: entries[0].time,
      bestlap: best,
      alltimelap: best - 0.4,
      reference: best,
      delta: 0.31,
      overall: best - 0.9,
      history: entries,
      currentRow: liveLapEntry(live, history.wearMode),
      settings: mockConfig({
        ...config,
        history: { enabled: true, count: 8, ...history },
      }),
    },
  };
};

const everyCell = {
  showStintLap: true,
  showFuel: true,
  showWear: true,
  showFlags: true,
  showCurrentRow: true,
};

/**
 * Every cell on for a car that runs on virtual energy, counted in percent
 * of it. The newest rows: the lap under way, four laps of the stint, the
 * out-lap after the stop and, past the line that ends the stint before, its
 * in-lap and two laps in the rain.
 */
export const AllCellsEnergyCar: Story = {
  name: 'All Cells: Energy Car',
  ...ledgerStory({}, everyCell),
};

/** The same race in a car that runs on fuel, in litres. */
export const AllCellsFuelCar: Story = {
  name: 'All Cells: Fuel Car',
  ...ledgerStory({ budget: 'fuel' }, everyCell),
};

/** A fuel car in gallons, with the wear of the worst tyre. */
export const AllCellsGallonsHighestWear: Story = {
  name: 'All Cells: Gallons, Highest Wear',
  ...ledgerStory(
    { budget: 'fuel' },
    { ...everyCell, wearMode: 'highest' },
    { fuelUnits: 'gal' }
  ),
};

/**
 * iRacing reads tread only in the pits: the wear cell keeps its place with
 * a dash.
 */
export const AllCellsNoLiveWear: Story = {
  name: 'All Cells: No Live Wear',
  ...ledgerStory({ budget: 'fuel', treadPerLap: null }, everyCell),
};

/**
 * The marks alone, as a saved dashboard gets them: the start of the race,
 * the stops, the yellow, the two laps under a full-course caution, the
 * voided lap and the wet ones, with a line where a stint ends.
 */
export const LapMarks: Story = {
  name: 'Lap Marks (default)',
  ...ledgerStory({}, { count: 20 }, { showCurrentLap: false }),
  // At the default width: the marks need no more room.
  parameters: {},
};

/**
 * In reverse order the newest lap is at the bottom, and the line where a
 * stint ends is still between its last lap and the next stint's first.
 */
export const AllCellsReversed: Story = {
  name: 'All Cells: Reverse Order',
  ...ledgerStory({}, { ...everyCell, count: 6 }, { reverse: true }),
};

/**
 * A team-mate has the car. The timer runs on their lap; the list is the
 * laps the user drove, says so, and has no row for the lap under way.
 */
export const TeamMateDriving: Story = {
  name: 'Team-mate Driving',
  ...ledgerStory({}, everyCell),
  render: (args) => (
    <LapTimeLogDisplay {...args} currentRow={undefined} teamMateDriving />
  ),
};

/** Every cell on before a lap has been driven. */
export const AllCellsNoLaps: Story = {
  name: 'All Cells: No Laps Yet',
  parameters: WIDE,
  args: {
    current: 12.4,
    settings: mockConfig({
      history: { enabled: true, count: 8, ...everyCell },
    }),
    history: [],
  },
};
