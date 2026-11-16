import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import type { ClassRivals } from '@irdashies/domain';
import { Battle } from './Battle';

/**
 * "Show only when on track" in the Battle widget: on track is driving, or
 * watching a car that is out of its garage.
 */
const scene = vi.hoisted(() => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  showOnlyWhenOnTrack: true,
  header: true,
}));

const NO_RIVALS: ClassRivals = {
  // The car the camera is on: the team car, while a team-mate drives it.
  focusCarIdx: 4,
  isRace: true,
  ahead: undefined,
  focus: undefined,
  behind: undefined,
  available: { pitStops: false, energy: false, trackLimits: false },
  trackLimitsPointsMax: 0,
};

vi.mock('@irdashies/context', () => ({
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
    isWatchingOwnCar: scene.isWatchingOwnCar,
    isWatchingOtherCar: scene.isWatchingOtherCar,
  }),
  useSessionVisibility: () => true,
  useGeneralSettings: () => undefined,
  useWeekendInfoNumCarClasses: () => 1,
  useCarIdxSpeed: () => [],
  trackStateSelectors: { displayUnits: () => undefined },
  useTrackStateSelector: () => undefined,
}));

vi.mock('@irdashies/domain', () => ({
  useHighlightColor: () => 0xffffff,
  useClassRivals: () => NO_RIVALS,
}));

vi.mock('./hooks/useBattleSettings', () => ({
  useBattleSettings: () => ({
    ...getWidgetDefaultConfig('battle'),
    showOnlyWhenOnTrack: scene.showOnlyWhenOnTrack,
    header: { enabled: scene.header },
  }),
}));

const isShown = (): boolean =>
  render(<Battle />).container.querySelector('table') !== null;

beforeEach(() => {
  scene.isDriving = false;
  scene.isWatching = false;
  scene.isWatchingOwnCar = false;
  scene.isWatchingOtherCar = false;
  scene.showOnlyWhenOnTrack = true;
  scene.header = true;
});
afterEach(cleanup);

describe('Battle set to show only when on track', () => {
  it('is shown while driving', () => {
    scene.isDriving = true;

    expect(isShown()).toBe(true);
  });

  it('is shown while watching the team car, as through a team-mate’s stint', () => {
    scene.isWatching = true;
    scene.isWatchingOwnCar = true;

    expect(isShown()).toBe(true);
  });

  it('is shown while watching another car: its rivals are true of it', () => {
    scene.isWatching = true;
    scene.isWatchingOtherCar = true;

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

describe('Battle with nobody to show', () => {
  beforeEach(() => {
    scene.isDriving = true;
  });

  it('keeps its three rows, in dashes, so it can still be placed', () => {
    const { container } = render(<Battle />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.map((row) => row.getAttribute('data-row'))).toEqual([
      'ahead',
      'focus',
      'behind',
    ]);
    for (const row of rows) {
      expect(row.querySelector('[data-column="driverName"]')?.textContent).toBe(
        '—'
      );
    }
  });

  it('labels its columns, and drops the labels with the setting off', () => {
    const labelled = render(<Battle />).container;
    expect(labelled.querySelector('thead')?.textContent).toContain('Gap');
    cleanup();

    scene.header = false;
    expect(render(<Battle />).container.querySelector('thead')).toBeNull();
  });
});
