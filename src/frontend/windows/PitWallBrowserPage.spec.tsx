import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IrSdkBridge } from '@irdashies/types';

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
// layout the device chose and lets one be chosen, which is all this file's
// subject adds around it.
vi.mock('./PitWallWindow', async () => {
  const { usePitWallDeviceLayout } =
    await import('../components/PitWall/PitWallDeviceLayout');
  return {
    PitWallContent: () => {
      const device = usePitWallDeviceLayout();
      return (
        <button type="button" onClick={() => device?.setLayout('compact')}>
          {device ? `device layout: ${device.layout ?? 'none'}` : 'no device'}
        </button>
      );
    },
  };
});

import { PIT_WALL_DEVICE_LAYOUT_KEY } from '../components/PitWall/PitWallDeviceLayout';
import { PitWallBrowserPage } from './PitWallBrowserPage';

const socket = { onSessionData: vi.fn() } as unknown as IrSdkBridge;

beforeEach(() => {
  mocks.sessionBridges.length = 0;
  localStorage.clear();
});

describe('PitWallBrowserPage', () => {
  it('reads the session from the socket it is given', () => {
    render(<PitWallBrowserPage bridge={socket} />);

    expect(mocks.sessionBridges).toEqual([socket]);
  });

  it('draws the window’s page with the layout made a choice of the device', () => {
    render(<PitWallBrowserPage bridge={socket} />);
    expect(screen.getByRole('button')).toHaveTextContent('device layout: none');

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent(
      'device layout: compact'
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBe('compact');
  });

  it('opens with what the device chose before', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'watching');

    render(<PitWallBrowserPage bridge={socket} />);

    expect(screen.getByRole('button')).toHaveTextContent(
      'device layout: watching'
    );
  });
});
