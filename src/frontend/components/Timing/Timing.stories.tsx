import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import {
  getWidgetManifest,
  type ChannelPayloads,
  type LapDeltaReference,
  type LapDeltaSnapshot,
  type LapLogSnapshot,
  type SectorTimingResultSnapshot,
  type SectorTimingSnapshot,
  type SessionTimingSnapshot,
  type TimingConfig,
  type TrackStateSnapshot,
} from '@irdashies/types';
import { Timing } from './Timing';

/**
 * The widget's default overlay box. The stories draw it at that size, so
 * what they show is what a driver gets on first enabling it.
 */
const BOX = getWidgetManifest('timing')?.layout ?? { width: 300, height: 170 };
/** What each optional row asks for on top of it. */
const ROW_HEIGHT = 48;

const boxWithRows = (extraRows: number, width: number = BOX.width) => ({
  width,
  height: BOX.height + extraRows * ROW_HEIGHT,
});

// The recorded session behind the stories has the player in car 0, with cars
// 21 to 39 in the same class and cars 1 to 20 in a faster one.
const PLAYER = 0;
const CLASS_RIVAL = 21;
const CAR_COUNT = 41;

/** Every car's best lap: the player's, a class rival's and a faster class. */
const fieldBestLaps = (playerBest: number, rivalBest: number): number[] =>
  Array.from({ length: CAR_COUNT }, (_, carIdx) => {
    if (carIdx === PLAYER) return playerBest;
    if (carIdx === CLASS_RIVAL) return rivalBest;
    // The other class laps ten seconds quicker.
    if (carIdx <= 20) return 93.2 + carIdx * 0.11;
    return rivalBest + 0.4 + (carIdx - CLASS_RIVAL) * 0.13;
  });

const driving: TrackStateSnapshot = {
  ...trackStateStorySnapshot,
  focusCarIdx: PLAYER,
};

const sessionTiming = (currentLap: number): SessionTimingSnapshot => ({
  sessionType: 'Race',
  state: 4,
  currentLap,
  totalLaps: 0,
  time: 600,
  timeTotal: 3600,
  timeRemaining: 3000,
  greenFlagTimestamp: 0,
  isFixedLapRace: false,
  totalRaceLaps: 0,
  totalRaceTime: 0,
  adjustedRaceTime: 0,
  sessionNum: 0,
  version: 1,
});

const lapLog = (overrides: Partial<LapLogSnapshot> = {}): LapLogSnapshot => ({
  lapCompleted: 3,
  currentLapTime: 52.34,
  lastLapTime: 104.53,
  bestLapTime: 104.054,
  carIdxBestLapTime: fieldBestLaps(104.054, 103.611),
  sessionNum: 0,
  sessionTime: 600,
  playerTrackSurface: 3,
  incidentCount: 0,
  lapDistPct: 0.5,
  deltaToSessionLastLap: 0,
  deltaToSessionLastLapOk: false,
  deltaToSessionBestLap: 0,
  deltaToSessionBestLapOk: false,
  lapInvalidated: false,
  lastLapInvalid: false,
  lastLapUnderCaution: false,
  version: 1,
  ...overrides,
});

const none: LapDeltaReference = { lapTime: null, delta: null, trend: null };

const lapDelta = (
  sessionBest: LapDeltaReference,
  allTime: LapDeltaReference = { lapTime: 103.87, delta: 0.268, trend: 0 }
): LapDeltaSnapshot => ({ sessionBest, allTime, sessionNum: 0, version: 1 });

interface SectorStory {
  currentSectorIdx: number;
  /** When the car entered the sector, on the session clock. */
  entryTime?: number;
  current: (number | null)[];
  previous: (number | null)[];
  bests: (number | null)[];
  currentUnclean?: number[];
  previousUnclean?: number[];
}

const sectorTiming = ({
  currentSectorIdx,
  entryTime = 560,
  current,
  previous,
  bests,
  currentUnclean = [],
  previousUnclean = [],
}: SectorStory): SectorTimingSnapshot => {
  const count = previous.length;
  const result: SectorTimingResultSnapshot = {
    currentLapSectorTimes: current,
    previousLapSectorTimes: previous,
    currentLapSectorUnclean: previous.map((_, i) => currentUnclean.includes(i)),
    previousLapSectorUnclean: previous.map((_, i) =>
      previousUnclean.includes(i)
    ),
    sessionBestSectorTimes: bests,
    previousSessionBestSectorTimes: bests,
  };
  return {
    sectors: Array.from({ length: count }, (_, index) => ({
      SectorNum: index,
      SectorStartPct: index / count,
    })),
    currentSectorIdx,
    sectorEntryTime: entryTime,
    sectorEntryValid: true,
    inclusive: result,
    clean: result,
    sessionNum: 0,
    version: 1,
  };
};

/**
 * The fourth lap, part of the way round: the first sector is this lap's and
 * a best, the other two are still the previous lap's.
 */
const midLap: Partial<ChannelPayloads> = {
  'track-state.snapshot': driving,
  'session-timing.snapshot': sessionTiming(4),
  'lap-log.snapshot': lapLog(),
  'lap-delta.snapshot': lapDelta({
    lapTime: 104.054,
    delta: 0.084,
    trend: 0.02,
  }),
  'sector-timing.snapshot': sectorTiming({
    currentSectorIdx: 1,
    current: [31.204, null, null],
    previous: [31.48, 40.312, 32.738],
    bests: [31.204, 40.112, 32.738],
  }),
  'lap-times.snapshot': {
    lapTimes: fieldBestLaps(104.41, 104.02),
    lapTimeHistory: [],
    sessionNum: 0,
    version: 1,
  },
};

type TimingStoryConfig = Omit<Partial<TimingConfig>, 'tiles'> & {
  tiles?: Partial<TimingConfig['tiles']>;
};

const story = (
  channels: Partial<ChannelPayloads>,
  config: TimingStoryConfig = {},
  size: { width: number; height: number } = boxWithRows(0)
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      timing: config,
    }),
    ChannelSnapshotDecorator(channels),
    // The widget fills its overlay window, so the story supplies one.
    (Story: React.ComponentType) => (
      <div style={size}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Timing> = {
  component: Timing,
  title: 'widgets/Timing',
};

export default meta;

type Story = StoryObj<typeof Timing>;

/** The default layout in its default box, a touch down on the session best. */
export const Default: Story = {
  ...story(midLap),
};

/** Up on the reference: the delta turns green. */
export const Gaining: Story = {
  ...story({
    ...midLap,
    'lap-delta.snapshot': lapDelta({
      lapTime: 104.054,
      delta: -0.342,
      trend: -0.1,
    }),
  }),
};

/**
 * Every tile the settings offer, in a box three rows taller. The stint best
 * is not offered yet, so the pace has its row to itself.
 */
export const AllTiles: Story = {
  ...story(
    midLap,
    {
      tiles: {
        currentLap: true,
        predictedLap: true,
        sessionBest: true,
        allTimeBest: true,
        pace: true,
      },
    },
    boxWithRows(3)
  ),
};

/** On track before any channel has answered: every tile a placeholder. */
export const NoData: Story = {
  ...story({ 'track-state.snapshot': driving }),
};

/** The out-lap: a lap number and nothing timed yet. */
export const OutLap: Story = {
  ...story({
    'track-state.snapshot': driving,
    'session-timing.snapshot': sessionTiming(1),
    'lap-log.snapshot': lapLog({
      lapCompleted: 0,
      lastLapTime: 0,
      bestLapTime: 0,
      carIdxBestLapTime: fieldBestLaps(0, 103.611),
    }),
    'lap-delta.snapshot': lapDelta(none, none),
    'sector-timing.snapshot': sectorTiming({
      currentSectorIdx: 2,
      current: [null, 40.86, null],
      previous: [null, 40.86, null],
      bests: [null, 40.86, null],
    }),
  }),
};

/**
 * The last lap did not count: Le Mans Ultimate gave it no time, so the time
 * is the measured one, greyed and marked. The sector with the cut carries the
 * mark too.
 */
export const InvalidLastLap: Story = {
  ...story({
    ...midLap,
    'lap-log.snapshot': lapLog({ lastLapTime: 106.912, lastLapInvalid: true }),
    'sector-timing.snapshot': sectorTiming({
      currentSectorIdx: 1,
      current: [31.35, null, null],
      previous: [31.912, 42.262, 32.738],
      bests: [31.204, 40.112, 32.738],
      previousUnclean: [1],
    }),
  }),
};

/**
 * The lap in progress has been voided: the delta steps back and its label
 * says why, and the sector with the cut is marked.
 */
export const VoidLap: Story = {
  ...story({
    ...midLap,
    'lap-log.snapshot': lapLog({ lapInvalidated: true, lapDistPct: 0.62 }),
    'lap-delta.snapshot': lapDelta({
      lapTime: 104.054,
      delta: -0.214,
      trend: -0.05,
    }),
    'sector-timing.snapshot': sectorTiming({
      currentSectorIdx: 2,
      current: [31.204, 39.871, null],
      previous: [31.48, 40.312, 32.738],
      bests: [31.204, 39.871, 32.738],
      currentUnclean: [1],
    }),
  }),
};

/**
 * The lap just finished is the best of the session in the player's class:
 * the last lap is purple, the best-lap tile deepens and wears a crown, and
 * for five seconds after the line all three sectors are the finished lap's.
 */
export const BestIsSessionBest: Story = {
  ...story({
    ...midLap,
    'session-timing.snapshot': sessionTiming(5),
    'lap-log.snapshot': lapLog({
      lapCompleted: 4,
      currentLapTime: 2.4,
      lastLapTime: 103.498,
      bestLapTime: 103.498,
      carIdxBestLapTime: fieldBestLaps(103.498, 103.611),
      sessionTime: 602.4,
      lapDistPct: 0.02,
    }),
    'lap-delta.snapshot': lapDelta({
      lapTime: 103.498,
      delta: 0.012,
      trend: 0,
    }),
    'sector-timing.snapshot': sectorTiming({
      currentSectorIdx: 0,
      entryTime: 600,
      current: [null, null, null],
      previous: [31.204, 39.871, 32.423],
      bests: [31.204, 39.871, 32.423],
    }),
  }),
};

/** A personal best that someone else in the class has beaten: green. */
export const PersonalBest: Story = {
  ...story({
    ...midLap,
    'lap-log.snapshot': lapLog({ lastLapTime: 104.054 }),
    'sector-timing.snapshot': sectorTiming({
      currentSectorIdx: 1,
      current: [31.39, null, null],
      previous: [31.204, 40.112, 32.738],
      bests: [31.204, 40.112, 32.738],
    }),
  }),
};

const eightSectors = sectorTiming({
  currentSectorIdx: 6,
  current: [12.412, 14.038, 11.906, 13.377, 12.851, 15.24, null, null],
  previous: [12.498, 14.105, 11.906, 13.29, 12.992, 15.102, 11.73, 12.907],
  bests: [12.412, 14.038, 11.871, 13.29, 12.851, 15.102, 11.73, 12.907],
  // Off the track in the sixth sector.
  currentUnclean: [5],
});

/**
 * An iRacing track with eight sectors in the default box: six tiles, a
 * window that follows the car, the sector just completed second from the
 * right.
 */
export const EightSectors: Story = {
  ...story({ ...midLap, 'sector-timing.snapshot': eightSectors }),
};

/** The same lap with all eight tiles, in a wider box. */
export const EightSectorsAllShown: Story = {
  ...story(
    { ...midLap, 'sector-timing.snapshot': eightSectors },
    { sectorTilesMax: 8 },
    boxWithRows(0, 420)
  ),
};

/** The player's best time for each sector this session. */
export const BestSectors: Story = {
  ...story(midLap, { sectorSource: 'best' }),
};

/** Against the best lap kept for this track and car across sessions. */
export const AgainstAllTimeBest: Story = {
  ...story(midLap, { deltaReference: 'allTime' }),
};

/**
 * A reference the delta channel does not carry yet, as a config saved by a
 * later build would ask for: dashes, and no other lap in its place.
 */
export const ReferenceNotAvailable: Story = {
  ...story(
    midLap,
    { deltaReference: 'stintBest', tiles: { predictedLap: true } },
    boxWithRows(1)
  ),
};

/** Out of the car with the widget kept on screen: the last figures, dimmed. */
export const OutOfTheCar: Story = {
  ...story(
    {
      ...midLap,
      'track-state.snapshot': { ...driving, isOnTrack: false },
    },
    { showOnlyWhenOnTrack: false }
  ),
};

/** Two decimals throughout and larger text, in a box resized to suit. */
export const LargerText: Story = {
  ...story(
    midLap,
    { scale: 130, deltaDecimals: 2, lapTimeDecimals: 2, sectorDecimals: 2 },
    { width: 380, height: 216 }
  ),
};
