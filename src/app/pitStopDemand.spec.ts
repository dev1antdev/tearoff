import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveSimulator,
  DashboardLayout,
  DashboardWidget,
  Session,
  SimWidgetSupportConfig,
  Telemetry,
} from '@irdashies/types';
import { DEFAULT_SIM_WIDGET_SUPPORT, TrackLocation } from '@irdashies/types';
import { ChannelBus } from './bridge/channelBridge';
import { createSessionLifecycle } from './sessionLifecycle';
import { needsPitStops, watchPitStopDemand } from './pitStopDemand';
import {
  PitStopRuntime,
  type PitStopPersistence,
} from './processors/pitStopRuntime';

const widget = (id: string, enabled: boolean): DashboardWidget => ({
  id,
  enabled,
  layout: { x: 0, y: 0, width: 100, height: 100 },
});

const layout = (...widgets: DashboardWidget[]): DashboardLayout => ({
  widgets,
});

const support = DEFAULT_SIM_WIDGET_SUPPORT;

describe('needsPitStops', () => {
  it('follows the Gantry switch under iRacing', () => {
    expect(
      needsPitStops(layout(widget('gantry', true)), 'iracing', support)
    ).toBe(true);
    expect(
      needsPitStops(layout(widget('gantry', false)), 'iracing', support)
    ).toBe(false);
    expect(
      needsPitStops(layout(widget('battle', true)), 'iracing', support)
    ).toBe(false);
    expect(needsPitStops(undefined, 'iracing', support)).toBe(false);
  });

  it('is false under Le Mans Ultimate, where the Gantry is hidden', () => {
    expect(needsPitStops(layout(widget('gantry', true)), 'lmu', support)).toBe(
      false
    );
  });

  it('is as the switch says while no simulator is known', () => {
    for (const simulator of [undefined, null]) {
      expect(
        needsPitStops(layout(widget('gantry', true)), simulator, support)
      ).toBe(true);
    }
  });

  it('follows the Pit Wall switch under both simulators', () => {
    // The Pit Wall is shown under Le Mans Ultimate, where the Gantry is not.
    for (const simulator of ['iracing', 'lmu', undefined, null] as const) {
      expect(
        needsPitStops(layout(widget('pitwall', true)), simulator, support)
      ).toBe(true);
      expect(
        needsPitStops(layout(widget('pitwall', false)), simulator, support)
      ).toBe(false);
    }
  });

  it('is true under LMU with the Pit Wall on beside a Gantry that is hidden', () => {
    expect(
      needsPitStops(
        layout(widget('gantry', true), widget('pitwall', true)),
        'lmu',
        support
      )
    ).toBe(true);
    expect(
      needsPitStops(
        layout(widget('gantry', true), widget('pitwall', false)),
        'lmu',
        support
      )
    ).toBe(false);
  });

  it('is false for a Pit Wall the support file hides under the running sim', () => {
    const edited: SimWidgetSupportConfig = {
      ...support,
      disabledWidgets: {
        ...support.disabledWidgets,
        iracing: [...support.disabledWidgets.iracing, 'pitwall'],
      },
    };
    expect(
      needsPitStops(layout(widget('pitwall', true)), 'iracing', edited)
    ).toBe(false);
    expect(needsPitStops(layout(widget('pitwall', true)), 'lmu', edited)).toBe(
      true
    );
  });

  it('follows a support file that lets the Gantry run under LMU', () => {
    const edited: SimWidgetSupportConfig = {
      ...support,
      disabledWidgets: { ...support.disabledWidgets, lmu: [] },
    };
    expect(needsPitStops(layout(widget('gantry', true)), 'lmu', edited)).toBe(
      true
    );
  });
});

/** The app's side: the dashboard, the simulator and their two events. */
const fakeApp = (
  initialLayout: DashboardLayout,
  initialSimulator: ActiveSimulator | undefined
) => {
  const state = { simulator: initialSimulator };
  const dashboardListeners = new Set<(next: DashboardLayout) => void>();
  const simulatorListeners = new Set<() => void>();
  const onChange = vi.fn<(needed: boolean) => void>();
  const dispose = watchPitStopDemand({
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
    listeners: () => dashboardListeners.size + simulatorListeners.size,
  };
};

describe('watchPitStopDemand', () => {
  it('reports the demand straight away', () => {
    const app = fakeApp(layout(widget('gantry', true)), 'iracing');
    expect(app.onChange.mock.calls).toEqual([[true]]);
  });

  it('stops when auto-detection settles on Le Mans Ultimate', () => {
    // Left on auto-detect the dashboard is read first and the simulator is
    // named later, so a check made once at startup would never see it.
    const app = fakeApp(layout(widget('gantry', true)), undefined);
    expect(app.onChange.mock.calls).toEqual([[true]]);

    app.setSimulator('lmu');
    expect(app.onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('starts again when the simulator becomes iRacing', () => {
    const app = fakeApp(layout(widget('gantry', true)), 'lmu');
    expect(app.onChange.mock.calls).toEqual([[false]]);

    app.setSimulator('iracing');
    expect(app.onChange.mock.calls).toEqual([[false], [true]]);
  });

  it('starts under LMU when the Pit Wall is switched on', () => {
    const app = fakeApp(layout(widget('gantry', true)), 'lmu');
    app.setLayout(layout(widget('gantry', true), widget('pitwall', true)));
    app.setLayout(layout(widget('gantry', true), widget('pitwall', false)));
    expect(app.onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('stays off under LMU whatever the Gantry switch does', () => {
    const app = fakeApp(layout(widget('gantry', false)), 'lmu');
    app.setLayout(layout(widget('gantry', true)));
    app.setLayout(layout(widget('gantry', false)));
    expect(app.onChange.mock.calls).toEqual([[false]]);
  });

  it('follows the Gantry switch under iRacing, reporting only a change', () => {
    const app = fakeApp(layout(widget('gantry', false)), 'iracing');
    app.setLayout(layout(widget('gantry', true)));
    app.setLayout(layout(widget('gantry', true), widget('battle', true)));
    app.setLayout(layout(widget('gantry', false)));
    expect(app.onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('stops listening once disposed', () => {
    const app = fakeApp(layout(widget('gantry', true)), 'iracing');
    app.dispose();
    expect(app.listeners()).toBe(0);
  });
});

const session = (): Session =>
  ({
    WeekendInfo: { SubSessionID: 4242 },
    DriverInfo: { Drivers: [{ CarIdx: 0, UserID: 0, UserName: 'A' }] },
  }) as unknown as Session;

const frame = (
  sessionTime: number,
  surface: TrackLocation,
  onPitRoad: boolean
): Telemetry =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [0] },
    CarIdxTrackSurface: { value: [surface] },
    CarIdxOnPitRoad: { value: [onPitRoad] },
    CarIdxLap: { value: [3] },
  }) as unknown as Telemetry;

/** One car through the pit lane: in, stopped in its stall, and out again. */
const pitStop: Telemetry[] = [
  frame(100, TrackLocation.OnTrack, false),
  frame(110, TrackLocation.ApproachingPits, true),
  frame(115, TrackLocation.InPitStall, true),
  frame(140, TrackLocation.ApproachingPits, true),
  frame(150, TrackLocation.OnTrack, false),
];

/** Lets the stored-stops read settle, which is what releases the first save. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('pit stop recording under each simulator', () => {
  // The Gantry is enabled in the dashboard every time: it was switched on
  // for iRacing, and the setting is kept while another sim hides the widget.
  const record = async (simulator: ActiveSimulator, pitWall = false) => {
    const persistence = {
      load: vi.fn<PitStopPersistence['load']>(() => Promise.resolve(null)),
      save: vi.fn<PitStopPersistence['save']>(),
    };
    const metrics = { markStart: vi.fn(), markEnd: vi.fn() };
    const runtime = new PitStopRuntime(
      new ChannelBus(),
      createSessionLifecycle(),
      metrics,
      persistence
    );
    const app = fakeApp(
      layout(widget('gantry', true), widget('pitwall', pitWall)),
      simulator
    );
    app.onChange.mock.calls.forEach(([needed]) =>
      runtime.updateEnabled(needed)
    );

    runtime.onSession(session());
    pitStop.forEach((telemetry) => runtime.onFrame(telemetry));
    await settle();
    runtime.dispose();
    app.dispose();
    return { persistence, metrics };
  };

  it('records and stores a stop under iRacing', async () => {
    const { persistence } = await record('iracing');

    const [key, stops] = persistence.save.mock.calls.at(-1) ?? [];
    expect(key).toEqual({ subSessionId: 4242, sessionNum: 0 });
    expect(stops).toHaveLength(1);
    expect(stops?.[0]).toMatchObject({ entryTime: 110, exitTime: 150 });
  });

  it('reads no frame and touches no storage under Le Mans Ultimate', async () => {
    const { persistence, metrics } = await record('lmu');

    expect(metrics.markStart).not.toHaveBeenCalledWith('pitStopProcessing');
    expect(persistence.load).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('records a stop under Le Mans Ultimate with the Pit Wall switched on', async () => {
    const { persistence, metrics } = await record('lmu', true);

    expect(metrics.markStart).toHaveBeenCalledWith('pitStopProcessing');
    // Handed on to be kept. Whether it is written is the archive's to say:
    // under a session id the next race shares, it is not.
    const [, stops] = persistence.save.mock.calls.at(-1) ?? [];
    expect(stops).toHaveLength(1);
    expect(stops?.[0]).toMatchObject({ entryTime: 110, exitTime: 150 });
  });
});
