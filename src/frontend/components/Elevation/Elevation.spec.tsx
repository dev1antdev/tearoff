import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackProfileSnapshot,
  useTrackStateSelector,
} from '@irdashies/context';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  ElevationConfig,
  TrackProfileSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { Elevation } from './Elevation';

/**
 * Whether nothing painted can reach the screen, as a store: the profile is
 * memoised, so only a hook that subscribes can tell it, as the real one does.
 */
const painting = vi.hoisted(() => {
  let paused = false;
  const listeners = new Set<() => void>();
  return {
    isPaused: () => paused,
    set: (next: boolean) => {
      paused = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@irdashies/context', async () => {
  const { useSyncExternalStore } = await import('react');
  const store = await vi.importActual<
    typeof import('../../context/ChannelStore/ChannelSnapshotStore')
  >('../../context/ChannelStore/ChannelSnapshotStore');
  return {
    getChannelSnapshotStore: store.getChannelSnapshotStore,
    trackStateSelectors: {
      displayUnits: (snapshot: TrackStateSnapshot) => snapshot.displayUnits,
    },
    usePaintingPaused: () =>
      useSyncExternalStore(painting.subscribe, painting.isPaused),
    useDashboard: vi.fn(),
    useDrivingState: vi.fn(),
    useSessionVisibility: vi.fn(),
    useTrackProfileSnapshot: vi.fn(),
    useTrackStateSelector: vi.fn(),
  };
});

const WIDTH = 400;
const HEIGHT = 70;

/** Four buckets: the line 10 m above the lowest point, the top at 40 m. */
const ELEVATION = [10, 40, 0, 20];

const profile = (
  extra: Partial<TrackProfileSnapshot> = {}
): TrackProfileSnapshot => ({
  trackKey: 'lmu:694510461',
  trackLengthM: 3590.35,
  elevationM: ELEVATION,
  lineElevationM: 10,
  elevationRangeM: 40,
  elevationSource: 'recorded',
  recordingProgress: null,
  sectorStartPct: [0, 0.39, 0.792],
  notes: [],
  sessionNum: 0,
  version: 1,
  ...extra,
});

const trackState = (
  extra: Partial<TrackStateSnapshot> = {}
): TrackStateSnapshot =>
  ({
    focusCarIdx: 2,
    carIdxLapDistPct: [0.1, 0.2, 0.75],
    lapDistPct: 0.125,
    displayUnits: 1,
    version: 1,
    ...extra,
  }) as TrackStateSnapshot;

interface Scene {
  config?: Partial<ElevationConfig>;
  isDriving?: boolean;
  isWatching?: boolean;
  sessionVisible?: boolean;
  isDemoMode?: boolean;
  displayUnits?: number;
}

describe('Elevation', () => {
  let publish: ((snapshot: TrackStateSnapshot) => void) | undefined;
  let subscriptions: number;

  const show = (
    snapshot: TrackProfileSnapshot | undefined,
    {
      config = {},
      isDriving = true,
      isWatching = false,
      sessionVisible = true,
      isDemoMode = false,
      displayUnits = 1,
    }: Scene = {}
  ) => {
    vi.mocked(useDashboard).mockReturnValue({
      currentDashboard: { widgets: [{ id: 'elevation', config }] },
      isDemoMode,
    } as unknown as ReturnType<typeof useDashboard>);
    vi.mocked(useDrivingState).mockReturnValue({
      isDriving,
      isWatching,
      isWatchingOwnCar: false,
      isWatchingOtherCar: isWatching,
    });
    vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
    vi.mocked(useTrackProfileSnapshot).mockReturnValue(snapshot);
    vi.mocked(useTrackStateSelector).mockReturnValue(displayUnits as never);
    return render(<Elevation />);
  };

  const drive = (extra: Partial<TrackStateSnapshot> = {}) =>
    act(() => publish?.(trackState(extra)));

  /** The paths of the profile itself, in the order they are drawn. */
  const profilePaths = () =>
    [...screen.getByTestId('elevation-profile').querySelectorAll('path')].map(
      (path) => path.getAttribute('d')
    );

  const reading = () => screen.getByTestId('elevation-reading').textContent;
  const markX = () =>
    Number(screen.getByTestId('elevation-mark').getAttribute('x1'));
  const dot = () => {
    const element = screen.getByTestId('elevation-dot');
    return {
      x: Number(element.getAttribute('cx')),
      y: Number(element.getAttribute('cy')),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    painting.set(false);
    publish = undefined;
    subscriptions = 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
      WIDTH
    );
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
      HEIGHT
    );
    const bridge: ChannelBridge = {
      subscribe: <K extends ChannelName>(
        channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        if (channel !== 'track-state.snapshot') return () => undefined;
        subscriptions += 1;
        publish = callback as (snapshot: TrackStateSnapshot) => void;
        return () => {
          subscriptions -= 1;
          publish = undefined;
        };
      },
    };
    window.channelBridge = bridge;
  });

  afterEach(() => {
    // Unmounted before the bridge goes: the mark is still subscribed to it.
    cleanup();
    Reflect.deleteProperty(window, 'channelBridge');
    vi.restoreAllMocks();
  });

  describe('the profile', () => {
    it('is drawn across the box, closed at the height it began at', () => {
      show(profile());

      const [area, tint, line, driven] = profilePaths();
      // 10, 40, 0 and 20 m between 8 px margins, and back to the first.
      expect(line).toBe('M0 48.5L100 8L200 62L300 35L400 48.5');
      expect(area).toBe(`${line}L400 70L0 70Z`);
      // The same two again, shown as far as the car has got.
      expect(tint).toBe(area);
      expect(driven).toBe(line);
    });

    it('marks where the sectors start, and not the line twice', () => {
      show(profile());

      expect(
        screen
          .getAllByTestId('elevation-sector')
          .map((line) => Number(line.getAttribute('x1')))
      ).toEqual([0.39 * WIDTH, 0.792 * WIDTH]);
    });

    it('leaves the sector lines and the tint out when switched off', () => {
      show(profile(), {
        config: { showSectors: false, showProgress: false },
      });

      expect(screen.queryByTestId('elevation-sector')).toBeNull();
      expect(profilePaths()).toHaveLength(2);
    });

    it("prints the lap's range in whole metres", () => {
      show(profile());

      expect(screen.getByTestId('elevation-range')).toHaveTextContent('40 m');
    });

    it('prints the range in feet where the driver reads feet', () => {
      show(profile(), { displayUnits: 0 });

      expect(screen.getByTestId('elevation-range')).toHaveTextContent('131 ft');
    });

    it('leaves the range out when switched off', () => {
      show(profile(), { config: { showRange: false } });

      expect(screen.queryByTestId('elevation-range')).toBeNull();
    });
  });

  describe("the car's place", () => {
    it('is marked at its lap fraction, on the profile', async () => {
      show(profile());
      await drive({ lapDistPct: 0.125 });

      // Half-way from the first bucket to the second: 25 m up.
      expect(markX()).toBe(50);
      expect(dot()).toEqual({ x: 50, y: 28.3 });
      expect(reading()).toBe('25.0');
    });

    it('moves with the car without drawing the widget again', async () => {
      show(profile());
      await drive({ lapDistPct: 0.125 });
      const renders = vi.mocked(useTrackProfileSnapshot).mock.calls.length;

      await drive({ lapDistPct: 0.5 });

      expect(markX()).toBe(200);
      expect(dot().y).toBe(62);
      expect(reading()).toBe('0.0');
      expect(vi.mocked(useTrackProfileSnapshot).mock.calls).toHaveLength(
        renders
      );
    });

    it('runs from the last bucket back to the line', async () => {
      show(profile());
      await drive({ lapDistPct: 0.875 });

      // Half-way from 20 m back to the 10 m of the line.
      expect(markX()).toBe(350);
      expect(reading()).toBe('15.0');
    });

    it('tints the lap as far as the car has got', async () => {
      const { container } = show(profile());
      await drive({ lapDistPct: 0.25 });

      expect(
        container.querySelector('clipPath rect')?.getAttribute('width')
      ).toBe('100.0');
    });

    it('is that of the car being watched while watching', async () => {
      show(profile(), { isDriving: false, isWatching: true });
      await drive({ lapDistPct: 0.125, focusCarIdx: 2 });

      // The camera's car is three quarters round: on the last bucket.
      expect(markX()).toBe(300);
      expect(reading()).toBe('20.0');
    });

    it("is the player's own at the wheel, whatever the camera is on", async () => {
      show(profile(), { isDriving: true, isWatching: false });
      await drive({ lapDistPct: 0.125, focusCarIdx: 2 });

      expect(markX()).toBe(50);
    });
  });

  describe('the reading', () => {
    it('is signed when it is measured from the line', async () => {
      show(profile(), { config: { zero: 'line' } });
      await drive({ lapDistPct: 0.125 });
      // 25 m above the lowest point is 15 m above the line.
      expect(reading()).toBe('+15.0');

      await drive({ lapDistPct: 0.5 });
      expect(reading()).toBe('-10.0');

      await drive({ lapDistPct: 0 });
      expect(reading()).toBe('0.0');
    });

    it('is in feet when the unit is set to feet', async () => {
      const { container } = show(profile(), { config: { unit: 'ft' } });
      await drive({ lapDistPct: 0.125 });

      // 25 m by 3.28084.
      expect(reading()).toBe('82.0');
      expect(container).toHaveTextContent('82.0ft');
      expect(screen.getByTestId('elevation-range')).toHaveTextContent('131 ft');
    });

    it('follows the sim on auto and keeps to metres when set to them', async () => {
      show(profile(), { displayUnits: 0 });
      await drive({ lapDistPct: 0.125 });
      expect(reading()).toBe('82.0');
      cleanup();

      show(profile(), { displayUnits: 0, config: { unit: 'm' } });
      await drive({ lapDistPct: 0.125 });
      expect(reading()).toBe('25.0');
    });

    it('is left out when switched off', () => {
      show(profile(), { config: { showReading: false } });

      expect(screen.queryByTestId('elevation-reading')).toBeNull();
    });
  });

  describe('without a profile', () => {
    it('says how to get one, over a flat line', async () => {
      show(profile({ elevationM: [], elevationSource: null }));
      await drive({ lapDistPct: 0.4 });

      expect(
        screen.getByText('Drive one clean lap to record the profile')
      ).toBeInTheDocument();
      expect(reading()).toBe('--.-');
      expect(profilePaths()).toEqual([
        'M0 35L400 35L400 70L0 70Z',
        'M0 35L400 35',
      ]);
      // No car to place on a profile that is not there, and no range.
      expect(screen.queryByTestId('elevation-mark')).toBeNull();
      expect(screen.queryByTestId('elevation-range')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('shows how far round the lap that records it the car is', () => {
      show(
        profile({
          elevationM: [],
          elevationSource: null,
          recordingProgress: 0.35,
        })
      );

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '35'
      );
    });

    it('keeps its shape before the channel has answered', () => {
      show(undefined);

      expect(
        screen.getByText('Drive one clean lap to record the profile')
      ).toBeInTheDocument();
      expect(reading()).toBe('--.-');
    });

    it('draws a fixed profile in demo mode', async () => {
      show(undefined, { isDemoMode: true });
      await drive({ lapDistPct: 0.5 });

      expect(
        screen.queryByText('Drive one clean lap to record the profile')
      ).toBeNull();
      expect(profilePaths()).toHaveLength(4);
      expect(reading()).not.toBe('--.-');
    });
  });

  it('draws a profile from a TinyPedal map the same, while its own is recorded', () => {
    show(profile({ elevationSource: 'tinypedal', recordingProgress: 0.6 }));

    expect(profilePaths()).toHaveLength(4);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '60'
    );
  });

  describe('while nothing painted can be seen', () => {
    it('moves nothing, and places the car once it can be seen again', async () => {
      show(profile());
      await drive({ lapDistPct: 0.125 });
      expect(markX()).toBe(50);

      act(() => painting.set(true));
      await drive({ lapDistPct: 0.25 });
      await drive({ lapDistPct: 0.5 });
      // Still where it was when the overlay was hidden.
      expect(markX()).toBe(50);
      expect(reading()).toBe('25.0');

      act(() => painting.set(false));
      expect(markX()).toBe(200);
      expect(reading()).toBe('0.0');
    });
  });

  describe('visibility', () => {
    it('hides while the player is neither driving nor watching', () => {
      const { container } = show(profile(), { isDriving: false });

      expect(container).toBeEmptyDOMElement();
      // Hidden, it asks for neither channel.
      expect(vi.mocked(useTrackProfileSnapshot)).toHaveBeenCalledWith(false);
      expect(subscriptions).toBe(0);
    });

    it('stays while a car is being watched', () => {
      const { container } = show(profile(), {
        isDriving: false,
        isWatching: true,
      });

      expect(container).not.toBeEmptyDOMElement();
    });

    it('stays out of the car when set to', () => {
      const { container } = show(profile(), {
        config: { showOnlyWhenOnTrack: false },
        isDriving: false,
      });

      expect(container).not.toBeEmptyDOMElement();
    });

    it('hides in a session it is switched off for', () => {
      const { container } = show(profile(), { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
    });

    it('lets go of the channel when it goes', () => {
      const { unmount } = show(profile());
      expect(subscriptions).toBe(1);

      unmount();
      expect(subscriptions).toBe(0);
    });
  });
});
