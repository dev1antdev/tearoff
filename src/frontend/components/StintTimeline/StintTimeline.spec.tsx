import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboard, useSessionStore } from '@irdashies/context';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  RaceHistoryBridge,
  RaceHistorySummarySnapshot,
  StintTimelineConfig,
} from '@irdashies/types';
import {
  strategyHistoryBridge,
  strategySlotOf,
  strategyStage,
  type StrategyStage,
} from '../../../../.storybook/strategyStage';
import { StintTimeline } from './StintTimeline';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
  // jsdom lays nothing out: the chart is given the width of a wide panel,
  // where every stint of the staged race has room for its driver's name.
  useElementSize: () => ({ width: 1200, height: 0 }),
}));

/**
 * The Stint Timeline over a stub channel bridge and a stub of the race
 * history's bridge, on the STAGED eight-hour race the stories are told
 * with. The stints driven are staged records, the stints to come what the
 * real forecast processor makes of the staged cars; nothing here was
 * recorded, because no recording has a stop.
 */

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

type Listener = (payload: unknown) => void;

/**
 * A bridge that answers each subscription with the staged snapshot, and
 * lets a test publish another one afterwards.
 */
const stubBridge = (snapshots: Partial<ChannelPayloads>) => {
  const listeners = new Map<string, Set<Listener>>();
  const bridge: ChannelBridge = {
    subscribe: <K extends ChannelName>(
      channel: K,
      callback: (payload: ChannelPayloads[K]) => void
    ) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      listeners.set(channel, set);
      const listener = callback as Listener;
      set.add(listener);
      const snapshot = snapshots[channel];
      if (snapshot !== undefined) callback(snapshot as ChannelPayloads[K]);
      return () => set.delete(listener);
    },
  };
  const publish = <K extends ChannelName>(
    channel: K,
    payload: ChannelPayloads[K]
  ) => listeners.get(channel)?.forEach((listener) => listener(payload));
  return { bridge, publish };
};

interface Shown {
  publish: ReturnType<typeof stubBridge>['publish'];
  history: RaceHistoryBridge;
  summary: RaceHistorySummarySnapshot;
  container: HTMLElement;
  unmount: () => void;
}

const show = (
  stage: StrategyStage = {},
  config: Partial<StintTimelineConfig> = {},
  { withHistory = true }: { withHistory?: boolean } = {}
): Shown => {
  const staged = strategyStage(stage);
  const { bridge, publish } = stubBridge(staged.snapshots);
  window.channelBridge = bridge;
  const history = strategyHistoryBridge(staged.stints);
  vi.spyOn(history, 'getCarStints');
  window.raceHistoryBridge = withHistory ? history : undefined;
  useSessionStore.setState({ session: staged.session });
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'stinttimeline', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  const summary = staged.snapshots['race-history.summary'];
  if (!summary) throw new Error('the stage has no summary');
  const { container, unmount } = render(<StintTimeline />);
  return { publish, history, summary, container, unmount };
};

const rowOf = (carNumber: string): HTMLElement => {
  const slot = String(strategySlotOf(carNumber));
  const row = screen
    .getAllByTestId('stint-row')
    .find((entry) => entry.dataset.car === slot);
  if (!row) throw new Error(`no row for #${carNumber}`);
  return row;
};

/** How many bars of each kind a car's row has: driven, then forecast. */
const barsOf = (carNumber: string): [number, number] => {
  const bars = within(rowOf(carNumber)).queryAllByTestId('stint-bar');
  return [
    bars.filter((bar) => bar.dataset.kind === 'driven').length,
    bars.filter((bar) => bar.dataset.kind === 'forecast').length,
  ];
};

/** The names written on a car's bars, left to right. */
const namesOn = (carNumber: string): string[] =>
  within(rowOf(carNumber))
    .queryAllByTestId('stint-bar')
    .map((bar) => bar.textContent ?? '')
    .filter(Boolean);

/** Waits for the race history's answers to be drawn. */
const settled = () => waitFor(() => expect(barsOf('77')[0]).toBe(5));

describe('StintTimeline (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  afterEach(() => {
    window.raceHistoryBridge = undefined;
  });

  it('draws our car first, then the class cars ahead and behind', async () => {
    show();
    await settled();
    expect(
      screen.getAllByTestId('stint-timeline-car').map((car) => car.textContent)
    ).toEqual(['#77', '#91', '#54']);
    expect(screen.getAllByTestId('stint-timeline-car')[0]).toHaveAttribute(
      'data-own',
      'true'
    );
  });

  it('fills the stints driven and dashes the stints to come', async () => {
    show();
    await settled();
    // Four stops made and three owed: five stints driven, and after what is
    // left of the fifth, three more.
    expect(barsOf('77')).toEqual([5, 4]);
    // The car ahead owes a stop more.
    expect(barsOf('91')).toEqual([5, 5]);
    expect(barsOf('54')).toEqual([5, 4]);
    expect(screen.getByTestId('stint-timeline-now')).toBeInTheDocument();
  });

  it('names our own car’s stints by driver, and no stint to come but the one under way', async () => {
    show();
    await settled();
    expect(namesOn('77')).toEqual([
      'Ivanov',
      'Ivanov',
      'Petrov',
      'Petrov',
      'Ivanov',
      'Ivanov',
    ]);
    // A rival's bars carry no names.
    expect(namesOn('91')).toEqual([]);
  });

  it('puts the team-mate’s name on the stint a team-mate drives', async () => {
    show({ teamMate: 'Andrei Petrov' });
    await settled();
    expect(namesOn('77').slice(-2)).toEqual(['Petrov', 'Petrov']);
  });

  it('gives a stint to come no driver’s colour, but for what is left of the one under way', async () => {
    show({ teamMate: 'Andrei Petrov' });
    await settled();
    const outlines = within(rowOf('77'))
      .getAllByTestId('stint-bar')
      .filter((bar) => bar.dataset.kind === 'forecast')
      .map((bar) => bar.querySelector('rect')?.getAttribute('class') ?? '');
    // The team-mate is the car's second driver: teal, as the stint's
    // driven part is. Who drives the three after it is not known.
    expect(outlines).toHaveLength(4);
    expect(outlines[0]).toContain('stroke-teal-400');
    for (const outline of outlines.slice(1)) {
      expect(outline).toContain('stroke-slate-400');
      expect(outline).not.toMatch(/stroke-(amber|teal|purple)/);
    }
  });

  it('marks hours along a race with a clock, and laps along one without', async () => {
    const timed = show();
    await settled();
    expect(
      screen
        .getAllByTestId('stint-timeline-tick')
        .map((tick) => tick.textContent)
    ).toEqual(['2 h', '4 h', '6 h']);
    timed.unmount();

    show({ lapRace: true });
    await settled();
    expect(
      screen
        .getAllByTestId('stint-timeline-tick')
        .map((tick) => tick.textContent)
    ).toEqual(['lap 50', 'lap 100', 'lap 150', 'lap 200']);
  });

  it('says what the bars are', async () => {
    show();
    await settled();
    expect(screen.getByTestId('stint-timeline-legend')).toHaveTextContent(
      'Filled: driven. Dashed: forecast from each car’s next stop and stint length; none where that is not known. White line: now. Rivals change shade at each driver change.'
    );
  });

  describe('the race history', () => {
    it('is asked once for each car drawn', async () => {
      const { history } = show();
      await settled();
      expect(history.getCarStints).toHaveBeenCalledTimes(3);
      expect(
        vi
          .mocked(history.getCarStints)
          .mock.calls.map(([carIdx]) => carIdx)
          .sort((a, b) => a - b)
      ).toEqual(['91', '77', '54'].map(strategySlotOf).sort((a, b) => a - b));
    });

    it('is asked again for a car when its revision moves, and for no other', async () => {
      const { history, publish, summary } = show();
      await settled();
      vi.mocked(history.getCarStints).mockClear();

      // The summary moves without any of the three cars' records moving.
      act(() => publish('race-history.summary', { ...summary, version: 2 }));
      const other = strategySlotOf('33');
      act(() =>
        publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === other ? revision + 1 : revision
          ),
          version: 3,
        })
      );
      expect(history.getCarStints).not.toHaveBeenCalled();

      const own = strategySlotOf('77');
      act(() =>
        publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === own ? revision + 1 : revision
          ),
          version: 4,
        })
      );
      expect(history.getCarStints).toHaveBeenCalledTimes(1);
      expect(history.getCarStints).toHaveBeenCalledWith(own);
      await settled();
    });

    it('drops what it holds when another race begins', async () => {
      const { publish, summary } = show();
      await settled();
      act(() => publish('race-history.summary', { ...summary, raceToken: '' }));
      // Nothing is recorded: only the stints to come are left.
      expect(barsOf('77')).toEqual([0, 4]);
    });

    it('leaves the driven part empty where there is no bridge to ask', () => {
      // A page that was given no bridge to the race history. No page of
      // the app is one: a window has it over IPC, a browser page over
      // its socket.
      show({}, {}, { withHistory: false });
      expect(barsOf('77')).toEqual([0, 4]);
      expect(barsOf('91')).toEqual([0, 5]);
    });
  });

  describe('where the forecast cannot say when a car stops', () => {
    it('draws no stints to come for it', async () => {
      // A team-mate in a car on fuel: our own stops are not known.
      show({ teamMate: 'Andrei Petrov', fuelCar: true });
      await settled();
      expect(barsOf('77')).toEqual([5, 0]);
      // The rivals' are.
      expect(barsOf('91')).toEqual([5, 5]);
    });
  });

  describe('its settings', () => {
    it('draws as many rivals as asked for, from none to four', async () => {
      const alone = show({}, { rivals: 0 });
      await settled();
      expect(screen.getAllByTestId('stint-row')).toHaveLength(1);
      alone.unmount();

      show({}, { rivals: 4 });
      await settled();
      expect(
        screen
          .getAllByTestId('stint-timeline-car')
          .map((car) => car.textContent)
      ).toEqual(['#77', '#46', '#91', '#54', '#23']);
    });

    it('takes a count it was never offered as the nearest it has', async () => {
      show({}, { rivals: 12 });
      await settled();
      expect(screen.getAllByTestId('stint-row')).toHaveLength(5);
    });

    it('leaves the names and the legend out when switched off', async () => {
      show({}, { showDrivers: false, showLegend: false });
      await settled();
      expect(namesOn('77')).toEqual([]);
      expect(screen.queryByTestId('stint-timeline-legend')).toBeNull();
    });

    it('hides in a session it is not set to show in', () => {
      const { container } = show({ session: 'practice' });
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('when there is nothing to forecast', () => {
    it('says it is waiting for the green flag, and asks the race history for nothing', () => {
      const { history } = show({ session: 'grid' });
      expect(screen.getByTestId('stint-timeline')).toHaveAttribute(
        'data-valid',
        'false'
      );
      expect(screen.getByTestId('stint-timeline-reason')).toHaveTextContent(
        'Waiting for the green flag.'
      );
      expect(screen.queryByTestId('stint-timeline-chart')).toBeNull();
      expect(history.getCarStints).not.toHaveBeenCalled();
    });

    it('says the session is not a race, where it is set to show in one', () => {
      show({ session: 'practice' }, { sessionVisibility: ALL_SESSIONS });
      expect(screen.getByTestId('stint-timeline-reason')).toHaveTextContent(
        'A forecast needs a race: this session is not one.'
      );
    });
  });
});
