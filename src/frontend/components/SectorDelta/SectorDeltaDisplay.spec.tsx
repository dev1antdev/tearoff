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
