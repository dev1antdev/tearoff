import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { useMinimapSnapshot } from '@irdashies/context';
import { Minimap } from './Minimap';

/**
 * "Show only when on track" in the Minimap: on track is driving, or watching
 * a car that is out of its garage.
 */
const scene = vi.hoisted(() => ({
  isDriving: false,
  isWatching: false,
  showOnlyWhenOnTrack: true,
}));

vi.mock('@irdashies/context', () => ({
  useActiveSimulator: () => 'lmu',
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
  }),
  useGeneralSettings: () => undefined,
  useMinimapSnapshot: vi.fn(),
  useSessionDrivers: () => [],
  useSessionStore: () => -1,
  useSessionVisibility: () => true,
}));

vi.mock('@irdashies/domain/track', () => ({
  useSessionTrackGeometry: () => ({ geometry: undefined }),
}));

vi.mock('./hooks/useMinimapSettings', () => ({
  useMinimapSettings: () => ({
    ...getWidgetDefaultConfig('minimap'),
    showOnlyWhenOnTrack: scene.showOnlyWhenOnTrack,
  }),
}));

vi.mock('./MinimapCanvas', () => ({
  MinimapCanvas: () => <div data-testid="minimap-canvas" />,
}));

const isShown = (): boolean =>
  render(<Minimap />).container.querySelector(
    '[data-testid="minimap-canvas"]'
  ) !== null;

beforeEach(() => {
  vi.mocked(useMinimapSnapshot).mockReset();
  scene.isDriving = false;
  scene.isWatching = false;
  scene.showOnlyWhenOnTrack = true;
});

describe('Minimap set to show only when on track', () => {
  it('is shown while driving', () => {
    scene.isDriving = true;

    expect(isShown()).toBe(true);
  });

  it('is shown while watching a car, as through a team-mate’s stint', () => {
    scene.isWatching = true;

    expect(isShown()).toBe(true);
    // And it asks for its channel, which it does not while hidden.
    expect(useMinimapSnapshot).toHaveBeenLastCalledWith(true);
  });

  it('is hidden while neither: in the garage, or in the menus', () => {
    const { container } = render(<Minimap />);

    expect(container.innerHTML).toBe('');
    expect(useMinimapSnapshot).toHaveBeenLastCalledWith(false);
  });

  it('is shown anywhere with the setting off', () => {
    scene.showOnlyWhenOnTrack = false;

    expect(isShown()).toBe(true);
  });
});
