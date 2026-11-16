import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveSimulator,
  DashboardLayout,
  DashboardWidget,
  SimWidgetSupportConfig,
} from '@irdashies/types';
import { DEFAULT_SIM_WIDGET_SUPPORT } from '@irdashies/types';
import type { ChannelBus } from './bridge/channelBus';
import { createPerfDashboard, getPerfRunConfig } from './perfRunConfig';
import { needsRaceHistory, watchRaceHistoryDemand } from './raceHistoryDemand';

const widget = (id: string, enabled: boolean): DashboardWidget => ({
  id,
  enabled,
  layout: { x: 0, y: 0, width: 100, height: 100 },
});

const layout = (...widgets: DashboardWidget[]): DashboardLayout => ({
  widgets,
});

const support = DEFAULT_SIM_WIDGET_SUPPORT;

describe('needsRaceHistory', () => {
  it('follows the Pit Wall switch under both simulators', () => {
    for (const simulator of ['iracing', 'lmu'] as const) {
      expect(
        needsRaceHistory(layout(widget('pitwall', true)), simulator, support)
      ).toBe(true);
      expect(
        needsRaceHistory(layout(widget('pitwall', false)), simulator, support)
      ).toBe(false);
    }
  });

  it('is false with no dashboard, and with no Pit Wall on it', () => {
    expect(needsRaceHistory(undefined, 'lmu', support)).toBe(false);
    expect(needsRaceHistory(layout(), 'lmu', support)).toBe(false);
    // No other widget is a reason, the ones that show a race included.
    expect(
      needsRaceHistory(
        layout(
          widget('standings', true),
          widget('gantry', true),
          widget('stinthistory', true)
        ),
        'iracing',
        support
      )
    ).toBe(false);
  });

  it('is as the switch says while no simulator is known', () => {
    for (const simulator of [undefined, null]) {
      expect(
        needsRaceHistory(layout(widget('pitwall', true)), simulator, support)
      ).toBe(true);
    }
  });

  it('is false under a simulator the support file hides the Pit Wall for', () => {
    // The switch is kept as the user set it; the page is only hidden.
    const edited: SimWidgetSupportConfig = {
      ...support,
      disabledWidgets: {
        ...support.disabledWidgets,
        lmu: [...support.disabledWidgets.lmu, 'pitwall'],
      },
    };

    expect(
      needsRaceHistory(layout(widget('pitwall', true)), 'lmu', edited)
    ).toBe(false);
    expect(
      needsRaceHistory(layout(widget('pitwall', true)), 'iracing', edited)
    ).toBe(true);
  });
});

type CountListener = Parameters<ChannelBus['onSubscriberCountChanged']>[0];

/** The app's side: the dashboard, the simulator, the bus and their events. */
const fakeApp = (
  initialLayout: DashboardLayout | undefined,
  initialSimulator: ActiveSimulator | undefined,
  options: {
    subscribers?: number;
    resolveLayout?: (layout: DashboardLayout) => DashboardLayout;
  } = {}
) => {
  const state = {
    simulator: initialSimulator,
    subscribers: {
      'race-history.summary': options.subscribers ?? 0,
    } as Record<string, number>,
  };
  const dashboardListeners = new Set<(next: DashboardLayout) => void>();
  const simulatorListeners = new Set<() => void>();
  const countListeners = new Set<CountListener>();
  const onChange = vi.fn<(needed: boolean) => void>();
  const dispose = watchRaceHistoryDemand({
    bus: {
      subscriberCount: (channel) => state.subscribers[channel] ?? 0,
      onSubscriberCountChanged: (listener) => {
        countListeners.add(listener);
        return () => countListeners.delete(listener);
      },
    },
    initialLayout,
    onDashboardUpdated: (listener) => {
      dashboardListeners.add(listener);
      return () => dashboardListeners.delete(listener);
    },
    getSimulator: () => state.simulator,
    onSimulatorChanged: (listener) => {
      simulatorListeners.add(listener);
      return () => simulatorListeners.delete(listener);
    },
    getSupport: () => support,
    onChange,
    resolveLayout: options.resolveLayout,
  });
  return {
    onChange,
    dispose,
    setSimulator: (next: ActiveSimulator | undefined) => {
      state.simulator = next;
      simulatorListeners.forEach((listener) => listener());
    },
    setLayout: (next: DashboardLayout) =>
      dashboardListeners.forEach((listener) => listener(next)),
    setSubscribers: (channel: string, count: number) => {
      state.subscribers[channel] = count;
      countListeners.forEach((listener) => listener(channel, count, count));
    },
    listeners: () =>
      dashboardListeners.size + simulatorListeners.size + countListeners.size,
  };
};

describe('watchRaceHistoryDemand', () => {
  it('reports the demand straight away', () => {
    expect(
      fakeApp(layout(widget('pitwall', true)), 'lmu').onChange.mock.calls
    ).toEqual([[true]]);
    expect(
      fakeApp(layout(widget('pitwall', false)), 'lmu').onChange.mock.calls
    ).toEqual([[false]]);
    expect(fakeApp(undefined, undefined).onChange.mock.calls).toEqual([
      [false],
    ]);
  });

  it('follows the Pit Wall switch, reporting only a change', () => {
    const app = fakeApp(layout(widget('pitwall', false)), 'lmu');

    app.setLayout(layout(widget('pitwall', true)));
    app.setLayout(layout(widget('pitwall', true), widget('standings', true)));
    app.setLayout(layout(widget('pitwall', false)));

    expect(app.onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('records for a subscriber to the summary while the Pit Wall is off', () => {
    // A page served to a browser, with the Pit Wall off on the desktop.
    const app = fakeApp(layout(widget('pitwall', false)), 'lmu');

    app.setSubscribers('race-history.summary', 1);
    app.setSubscribers('standings.snapshot', 0);
    app.setSubscribers('race-history.summary', 2);
    app.setSubscribers('race-history.summary', 0);

    expect(app.onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('records for a reader of the race log, as for one of the summary', () => {
    // The Race Log widget on the overlay, with the Pit Wall off.
    const app = fakeApp(layout(widget('pitwall', false)), 'lmu');

    app.setSubscribers('race-log.snapshot', 1);
    app.setSubscribers('race-history.summary', 1);
    // One reader leaves and the other is still there.
    app.setSubscribers('race-log.snapshot', 0);
    expect(app.onChange.mock.calls).toEqual([[false], [true]]);

    app.setSubscribers('race-history.summary', 0);
    expect(app.onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('starts recording for a subscriber that was there first', () => {
    const app = fakeApp(layout(), 'lmu', { subscribers: 1 });

    expect(app.onChange.mock.calls).toEqual([[true]]);
  });

  it('goes on while either reason stands', () => {
    const app = fakeApp(layout(widget('pitwall', true)), 'lmu');

    app.setSubscribers('race-history.summary', 1);
    app.setLayout(layout(widget('pitwall', false)));
    expect(app.onChange.mock.calls).toEqual([[true]]);

    app.setSubscribers('race-history.summary', 0);
    expect(app.onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('asks again when the simulator becomes known or changes', () => {
    // Left on auto-detect the dashboard is read first and the simulator is
    // named later. The Pit Wall is shown under both, so the answer stands;
    // what matters is that it is asked again.
    const getSupport = vi.fn(() => support);
    const simulatorListeners = new Set<() => void>();
    const onChange = vi.fn();
    watchRaceHistoryDemand({
      bus: {
        subscriberCount: () => 0,
        onSubscriberCountChanged: () => () => undefined,
      },
      initialLayout: layout(widget('pitwall', true)),
      onDashboardUpdated: () => () => undefined,
      getSimulator: () => 'lmu',
      onSimulatorChanged: (listener) => {
        simulatorListeners.add(listener);
        return () => simulatorListeners.delete(listener);
      },
      getSupport,
      onChange,
    });
    expect(getSupport).toHaveBeenCalledTimes(1);

    simulatorListeners.forEach((listener) => listener());

    expect(getSupport).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it('goes by the dashboard a perf run shows, not the one stored', () => {
    const config = getPerfRunConfig({
      PERF_METRICS: '1',
      PERF_WIDGET_TYPES: 'standings',
    });
    const app = fakeApp(layout(widget('pitwall', true)), 'lmu', {
      resolveLayout: (current) => createPerfDashboard(current, config),
    });

    expect(app.onChange.mock.calls).toEqual([[false]]);
    // A subscriber is still a reason, whatever the run shows.
    app.setSubscribers('race-history.summary', 1);
    expect(app.onChange.mock.calls).toEqual([[false], [true]]);
  });

  it('stops listening once disposed', () => {
    const app = fakeApp(layout(widget('pitwall', true)), 'lmu');
    expect(app.listeners()).toBe(3);

    app.dispose();

    expect(app.listeners()).toBe(0);
  });
});
