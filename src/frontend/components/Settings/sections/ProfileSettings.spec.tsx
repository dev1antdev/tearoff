import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileSettings } from './ProfileSettings';
import userEvent from '@testing-library/user-event';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  getComponentServerPort: vi.fn(),
  getComponentServerHost: vi.fn(),
  refreshProfiles: vi.fn(),
  switchProfile: vi.fn(),
  writeText: vi.fn(),
  webServerEnabled: true,
  portDiscoveryAvailable: true,
}));

const profiles = [
  { id: 'default', name: 'Default' },
  { id: 'race + night', name: 'Night Race' },
];

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    currentDashboard: {
      widgets: [],
      generalSettings: { enableWebServer: mocks.webServerEnabled },
    },
    currentProfile: profiles[0],
    profiles,
    bridge: {
      getComponentServerPort: mocks.portDiscoveryAvailable
        ? mocks.getComponentServerPort
        : undefined,
      getComponentServerHost: mocks.getComponentServerHost,
    },
    refreshProfiles: mocks.refreshProfiles,
    switchProfile: mocks.switchProfile,
  }),
}));

const expectedUrl = (profile: string, port: number, host = '192.168.1.50') =>
  `http://${host}:${port}/dashboard?profile=${encodeURIComponent(profile)}`;

beforeEach(() => {
  mocks.getComponentServerPort.mockReset().mockResolvedValue(4321);
  mocks.switchProfile.mockReset();
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.webServerEnabled = true;
  mocks.portDiscoveryAvailable = true;
  mocks.getComponentServerHost.mockReset().mockResolvedValue('192.168.1.50');
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
});

afterEach(() => vi.unstubAllGlobals());

describe('ProfileSettings browser layout URLs', () => {
  it('returns from the delete confirmation to the originating profile Actions button', async () => {
    render(<ProfileSettings />);
    await screen.findByDisplayValue(expectedUrl('default', 4321));
    const trigger = screen.getAllByRole('button', { name: 'Actions' })[1];
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Keep Profile' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it.each([3007, 4321])(
    'uses the detected server port %i for displayed and copied OBS URLs',
    async (port) => {
      mocks.getComponentServerPort.mockResolvedValue(port);
      render(<ProfileSettings />);
      await screen.findByDisplayValue(expectedUrl('default', port));
      expect(
        screen.getByDisplayValue(expectedUrl('default', port, 'localhost'))
      ).toBeInTheDocument();
      expect(mocks.getComponentServerHost).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
      expect(mocks.writeText).toHaveBeenLastCalledWith(
        expectedUrl('default', port)
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(mocks.writeText).toHaveBeenLastCalledWith(
        expectedUrl('default', port, 'localhost')
      );
    }
  );

  it.each(profiles.map((profile, index) => ({ ...profile, index })))(
    'opens $name through Actions without switching desktop profiles',
    async ({ id, index }) => {
      render(<ProfileSettings />);
      expect(
        screen.queryByRole('link', { name: 'Edit Browser Layout' })
      ).not.toBeInTheDocument();
      await screen.findByDisplayValue(expectedUrl('default', 4321));
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Actions' })[index]
      );
      const link = screen.getByRole('link', { name: 'Edit Browser Layout' });
      await waitFor(() =>
        expect(link).toHaveAttribute('href', expectedUrl(id, 4321))
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // The existing Electron window-open handler sends this link to the
      // system browser; hardenWindow.spec covers the http(s) handoff.
      link.addEventListener('click', (event) => event.preventDefault());
      const href = link.getAttribute('href');
      fireEvent.click(link);
      expect(
        screen.queryByRole('link', { name: 'Edit Browser Layout' })
      ).not.toBeInTheDocument();
      expect(mocks.switchProfile).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Copy URL' })[index]
      );
      expect(mocks.writeText).toHaveBeenLastCalledWith(href);
    }
  );

  it('keeps URLs unavailable until port discovery resolves', async () => {
    const port = Promise.withResolvers<number>();
    mocks.getComponentServerPort.mockReturnValue(port.promise);
    render(<ProfileSettings />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading browser source URLs...'
    );
    expect(
      screen.queryByRole('link', { name: 'Edit Browser Layout' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy URL' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy for OBS' })
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/http:\/\//)).not.toBeInTheDocument();

    port.resolve(4321);
    await screen.findByDisplayValue(expectedUrl('default', 4321));
    const link = screen.getByRole('link', { name: 'Edit Browser Layout' });
    expect(link).toHaveAttribute('href', expectedUrl('race + night', 4321));
    expect(screen.getAllByRole('button', { name: 'Copy URL' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 4321)
    );
  });

  it('shows an error and keeps URLs unavailable when port discovery fails', async () => {
    mocks.getComponentServerPort.mockRejectedValue(
      new Error('Port lookup failed')
    );
    render(<ProfileSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load browser source URLs'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(
      screen.queryByRole('link', { name: 'Edit Browser Layout' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy URL' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy for OBS' })
    ).not.toBeInTheDocument();
    expect(mocks.getComponentServerHost).not.toHaveBeenCalled();
  });

  it('uses the original default only for a legacy bridge without port discovery', async () => {
    mocks.portDiscoveryAvailable = false;
    render(<ProfileSettings />);
    await screen.findByDisplayValue(expectedUrl('default', 3000));
    fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 3000)
    );
    expect(mocks.getComponentServerPort).not.toHaveBeenCalled();
  });

  it('keeps the detected port when the LAN address lookup fails', async () => {
    mocks.getComponentServerHost.mockRejectedValue(new Error('No LAN address'));
    render(<ProfileSettings />);
    await screen.findAllByDisplayValue(
      expectedUrl('default', 4321, 'localhost')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 4321, 'localhost')
    );
  });

  it('hides browser actions when the web server is turned off', () => {
    mocks.webServerEnabled = false;
    render(<ProfileSettings />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Edit Browser Layout' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy URL' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy for OBS' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/The built-in web server is turned off/)
    ).toBeInTheDocument();
  });
});

describe('ProfileSettings links for other devices', () => {
  const KEY = 'device-key-0123456789abcdefghijk';
  const keyed = (profile: string) => `${expectedUrl(profile, 4321)}&key=${KEY}`;
  const masked = `${expectedUrl('default', 4321)}&key=••••••••`;
  const access = (key: string | null) => ({
    listening: true,
    port: 4321,
    networkAccess: key !== null,
    host: key === null ? null : '192.168.1.50',
    key,
    devices: 0,
  });

  /** The server as the main process reports it to the settings window. */
  const serverHas = (key: string | null) => {
    window.browserAccessBridge = {
      getAccess: async () => access(key),
      replaceKey: async () => access(key),
      onDevicesChanged: () => () => undefined,
    };
  };

  afterEach(() => {
    delete window.browserAccessBridge;
  });

  it('carries the key in the link by network address, and keeps it off the screen', async () => {
    serverHas(KEY);
    render(<ProfileSettings />);

    await screen.findByDisplayValue(masked);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(
      screen.getByText(/It carries the key a device that is not this PC needs/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
    expect(mocks.writeText).toHaveBeenLastCalledWith(keyed('default'));

    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(screen.getByDisplayValue(keyed('default'))).toBeInTheDocument();
  });

  it('copies each profile’s URL with the key', async () => {
    serverHas(KEY);
    render(<ProfileSettings />);
    await screen.findByDisplayValue(masked);

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy URL' })[1]);

    expect(mocks.writeText).toHaveBeenLastCalledWith(keyed('race + night'));
  });

  it('leaves the links this PC opens without the key', async () => {
    serverHas(KEY);
    render(<ProfileSettings />);
    await screen.findByDisplayValue(masked);

    // The localhost link, and the page opened from here in this PC's browser.
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 4321, 'localhost')
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(
      screen.getByRole('link', { name: 'Edit Browser Layout' })
    ).toHaveAttribute('href', expectedUrl('race + night', 4321));
  });

  it('carries no key while the server answers this PC only', async () => {
    serverHas(null);
    mocks.getComponentServerHost.mockResolvedValue('localhost');
    render(<ProfileSettings />);
    await screen.findAllByDisplayValue(
      expectedUrl('default', 4321, 'localhost')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));

    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 4321, 'localhost')
    );
    expect(screen.queryByRole('button', { name: 'Show key' })).toBeNull();
    expect(screen.queryByText(/It carries the key/)).toBeNull();
  });

  it('never puts the key on a link that names this PC itself', async () => {
    // Network access is on, yet no address was found: the link says localhost.
    serverHas(KEY);
    mocks.getComponentServerHost.mockResolvedValue('localhost');
    render(<ProfileSettings />);
    await screen.findAllByDisplayValue(
      expectedUrl('default', 4321, 'localhost')
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy URL' })[0]);

    expect(mocks.writeText).toHaveBeenLastCalledWith(
      expectedUrl('default', 4321, 'localhost')
    );
    expect(document.body.innerHTML).not.toContain(KEY);
  });
});
