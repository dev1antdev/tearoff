import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useSystemPerformanceSnapshot,
} from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type SystemPerformanceConfig,
  type SystemPerformanceSnapshot,
} from '@irdashies/types';
import { SystemPerformance } from './SystemPerformance';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useSystemPerformanceSnapshot: vi.fn(),
}));

const defaults = getWidgetDefaultConfig('systemperformance');

const snapshot = (
  values: Partial<SystemPerformanceSnapshot> = {}
): SystemPerformanceSnapshot => ({
  systemCpuPercent: 23.4,
  systemMemoryUsedGb: 15.2,
  systemMemoryTotalGb: 31.8,
  appCpuPercent: 1.2,
  appMemoryMb: 412,
  simFps: 118,
  simCpuPercent: 46,
  simGpuPercent: 71,
  gpuPercent: null,
  version: 1,
  ...values,
});

/** What Le Mans Ultimate leaves of it: no meters of the sim's own. */
const lmuSnapshot = (): SystemPerformanceSnapshot =>
  snapshot({ simFps: null, simCpuPercent: null, simGpuPercent: null });

interface Scene {
  /** As saved: a config from an older build may lack whole groups. */
  config?: Partial<SystemPerformanceConfig>;
  isDriving?: boolean;
  isWatching?: boolean;
  sessionVisible?: boolean;
}

const show = (
  performance: SystemPerformanceSnapshot | undefined,
  {
    config = {},
    isDriving = true,
    isWatching = false,
    sessionVisible = true,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'systemperformance', config }],
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useSystemPerformanceSnapshot).mockReturnValue(performance);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching,
    // The widget describes the machine, so which car is watched is all one.
    isWatchingOwnCar: false,
    isWatchingOtherCar: isWatching,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  return render(<SystemPerformance />);
};

/** One figure: what it says and the colour it is drawn in. */
const figure = (group: string, kind: string) => {
  const cell = screen.getByTestId(`system-performance-${group}-${kind}`);
  const value = cell.querySelector('span');
  if (!value) throw new Error(`No value in ${group} ${kind}`);
  return { text: cell.textContent, tone: cell.dataset.tone, value };
};

const rows = () =>
  ['system', 'app', 'sim'].filter(
    (group) => screen.queryByTestId(`system-performance-${group}`) !== null
  );

describe('SystemPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('under iRacing', () => {
    it('draws the machine, Tearoff and the sim, each with its figures', () => {
      show(snapshot());

      expect(rows()).toEqual(['system', 'app', 'sim']);
      expect(screen.getByTestId('system-performance-system')).toHaveTextContent(
        'System'
      );
      expect(screen.getByTestId('system-performance-app')).toHaveTextContent(
        'Tearoff'
      );
      expect(screen.getByTestId('system-performance-sim')).toHaveTextContent(
        'Sim'
      );
      expect(figure('system', 'cpu').text).toBe('23%');
      expect(figure('system', 'memory').text).toBe('15.2GB');
      expect(figure('app', 'cpu').text).toBe('1.2%');
      expect(figure('app', 'memory').text).toBe('412MB');
      expect(figure('sim', 'fps').text).toBe('118fps');
      expect(figure('sim', 'cpu').text).toBe('46%');
      expect(figure('sim', 'gpu').text).toBe('71%');
    });

    it('is all white while nothing is over a threshold', () => {
      show(snapshot());

      for (const [group, kind] of [
        ['system', 'cpu'],
        ['system', 'memory'],
        ['app', 'cpu'],
        ['app', 'memory'],
        ['sim', 'fps'],
        ['sim', 'cpu'],
        ['sim', 'gpu'],
      ]) {
        expect(figure(group, kind).value).toHaveClass('text-white');
      }
    });

    it('names each icon for a reader that cannot see it', () => {
      show(snapshot());

      const sim = ['fps', 'cpu', 'gpu'].map((kind) =>
        screen
          .getByTestId(`system-performance-sim-${kind}`)
          .getAttribute('aria-label')
      );
      expect(sim).toEqual(['Frame rate', 'CPU', 'GPU']);
      expect(
        screen
          .getByTestId('system-performance-system-memory')
          .getAttribute('aria-label')
      ).toBe('Memory');
    });
  });

  describe('thresholds', () => {
    it('turns a CPU figure amber from the warning and red from 95', () => {
      show(snapshot({ systemCpuPercent: 85, simCpuPercent: 95 }));

      expect(figure('system', 'cpu').value).toHaveClass('text-amber-300');
      expect(figure('sim', 'cpu').value).toHaveClass('text-red-400');
      // The ones still under it stay white.
      expect(figure('app', 'cpu').value).toHaveClass('text-white');
      expect(figure('sim', 'gpu').value).toHaveClass('text-white');
    });

    it('colours the GPU meter by the same warning', () => {
      show(snapshot({ simGpuPercent: 99.5 }));

      expect(figure('sim', 'gpu').text).toBe('100%');
      expect(figure('sim', 'gpu').value).toHaveClass('text-red-400');
    });

    it('turns the frame rate amber below the warning and red below half of it', () => {
      const { unmount } = show(snapshot({ simFps: 59 }));
      expect(figure('sim', 'fps').value).toHaveClass('text-amber-300');
      unmount();

      show(snapshot({ simFps: 29 }));
      expect(figure('sim', 'fps').value).toHaveClass('text-red-400');
    });

    it('uses the thresholds from the settings', () => {
      show(snapshot({ systemCpuPercent: 62, simFps: 100 }), {
        config: { warn: { cpuPercent: 60, fps: 120 } },
      });

      expect(figure('system', 'cpu').value).toHaveClass('text-amber-300');
      expect(figure('sim', 'fps').value).toHaveClass('text-amber-300');
    });

    it('never colours memory', () => {
      show(snapshot({ systemMemoryUsedGb: 31.7, appMemoryMb: 4096 }));

      expect(figure('system', 'memory').value).toHaveClass('text-white');
      expect(figure('app', 'memory').value).toHaveClass('text-white');
    });
  });

  describe('under Le Mans Ultimate', () => {
    it('draws the machine and Tearoff and no row for the sim', () => {
      show(lmuSnapshot());

      expect(rows()).toEqual(['system', 'app']);
      expect(figure('system', 'cpu').text).toBe('23%');
      expect(figure('app', 'memory').text).toBe('412MB');
      expect(screen.queryByText('Sim')).toBeNull();
      expect(screen.queryByLabelText('Frame rate')).toBeNull();
      expect(screen.queryByLabelText('GPU')).toBeNull();
    });

    it('draws no sim row in the strip either', () => {
      show(lmuSnapshot(), { config: { layout: 'inline' } });

      expect(rows()).toEqual(['system', 'app']);
    });
  });

  describe('placeholders', () => {
    it('keeps its shape before the first reading', () => {
      show(undefined);

      expect(rows()).toEqual(['system', 'app']);
      for (const [group, kind] of [
        ['system', 'cpu'],
        ['system', 'memory'],
        ['app', 'cpu'],
        ['app', 'memory'],
      ]) {
        const cell = figure(group, kind);
        // A dash and no unit: a unit after it would read as a value.
        expect(cell.text).toBe('--');
        expect(cell.tone).toBe('none');
        expect(cell.value).toHaveClass('text-slate-500');
      }
    });

    it('shows memory while the CPU figures are still to come', () => {
      show(snapshot({ systemCpuPercent: null, appCpuPercent: null }));

      expect(figure('system', 'cpu').text).toBe('--');
      expect(figure('system', 'memory').text).toBe('15.2GB');
      expect(figure('app', 'cpu').text).toBe('--');
      expect(figure('app', 'memory').text).toBe('412MB');
    });

    it('puts a dash in one sim cell rather than dropping the row', () => {
      show(snapshot({ simGpuPercent: null }));

      expect(rows()).toEqual(['system', 'app', 'sim']);
      expect(figure('sim', 'gpu').text).toBe('--');
      expect(figure('sim', 'fps').text).toBe('118fps');
    });
  });

  describe('settings', () => {
    it('draws only the rows that are switched on', () => {
      show(snapshot(), {
        config: { system: { enabled: false }, sim: { enabled: false } },
      });

      expect(rows()).toEqual(['app']);
    });

    it('draws nothing with every row switched off', () => {
      const { container } = show(snapshot(), {
        config: {
          system: { enabled: false },
          app: { enabled: false },
          sim: { enabled: false },
        },
      });

      expect(container).toBeEmptyDOMElement();
    });

    it('lays the groups out as rows, or along one strip', () => {
      const { unmount } = show(snapshot());
      expect(screen.getByTestId('system-performance').dataset.layout).toBe(
        'rows'
      );
      unmount();

      show(snapshot(), { config: { layout: 'inline' } });
      const widget = screen.getByTestId('system-performance');
      expect(widget.dataset.layout).toBe('inline');
      // A group is one box holding its label and its figures.
      const sim = within(screen.getByTestId('system-performance-sim'));
      expect(sim.getByText('Sim')).toBeInTheDocument();
      expect(sim.getByLabelText('Frame rate')).toHaveTextContent('118fps');
    });

    it('takes the background opacity from the settings', () => {
      show(snapshot(), { config: { background: { opacity: 35 } } });

      expect(
        screen
          .getByTestId('system-performance')
          .style.getPropertyValue('--bg-opacity')
      ).toBe('35%');
    });

    it('fills in a config saved without the newer groups', () => {
      show(snapshot({ systemCpuPercent: 90 }), {
        config: { background: { opacity: 50 } },
      });

      expect(rows()).toEqual(['system', 'app', 'sim']);
      // The default warning of 85 applies.
      expect(figure('system', 'cpu').value).toHaveClass('text-amber-300');
      expect(defaults.warn.cpuPercent).toBe(85);
    });
  });

  describe('visibility', () => {
    it('stays on screen out of the car: it describes the machine', () => {
      show(snapshot(), { isDriving: false, isWatching: false });

      expect(screen.getByTestId('system-performance')).toBeInTheDocument();
    });

    it('hides off track when set to show only on track', () => {
      const { container } = show(snapshot(), {
        config: { showOnlyWhenOnTrack: true },
        isDriving: false,
        isWatching: false,
      });

      expect(container).toBeEmptyDOMElement();
    });

    it('stays while watching a car when set to show only on track', () => {
      show(snapshot(), {
        config: { showOnlyWhenOnTrack: true },
        isDriving: false,
        isWatching: true,
      });

      expect(screen.getByTestId('system-performance')).toBeInTheDocument();
    });

    it('stays while driving when set to show only on track', () => {
      show(snapshot(), {
        config: { showOnlyWhenOnTrack: true },
        isDriving: true,
      });

      expect(screen.getByTestId('system-performance')).toBeInTheDocument();
    });

    it('hides in a session type that is switched off', () => {
      const { container } = show(snapshot(), { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
      expect(useSessionVisibility).toHaveBeenCalledWith(
        defaults.sessionVisibility
      );
    });
  });
});
