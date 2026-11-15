import { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { SectorDelta } from './SectorDelta';
import {
  useSectorTimingStore,
  useReferenceLapStore,
  useSessionStore,
} from '@irdashies/context';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type { ReferenceLap } from '@irdashies/types';

export default {
  component: SectorDelta,
  title: 'widgets/SectorDelta',
  decorators: [
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
    }),
    TelemetryDecorator(),
  ],
  args: {
    background: { opacity: 80 },
    showOnlyWhenOnTrack: false,
    ghostComparison: 'prefer-ghost',
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
} as Meta;

type Story = StoryObj<typeof SectorDelta>;

const MOCK_SECTORS = [
  { SectorNum: 0, SectorStartPct: 0 },
  { SectorNum: 1, SectorStartPct: 0.33 },
  { SectorNum: 2, SectorStartPct: 0.67 },
];

const PLAYER_CAR_IDX = 1;
const PLAYER_CLASS_ID = 42;

type SectorStoreState = ReturnType<typeof useSectorTimingStore.getState>;

/** What a story adds to the store beyond the three arrays every one sets. */
type SectorStoreExtras = Partial<
  Pick<
    SectorStoreState,
    | 'previousLapSectorTimes'
    | 'previousSessionBestSectorTimes'
    | 'sessionBestLapSectorTimes'
    | 'allTime'
    | 'lapStartTime'
    | 'sectorEvent'
    | 'currentSectorIdx'
  >
>;

/** Nothing a story does not set is left over from the story before it. */
const NO_EXTRAS: Required<SectorStoreExtras> = {
  previousLapSectorTimes: [],
  previousSessionBestSectorTimes: [],
  sessionBestLapSectorTimes: [],
  allTime: null,
  lapStartTime: null,
  sectorEvent: null,
  currentSectorIdx: 2,
};

/** Seeds the SectorTimingStore with preset state for visual testing */
function SectorStoreSeeder({
  sectorColors,
  currentLapSectorTimes,
  sessionBestSectorTimes,
  extras,
}: {
  sectorColors: ('purple' | 'green' | 'yellow' | 'red' | 'default')[];
  currentLapSectorTimes: (number | null)[];
  sessionBestSectorTimes: (number | null)[];
  extras?: SectorStoreExtras;
}) {
  const store = useSectorTimingStore;
  useEffect(() => {
    store.setState({
      sectors: MOCK_SECTORS,
      sectorColors,
      currentLapSectorTimes,
      sessionBestSectorTimes,
      sectorEntryValid: true,
      sectorEntryTime: 0,
      ...NO_EXTRAS,
      ...extras,
    });
  }, [
    store,
    sectorColors,
    currentLapSectorTimes,
    sessionBestSectorTimes,
    extras,
  ]);
  return null;
}

/**
 * Builds a mock ghost lap with per-sector time distribution.
 *
 * Each sector is modelled as piecewise-linear: within a sector the elapsed
 * time increases proportionally to the distance covered in that sector.
 *
 * @param sectorBoundaries - SectorStartPct values in ascending order (e.g. [0, 0.33, 0.67])
 * @param sectorTimes - Ghost lap time (seconds) for each sector
 */
function buildMockGhostLap(
  sectorBoundaries: number[],
  sectorTimes: number[]
): ReferenceLap {
  const pointsCount = 400; // 0.25% resolution
  const interval = 1 / pointsCount;
  const lapTime = sectorTimes.reduce((a, b) => a + b, 0);

  // Cumulative elapsed time at the start of each sector
  const sectorStartTimes: number[] = sectorTimes.map((_, i) =>
    sectorTimes.slice(0, i).reduce((a, b) => a + b, 0)
  );

  // Width (in trackPct) of each sector
  const sectorWidths: number[] = sectorBoundaries.map((startPct, i) => {
    const nextPct =
      i < sectorBoundaries.length - 1 ? sectorBoundaries[i + 1] : 1;
    return nextPct - startPct;
  });

  const times = new Float32Array(pointsCount);
  const pointPos = new Float32Array(pointsCount);
  const tangents = new Float32Array(pointsCount);

  for (let i = 0; i < pointsCount; i++) {
    const pct = i * interval;
    pointPos[i] = pct;

    // Determine which sector this point belongs to
    let sectorIdx = 0;
    for (let s = sectorBoundaries.length - 1; s >= 0; s--) {
      if (pct >= sectorBoundaries[s]) {
        sectorIdx = s;
        break;
      }
    }

    const offset = pct - sectorBoundaries[sectorIdx];
    const width = sectorWidths[sectorIdx];
    const timeElapsedSinceStart =
      sectorStartTimes[sectorIdx] + (offset / width) * sectorTimes[sectorIdx];

    times[i] = timeElapsedSinceStart;

    // Tangent = slope for this sector (constant within sector)
    tangents[i] = sectorTimes[sectorIdx] / width;
  }

  return {
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 0.9975,
    isCleanLap: true,
    times,
    pointPos,
    tangents,
    interval,
    pointsCount,
  };
}

// Ghost sector times used across demo stories:
//   S1 = 28.5 s (short/fast sector)
//   S2 = 31.0 s (long/slow sector)
//   S3 = 29.5 s (medium sector)
// Total ghost lap: 89.0 s
const GHOST_SECTOR_TIMES = [28.5, 31.0, 29.5];
const GHOST_BOUNDARIES = MOCK_SECTORS.map((s) => s.SectorStartPct);

/**
 * Seeds both the ReferenceLapStore (ghost lap) and the SessionStore (player
 * identity) so that useReferenceLapSectorTimes can resolve ghost sector times.
 *
 * Ghost sector times: S1=28.5 s | S2=31.0 s | S3=29.5 s (total 89.0 s)
 */
function GhostLapSeeder() {
  // The class of whoever the session says the player is. The telemetry
  // decorator loads a recorded session of its own after the first render,
  // and the ghost has to be filed under that one's class to be found.
  const playerClassId = useSessionStore((state) => {
    const carIdx = state.session?.DriverInfo?.DriverCarIdx;
    return (
      state.session?.DriverInfo?.Drivers?.find(
        (driver) => driver.CarIdx === carIdx
      )?.CarClassID ?? null
    );
  });

  useEffect(() => {
    if (playerClassId !== null) return;
    // Give the player an identity so the hook can find their class ID
    useSessionStore.setState({
      session: {
        DriverInfo: {
          DriverCarIdx: PLAYER_CAR_IDX,
          Drivers: [
            {
              CarIdx: PLAYER_CAR_IDX,
              CarClassID: PLAYER_CLASS_ID,
            },
          ],
        },
      } as never,
    });
  }, [playerClassId]);

  useEffect(() => {
    if (playerClassId === null) return;
    const ghostLap = buildMockGhostLap(GHOST_BOUNDARIES, GHOST_SECTOR_TIMES);
    useReferenceLapStore.setState({
      persistedLaps: new Map([[playerClassId, ghostLap]]),
    });
  }, [playerClassId]);
  return null;
}

export const AllCompleted: Story = {
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'green', 'yellow']}
        currentLapSectorTimes={[28.123, 30.456, 32.789]}
        sessionBestSectorTimes={[28.5, 30.2, 32.1]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

export const PartiallyCompleted: Story = {
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['green', 'red', 'default']}
        currentLapSectorTimes={[29.8, 31.5, null]}
        sessionBestSectorTimes={[30.1, 30.9, 32.0]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

export const PersonalBests: Story = {
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'purple', 'purple']}
        currentLapSectorTimes={[27.9, 29.8, 31.2]}
        sessionBestSectorTimes={[28.1, 30.2, 31.5]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

export const NoData: Story = {
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['default', 'default', 'default']}
        currentLapSectorTimes={[null, null, null]}
        sessionBestSectorTimes={[null, null, null]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

export const FirstSectorComplete: Story = {
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['green', 'default', 'default']}
        currentLapSectorTimes={[29.123, null, null]}
        sessionBestSectorTimes={[29.5, 31.0, 32.0]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/**
 * Where the car and the clock are in the ghost stories: 11.8 s into the
 * third sector and four tenths of the way through it, which the ghost took
 * 11.6 s to reach. The live figure on the third card is the difference.
 */
const GHOST_NOW = 11.8;
const inThirdSector = ChannelSnapshotDecorator({
  'track-state.snapshot': {
    ...trackStateStorySnapshot,
    lapDistPct: 0.8,
    sessionTime: GHOST_NOW,
  },
});

/**
 * Ghost lap loaded — two completed sectors, third in progress.
 * Ghost: S1=28.5 s | S2=31.0 s | S3=29.5 s
 * Player S1=28.3 → -0.20 (green, faster) | S2=31.3 → +0.30 (yellow, slightly behind)
 */
export const WithGhostLap: Story = {
  decorators: [inThirdSector],
  render: (args) => (
    <>
      <GhostLapSeeder />
      <SectorStoreSeeder
        sectorColors={['green', 'yellow', 'default']}
        currentLapSectorTimes={[28.3, 31.3, null]}
        sessionBestSectorTimes={[28.8, 31.5, 30.0]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/**
 * Ghost lap loaded — all sectors completed, showing all three ghost delta colors.
 * Ghost: S1=28.5 s | S2=31.0 s | S3=29.5 s
 * Player S1=28.8 → +0.30 (yellow) | S2=30.4 → -0.60 (green) | S3=30.2 → +0.70 (red)
 */
export const WithGhostLapAllCompleted: Story = {
  decorators: [inThirdSector],
  render: (args) => (
    <>
      <GhostLapSeeder />
      <SectorStoreSeeder
        sectorColors={['green', 'purple', 'yellow']}
        currentLapSectorTimes={[28.8, 30.4, 30.2]}
        sessionBestSectorTimes={[29.0, 31.0, 30.0]}
      />
      <SectorDelta {...args} />
    </>
  ),
};

// A recorded race at Laguna Seca in Le Mans Ultimate, whose own three
// sectors these are: the flying lap of 86.660 s, and a third lap that opens
// with the best first sector yet.
const FLYING_LAP = [32.739, 35.07, 18.851];
const BEST_SECTORS = [32.461, 35.07, 18.851];
/** The story clock, which the track-state snapshot of the stories reads. */
const NOW = 10;

/** Part-way round the third lap, in its second sector. */
const thirdLap: SectorStoreExtras = {
  currentSectorIdx: 1,
  previousLapSectorTimes: [32.461, 35.07, 18.851],
  previousSessionBestSectorTimes: [32.739, 35.357, 19.007],
  sessionBestLapSectorTimes: FLYING_LAP,
  // 51.3 s into the lap.
  lapStartTime: NOW - 51.3,
};

/** The bests kept from earlier sessions on this track in this car. */
const ALL_TIME = {
  bestSectorTimes: [32.214, 34.902, 18.851],
  // The third sector has just been improved on, at the end of the last lap.
  previousBestSectorTimes: [null, null, 18.93],
  bestLapSectorTimes: [32.39, 35.004, 18.93],
};

/**
 * Against the sectors of the best whole lap of the session rather than the
 * best of each sector: the first sector of this lap is quicker than that
 * lap's was.
 */
export const AgainstSessionBestLap: Story = {
  args: { ghostComparison: 'session-best-lap' },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'default', 'default']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={thirdLap}
      />
      <SectorDelta {...args} />
    </>
  ),
};

const againstAllTime: SectorStoreExtras = { ...thirdLap, allTime: ALL_TIME };

/**
 * Against the best of each sector kept for this track and car between
 * sessions. The third sector of the last lap set a new one, and is shown
 * against the best it replaced.
 */
export const AgainstAllTimeBestSectors: Story = {
  args: { ghostComparison: 'all-time-best' },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'default', 'default']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={againstAllTime}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/** Against the sectors of the best whole lap kept for the track and car. */
export const AgainstAllTimeBestLap: Story = {
  args: { ghostComparison: 'all-time-best-lap' },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'default', 'default']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={againstAllTime}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/**
 * The all-time bests have not been read yet, or this is the first time on
 * the track: the sector times as they are, and no delta from nothing.
 */
export const AllTimeBestsNotKnownYet: Story = {
  args: { ghostComparison: 'all-time-best', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'default', 'default']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={thirdLap}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/**
 * The target row with the session's best sectors: TB, the theoretical best
 * as far as the sector being driven, and the lap's own clock beside it.
 */
export const TheoreticalBestTarget: Story = {
  args: { ghostComparison: 'session-best-only', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'green', 'green']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={thirdLap}
      />
      <SectorDelta {...args} />
    </>
  ),
};

const lastSector: SectorStoreExtras = {
  ...againstAllTime,
  currentSectorIdx: 2,
  // 1:13.2 into the lap.
  lapStartTime: NOW - 73.2,
};

/**
 * The all-time theoretical best in the last sector: the whole lap that the
 * best of each sector adds up to, 1:25.967.
 */
export const AllTimeTheoreticalBestTarget: Story = {
  args: { ghostComparison: 'all-time-best', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'green', 'default']}
        currentLapSectorTimes={[32.461, 35.12, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={lastSector}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/** A best lap as the target is marked PB. */
export const BestLapTarget: Story = {
  args: { ghostComparison: 'all-time-best-lap', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'green', 'default']}
        currentLapSectorTimes={[32.461, 35.12, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={lastSector}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/** Two seconds after the first sector ended a quarter of a second up. */
const justAhead: SectorStoreExtras = {
  ...thirdLap,
  lapStartTime: NOW - 34.461,
  sectorEvent: {
    sectorIdx: 0,
    at: NOW - 2,
    lapSectorTimes: [32.461, null, null],
    before: {
      // As the bests stood while that sector was being driven.
      sessionBestSectorTimes: FLYING_LAP,
      sessionBestLapSectorTimes: FLYING_LAP,
      allTime: null,
    },
  },
};

/**
 * Just into the second sector: for a few seconds the row shows how the lap
 * stands against its target so far, green when ahead, and the lap time at
 * the end of the sector just finished.
 */
export const TargetGapAhead: Story = {
  args: { ghostComparison: 'session-best-only', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'green', 'green']}
        currentLapSectorTimes={[32.461, null, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={justAhead}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/** Two seconds after a second sector that cost four tenths. */
const justBehind: SectorStoreExtras = {
  ...thirdLap,
  currentSectorIdx: 2,
  lapStartTime: NOW - 69.951,
  sectorEvent: {
    sectorIdx: 1,
    at: NOW - 2,
    lapSectorTimes: [32.461, 35.49, null],
    before: {
      sessionBestSectorTimes: BEST_SECTORS,
      sessionBestLapSectorTimes: FLYING_LAP,
      allTime: null,
    },
  },
};

/** The same moment a sector later, behind the target: red. */
export const TargetGapBehind: Story = {
  args: { ghostComparison: 'session-best-only', showTargetLap: true },
  render: (args) => (
    <>
      <SectorStoreSeeder
        sectorColors={['purple', 'red', 'green']}
        currentLapSectorTimes={[32.461, 35.49, null]}
        sessionBestSectorTimes={BEST_SECTORS}
        extras={justBehind}
      />
      <SectorDelta {...args} />
    </>
  ),
};

/** The two sectors done and the 11.8 s of the third: 1:11.4 into the lap. */
const ghostLapUnderWay: SectorStoreExtras = {
  lapStartTime: GHOST_NOW - 71.4,
};

/**
 * The target row with the ghost: REF, the reference lap's time as far as
 * the sector being driven.
 */
export const GhostTarget: Story = {
  args: { showTargetLap: true },
  decorators: [inThirdSector],
  render: (args) => (
    <>
      <GhostLapSeeder />
      <SectorStoreSeeder
        sectorColors={['green', 'yellow', 'default']}
        currentLapSectorTimes={[28.3, 31.3, null]}
        sessionBestSectorTimes={[28.8, 31.5, 30.0]}
        extras={ghostLapUnderWay}
      />
      <SectorDelta {...args} />
    </>
  ),
};
