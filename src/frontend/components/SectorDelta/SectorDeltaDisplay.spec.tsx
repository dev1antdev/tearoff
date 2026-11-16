import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ReferenceLap,
  type Session,
} from '@irdashies/types';
import {
  useReferenceLapStore,
  useSectorTimingStore,
  useSessionStore,
} from '@irdashies/context';
import { SectorDeltaDisplay } from './SectorDeltaDisplay';
import type { SectorDeltaData } from './SectorDeltaDisplay';

vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// In the car, in a session the widget shows in, part of the way through the
// third sector.
const trackState = vi.hoisted(() => ({
  isOnTrack: true,
  notInSession: false,
  lapDistPct: 0.9,
  sessionTime: 200,
}));
vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useSessionVisibility: () => true,
  useTrackStateSnapshot: () => trackState,
  useTrackStateSelector: (selector: (state: typeof trackState) => unknown) =>
    selector(trackState),
}));

// Le Mans Ultimate, where the player's all-time lap is the ghost.
vi.mock('../../context/shared/useActiveSimulator', () => ({
  useActiveSimulator: () => 'lmu',
}));

const PLAYER_CAR_IDX = 0;
const PLAYER_CLASS_ID = 1;
const POINTS = 400;

/** A lap driven at one speed: its time to any point is that share of it. */
const steadyLap = (lapTime: number): ReferenceLap => {
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  for (let index = 0; index < POINTS; index += 1) {
    pointPos[index] = index / POINTS;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    tangents: new Float32Array(POINTS).fill(lapTime),
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

// LMU's sectors as learned on track: two fifths, two fifths and a fifth.
const sectors = [
  { SectorNum: 0, SectorStartPct: 0 },
  { SectorNum: 1, SectorStartPct: 0.4 },
  { SectorNum: 2, SectorStartPct: 0.8 },
];

/** Two sectors of this lap done, the third being driven. */
const data: SectorDeltaData = {
  sectors,
  sectorColors: ['green', 'red', 'default'],
  currentLapSectorTimes: [40.5, 39.2, null],
  currentLapSectorUnclean: [false, false, false],
  previousLapSectorTimes: [41, 40, 20.5],
  previousLapSectorUnclean: [false, false, false],
  sessionBestSectorTimes: [40.2, 38.9, 20.1],
  previousSessionBestSectorTimes: [41, 40, 20.5],
  // The lap before this one is the best whole lap of the session.
  sessionBestLapSectorTimes: [41, 40, 20.5],
  allTime: null,
  // Over the line at 100 s on the session clock, which now reads 200.
  lapStartTime: 100,
  sectorEvent: null,
  currentSectorIdx: 2,
};

const config = getWidgetDefaultConfig('sectordelta');

/** What each card shows, by its sector label. */
const cards = (container: HTMLElement) =>
  Object.fromEntries(
    ['S1', 'S2', 'S3'].map((label) => {
      const card = [...container.querySelectorAll('span')].find(
        (span) => span.textContent === label
      )?.parentElement;
      return [label, card?.textContent?.slice(label.length)];
    })
  );

beforeEach(() => {
  useReferenceLapStore.getState().completeSession();
  useSectorTimingStore.getState().reset();
  useSectorTimingStore.setState({ sectors });
  useSessionStore.setState({
    session: {
      DriverInfo: {
        DriverCarIdx: PLAYER_CAR_IDX,
        Drivers: [
          { CarIdx: PLAYER_CAR_IDX, CarClassID: PLAYER_CLASS_ID },
          { CarIdx: 7, CarClassID: PLAYER_CLASS_ID },
        ],
      },
    } as unknown as Session,
  });
});

describe('Sector Delta against its ghost', () => {
  it("compares with the player's all-time lap where the class has no reference", () => {
    // Le Mans Ultimate. The all-time lap is 100 s, so 40, 40 and 20 s
    // through these sectors.
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    const { container } = render(
      <SectorDeltaDisplay {...config} data={data} />
    );

    expect(cards(container)).toEqual({
      S1: '+0.500',
      S2: '-0.800',
      // The sector being driven shows the last time through it.
      S3: '+0.500',
    });
    // The ghost mark beside the cards.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it("compares with the session's own bests when there is no ghost at all", () => {
    // Another car's best lap of the session is not a ghost.
    useReferenceLapStore.setState({
      bestLaps: new Map([[7, steadyLap(80)]]),
    });
    const { container } = render(
      <SectorDeltaDisplay {...config} data={data} />
    );

    expect(cards(container)).toEqual({
      S1: '+0.300',
      S2: '+0.300',
      S3: '+0.400',
    });
    expect(container.querySelector('svg')).toBeNull();
  });

  it('compares with the class reference where the session has one', () => {
    // 80 s: 32, 32 and 16 s through these sectors.
    useReferenceLapStore.setState({
      persistedLaps: new Map([[PLAYER_CLASS_ID, steadyLap(80)]]),
      playerAllTimeLap: steadyLap(100),
    });
    const { container } = render(
      <SectorDeltaDisplay {...config} data={data} />
    );

    expect(cards(container)).toEqual({
      S1: '+8.500',
      S2: '+7.200',
      S3: '+4.500',
    });
  });

  it('leaves the ghost alone when set to the session best only', () => {
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        data={data}
      />
    );

    expect(cards(container).S1).toBe('+0.300');
  });
});

/** The accent under a card, by its sector label. */
const accent = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('span')].find(
    (span) => span.textContent === label
  )?.parentElement?.className ?? '';

describe('Sector Delta against a best lap', () => {
  it('compares with the sectors of the best lap of the session', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-lap"
        data={data}
      />
    );

    expect(cards(container)).toEqual({
      S1: '-0.500',
      S2: '-0.800',
      // The sector being driven shows the last time through it, which was
      // on that lap.
      S3: '+0.000',
    });
    // Quicker than the best lap through a sector is purple.
    expect(accent(container, 'S1')).toContain('border-purple-400');
  });

  it('shows the plain time before there is a whole lap to compare with', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-lap"
        data={{ ...data, sessionBestLapSectorTimes: [null, null, null] }}
      />
    );

    expect(cards(container)).toEqual({
      S1: '40.500',
      S2: '39.200',
      S3: '20.500',
    });
    expect(accent(container, 'S1')).toContain('border-slate-700');
  });
});

describe('Sector Delta against the all-time bests', () => {
  const allTime = {
    bestSectorTimes: [40, 39.2, 20],
    // The second sector has just been improved on, from 39.6.
    previousBestSectorTimes: [null, 39.6, null],
    bestLapSectorTimes: [40.3, 39.5, 20.2],
  };

  it('compares with the best of each sector, and a new best with the one before', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="all-time-best"
        data={{ ...data, allTime }}
      />
    );

    expect(cards(container)).toEqual({
      S1: '+0.500',
      S2: '-0.400',
      S3: '+0.500',
    });
    expect(accent(container, 'S2')).toContain('border-purple-400');
    expect(accent(container, 'S1')).not.toContain('border-purple-400');
  });

  it('compares with the sectors of the all-time best lap', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="all-time-best-lap"
        data={{ ...data, allTime }}
      />
    );

    expect(cards(container)).toEqual({
      S1: '+0.200',
      S2: '-0.300',
      S3: '+0.300',
    });
  });

  it('shows the plain time until the store that keeps them has answered', () => {
    for (const ghostComparison of [
      'all-time-best',
      'all-time-best-lap',
    ] as const) {
      const { container, unmount } = render(
        <SectorDeltaDisplay
          {...config}
          ghostComparison={ghostComparison}
          data={data}
        />
      );

      expect(cards(container)).toEqual({
        S1: '40.500',
        S2: '39.200',
        S3: '20.500',
      });
      expect(accent(container, 'S2')).toContain('border-slate-700');
      unmount();
    }
  });

  it('does not borrow the ghost or the session bests for them', () => {
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="all-time-best"
        data={data}
      />
    );

    expect(cards(container).S1).toBe('40.500');
    // No ghost mark either.
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('the target row of Sector Delta', () => {
  const row = (container: HTMLElement) =>
    container.querySelector('[data-testid="sector-target"]');
  const target = (container: HTMLElement) =>
    container.querySelector('[data-testid="sector-target-value"]');
  const lap = (container: HTMLElement) =>
    container.querySelector('[data-testid="sector-target-lap"]');

  /** The second sector ended `secondsAgo` seconds ago on the session clock. */
  const secondSectorEnded = (secondsAgo: number) => ({
    sectorIdx: 1,
    at: trackState.sessionTime - secondsAgo,
    lapSectorTimes: [40.5, 39.2, null],
    before: {
      sessionBestSectorTimes: [40.2, 38.9, 20.1],
      sessionBestLapSectorTimes: [41, 40, 20.5],
      allTime: null,
    },
  });

  beforeEach(() => {
    trackState.isOnTrack = true;
    trackState.sessionTime = 200;
  });

  it('is not drawn unless it is switched on', () => {
    const { container } = render(
      <SectorDeltaDisplay {...config} data={data} />
    );

    expect(row(container)).toBeNull();
  });

  it('shows the theoretical best as far as this sector, and the running lap', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={data}
      />
    );

    // The best of each of the three sectors: 40.2, 38.9 and 20.1.
    expect(row(container)?.textContent).toContain('TB');
    expect(target(container)?.textContent).toBe('1:39.200');
    expect(target(container)?.className).toContain('text-purple-300');
    // Over the line at 100 s, and the clock reads 200.
    expect(lap(container)?.textContent).toBe('1:40.0');
  });

  it('adds the target up only as far as the sector being driven', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, currentSectorIdx: 1 }}
      />
    );

    expect(target(container)?.textContent).toBe('1:19.100');
  });

  it('calls a best lap PB and the ghost REF', () => {
    const bestLap = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-lap"
        showTargetLap
        data={data}
      />
    );
    expect(row(bestLap.container)?.textContent).toContain('PB');
    expect(target(bestLap.container)?.textContent).toBe('1:41.500');
    bestLap.unmount();

    // The ghost: the all-time lap of 100 s.
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    const ghost = render(
      <SectorDeltaDisplay {...config} showTargetLap data={data} />
    );
    expect(row(ghost.container)?.textContent).toContain('REF');
    expect(target(ghost.container)?.textContent).toBe('1:40.000');
  });

  it('shows dashes for a target that does not exist yet', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="all-time-best"
        showTargetLap
        data={data}
      />
    );

    expect(target(container)?.textContent).toBe('-:--.---');
    expect(lap(container)?.textContent).toBe('1:40.0');
  });

  it('holds the gap at the end of a sector, against the target as it stood', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, sectorEvent: secondSectorEnded(2) }}
      />
    );

    // 79.7 s to the end of the second sector against 79.1.
    expect(target(container)?.textContent).toBe('+0.600');
    expect(target(container)?.className).toContain('text-red-400');
    expect(lap(container)?.textContent).toBe('1:19.700');
  });

  it('shows a lap that is ahead of its target in green, below zero', () => {
    const event = secondSectorEnded(2);
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-lap"
        showTargetLap
        data={{ ...data, sectorEvent: event }}
      />
    );

    // 79.7 s against the 81 s of the best lap to the same point.
    expect(target(container)?.textContent).toBe('-1.300');
    expect(target(container)?.className).toContain('text-green-400');
  });

  it('goes back to the target once the hold has run out', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, sectorEvent: secondSectorEnded(6) }}
      />
    );

    expect(target(container)?.textContent).toBe('1:39.200');
    expect(lap(container)?.textContent).toBe('1:40.0');
  });

  it('never holds the gap for longer than half the sector being driven', () => {
    // Four seconds after the sector ended, with a hold of ten asked for:
    // the last time through this sector took 6 s, so three is the most.
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        targetFreezeSeconds={10}
        data={{
          ...data,
          previousLapSectorTimes: [41, 40, 6],
          sectorEvent: secondSectorEnded(4),
        }}
      />
    );

    expect(target(container)?.textContent).toBe('1:39.200');
  });

  it('does not hold the gap at all when set to zero', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        targetFreezeSeconds={0}
        data={{ ...data, sectorEvent: secondSectorEnded(0.5) }}
      />
    );

    expect(target(container)?.textContent).toBe('1:39.200');
  });

  it('shows two dashes for a gap with a sector missing from the lap', () => {
    const event = secondSectorEnded(2);
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={{
          ...data,
          sectorEvent: { ...event, lapSectorTimes: [null, 39.2, null] },
        }}
      />
    );

    expect(target(container)?.textContent).toBe('--');
    expect(lap(container)?.textContent).toBe('-:--.---');
  });

  it('runs no lap clock for a lap that was not followed from the line', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, lapStartTime: null }}
      />
    );

    expect(target(container)?.textContent).toBe('1:39.200');
    expect(lap(container)?.textContent).toBe('-:--.-');
  });

  it('keeps the target and stops the clock out of the car', () => {
    // A team-mate's stint with the widget left on screen: the sectors and
    // the target are the user's own, and no lap of theirs is running.
    trackState.isOnTrack = false;
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        showOnlyWhenOnTrack={false}
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, sectorEvent: secondSectorEnded(2) }}
      />
    );

    expect(target(container)?.textContent).toBe('1:39.200');
    expect(lap(container)?.textContent).toBe('-:--.-');
    expect(cards(container).S1).toBe('+0.300');
  });

  it('shows a still target and lap time in demo mode, whatever is chosen', () => {
    // The sample data has session bests and nothing else, so the all-time
    // comparison that was asked for is not left showing dashes.
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        ghostComparison="all-time-best"
        showTargetLap
        data={{ ...data, sectorEvent: secondSectorEnded(2) }}
        demo
      />
    );

    expect(row(container)?.textContent).toContain('TB');
    expect(target(container)?.textContent).toBe('1:39.200');
    // Two sectors of the sample lap and four tenths of the third.
    expect(lap(container)?.textContent).toBe('1:29.2');
  });

  it('follows the precision of the widget', () => {
    const { container } = render(
      <SectorDeltaDisplay
        {...config}
        timeFormat="seconds-2"
        ghostComparison="session-best-only"
        showTargetLap
        data={{ ...data, sectorEvent: secondSectorEnded(2) }}
      />
    );

    expect(target(container)?.textContent).toBe('+0.60');
    expect(lap(container)?.textContent).toBe('1:19.70');
  });
});
