import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Show only when on track" in the Standings and the Relative: on track is
 * driving, or watching a car that is out of its garage.
 */
const scene = vi.hoisted(() => ({
  isDriving: false,
  isWatching: false,
  showOnlyWhenOnTrack: true,
}));

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useGeneralSettings: () => undefined,
  useLapTimesStoreUpdater: () => undefined,
  useLapTimeHistory: () => [],
  useP2PDisplayStates: () => [],
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
  }),
  useWeekendInfoNumCarClasses: () => 1,
  useWeekendInfoTeamRacing: () => false,
  useSessionVisibility: () => true,
  useCarIdxRollingAvgLapTime: () => [],
  usePitStopDuration: () => [],
  usePitLaneStore: () => null,
  useFirstObservedLap: () => [],
  useActiveSimulator: () => 'lmu',
  useFocusCarIdx: () => 4,
  useFlagStateSnapshot: () => undefined,
}));

vi.mock('./hooks', () => {
  const settings = () => ({
    showOnlyWhenOnTrack: scene.showOnlyWhenOnTrack,
    titleBar: { enabled: false },
    headerBar: { enabled: false },
    footerBar: { enabled: false },
    driverStandings: { numTopDrivers: 0 },
    buffer: 1,
  });
  return {
    useCarClassStats: () => ({ c1: { shortName: 'LMGT3' } }),
    useDriverStandings: () => [
      [
        'c1',
        [
          {
            carIdx: 4,
            classPosition: 1,
            carClass: { color: 0xff0000 },
            driver: { name: 'Team car', carNum: '77' },
          },
        ],
      ],
    ],
    useStandingsSettings: settings,
    useRelativeSettings: settings,
    useDriverRelatives: () => [],
    useHighlightColor: () => 0xffffff,
    useDriverTagMap: () => ({ tagMap: new Map(), hasAnyTag: false }),
    useManufacturerCounts: () => ({}),
    useClassLapEstimates: () => ({}),
    calculateLapDeltas: () => ({}),
  };
});

vi.mock('./hooks/useIsSingleMake', () => ({ useIsSingleMake: () => false }));
vi.mock('./hooks/useTrackLimitsMax', () => ({
  useTrackLimitsMax: () => undefined,
}));
vi.mock('./components/TitleBar/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('./components/SessionBar/SessionBar', () => ({
  SessionBar: () => null,
}));
vi.mock('./components/DriverClassHeader/DriverClassHeader', () => ({
  DriverClassHeader: () => (
    <tr>
      <td data-testid="class-header" />
    </tr>
  ),
}));
vi.mock('./components/DriverInfoRow/DriverInfoRow', () => ({
  DriverInfoRow: () => (
    <tr>
      <td data-testid="driver-row" />
    </tr>
  ),
}));

import { Relative } from './Relative';
import { Standings } from './Standings';

const isShown = (widget: React.ReactElement): boolean =>
  render(widget).container.querySelector('[data-testid="driver-row"]') !== null;

beforeEach(() => {
  scene.isDriving = false;
  scene.isWatching = false;
  scene.showOnlyWhenOnTrack = true;
});

describe.each([
  ['Standings', () => <Standings />],
  ['Relative', () => <Relative />],
])('%s set to show only when on track', (_name, widget) => {
  it('is shown while driving', () => {
    scene.isDriving = true;

    expect(isShown(widget())).toBe(true);
  });

  it('is shown while watching a car, as through a team-mate’s stint', () => {
    scene.isWatching = true;

    expect(isShown(widget())).toBe(true);
  });

  it('is hidden while neither: in the garage, or in the menus', () => {
    const { container } = render(widget());

    expect(container.innerHTML).toBe('');
  });

  it('is shown anywhere with the setting off', () => {
    scene.showOnlyWhenOnTrack = false;

    expect(isShown(widget())).toBe(true);
  });
});
