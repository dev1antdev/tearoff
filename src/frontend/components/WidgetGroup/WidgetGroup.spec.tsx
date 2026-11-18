import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  type DashboardLayout,
} from '@irdashies/types';
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

vi.mock('@irdashies/context', () => ({
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
}));
vi.mock('../WidgetPanelHost/HostedWidget', () => ({
  HostedWidget: ({
    widget,
    scale,
    embedded,
  }: {
    widget: { id: string };
    scale: number;
    embedded: boolean;
  }) => (
    <div
      data-testid={`hosted-${widget.id}`}
      data-scale={scale}
      data-embedded={String(embedded)}
    />
  ),
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
    { id: 'flag', enabled: true, layout, alwaysEnabled: true },
    { id: 'radar', enabled: true, layout },
  ],
});

const drawn = () =>
  [...document.querySelectorAll('[data-group-member]')].map((element) =>
    element.getAttribute('data-group-member')
  );

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

  it('lets members write their data, being the only copy of them', () => {
    render(<WidgetGroup />);

    expect(screen.getByTestId('hosted-input')).toHaveAttribute(
      'data-embedded',
      'false'
    );
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

  it('keeps only always-on members with no sim running', () => {
    state.running = false;
    render(<WidgetGroup />);

    expect(drawn()).toEqual(['flag']);
  });

  it('is hidden in a session it is switched off for', () => {
    state.sessionVisible = false;

    expect(render(<WidgetGroup />).container).toBeEmptyDOMElement();
  });

  it('follows its only-on-track setting', () => {
    state.dashboard = dashboard(true);
    const { container, unmount } = render(<WidgetGroup />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    state.watching = true;
    render(<WidgetGroup />);
    expect(drawn()).toHaveLength(3);
  });
});
