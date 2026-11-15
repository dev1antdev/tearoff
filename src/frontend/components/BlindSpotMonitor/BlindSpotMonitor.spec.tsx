import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarLeftRight, type BlindSpotSnapshot } from '@irdashies/types';
import { BlindSpotMonitor } from './BlindSpotMonitor';

/** A car on the left, `metres` ahead of ours, as a sim reporting offsets. */
const alongside = (metres: number): BlindSpotSnapshot => ({
  carLeftRight: CarLeftRight.CarLeft,
  carIdxLapDistPct: [],
  isOnTrack: true,
  leftLongitudinalM: metres,
  rightLongitudinalM: null,
  version: 1,
});

const scene = vi.hoisted(() => ({
  hidden: false,
  snapshot: undefined as unknown,
  dashboard: {
    isDemoMode: false,
    currentDashboard: {
      widgets: [
        { id: 'blindspotmonitor', config: { distAhead: 4, distBehind: 4 } },
      ],
    },
  },
}));

vi.mock('@irdashies/context', () => ({
  useDriverCarIdx: () => 0,
  useTrackLength: () => 5000,
  useBlindSpotSelector: (selector: (snapshot: BlindSpotSnapshot) => unknown) =>
    selector(scene.snapshot as BlindSpotSnapshot),
  useDashboard: () => scene.dashboard,
  useSessionVisibility: () => true,
  usePaintingPaused: () => scene.hidden,
}));

/** The bar that slides with the car alongside: the left one comes first. */
const bar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[style*="transform"]');

describe('BlindSpotMonitor while the overlay is hidden', () => {
  beforeEach(() => {
    scene.hidden = false;
    scene.snapshot = alongside(1);
  });
  afterEach(cleanup);

  it('moves no bar, and brings it back where the car alongside is by then', () => {
    const view = render(<BlindSpotMonitor />);
    // 1 m ahead of a 4 m reach: a quarter of the way up.
    expect(bar(view.container)?.style.transform).toBe('translateY(12.5%)');

    scene.hidden = true;
    view.rerender(<BlindSpotMonitor />);
    // Nothing left to restyle or to run a transition on, tick after tick.
    expect(view.container.innerHTML).toBe('');
    scene.snapshot = alongside(2);
    view.rerender(<BlindSpotMonitor />);
    scene.snapshot = alongside(3);
    view.rerender(<BlindSpotMonitor />);
    expect(view.container.innerHTML).toBe('');

    scene.hidden = false;
    view.rerender(<BlindSpotMonitor />);
    const back = bar(view.container);
    // Where the car is now, placed at once rather than slid there.
    expect(back?.style.transform).toBe('translateY(-62.5%)');
    expect(back?.style.transition).toBe('none');
  });
});
