import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { InformationBar } from './InformationBar';

/**
 * "Show only when on track" in the Info Bar: on track is driving, or
 * watching a car that is out of its garage.
 */
const scene = vi.hoisted(() => ({
  isDriving: false,
  isWatching: false,
  showOnlyWhenOnTrack: true,
}));

vi.mock('@irdashies/context', () => ({
  useGeneralSettings: () => undefined,
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
  }),
  useSessionVisibility: () => true,
}));

vi.mock('@irdashies/domain', () => ({
  useInformationBarSettings: () => ({
    ...getWidgetDefaultConfig('infobar'),
    enabled: true,
    showOnlyWhenOnTrack: scene.showOnlyWhenOnTrack,
  }),
}));

vi.mock('../Standings/components/SessionBar/SessionBar', () => ({
  SessionBar: () => <div data-testid="session-bar" />,
}));

const isShown = (): boolean =>
  render(<InformationBar />).container.querySelector(
    '[data-testid="session-bar"]'
  ) !== null;

beforeEach(() => {
  scene.isDriving = false;
  scene.isWatching = false;
  scene.showOnlyWhenOnTrack = true;
});

describe('Info Bar set to show only when on track', () => {
  it('is shown while driving', () => {
    scene.isDriving = true;

    expect(isShown()).toBe(true);
  });

  it('is shown while watching a car, as through a team-mate’s stint', () => {
    scene.isWatching = true;

    expect(isShown()).toBe(true);
  });

  it('is hidden while neither: in the garage, or in the menus', () => {
    const { container } = render(<InformationBar />);

    expect(container.innerHTML).toBe('');
  });

  it('is shown anywhere with the setting off', () => {
    scene.showOnlyWhenOnTrack = false;

    expect(isShown()).toBe(true);
  });
});
