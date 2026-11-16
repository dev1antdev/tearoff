import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAccess, BrowserAccessBridge } from '@irdashies/types';
import { PitWallBrowserAccess } from './PitWallBrowserAccess';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  generalSettings: {} as Record<string, unknown>,
  saveDashboard: vi.fn(),
}));

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    currentDashboard: { widgets: [], generalSettings: mocks.generalSettings },
    onDashboardUpdated: mocks.saveDashboard,
  }),
}));

const KEY = 'old-key-0123456789abcdefghijklmn';
const NEW_KEY = 'new-key-0123456789abcdefghijklmn';
const LOCAL_LINK = 'http://localhost:3000/pitwall';
const linkWith = (key: string) => `http://192.168.1.50:3000/pitwall?key=${key}`;
const MASKED_LINK = 'http://192.168.1.50:3000/pitwall?key=••••••••';
const writeText = vi.fn();

const open = (values: Partial<BrowserAccess> = {}): BrowserAccess => ({
  listening: true,
  port: 3000,
  networkAccess: true,
  host: '192.168.1.50',
  key: KEY,
  devices: 0,
  ...values,
});
const closed = (values: Partial<BrowserAccess> = {}): BrowserAccess =>
  open({ networkAccess: false, host: null, key: null, ...values });

function fakeBridge(first: BrowserAccess) {
  const listeners = new Set<(devices: number) => void>();
  const bridge = {
    getAccess: vi.fn(async () => first),
    replaceKey: vi.fn(async () => open({ key: NEW_KEY })),
    onDevicesChanged: vi.fn((callback: (devices: number) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
  } satisfies BrowserAccessBridge;
  return {
    bridge,
    announce: (devices: number) =>
      act(() => listeners.forEach((listener) => listener(devices))),
  };
}

const show = (bridge?: BrowserAccessBridge) =>
  render(
    <MemoryRouter>
      <PitWallBrowserAccess bridge={bridge} />
    </MemoryRouter>
  );

/** Renders with the server as `access` says and waits for the links. */
async function shown(access: BrowserAccess) {
  const fake = fakeBridge(access);
  show(fake.bridge);
  await screen.findByRole('heading', { name: 'On this PC' });
  return fake;
}

const otherDevices = () =>
  screen.getByRole('heading', { name: 'On another device' })
    .parentElement as HTMLElement;

beforeEach(() => {
  mocks.generalSettings = { enableWebServer: true, enableNetworkAccess: true };
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the link for this PC', () => {
  it('is shown whole, copied as it is, and opened in the browser', async () => {
    await shown(closed());

    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for this PC' })
    ).toHaveValue(LOCAL_LINK);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', LOCAL_LINK);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LOCAL_LINK);
  });

  it('names the port the server took', async () => {
    await shown(closed({ port: 3002 }));

    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for this PC' })
    ).toHaveValue('http://localhost:3002/pitwall');
  });

  it('never carries the key, even while there is one', async () => {
    await shown(open());

    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for this PC' })
    ).toHaveValue(LOCAL_LINK);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      LOCAL_LINK
    );
  });
});

describe('with network access off', () => {
  beforeEach(() => {
    mocks.generalSettings = { enableNetworkAccess: false };
  });

  it('says so, points at the switch, and offers no link for other devices', async () => {
    await shown(closed());

    expect(otherDevices()).toHaveTextContent(
      'Network access is off, so only this PC can open the page.'
    );
    expect(otherDevices()).toHaveTextContent(
      'turn on Enable Network Access in General settings and restart Tearoff'
    );
    expect(
      within(otherDevices()).getByRole('link', { name: 'General settings' })
    ).toHaveAttribute('href', '/settings/general');
    expect(
      screen.queryByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
  });

  it('does not turn network access on, whatever is pressed', async () => {
    const { bridge } = await shown(closed());

    for (const button of screen.getAllByRole('button')) {
      fireEvent.click(button);
    }

    expect(mocks.saveDashboard).not.toHaveBeenCalled();
    expect(bridge.replaceKey).not.toHaveBeenCalled();
  });

  it('says a restart is due once the switch is on and the server is not yet open', async () => {
    mocks.generalSettings = { enableNetworkAccess: true };
    await shown(closed());

    expect(otherDevices()).toHaveTextContent(
      'has not taken effect yet. Restart Tearoff'
    );
    expect(
      screen.queryByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toBeNull();
  });
});

describe('with network access on', () => {
  it('shows the link for other devices with the key kept off the screen', async () => {
    await shown(open());

    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toHaveValue(MASKED_LINK);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(otherDevices()).toHaveTextContent(
      'a device without it is refused everything'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toHaveValue(linkWith(KEY));
  });

  it('copies the link with the key in it', async () => {
    await shown(open());

    await act(async () => {
      fireEvent.click(
        within(otherDevices()).getByRole('button', { name: 'Copy' })
      );
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(linkWith(KEY));
  });

  it('says how many devices are connected, and follows the count', async () => {
    const { announce } = await shown(open());
    // The copy button beside it has a status of its own.
    const count = () => within(otherDevices()).getByText(/connected right now/);

    expect(count()).toHaveTextContent('No other device is connected');
    announce(1);
    expect(count()).toHaveTextContent('1 other device is connected right now.');
    announce(3);
    expect(count()).toHaveTextContent(
      '3 other devices are connected right now.'
    );
  });

  it('asks before it replaces the key, and keeps it when told to', async () => {
    const { bridge } = await shown(open());

    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    const dialog = screen.getByRole('dialog', { name: 'Make a new key?' });
    expect(dialog).toHaveTextContent('is disconnected');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Keep this key' })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bridge.replaceKey).not.toHaveBeenCalled();
  });

  it('replaces the key at once when told to, and shows the new link', async () => {
    const { bridge } = await shown(open());
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));

    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'New key',
      })
    );

    expect(bridge.replaceKey).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Pit Wall link for other devices' })
      ).toHaveValue(linkWith(NEW_KEY))
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the old key is still in force when a new one could not be made', async () => {
    const { bridge } = await shown(open());
    bridge.replaceKey.mockRejectedValueOnce(new Error('EPERM'));

    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'New key',
      })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The key could not be replaced. The old one is still in force.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toHaveValue(linkWith(KEY));
  });

  it('says other devices stay connected until a restart once the switch is off', async () => {
    mocks.generalSettings = { enableNetworkAccess: false };
    await shown(open());

    expect(otherDevices()).toHaveTextContent(
      'Other devices can still connect until Tearoff restarts.'
    );
    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for other devices' })
    ).toBeVisible();
  });

  it('says so where this PC has no address on a network', async () => {
    await shown(open({ host: null }));

    expect(within(otherDevices()).getByRole('alert')).toHaveTextContent(
      'Tearoff found no network address for this PC.'
    );
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
  });

  it('says so where no key could be made', async () => {
    await shown(open({ key: null }));

    expect(within(otherDevices()).getByRole('alert')).toHaveTextContent(
      'Tearoff could not make the key other devices need.'
    );
  });
});

describe('without a server to link to', () => {
  it('says the web server is turned off and points at its switch', async () => {
    mocks.generalSettings = { enableWebServer: false };
    show(fakeBridge(closed({ listening: false })).bridge);

    expect(
      await screen.findByText(/The built-in web server is turned off/)
    ).toHaveTextContent('Turn on Enable Web Server in General settings');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says a restart is due once the web server is switched back on', async () => {
    mocks.generalSettings = { enableWebServer: true };
    show(fakeBridge(closed({ listening: false })).bridge);

    expect(
      await screen.findByText(/The built-in web server is not running/)
    ).toHaveTextContent('restart Tearoff');
  });

  it('waits for the main process, then says so if it does not answer', async () => {
    const { bridge } = fakeBridge(closed());
    const answer = Promise.withResolvers<BrowserAccess>();
    bridge.getAccess.mockReturnValue(answer.promise);
    show(bridge);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the links');
    await act(async () => answer.reject(new Error('refused')));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the links.'
    );
  });

  it('has nothing to ask outside the desktop app', () => {
    show();

    expect(
      screen.getByText('The links are shown in the Tearoff app.')
    ).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
