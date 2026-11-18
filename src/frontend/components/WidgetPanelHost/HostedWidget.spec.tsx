import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardWidget } from '@irdashies/types';

const mocks = vi.hoisted(() => ({
  widgetProps: [] as Record<string, unknown>[],
  draws: true,
}));

vi.mock('../../WidgetIndex', () => ({
  getWidget: (type: string) => {
    if (type === 'unknown') return undefined;
    if (type === 'broken') {
      return () => {
        throw new Error('boom');
      };
    }
    return (props: Record<string, unknown>) => {
      mocks.widgetProps.push(props);
      return mocks.draws ? <div data-testid={`widget-${type}`} /> : null;
    };
  },
}));

vi.mock('@irdashies/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import logger from '@irdashies/utils/logger';
import { HostedPanelMessage, HostedWidget } from './HostedWidget';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

const host = { running: true, host: 'test-host', waitingMessage: 'Waiting.' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.widgetProps.length = 0;
  mocks.draws = true;
});

describe('HostedWidget', () => {
  it('draws the widget with its saved config and marks the copy embedded', () => {
    render(
      <HostedWidget
        {...host}
        widget={widget('fuel', { config: { safetyMargin: 1 } })}
      />
    );
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
    expect(mocks.widgetProps[0]).toEqual({ safetyMargin: 1, embedded: true });
  });

  it('does not mark a widget embedded when it is the only copy', () => {
    render(<HostedWidget {...host} widget={widget('fuel')} embedded={false} />);
    expect(mocks.widgetProps[0]).toEqual({});
  });

  it('keeps a scale worked out from two others as it is', () => {
    const { container } = render(
      <HostedWidget {...host} widget={widget('fuel')} scale={300} exactScale />
    );
    expect(container.querySelector('[data-widget-scale]')).toHaveAttribute(
      'data-widget-scale',
      '300'
    );
  });

  it('finds a copy of a widget by its type', () => {
    render(
      <HostedWidget {...host} widget={widget('fuel-2', { type: 'fuel' })} />
    );
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
  });

  it('draws nothing for a type that is not registered', () => {
    const { container } = render(
      <HostedWidget {...host} widget={widget('unknown')} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is waiting while no sim is running', () => {
    render(<HostedWidget {...host} running={false} widget={widget('fuel')} />);
    expect(screen.getByText('Waiting.')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-fuel')).not.toBeInTheDocument();
  });

  it('draws a widget that needs no sim whether one is running or not', () => {
    render(
      <HostedWidget
        {...host}
        running={false}
        widget={widget('fuel', { alwaysEnabled: true })}
      />
    );
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
  });

  it('uses the scale saved for the widget unless the host gives one', () => {
    const saved = widget('fuel', { scale: 150 });
    const { unmount } = render(<HostedWidget {...host} widget={saved} />);
    expect(
      screen.getByTestId('widget-fuel').closest('[data-widget-scale]')
    ).toHaveAttribute('data-widget-scale', '150');
    unmount();

    render(<HostedWidget {...host} widget={saved} scale={80} />);
    expect(
      screen.getByTestId('widget-fuel').closest('[data-widget-scale]')
    ).toHaveAttribute('data-widget-scale', '80');
  });

  it('keeps a widget that throws inside its own boundary, named after the host', () => {
    render(<HostedWidget {...host} widget={widget('broken')} />);
    expect(
      screen.getByText('This panel hit a problem. It will try again shortly.')
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(logger.error)
        .mock.calls.some(([message]) =>
          String(message).includes('[ErrorBoundary:test-host:broken]')
        )
    ).toBe(true);
  });

  it('adds nothing around the widget unless asked to scroll', () => {
    render(<HostedWidget {...host} widget={widget('fuel')} />);
    const drawn = screen.getByTestId('widget-fuel');
    expect(drawn.parentElement?.className).not.toContain('overflow-auto');
    expect(drawn.parentElement?.className).not.toContain('peer');
  });

  it('scrolls a widget larger than its panel inside the scaled content', () => {
    render(
      <HostedWidget
        {...host}
        widget={widget('fuel')}
        scroll={{ emptyMessage: 'Nothing to show.' }}
      />
    );
    const scroller =
      screen.getByTestId('widget-fuel').parentElement?.parentElement;
    expect(scroller?.className).toContain('overflow-auto');
    expect(scroller?.closest('[data-widget-scale]')).not.toBeNull();
  });

  it('keeps a line ready for a widget that draws nothing', () => {
    mocks.draws = false;
    render(
      <HostedWidget
        {...host}
        widget={widget('fuel')}
        scroll={{ emptyMessage: 'Nothing to show.' }}
      />
    );
    const message = screen.getByText('Nothing to show.');
    // Shown by the stylesheet only while the widget's box is empty.
    expect(message.className).toContain('peer-empty:flex');
    expect(message.className).toContain('hidden');
    expect(message.previousElementSibling).toBeEmptyDOMElement();
    expect(message.previousElementSibling?.className).toContain('peer');
  });
});

describe('HostedPanelMessage', () => {
  it('offers its action when it has one', () => {
    const onClick = vi.fn();
    render(
      <HostedPanelMessage
        message="Missing."
        action={{ label: 'Fix it', onClick }}
      />
    );
    screen.getByRole('button', { name: 'Fix it' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is only a line without one', () => {
    render(<HostedPanelMessage message="Missing." />);
    expect(screen.getByText('Missing.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
