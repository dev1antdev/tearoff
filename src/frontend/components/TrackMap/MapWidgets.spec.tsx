import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@irdashies/context';
import type { TrackDrawing } from '@irdashies/domain/track';
import type {
  ActiveSimulator,
  DashboardBridge,
  LmuTrackMap,
  Session,
} from '@irdashies/types';
import { FlatTrackMapWidget, TrackMapWidget } from './MapWidgets';

/**
 * Which sim's map the overlay mounts for `map` and `flatmap`.
 *
 * The four maps themselves are stood in for: this is about the choice, made
 * from the session in the real store and the simulator the real bridge hook
 * reports.
 */
const mounted = vi.hoisted(() => ({
  lmuMap: [] as { embedded?: boolean; drawing: unknown }[],
  embedded: [] as [string, boolean | undefined][],
}));
vi.mock('./TrackMap', () => ({
  TrackMap: ({ embedded }: { embedded?: boolean }) => {
    mounted.embedded.push(['map', embedded]);
    return <div>Map from the shipped drawing</div>;
  },
}));
vi.mock('./TrackMapLmu', () => ({
  TrackMapLmu: (props: { embedded?: boolean; drawing: unknown }) => {
    mounted.lmuMap.push(props);
    mounted.embedded.push(['lmuMap', props.embedded]);
    return <div>Map from the session outline</div>;
  },
}));
vi.mock('./FlatTrackMap', () => ({
  FlatTrackMap: ({ embedded }: { embedded?: boolean }) => {
    mounted.embedded.push(['flat', embedded]);
    return <div>Flat map for a shipped drawing</div>;
  },
}));
vi.mock('./FlatTrackMapLmu', () => ({
  FlatTrackMapLmu: ({ embedded }: { embedded?: boolean }) => {
    mounted.embedded.push(['lmuFlat', embedded]);
    return <div>Flat map for Le Mans Ultimate</div>;
  },
}));

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const outline = (points = square): LmuTrackMap => ({
  orientation: 'lmu-ccw-v1',
  active: {
    inside: '',
    outside: '',
    // A copy: the session is republished with a new one each time.
    trackPathPoints: points.map((point) => ({ ...point })),
    totalLength: points.length - 1,
  },
  startFinish: {
    line: '',
    point: { ...points[0], length: 0 },
    direction: 'anticlockwise',
  },
});

const setSession = (session: Partial<Session> | null) =>
  act(() => useSessionStore.setState({ session: session as Session | null }));

const iracingSession = { WeekendInfo: { TrackID: 47 } } as Partial<Session>;
const lmuSession = (map?: LmuTrackMap) =>
  ({
    WeekendInfo: { TrackID: 1_694_510_461 },
    ...(map ? { LmuTrackMap: map } : {}),
  }) as Partial<Session>;

/** The dashboard bridge of a window whose main process names this sim. */
const runSimulator = async (simulator: ActiveSimulator | null) => {
  window.dashboardBridge = {
    getActiveSimulator: async () => simulator,
    onSimulatorChanged: () => () => undefined,
  } as unknown as DashboardBridge;
};

/** Lets the bridge's answer about the simulator arrive. */
const settle = () => act(async () => undefined);

describe('the map widgets', () => {
  const previousBridge = window.dashboardBridge;

  beforeEach(() => {
    mounted.lmuMap.length = 0;
    mounted.embedded.length = 0;
    Reflect.deleteProperty(window, 'dashboardBridge');
    useSessionStore.setState({ session: null });
  });
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ session: null });
    if (previousBridge) window.dashboardBridge = previousBridge;
    else Reflect.deleteProperty(window, 'dashboardBridge');
  });

  describe('under iRacing', () => {
    it('mount the maps made of the shipped drawing', async () => {
      await runSimulator('iracing');
      setSession(iracingSession);
      render(
        <>
          <TrackMapWidget />
          <FlatTrackMapWidget />
        </>
      );
      await settle();

      expect(screen.getByText('Map from the shipped drawing')).toBeTruthy();
      expect(screen.getByText('Flat map for a shipped drawing')).toBeTruthy();
      expect(mounted.lmuMap).toEqual([]);
    });

    it('do the same while no simulator is known: demo mode, a browser source', () => {
      setSession(iracingSession);
      render(
        <>
          <TrackMapWidget />
          <FlatTrackMapWidget />
        </>
      );

      expect(screen.getByText('Map from the shipped drawing')).toBeTruthy();
      expect(screen.getByText('Flat map for a shipped drawing')).toBeTruthy();
    });

    it('never leave them for the other pair, whatever the session republishes', async () => {
      await runSimulator('iracing');
      setSession(iracingSession);
      render(<TrackMapWidget />);
      await settle();
      setSession({ ...iracingSession });
      setSession({ WeekendInfo: { TrackID: 337 } } as Partial<Session>);

      expect(mounted.embedded.every(([map]) => map === 'map')).toBe(true);
    });
  });

  describe('under Le Mans Ultimate', () => {
    it('mount the maps made of the outline the session carries', async () => {
      await runSimulator('lmu');
      setSession(lmuSession(outline()));
      render(
        <>
          <TrackMapWidget />
          <FlatTrackMapWidget />
        </>
      );
      await settle();

      expect(screen.getByText('Map from the session outline')).toBeTruthy();
      expect(screen.getByText('Flat map for Le Mans Ultimate')).toBeTruthy();
      const drawing = mounted.lmuMap.at(-1)?.drawing as TrackDrawing;
      // The four samples and the first again: the lap, closed.
      expect(drawing.active.trackPathPoints).toHaveLength(5);
      expect(drawing.active.inside).toBe('M0,0 L100,0 L100,100 L0,100 Z');
    });

    it('take the outline as settling it before the simulator is known', () => {
      // The session can arrive before the main process has said which sim
      // is running, and only a Le Mans Ultimate one carries an outline.
      setSession(lmuSession(outline()));
      render(<TrackMapWidget />);

      expect(mounted.embedded).toEqual([['lmuMap', undefined]]);
    });

    it('mount the same pair for a circuit with no outline, with none to draw', async () => {
      await runSimulator('lmu');
      setSession(lmuSession());
      render(
        <>
          <TrackMapWidget />
          <FlatTrackMapWidget />
        </>
      );
      await settle();

      // Not the drawing for its track id: that id names no iRacing track.
      expect(screen.queryByText('Map from the shipped drawing')).toBeNull();
      expect(mounted.lmuMap.at(-1)?.drawing).toBeNull();
      expect(screen.getByText('Flat map for Le Mans Ultimate')).toBeTruthy();
    });

    it('hand over the outline when the lap that draws it has been driven', async () => {
      await runSimulator('lmu');
      setSession(lmuSession());
      render(<TrackMapWidget />);
      await settle();
      expect(mounted.lmuMap.at(-1)?.drawing).toBeNull();

      setSession(lmuSession(outline()));

      expect(mounted.lmuMap.at(-1)?.drawing).not.toBeNull();
    });

    it('keep one drawing while the session republishes the same outline', async () => {
      await runSimulator('lmu');
      setSession(lmuSession(outline()));
      render(<TrackMapWidget />);
      await settle();
      const first = mounted.lmuMap.at(-1)?.drawing;

      // A position moved: the whole session again, the map a fresh copy.
      setSession(lmuSession(outline()));
      expect(mounted.lmuMap.at(-1)?.drawing).toBe(first);

      // Another circuit is another drawing.
      setSession(
        lmuSession(outline(square.map(({ x, y }) => ({ x: x * 2, y }))))
      );
      expect(mounted.lmuMap.at(-1)?.drawing).not.toBe(first);
    });
  });

  it('pass on that the map is docked in the Gantry', () => {
    setSession(iracingSession);
    render(
      <>
        <TrackMapWidget embedded />
        <FlatTrackMapWidget embedded />
      </>
    );
    setSession(lmuSession(outline()));

    expect(mounted.embedded).toEqual([
      ['map', true],
      ['flat', true],
      ['lmuMap', true],
      ['lmuFlat', true],
    ]);
  });
});
