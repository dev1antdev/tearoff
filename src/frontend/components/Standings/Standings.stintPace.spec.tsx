import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ChannelBridge,
  type RaceHistorySummarySnapshot,
  type StandingsConfig,
  type StintPaceReference,
} from '@irdashies/types';

/**
 * The "vs stint" column in a rendered Standings and a rendered Relative:
 * the widget, its rows and cells and the hook behind the column are the
 * real ones, fed `race-history.summary` over a stub channel bridge. The
 * rows and the settings are staged.
 *
 * What matters most here is the column switched off: reading the summary is
 * what has a race recorded, so a widget that does not show the column must
 * not ask for it.
 */
const scene = vi.hoisted(() => ({
  standings: undefined as unknown,
  relative: undefined as unknown,
  subscribed: [] as string[],
  unsubscribed: [] as string[],
  publish: undefined as ((payload: unknown) => void) | undefined,
}));

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: () => ({ currentDashboard: undefined }),
  useGeneralSettings: () => undefined,
  useP2PDisplayStates: () => [],
  useDrivingState: () => ({ isDriving: true, isWatching: false }),
  useWeekendInfoNumCarClasses: () => 1,
  useWeekendInfoTeamRacing: () => false,
  useSessionVisibility: () => true,
  usePitStopDuration: () => [],
  usePitLaneStore: () => null,
  useFirstObservedLap: () => [],
  useActiveSimulator: () => 'lmu',
  useFocusCarIdx: () => 1,
  useFlagStateSnapshot: () => undefined,
}));

vi.mock('./hooks', () => {
  const car = (carIdx: number, name: string) => ({
    carIdx,
    classPosition: carIdx + 1,
    carClass: { color: 0xff0000 },
    driver: { name, carNum: String(carIdx + 1) },
    onTrack: true,
    // The Relative is built around the focus car.
    isPlayer: carIdx === 1,
  });
  const cars = [
    car(0, 'Double Stint'),
    car(1, 'Two Clean Laps'),
    car(2, 'Never Stopped'),
  ];
  return {
    useCarClassStats: () => ({ c1: { shortName: 'LMGT3' } }),
    useClassFields: () => [],
    useDriverStandings: () => [['c1', cars]],
    useDriverRelatives: () => cars,
    useStandingsSettings: () => scene.standings,
    useRelativeSettings: () => scene.relative,
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

import { Relative } from './Relative';
import { Standings } from './Standings';

/** The settings the two widgets share where the column is concerned. */
interface PaceSettings {
  stintPace: { enabled: boolean };
  paceAgainst: StintPaceReference;
  displayOrder: string[];
}

/** Both widgets get the same settings on top of their own defaults. */
const configure = (overrides: Partial<PaceSettings> = {}) => {
  scene.standings = { ...getWidgetDefaultConfig('standings'), ...overrides };
  scene.relative = {
    ...getWidgetDefaultConfig('relative'),
    // One row either side of the focus car: the three staged cars.
    buffer: 1,
    ...overrides,
  };
};

const ON: Partial<PaceSettings> = { stintPace: { enabled: true } };

/**
 * The summary as the recorder would publish it for the three cars.
 *
 * - Car 0 is in the second half of a double stint: half a second quicker
 *   than the first half, four tenths slower than the driver before.
 * - Car 1 has two clean laps since its stop, one short of a figure.
 * - Car 2 has not stopped: nothing to hold its stint against.
 */
const summary = (
  over: Partial<RaceHistorySummarySnapshot> = {}
): RaceHistorySummarySnapshot => ({
  raceToken: 'boot:1',
  raceId: null,
  resumed: false,
  laps: [40, 38, 41],
  lastLap: [40, 38, 41],
  missingLaps: [0, 0, 0],
  stintFirstLap: [34, 36, 1],
  stintLaps: [7, 3, 41],
  stintDriver: ['B', 'C', 'D'],
  stintAvgLap: [114.0, 115.1, 113.2],
  stintCleanLaps: [6, 2, 40],
  previousStintAvgLap: [114.5, 115.0, -1],
  previousStintDriver: ['B', 'C', ''],
  previousDriverStintAvgLap: [113.6, -1, -1],
  previousDriverStintDriver: ['A', '', ''],
  driverChanges: [1, 0, 0],
  stops: [2, 1, 0],
  revision: [9, 7, 5],
  sessionNum: 0,
  version: 1,
  ...over,
});

const cells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('td[data-column="stintPace"]'));
const column = (container: HTMLElement) =>
  cells(container).map((cell) => cell.textContent);
const tones = (container: HTMLElement) =>
  cells(container).map((cell) => cell.getAttribute('data-tone'));

const SUMMARY = 'race-history.summary';

beforeEach(() => {
  scene.subscribed = [];
  scene.unsubscribed = [];
  scene.publish = undefined;
  configure();
  window.channelBridge = {
    subscribe: (channel: string, callback: (payload: unknown) => void) => {
      scene.subscribed.push(channel);
      if (channel === SUMMARY) {
        scene.publish = callback;
        callback(summary());
      }
      return () => {
        scene.unsubscribed.push(channel);
      };
    },
  } as unknown as ChannelBridge;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'channelBridge');
});

describe.each([
  ['Standings', () => <Standings />],
  ['Relative', () => <Relative />],
])('%s: the vs stint column', (_name, widget) => {
  it('is off on a new dashboard, and the race history is not asked for', () => {
    const { container } = render(widget());

    expect(
      container.querySelectorAll('td[data-column="driverName"]')
    ).toHaveLength(3);
    expect(column(container)).toEqual([]);
    expect(scene.subscribed).not.toContain(SUMMARY);
  });

  it('shows each car against its stint before, signed and coloured', () => {
    configure(ON);

    const { container } = render(widget());

    expect(scene.subscribed).toContain(SUMMARY);
    expect(column(container)).toEqual(['-0.50', '--', '--']);
    expect(tones(container)).toEqual(['faster', 'none', 'none']);
  });

  it('shows each car against the last stint by another driver when set so', () => {
    configure({ ...ON, paceAgainst: 'driver' });

    const { container } = render(widget());

    expect(column(container)).toEqual(['+0.40', '--', '--']);
    expect(tones(container)).toEqual(['slower', 'none', 'none']);
  });

  it('follows the summary as laps come in', () => {
    configure(ON);
    const { container } = render(widget());
    expect(column(container)[1]).toBe('--');

    // Car 1 completes its third clean lap of the stint.
    act(() =>
      scene.publish?.(
        summary({
          stintAvgLap: [114.0, 115.2, 113.2],
          stintCleanLaps: [6, 3, 40],
          version: 2,
        })
      )
    );

    expect(column(container)).toEqual(['-0.50', '+0.20', '--']);
  });

  it('follows the choice between the two while on screen', () => {
    configure(ON);
    const { container, rerender } = render(widget());
    expect(column(container)[0]).toBe('-0.50');

    configure({ ...ON, paceAgainst: 'driver' });
    rerender(widget());
    expect(column(container)[0]).toBe('+0.40');

    configure({ ...ON, paceAgainst: 'stint' });
    rerender(widget());
    expect(column(container)[0]).toBe('-0.50');
  });

  it('lets go of the race history when the column is switched off', () => {
    configure(ON);
    const { container, rerender } = render(widget());
    expect(column(container)).toHaveLength(3);

    configure({ stintPace: { enabled: false } });
    rerender(widget());

    expect(column(container)).toEqual([]);
    expect(scene.unsubscribed).toContain(SUMMARY);
  });

  it('takes a stored value that is neither as the previous stint', () => {
    configure({
      ...ON,
      paceAgainst: 'team' as unknown as StintPaceReference,
    });

    const { container } = render(widget());

    expect(column(container)[0]).toBe('-0.50');
  });

  it('survives an entry stored broken: off without one', () => {
    configure({ stintPace: null } as unknown as Partial<PaceSettings>);

    const { container } = render(widget());

    expect(
      container.querySelectorAll('td[data-column="driverName"]')
    ).toHaveLength(3);
    expect(column(container)).toEqual([]);
    expect(scene.subscribed).not.toContain(SUMMARY);
  });

  it('shows dashes before the recorder has published anything', () => {
    configure(ON);
    window.channelBridge = {
      subscribe: (channel: string) => {
        scene.subscribed.push(channel);
        return () => undefined;
      },
    } as unknown as ChannelBridge;

    const { container } = render(widget());

    expect(scene.subscribed).toContain(SUMMARY);
    expect(column(container)).toEqual(['--', '--', '--']);
  });

  it('sits where the display order puts it', () => {
    configure({
      ...ON,
      displayOrder: ['position', 'stintPace', 'driverName'],
    });

    const { container } = render(widget());

    const row = cells(container)[0].parentElement as HTMLElement;
    const ids = Array.from(row.querySelectorAll('td[data-column]')).map(
      (cell) => cell.getAttribute('data-column')
    );
    expect(ids.indexOf('stintPace')).toBe(ids.indexOf('driverName') - 1);
  });
});

describe('Standings: the header of the vs stint column', () => {
  it('is VS STINT, as the Timing Tower heads it', () => {
    configure(ON);
    scene.standings = {
      ...(scene.standings as StandingsConfig),
      stylingOptions: { columnHeaders: { enabled: true } },
    };

    const { container } = render(<Standings />);

    const header = container.querySelector('tbody tr')?.textContent ?? '';
    expect(header).toContain('VS STINT');
  });

  it('is not there while the column is off', () => {
    scene.standings = {
      ...(scene.standings as StandingsConfig),
      stylingOptions: { columnHeaders: { enabled: true } },
    };

    const { container } = render(<Standings />);

    expect(container.querySelector('tbody tr')?.textContent).not.toContain(
      'VS STINT'
    );
  });
});
