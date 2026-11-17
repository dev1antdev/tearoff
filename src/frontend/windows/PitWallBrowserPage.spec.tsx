import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserConnection, IrSdkBridge } from '@irdashies/types';

const mocks = vi.hoisted(() => ({
  sessionBridges: [] as unknown[],
}));

vi.mock('@irdashies/context', () => ({
  SessionProvider: ({ bridge }: { bridge: unknown }) => {
    mocks.sessionBridges.push(bridge);
    return null;
  },
}));

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

// The page itself has its own specs. Here it is a stand-in that says which
// layout the device chose and lets one be chosen, and whether the page is
// reconnecting, which is all this file's subject adds around it.
vi.mock('./PitWallWindow', async () => {
  const { usePitWallDeviceLayout } =
    await import('../components/PitWall/PitWallDeviceLayout');
  const { usePitWallReconnecting } =
    await import('../components/PitWall/PitWallConnection');
  return {
    PitWallContent: () => {
      const device = usePitWallDeviceLayout();
      const reconnecting = usePitWallReconnecting();
      return (
        <>
          <button type="button" onClick={() => device?.setLayout('compact')}>
            {device ? `device layout: ${device.layout ?? 'none'}` : 'no device'}
          </button>
          <p>{reconnecting ? 'reconnecting' : 'connected'}</p>
        </>
      );
    },
  };
});

import { PIT_WALL_DEVICE_LAYOUT_KEY } from '../components/PitWall/PitWallDeviceLayout';
import { PitWallBrowserPage } from './PitWallBrowserPage';

const socket = { onSessionData: vi.fn() } as unknown as IrSdkBridge;

const connection = (connected: boolean): BrowserConnection => ({
  isConnected: () => connected,
  onConnectionChanged: () => () => undefined,
});
const up = connection(true);

beforeEach(() => {
  mocks.sessionBridges.length = 0;
  localStorage.clear();
});

describe('PitWallBrowserPage', () => {
  it('reads the session from the socket it is given', () => {
    render(<PitWallBrowserPage bridge={socket} connection={up} />);

    expect(mocks.sessionBridges).toEqual([socket]);
  });

  it('draws the window’s page with the layout made a choice of the device', () => {
    render(<PitWallBrowserPage bridge={socket} connection={up} />);
    expect(screen.getByRole('button')).toHaveTextContent('device layout: none');

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent(
      'device layout: compact'
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBe('compact');
  });

  it('opens with what the device chose before', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'watching');

    render(<PitWallBrowserPage bridge={socket} connection={up} />);

    expect(screen.getByRole('button')).toHaveTextContent(
      'device layout: watching'
    );
  });

  it('tells the page whether the socket it is fed over is up', () => {
    const { unmount } = render(
      <PitWallBrowserPage bridge={socket} connection={up} />
    );
    expect(screen.getByText('connected')).toBeVisible();
    unmount();

    render(
      <PitWallBrowserPage bridge={socket} connection={connection(false)} />
    );

    expect(screen.getByText('reconnecting')).toBeVisible();
  });
});
