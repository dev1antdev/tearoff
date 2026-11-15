import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useChannelSelector,
  useDashboard,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import type { FrictionCircleConfig, GForceSnapshot } from '@irdashies/types';
import { FrictionCircle } from './FrictionCircle';
import type { FrictionCircleCanvasProps } from './FrictionCircleCanvas';

vi.mock('@irdashies/context', () => ({
  useChannelSelector: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

const canvasProps = vi.hoisted(() => ({
  last: null as FrictionCircleCanvasProps | null,
}));

vi.mock('./FrictionCircleCanvas', () => ({
  FrictionCircleCanvas: (props: FrictionCircleCanvasProps) => {
    canvasProps.last = props;
    return <canvas data-testid="circle" />;
  },
}));

const reading = (extra: Partial<GForceSnapshot> = {}): GForceSnapshot => ({
  available: true,
  latG: -1.42,
  longG: -1.18,
  maxLatG: 2.36,
  maxLongG: 2.21,
  sustainedLatG: 2.31,
  sessionNum: 0,
  version: 1,
  ...extra,
});

interface Scene {
  /** As saved: a config from an older build may lack whole groups. */
  config?: Partial<FrictionCircleConfig>;
  isDriving?: boolean;
  sessionVisible?: boolean;
}

type Selector = (snapshot: GForceSnapshot) => string;

const show = (
  snapshot: GForceSnapshot | undefined,
  { config = {}, isDriving = true, sessionVisible = true }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'frictioncircle', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  // The widget's own selector, run on the snapshot as the store would.
  vi.mocked(useChannelSelector).mockImplementation(((
    _channel: string,
    selector: Selector
  ) => (snapshot ? selector(snapshot) : undefined)) as never);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: false,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  return render(<FrictionCircle />);
};

const textOf = (container: HTMLElement): string =>
  (container.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('FrictionCircle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvasProps.last = null;
  });

  it('prints the two readings as magnitudes, and their maxima', () => {
    const { container } = show(reading());

    // Lateral and longitudinal at the top, the maximum of each below.
    expect(textOf(container)).toBe('Lat1.42Lon1.18Max2.36Max2.21');
  });

  it('reads the figures ten times a second, not at the rate of the dot', () => {
    show(reading());

    expect(vi.mocked(useChannelSelector)).toHaveBeenCalledWith(
      'g-force.snapshot',
      expect.any(Function),
      { rateHz: 10 }
    );
  });

  it('prints dashes out of the car', () => {
    const { container } = show(reading({ available: false }), {
      config: { showOnlyWhenOnTrack: false },
      isDriving: false,
    });

    expect(textOf(container)).toBe('Lat--Lon--Max--Max--');
    expect(screen.getByTestId('circle')).toBeInTheDocument();
  });

  it('prints dashes before the channel has answered', () => {
    const { container } = show(undefined);

    expect(textOf(container)).toBe('Lat--Lon--Max--Max--');
  });

  it('leaves the figures out when switched off', () => {
    const { container } = show(reading(), { config: { showReadings: false } });

    expect(textOf(container)).toBe('');
    expect(screen.getByTestId('circle')).toBeInTheDocument();
  });

  it('hands the circle its settings', () => {
    show(reading(), {
      config: {
        scaleG: 5,
        orientation: 'acceleration',
        showTrace: false,
        traceSeconds: 8,
        showRings: false,
        showSustainedRing: false,
      },
    });

    expect(canvasProps.last).toEqual({
      scaleG: 5,
      orientation: 'acceleration',
      showTrace: false,
      traceSeconds: 8,
      showRings: false,
      showSustainedRing: false,
    });
  });

  it('uses the defaults for a config saved without them', () => {
    show(reading());

    expect(canvasProps.last).toEqual({
      scaleG: 3.5,
      orientation: 'force',
      showTrace: true,
      traceSeconds: 4,
      showRings: true,
      showSustainedRing: true,
    });
  });

  it('holds a scale and a trail length saved out of range to their limits', () => {
    show(reading(), {
      config: {
        scaleG: 0,
        traceSeconds: 600,
        orientation: 'sideways' as FrictionCircleConfig['orientation'],
      },
    });

    expect(canvasProps.last).toMatchObject({
      scaleG: 1,
      traceSeconds: 10,
      orientation: 'force',
    });
  });

  describe('visibility', () => {
    it('hides while the player is not driving', () => {
      const { container } = show(reading(), { isDriving: false });

      expect(container).toBeEmptyDOMElement();
    });

    it('stays when set to show off track as well', () => {
      const { container } = show(reading(), {
        config: { showOnlyWhenOnTrack: false },
        isDriving: false,
      });

      expect(container).not.toBeEmptyDOMElement();
    });

    it('hides in a session it is switched off for', () => {
      const { container } = show(reading(), { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
