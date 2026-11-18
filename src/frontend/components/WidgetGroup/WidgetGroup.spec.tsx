import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  type DashboardLayout,
} from '@irdashies/types';
import { OverlayHiddenContext, useOverlayHidden } from '@irdashies/context';
import { WidgetGroup } from './WidgetGroup';

const state = vi.hoisted(() => ({
  dashboard: undefined as unknown,
  simulator: null as string | null,
  running: true,
  driving: false,
  watching: false,
  sessionVisible: true,
  hidden: new Set<string>(),
}));

vi.mock('@irdashies/context', async () => {
  const { createContext, useContext } = await import('react');
  const OverlayHiddenContext = createContext(false);
  return {
    OverlayHiddenContext,
    useOverlayHidden: () => useContext(OverlayHiddenContext),
    useDashboard: () => ({ currentDashboard: state.dashboard }),
    useActiveSimulator: () => state.simulator,
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
    useRunningState: () => ({ running: state.running }),
    useHiddenWidgetIds: () => state.hidden,
    useDrivingState: () => ({
      isDriving: state.driving,
      isWatching: state.watching,
    }),
    useSessionVisibility: () => state.sessionVisible,
  };
});
vi.mock('../WidgetPanelHost/HostedWidget', () => ({
  HostedWidget: function HostedWidget({
    widget,
    scale,
    running,
    onOverlay,
  }: {
    widget: { id: string };
    scale: number;
    running: boolean;
    onOverlay: boolean;
  }) {
    return (
      <div
        data-testid={`hosted-${widget.id}`}
        data-scale={scale}
        data-running={String(running)}
        data-on-overlay={String(onOverlay)}
        data-hidden={String(useOverlayHidden())}
      />
    );
  },
}));

const layout = { x: 0, y: 0, width: 100, height: 100 };

const dashboard = (showOnlyWhenOnTrack = false): DashboardLayout => ({
  widgets: [
    {
      id: 'widgetgroup',
      enabled: true,
      layout,
      config: {
        showOnlyWhenOnTrack,
        members: [
          { widgetId: 'input', x: 10, y: 20, width: 300, height: 90 },
          { widgetId: 'flag', x: 0, y: 0, width: 50, height: 40, scale: 150 },
          { widgetId: 'radar', x: 0, y: 0, width: 50, height: 40 },
        ],
      },
    },
    { id: 'input', enabled: true, layout, scale: 80 },
    { id: 'flag', enabled: true, layout },
    { id: 'radar', enabled: true, layout },
  ],
});

const drawn = () =>
  [...document.querySelectorAll('[data-group-member]')].map((element) =>
    element.getAttribute('data-group-member')
  );

const expectHiddenButMounted = (container: HTMLElement) => {
  expect(container.firstChild).toHaveClass('invisible');
  expect(drawn()).toHaveLength(3);
  expect(screen.getByTestId('hosted-input')).toHaveAttribute(
    'data-hidden',
    'true'
  );
};

describe('WidgetGroup', () => {
  beforeEach(() => {
    state.dashboard = dashboard();
    state.simulator = null;
    state.running = true;
    state.driving = false;
    state.watching = false;
    state.sessionVisible = true;
    state.hidden = new Set();
  });

  it('places each member where it was put, in the saved order', () => {
    render(<WidgetGroup />);

    expect(drawn()).toEqual(['input', 'flag', 'radar']);
    expect(document.querySelector('[data-group-member="input"]')).toHaveStyle({
      left: '10px',
      top: '20px',
      width: '300px',
      height: '90px',
    });
  });

  it('multiplies the group scale by the scale of each member', () => {
    render(
      <WidgetScale scale={200}>
        <WidgetGroup />
      </WidgetScale>
    );

    // Its own scale in the group, then the one saved for the widget.
    expect(screen.getByTestId('hosted-flag')).toHaveAttribute(
      'data-scale',
      '300'
    );
    expect(screen.getByTestId('hosted-input')).toHaveAttribute(
      'data-scale',
      '160'
    );
  });

  it('hosts its members as the overlay copy of each widget', () => {
    state.running = false;
    render(<WidgetGroup />);

    const member = screen.getByTestId('hosted-input');
    expect(member).toHaveAttribute('data-on-overlay', 'true');
    expect(member).toHaveAttribute('data-running', 'false');
  });

  it('holds back a member the running sim cannot show', () => {
    state.simulator = 'lmu';
    render(<WidgetGroup />);

    expect(drawn()).toEqual(['input', 'flag']);
  });

  it('leaves out a member hidden by its hotkey', () => {
    state.hidden = new Set(['input']);
    render(<WidgetGroup />);

    expect(drawn()).toEqual(['flag', 'radar']);
  });

  it('keeps its members running in a session it is hidden in', () => {
    state.sessionVisible = false;

    expectHiddenButMounted(render(<WidgetGroup />).container);
  });

  it('follows its only-on-track setting without unmounting anything', () => {
    state.dashboard = dashboard(true);
    const { container, unmount } = render(<WidgetGroup />);
    expectHiddenButMounted(container);
    unmount();

    state.watching = true;
    const shown = render(<WidgetGroup />).container;
    expect(shown.firstChild).not.toHaveClass('invisible');
    expect(screen.getByTestId('hosted-input')).toHaveAttribute(
      'data-hidden',
      'false'
    );
  });

  it('stays hidden with the overlay around it', () => {
    render(
      <OverlayHiddenContext.Provider value>
        <WidgetGroup />
      </OverlayHiddenContext.Provider>
    );

    expect(screen.getByTestId('hosted-input')).toHaveAttribute(
      'data-hidden',
      'true'
    );
  });
});
