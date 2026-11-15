import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DashboardLayout,
  type InputConfig,
} from '@irdashies/types';
import { InputSettings } from './InputSettings';

const mocks = vi.hoisted(() => ({
  dashboard: undefined as DashboardLayout | undefined,
  onDashboardUpdated: vi.fn(),
}));

vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    ...actual,
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => null,
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
  };
});

const dashboardWith = (config: Record<string, unknown> = {}) =>
  ({
    widgets: [
      {
        id: 'input',
        enabled: true,
        layout: { x: 0, y: 0, width: 396, height: 92 },
        config: {
          ...structuredClone(getWidgetDefaultConfig('input')),
          ...config,
        },
      },
    ],
  }) as unknown as DashboardLayout;

const renderPage = () =>
  render(
    <MemoryRouter>
      <InputSettings />
    </MemoryRouter>
  );

const sourceChoice = () =>
  within(screen.getByRole('radiogroup', { name: 'Input source' }));

/** The label of the source that is selected. */
const chosenSource = () =>
  sourceChoice()
    .getAllByRole('radio')
    .filter((option) => option.getAttribute('aria-checked') === 'true')
    .map((option) => option.firstElementChild?.textContent);

/** The input config the page last saved. */
const savedConfig = (): InputConfig => {
  const dashboard = mocks.onDashboardUpdated.mock.lastCall?.[0] as
    DashboardLayout | undefined;
  return dashboard?.widgets.find((widget) => widget.id === 'input')
    ?.config as unknown as InputConfig;
};

const toggle = (name: string) => screen.getByRole('switch', { name });

describe('InputSettings', () => {
  beforeEach(() => {
    localStorage.setItem('inputTab', 'options');
    mocks.onDashboardUpdated.mockClear();
    mocks.dashboard = dashboardWith();
  });

  afterEach(() => {
    localStorage.removeItem('inputTab');
    mocks.dashboard = undefined;
  });

  describe('the input source', () => {
    it.each(['layout', 'options', 'visibility'])(
      'is offered as a two-way choice on the %s tab',
      (tab) => {
        localStorage.setItem('inputTab', tab);
        renderPage();

        const options = sourceChoice().getAllByRole('radio');
        expect(
          options.map((option) => option.firstElementChild?.textContent)
        ).toEqual(['Car', 'Pedals']);
        // Each says what it shows, and Car says where it works.
        expect(options[0].textContent).toContain(
          'after traction control, ABS and shift cuts'
        );
        expect(options[0].textContent).toContain(
          'while you watch another car and in replays'
        );
        expect(options[1].textContent).toContain(
          'the raw pedal position, before the assists'
        );
      }
    );

    it('replaces the Use Raw Inputs checkbox and no longer names a simulator', () => {
      renderPage();

      expect(screen.queryByText('Use Raw Inputs')).toBeNull();
      expect(screen.queryByRole('switch', { name: /raw/i })).toBeNull();
      expect(
        screen.getByRole('radiogroup', { name: 'Input source' }).textContent
      ).not.toMatch(/iRacing/);
    });

    it('starts on Car', () => {
      renderPage();

      expect(chosenSource()).toEqual(['Car']);
    });

    it('shows a dashboard that had Use Raw Inputs on as Pedals', () => {
      mocks.dashboard = dashboardWith({ useRawValues: true });
      renderPage();

      expect(chosenSource()).toEqual(['Pedals']);
    });

    it.each([undefined, null, 'true', 1])(
      'shows a stored value of %j as Car',
      (useRawValues) => {
        mocks.dashboard = dashboardWith({ useRawValues });
        renderPage();

        expect(chosenSource()).toEqual(['Car']);
      }
    );

    it('stores the choice as the boolean it has always been', () => {
      renderPage();

      fireEvent.click(sourceChoice().getByRole('radio', { name: /^Pedals/ }));
      expect(savedConfig().useRawValues).toBe(true);
      expect(chosenSource()).toEqual(['Pedals']);

      fireEvent.click(sourceChoice().getByRole('radio', { name: /^Car/ }));
      expect(savedConfig().useRawValues).toBe(false);
      expect(chosenSource()).toEqual(['Car']);
    });

    it('moves between the two with the arrow keys', () => {
      renderPage();

      fireEvent.keyDown(sourceChoice().getByRole('radio', { name: /^Car/ }), {
        key: 'ArrowRight',
      });
      expect(savedConfig().useRawValues).toBe(true);

      fireEvent.keyDown(
        sourceChoice().getByRole('radio', { name: /^Pedals/ }),
        {
          key: 'ArrowLeft',
        }
      );
      expect(savedConfig().useRawValues).toBe(false);
    });

    it('leaves the rest of the config as it was', () => {
      mocks.dashboard = dashboardWith({
        steer: {
          enabled: true,
          config: { style: 'lmp', color: 'dark' },
          rangeDeg: 900,
        },
      });
      renderPage();

      fireEvent.click(sourceChoice().getByRole('radio', { name: /^Pedals/ }));

      expect(savedConfig().steer).toMatchObject({
        config: { style: 'lmp', color: 'dark' },
        rangeDeg: 900,
      });
    });
  });

  describe('the traction control marks', () => {
    it('are offered beside the ABS ones and are on by default', () => {
      renderPage();

      expect(toggle('Show ABS')).toHaveAttribute('aria-checked', 'true');
      expect(toggle('Show Traction Control')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(toggle('Show ABS Indicator')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(toggle('Show Traction Control Indicator')).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('are on for a config saved before they existed', () => {
      const defaults = getWidgetDefaultConfig('input');
      mocks.dashboard = dashboardWith({
        trace: { ...defaults.trace, includeTc: undefined },
        bar: { ...defaults.bar, includeTc: undefined },
      });
      renderPage();

      expect(toggle('Show Traction Control')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(toggle('Show Traction Control Indicator')).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('switch off one at a time, keeping the rest of the group', () => {
      renderPage();

      fireEvent.click(toggle('Show Traction Control'));
      expect(savedConfig().trace).toMatchObject({
        includeTc: false,
        includeAbs: true,
        includeThrottle: true,
      });
      expect(savedConfig().bar.includeTc).toBe(true);

      fireEvent.click(toggle('Show Traction Control Indicator'));
      expect(savedConfig().bar).toMatchObject({
        includeTc: false,
        includeAbs: true,
      });
    });

    it('offers the mark style while either mark is drawn in the trace', () => {
      const style = 'ABS and Traction Control Style';
      const defaults = getWidgetDefaultConfig('input');
      renderPage();
      expect(screen.getByText(style)).toBeInTheDocument();

      fireEvent.click(toggle('Show ABS'));
      expect(screen.getByText(style)).toBeInTheDocument();

      fireEvent.click(toggle('Show Traction Control'));
      expect(screen.queryByText(style)).toBeNull();
      expect(savedConfig().trace).toMatchObject({
        includeAbs: false,
        includeTc: false,
        absStyle: defaults.trace.absStyle,
      });
    });
  });

  describe('the bars and the steering', () => {
    it('offers the brake pressure strip only with the side-by-side bars', () => {
      renderPage();
      expect(
        screen.queryByRole('switch', {
          name: 'Brake Pressure as the Car Strip',
        })
      ).toBeNull();

      fireEvent.click(toggle('Pedal and Car Side by Side'));

      expect(savedConfig().bar.dual).toBe(true);
      expect(toggle('Brake Pressure as the Car Strip')).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('has the full travel marker on and the force feedback bar off', () => {
      renderPage();

      expect(toggle('Show Full Travel Marker')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(toggle('Show Force Feedback Bar')).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('offers the wheel range for every style, and the readouts not for the ring', () => {
      const { unmount } = renderPage();
      for (const title of [
        'Wheel Rotation Range',
        'Angle Readout',
        'Rotation Arc',
        'Show Front Wheel Angle',
      ]) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
      unmount();

      mocks.dashboard = dashboardWith({
        steer: { enabled: true, config: { style: 'ring', color: 'light' } },
      });
      renderPage();
      expect(screen.getByText('Wheel Rotation Range')).toBeInTheDocument();
      for (const title of [
        'Angle Readout',
        'Rotation Arc',
        'Show Front Wheel Angle',
      ]) {
        expect(screen.queryByText(title)).toBeNull();
      }
    });

    it('keeps the wheel style when a readout setting changes', () => {
      mocks.dashboard = dashboardWith({
        steer: {
          enabled: true,
          config: { style: 'lmp', color: 'dark' },
          angleReadout: 'beyond270',
        },
      });
      renderPage();

      // The readout's Always; the rotation arc's comes after it.
      fireEvent.click(screen.getAllByRole('button', { name: 'Always' })[0]);

      expect(savedConfig().steer).toMatchObject({
        config: { style: 'lmp', color: 'dark' },
        angleReadout: 'always',
      });
    });

    it('offers the steering meter to the layout and its marks to the options', () => {
      renderPage();
      const meter = screen
        .getByRole('heading', { name: 'Steering Meter' })
        .closest('section');
      if (!meter) throw new Error('no Steering Meter panel');

      expect(within(meter).getByText('Scale Mark Spacing')).toBeInTheDocument();
      expect(
        within(meter).getByRole('switch', { name: 'Show Angle' })
      ).toHaveAttribute('aria-checked', 'true');
      expect(meter.textContent).toContain('Layout tab');
    });
  });
});
