import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSimulator } from '../../types';
import type { LmuRestResponse, LmuRestTransport } from '../lmu/rest/poller';
import {
  LMU_SETUP_SYNC_INTERVAL_MS,
  createLmuSetupAutoInstall,
  readSessionTrackFolder,
} from './lmuSetupAutoInstall';

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Connected = ActiveSimulator | undefined;

const setup = ({
  enabled = true,
  readTrackFolder = vi.fn(async () => 'Spa' as const),
  syncTrack = vi.fn(async () => undefined),
  intervalMs,
}: {
  enabled?: boolean;
  readTrackFolder?: () => Promise<string | null | 'unreachable'>;
  syncTrack?: (folder: string) => Promise<unknown>;
  intervalMs?: number;
} = {}) => {
  let listener: ((simulator: Connected) => void) | undefined;
  const service = createLmuSetupAutoInstall({
    onConnectedSimulatorChanged: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    readTrackFolder,
    syncTrack,
    isEnabled: () => enabled,
    intervalMs,
  });
  const connect = (simulator: Connected) => listener?.(simulator);
  return { service, connect, readTrackFolder, syncTrack };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createLmuSetupAutoInstall', () => {
  it('does nothing until LMU is connected', async () => {
    const { service, readTrackFolder } = setup();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readTrackFolder).not.toHaveBeenCalled();
    expect(service.status()).toEqual({
      lmuConnected: false,
      sessionTrackFolder: null,
      restReachable: null,
    });
  });

  it('ignores another simulator and a disconnect', async () => {
    const { connect, readTrackFolder } = setup();
    connect('iracing');
    connect(undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readTrackFolder).not.toHaveBeenCalled();
  });

  it('ticks at once, then every ten seconds', async () => {
    const { connect, syncTrack } = setup();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    expect(syncTrack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LMU_SETUP_SYNC_INTERVAL_MS - 1);
    expect(syncTrack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(syncTrack).toHaveBeenCalledTimes(2);
    expect(syncTrack).toHaveBeenLastCalledWith('Spa');
  });

  it('publishes the track folder it read', async () => {
    const { service, connect } = setup();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    expect(service.status()).toEqual({
      lmuConnected: true,
      sessionTrackFolder: 'Spa',
      restReachable: true,
    });
  });

  it('skips a tick while the previous one is still running', async () => {
    let release: (() => void) | undefined;
    const readTrackFolder = vi.fn(
      () =>
        new Promise<string | null | 'unreachable'>((resolve) => {
          release = () => resolve('Spa');
        })
    );
    const { connect } = setup({ readTrackFolder, intervalMs: 10 });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(30);
    expect(readTrackFolder).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(readTrackFolder).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable API once and installs nothing', async () => {
    const { service, connect, syncTrack } = setup({
      readTrackFolder: vi.fn(async () => 'unreachable' as const),
    });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(syncTrack).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({
      lmuConnected: true,
      sessionTrackFolder: null,
      restReachable: false,
    });
  });

  it('clears the track folder when LMU reports none', async () => {
    const { service, connect } = setup({
      readTrackFolder: vi.fn(async () => null),
    });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    expect(service.status()).toMatchObject({
      sessionTrackFolder: null,
      restReachable: true,
    });
  });

  it('keeps going after a failed install', async () => {
    const syncTrack = vi.fn(async () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    const { connect } = setup({ syncTrack });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LMU_SETUP_SYNC_INTERVAL_MS);
    expect(syncTrack).toHaveBeenCalledTimes(2);
  });

  it('stops on disconnect and clears its status', async () => {
    const { service, connect, syncTrack } = setup();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    connect(undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTrack).toHaveBeenCalledTimes(1);
    expect(service.status()).toEqual({
      lmuConnected: false,
      sessionTrackFolder: null,
      restReachable: null,
    });
  });

  it('stops when disabled and resumes when enabled again', async () => {
    const { service, connect, syncTrack } = setup();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    service.setEnabled(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTrack).toHaveBeenCalledTimes(1);

    service.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncTrack).toHaveBeenCalledTimes(2);
  });

  it('stays off when disabled before LMU connects', async () => {
    const { service, connect, syncTrack } = setup();
    service.setEnabled(false);
    connect('lmu');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTrack).not.toHaveBeenCalled();
  });

  it('does nothing once disposed', async () => {
    const { service, connect, syncTrack } = setup();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    service.dispose();
    connect('lmu');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTrack).toHaveBeenCalledTimes(1);
  });

  it('starts no write from a REST answer that arrives after it stopped', async () => {
    let answer: ((folder: string) => void) | undefined;
    const readTrackFolder = vi.fn(
      () =>
        new Promise<string | null | 'unreachable'>((resolve) => {
          answer = (folder) => resolve(folder);
        })
    );
    const { service, connect, syncTrack } = setup({ readTrackFolder });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);
    expect(readTrackFolder).toHaveBeenCalledTimes(1);

    service.dispose();
    answer?.('Spa');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(syncTrack).not.toHaveBeenCalled();
  });

  it('starts no write from a REST answer that arrives after a disable', async () => {
    let answer: ((folder: string) => void) | undefined;
    const readTrackFolder = vi.fn(
      () =>
        new Promise<string | null | 'unreachable'>((resolve) => {
          answer = (folder) => resolve(folder);
        })
    );
    const { service, connect, syncTrack } = setup({ readTrackFolder });
    connect('lmu');
    await vi.advanceTimersByTimeAsync(0);

    service.setEnabled(false);
    answer?.('Spa');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(syncTrack).not.toHaveBeenCalled();
  });
});

describe('readSessionTrackFolder', () => {
  const transport = (response: LmuRestResponse): LmuRestTransport =>
    vi.fn(async () => response);

  it('reads the folder out of the summary', async () => {
    await expect(
      readSessionTrackFolder(
        transport({
          ok: true,
          body: JSON.stringify({ currentTrackFolder: 'Spa' }),
        })
      )
    ).resolves.toBe('Spa');
  });

  it('reports a summary without a usable folder as null', async () => {
    await expect(
      readSessionTrackFolder(transport({ ok: true, body: '{}' }))
    ).resolves.toBeNull();
  });

  it('treats an HTTP error answer as no folder', async () => {
    await expect(
      readSessionTrackFolder(
        transport({ ok: false, reason: 'status', status: 404 })
      )
    ).resolves.toBeNull();
  });

  it('reports a refused, timed-out or failed connection as unreachable', async () => {
    for (const reason of ['refused', 'timeout', 'network'] as const) {
      await expect(
        readSessionTrackFolder(transport({ ok: false, reason }))
      ).resolves.toBe('unreachable');
    }
  });
});
