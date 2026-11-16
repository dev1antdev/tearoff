import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ChannelBridge,
  type LapAverageLaps,
  type LapTimesSnapshot,
  type StandingsConfig,
} from '@irdashies/types';
import { useLapTimesStore } from '@irdashies/context';

/**
 * The Avg 5 and Avg 10 columns in a rendered Standings and a rendered
 * Relative: the widget, its rows and cells, the lap-time store and its
 * updater are the real ones, fed `lap-times.snapshot` over a stub channel
 * bridge. The rows and the settings are staged.
 */
const scene = vi.hoisted(() => ({
  standings: undefined as unknown,
  relative: undefined as unknown,
  lapTimes: undefined as unknown,
  subscribed: [] as string[],
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
    car(0, 'Ran Clean'),
    car(1, 'Just Pitted'),
    car(2, 'Four Laps'),
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

/** The settings the two widgets share where the averages are concerned. */
interface AverageSettings {
  avgLast5: { enabled: boolean; timeFormat: string };
  avgLast10: { enabled: boolean; timeFormat: string };
  averagesOver: LapAverageLaps;
  displayOrder: string[];
}

/** Both widgets get the same settings on top of their own defaults. */
const configure = (overrides: Partial<AverageSettings> = {}) => {
  scene.standings = { ...getWidgetDefaultConfig('standings'), ...overrides };
  scene.relative = {
    ...getWidgetDefaultConfig('relative'),
    // One row either side of the focus car: the three staged cars.
    buffer: 1,
    ...overrides,
  };
};

const BOTH_ON: Partial<AverageSettings> = {
  avgLast5: { enabled: true, timeFormat: 'full' },
  avgLast10: { enabled: true, timeFormat: 'full' },
};

/**
 * Three cars, oldest lap first. The first lap of each was not watched from
 * its start, so it is in every car's laps and in nobody's clean laps.
 *
 * - Car 0 ran eleven laps without stopping: ten clean.
 * - Car 1 ran eleven and stopped on its seventh: the in-lap (131) and the
 *   out-lap (141) are not clean, which leaves eight.
 * - Car 2 has four laps, three of them clean.
 */
const LAP_TIMES: LapTimesSnapshot = {
  lapTimes: [],
  lapTimeHistory: [
    [100, 90, 91, 92, 93, 94, 90, 91, 92, 93, 94],
    [101, 91, 92, 93, 94, 95, 131, 141, 93, 94, 95],
    [99, 96, 97, 98],
  ],
  cleanLapTimeHistory: [
    [90, 91, 92, 93, 94, 90, 91, 92, 93, 94],
    [91, 92, 93, 94, 95, 93, 94, 95],
    [96, 97, 98],
  ],
  sessionNum: 0,
  version: 1,
};

const column = (container: HTMLElement, id: string) =>
  Array.from(container.querySelectorAll(`td[data-column="${id}"]`)).map(
    (cell) => cell.textContent
  );

beforeEach(() => {
  scene.lapTimes = LAP_TIMES;
  scene.subscribed = [];
  configure();
  window.channelBridge = {
    subscribe: (channel: string, callback: (payload: unknown) => void) => {
      scene.subscribed.push(channel);
      if (channel === 'lap-times.snapshot') callback(scene.lapTimes);
      return () => undefined;
    },
  } as unknown as ChannelBridge;
});

afterEach(() => {
  cleanup();
  useLapTimesStore.getState().reset();
  Reflect.deleteProperty(window, 'channelBridge');
});

describe.each([
  ['Standings', () => <Standings />],
  ['Relative', () => <Relative />],
])('%s: Avg 5 and Avg 10', (_name, widget) => {
  it('are off on a new dashboard, and nothing listens for lap times', () => {
    const { container } = render(widget());

    expect(column(container, 'driverName')).toHaveLength(3);
    expect(column(container, 'avgLast5')).toEqual([]);
    expect(column(container, 'avgLast10')).toEqual([]);
    expect(scene.subscribed).not.toContain('lap-times.snapshot');
  });

  it('average the clean laps by default, and wait for enough of them', () => {
    configure(BOTH_ON);

    const { container } = render(widget());

    expect(scene.subscribed).toContain('lap-times.snapshot');
    // Car 1's last five clean laps skip its stop; it has eight clean laps,
    // which is not ten. Car 2 has three.
    expect(column(container, 'avgLast5')).toEqual([
      '1:32.000',
      '1:34.200',
      '--',
    ]);
    expect(column(container, 'avgLast10')).toEqual(['1:32.000', '--', '--']);
  });

  it('average every lap when set to all laps, the stop included', () => {
    configure({ ...BOTH_ON, averagesOver: 'all' });

    const { container } = render(widget());

    // Car 1's in-lap and out-lap are now two of its last five, and it has
    // the ten laps the clean count was short of. Car 2 still has only four.
    expect(column(container, 'avgLast5')).toEqual([
      '1:32.000',
      '1:50.800',
      '--',
    ]);
    expect(column(container, 'avgLast10')).toEqual([
      '1:32.000',
      '1:41.900',
      '--',
    ]);
  });

  it('follow the switch between the two while on screen', () => {
    configure(BOTH_ON);
    const { container, rerender } = render(widget());
    expect(column(container, 'avgLast5')[1]).toBe('1:34.200');

    configure({ ...BOTH_ON, averagesOver: 'all' });
    rerender(widget());
    expect(column(container, 'avgLast5')[1]).toBe('1:50.800');

    configure({ ...BOTH_ON, averagesOver: 'clean' });
    rerender(widget());
    expect(column(container, 'avgLast5')[1]).toBe('1:34.200');
  });

  it('show dashes for clean laps where the source sends no clean history', () => {
    scene.lapTimes = {
      lapTimes: [],
      lapTimeHistory: LAP_TIMES.lapTimeHistory,
      sessionNum: 0,
      version: 1,
    } satisfies LapTimesSnapshot;
    configure(BOTH_ON);

    const { container, rerender } = render(widget());

    // Not the average of every lap under the clean heading.
    expect(column(container, 'avgLast5')).toEqual(['--', '--', '--']);
    expect(column(container, 'avgLast10')).toEqual(['--', '--', '--']);

    // The laps are there: all laps has them.
    configure({ ...BOTH_ON, averagesOver: 'all' });
    rerender(widget());
    expect(column(container, 'avgLast5')).toEqual([
      '1:32.000',
      '1:50.800',
      '--',
    ]);
  });

  it('take a stored value that is neither as clean laps', () => {
    configure({
      ...BOTH_ON,
      averagesOver: 'everything' as unknown as LapAverageLaps,
    });

    const { container } = render(widget());

    expect(column(container, 'avgLast5')[1]).toBe('1:34.200');
  });

  it('each use their own time format, like Last and Best', () => {
    configure({
      avgLast5: { enabled: true, timeFormat: 'mixed' },
      avgLast10: { enabled: true, timeFormat: 'seconds-full' },
    });

    const { container } = render(widget());

    expect(column(container, 'avgLast5')).toEqual(['1:32.0', '1:34.2', '--']);
    expect(column(container, 'avgLast10')).toEqual(['32.000', '--', '--']);
  });

  it('can be shown one without the other', () => {
    configure({ avgLast10: { enabled: true, timeFormat: 'full' } });

    const { container } = render(widget());

    expect(column(container, 'avgLast5')).toEqual([]);
    expect(column(container, 'avgLast10')).toEqual(['1:32.000', '--', '--']);
  });

  it('sit where the display order puts them', () => {
    configure({
      ...BOTH_ON,
      displayOrder: ['position', 'driverName', 'avgLast10', 'avgLast5'],
    });

    const { container } = render(widget());

    const row = container.querySelector('td[data-column="avgLast5"]')
      ?.parentElement as HTMLElement;
    const cells = Array.from(row.querySelectorAll('td[data-column]')).map(
      (cell) => cell.getAttribute('data-column')
    );
    expect(cells.slice(-2)).toEqual(['avgLast10', 'avgLast5']);
  });
});

describe('Standings: the headers of Avg 5 and Avg 10', () => {
  it('are AVG 5 and AVG 10, in the order of the columns', () => {
    configure({
      ...BOTH_ON,
      displayOrder: ['position', 'driverName', 'avgLast10', 'avgLast5'],
    });
    scene.standings = {
      ...(scene.standings as StandingsConfig),
      stylingOptions: { columnHeaders: { enabled: true } },
    };

    const { container } = render(<Standings />);

    const header = container.querySelector('tbody tr')?.textContent ?? '';
    expect(header).toContain('AVG 10');
    expect(header).toContain('AVG 5');
    expect(header.indexOf('AVG 10')).toBeLessThan(header.indexOf('AVG 5'));
  });
});
