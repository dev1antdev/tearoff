import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { Battle } from './Battle';

/**
 * "Show only when on track" in the Battle widget: on track is driving, or
 * watching a car that is out of its garage.
 */
const scene = vi.hoisted(() => ({
  isDriving: false,
  isWatching: false,
  showOnlyWhenOnTrack: true,
}));

vi.mock('@irdashies/context', () => ({
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
  }),
  useSessionVisibility: () => true,
  usePitLap: () => [],
  useCarLap: () => [],
  // The car the camera is on: the team car, while a team-mate drives it.
  useFocusCarIdx: () => 4,
  useGeneralSettings: () => undefined,
  useLapHistorySnapshot: () => undefined,
  useWeekendInfoNumCarClasses: () => 1,
  useCarIdxSpeed: () => [],
  useTrackStateSnapshot: () => undefined,
  useSessionStore: () => -1,
}));

vi.mock('@irdashies/domain', () => ({
  useHighlightColor: () => 0xffffff,
  useDriverRelatives: () => [],
  useDriverStandings: () => [],
  useDriverLivePositions: () => ({}),
  lastLineGap: () => null,
}));

vi.mock('./hooks/useBattleSettings', () => ({
  useBattleSettings: () => ({
    ...getWidgetDefaultConfig('battle'),
    showOnlyWhenOnTrack: scene.showOnlyWhenOnTrack,
  }),
}));

const isShown = (): boolean =>
  render(<Battle />).container.querySelector('table') !== null;

beforeEach(() => {
  scene.isDriving = false;
  scene.isWatching = false;
  scene.showOnlyWhenOnTrack = true;
});

describe('Battle set to show only when on track', () => {
  it('is shown while driving', () => {
    scene.isDriving = true;

    expect(isShown()).toBe(true);
  });

  it('is shown while watching a car, as through a team-mate’s stint', () => {
    scene.isWatching = true;

    expect(isShown()).toBe(true);
  });

  it('is hidden while neither: in the garage, or in the menus', () => {
    const { container } = render(<Battle />);

    expect(container.innerHTML).toBe('');
  });

  it('is shown anywhere with the setting off', () => {
    scene.showOnlyWhenOnTrack = false;

    expect(isShown()).toBe(true);
  });
});
