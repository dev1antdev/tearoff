import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneralSettingsType } from '@irdashies/types';

const listen = vi.fn();
const createServer = vi.fn();

vi.mock('http', () => ({
  default: {
    createServer: (...args: unknown[]) => createServer(...args),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/irdashies-test' },
}));

// No route is looked up in a spec: with no socket to ask, the address is
// chosen from the adapters `os.networkInterfaces` is made to list.
vi.mock('dgram', () => ({
  default: {
    createSocket: () => {
      throw new Error('no sockets in a spec');
    },
  },
}));

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const bridgeProxyState: { currentDashboard: unknown } = {
  currentDashboard: null,
};
vi.mock('./bridgeProxy', () => ({
  get currentDashboard() {
    return bridgeProxyState.currentDashboard;
  },
  createBridgeProxy: vi.fn(),
}));

const getDashboard = vi.fn();
vi.mock('../storage/dashboards', () => ({
  getDashboard: (...args: unknown[]) => getDashboard(...args),
  getCurrentProfileId: () => 'test-profile',
  listProfiles: () => [{ id: 'default', name: 'Default' }],
  getGarageCoverImageAsDataUrl: vi.fn(),
}));

// The key's file is the store's own business and has its own spec. Here it
// is a store that has one key until it is asked for another, and no disk.
const STORED_KEY = 'stored-key-0123456789abcdefghijk';
const NEXT_KEY = 'next-key-0123456789abcdefghijklm';
const keyStore = { opened: 0, failReplace: false };
vi.mock('../storage/deviceKeyStore', () => ({
  createDeviceKeyStore: () => {
    let key: string | null = null;
    return {
      open: async () => {
        keyStore.opened += 1;
        key = STORED_KEY;
      },
      current: () => key,
      replace: async () => {
        if (keyStore.failReplace) throw new Error('EPERM');
        key = NEXT_KEY;
        return key;
      },
    };
  },
}));

/** Minimal stand-in for http.Server that resolves tryListen()'s 'listening' event. */
function makeFakeServer() {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  return {
    once(event: string, cb: (...a: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return this;
    },
    on(event: string, cb: (...a: unknown[]) => void) {
      return this.once(event, cb);
    },
    removeListener() {
      return this;
    },
    listen(...args: unknown[]) {
      listen(...args);
      handlers.get('listening')?.forEach((cb) => cb());
    },
  };
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Drives the request handler startComponentServer handed to http.createServer.
 *
 * `from` is the socket's remote address, which is this machine unless a spec
 * says the request comes from another device.
 */
async function request(
  path: string,
  headers: Record<string, string> = {},
  from = '127.0.0.1'
): Promise<FakeResponse> {
  const handler = createServer.mock.calls[0][0] as (
    req: unknown,
    res: unknown
  ) => Promise<void>;

  const res: FakeResponse = { statusCode: 200, headers: {}, body: '' };
  const fakeRes = {
    get statusCode() {
      return res.statusCode;
    },
    set statusCode(code: number) {
      res.statusCode = code;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = String(value);
    },
    end(chunk?: string | Buffer) {
      if (chunk) res.body = chunk.toString();
    },
  };

  await handler(
    {
      url: path,
      method: 'GET',
      headers: { host: 'localhost:3000', ...headers },
      socket: { remoteAddress: from },
    },
    fakeRes
  );
  return res;
}

async function startWith(generalSettings: GeneralSettingsType | undefined) {
  vi.resetModules();
  // Injected by the Vite/Forge build at compile time; absent under vitest.
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
  listen.mockClear();
  createServer.mockClear();
  createServer.mockImplementation(() => makeFakeServer());
  getDashboard.mockReturnValue({ widgets: [], generalSettings });
  keyStore.opened = 0;
  keyStore.failReplace = false;

  const server = await import('./componentServer');
  await server.startComponentServer();
  return server;
}

describe('startComponentServer web server flag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts when enableWebServer is absent (default on, existing installs)', async () => {
    await startWith({ enableNetworkAccess: false });
    expect(createServer).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(3000, 'localhost');
  });

  it('starts when enableWebServer is explicitly true', async () => {
    await startWith({ enableWebServer: true });
    expect(listen).toHaveBeenCalledWith(3000, 'localhost');
  });

  it('does not create or bind a server when enableWebServer is false', async () => {
    await startWith({ enableWebServer: false });
    expect(createServer).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('stays disabled even when network access is on', async () => {
    await startWith({ enableWebServer: false, enableNetworkAccess: true });
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('single-widget routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    bridgeProxyState.currentDashboard = {
      widgets: [
        { id: 'carsystems', enabled: true },
        { id: 'standings', enabled: true },
        { id: 'weather', enabled: false },
      ],
    };
    await startWith({ enableWebServer: true });
  });

  it('serves /widget/<id> rather than falling through to the static handler', async () => {
    const res = await request('/widget/carsystems');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toContain('<iframe');
  });

  it('passes the widget id to the renderer bundle', async () => {
    const res = await request('/widget/carsystems');

    expect(res.body).toContain('widget=carsystems');
    expect(res.body).toContain('index-dashboard-view.html');
  });

  it('opens the widget in the profile named in the URL', async () => {
    const res = await request('/widget/carsystems?profile=race');

    expect(res.body).toContain('profile=race');
  });

  it('falls back to the current profile when the URL names none', async () => {
    const res = await request('/widget/carsystems');

    expect(res.body).toContain('profile=test-profile');
  });

  it('does not serve a widget page for an id it would not accept', async () => {
    for (const path of ['/widget/', '/widget/a.b', '/widget/a/b']) {
      const res = await request(path);

      expect(res.body, path).not.toContain('<iframe');
    }
  });

  it('leaves /dashboard drawing every widget, with no widget parameter', async () => {
    const res = await request('/dashboard');

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('index-dashboard-view.html');
    expect(res.body).not.toContain('widget=');
  });

  it('redirects the retired /component/<id> route to its replacement', async () => {
    const res = await request('/component/carsystems');

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/widget/carsystems');
  });

  it('carries the query string through that redirect', async () => {
    const res = await request('/component/carsystems?profile=race');

    expect(res.headers['location']).toBe('/widget/carsystems?profile=race');
  });

  it('redirects the renamed /widget/twitchchat link, keeping its query', async () => {
    const res = await request('/widget/twitchchat?profile=race&debug=true');

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(
      '/widget/streamchat?profile=race&debug=true'
    );
  });

  it('points the retired /component/twitchchat route at the new id directly', async () => {
    const res = await request('/component/twitchchat');

    expect(res.headers['location']).toBe('/widget/streamchat');
  });

  it('lists widgets from the live dashboard, not a hardcoded table', async () => {
    const res = await request('/components');
    const payload = JSON.parse(res.body);

    expect(payload.components).toEqual(['carsystems', 'standings', 'weather']);
    expect(payload.enabled).toEqual(['carsystems', 'standings']);
    expect(payload.examples).toContain(
      'http://localhost:3000/widget/carsystems'
    );
  });

  it('lists widgets that are disabled on the desktop, since their URL works', async () => {
    const res = await request('/components');

    expect(JSON.parse(res.body).components).toContain('weather');
  });

  it('offers a widget link for every widget on the landing page', async () => {
    const res = await request('/');

    expect(res.body).toContain('href="/widget/carsystems"');
    expect(res.body).toContain('href="/widget/standings"');
    expect(res.body).toContain('href="/widget/weather"');
  });

  it('lists enabled widgets first, and a repeated id once', async () => {
    bridgeProxyState.currentDashboard = {
      widgets: [
        { id: 'weather', enabled: false },
        { id: 'standings', enabled: true },
        { id: 'standings', enabled: true },
      ],
    };

    const res = await request('/components');

    expect(JSON.parse(res.body).components).toEqual(['standings', 'weather']);
  });

  it('escapes widget ids, which come from a user-editable profile', async () => {
    bridgeProxyState.currentDashboard = {
      widgets: [{ id: '<img src=x onerror=alert(1)>', enabled: true }],
    };

    const res = await request('/');

    expect(res.body).not.toContain('<img');
    expect(res.body).toContain('&lt;img');
  });

  it('says so when the profile has no widgets to link', async () => {
    bridgeProxyState.currentDashboard = { widgets: [] };

    const res = await request('/');

    expect(res.body).toContain('This profile has no widgets.');
    expect(res.body).not.toContain('href="/widget/');
  });

  it('marks the ones that are switched off for the desktop overlays', async () => {
    const res = await request('/');
    const weatherRow = res.body.slice(res.body.indexOf('/widget/weather'));

    expect(weatherRow).toContain('off on desktop');
  });
});

describe('who may ask the server', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    bridgeProxyState.currentDashboard = {
      widgets: [{ id: 'standings', enabled: true }],
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses a page from another site, and tells it nothing', async () => {
    await startWith({ enableWebServer: true });
    const res = await request('/components', { origin: 'https://example.com' });

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('Forbidden');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a name somebody pointed at this machine', async () => {
    await startWith({ enableWebServer: true });
    const res = await request('/dashboard', {
      host: 'attacker.example:3000',
      origin: 'http://attacker.example:3000',
    });

    expect(res.statusCode).toBe(403);
  });

  it('opens no response to every origin any more', async () => {
    await startWith({ enableWebServer: true });
    const plain = await request('/components');
    const own = await request('/components', {
      origin: 'http://localhost:3000',
    });

    expect(plain.statusCode).toBe(200);
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    expect(own.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000'
    );
    expect(own.headers['vary']).toBe('Origin');
  });

  it("answers to the machine's network address only when open to the network", async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
    } as unknown as ReturnType<typeof os.networkInterfaces>);
    const lan = { host: '192.168.1.50:3000' };

    await startWith({ enableWebServer: true, enableNetworkAccess: false });
    expect((await request('/dashboard', lan)).statusCode).toBe(403);

    await startWith({ enableWebServer: true, enableNetworkAccess: true });
    expect((await request('/dashboard', lan)).statusCode).toBe(200);
    // Still by name too, for a browser source on this machine.
    expect((await request('/dashboard')).statusCode).toBe(200);
  });

  it('does not hand out the stored configuration outside development', async () => {
    await startWith({ enableWebServer: true });
    const res = await request('/debug/dashboard');

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('standings');
  });
});

describe('the Pit Wall page', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    bridgeProxyState.currentDashboard = {
      widgets: [{ id: 'standings', enabled: true }],
    };
    await startWith({ enableWebServer: true });
  });

  it('serves /pitwall through the page bundle, told to draw the Pit Wall', async () => {
    const res = await request('/pitwall');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toContain('<title>Tearoff - Pit Wall</title>');
    expect(res.body).toContain('<iframe');
    expect(res.body).toContain('index-dashboard-view.html');
    expect(res.body).toContain('view=pitwall');
    expect(res.body).not.toContain('widget=');
  });

  it('opens it in the profile named in the URL, or the current one', async () => {
    expect((await request('/pitwall?profile=race')).body).toContain(
      'profile=race'
    );
    expect((await request('/pitwall')).body).toContain('profile=test-profile');
  });

  it('lets the page go full screen inside its frame', async () => {
    expect((await request('/pitwall')).body).toContain('allowfullscreen');
  });

  it('is listed on the landing page, once for each profile', async () => {
    const res = await request('/');

    expect(res.body).toContain('<h2>Pit Wall</h2>');
    expect(res.body).toContain('href="/pitwall?profile=default"');
    expect(res.body).toContain('href="/dashboard?profile=default"');
  });

  it('is not served for an address that only starts the same', async () => {
    const res = await request('/pitwall/extra');

    expect(res.body).not.toContain('<iframe');
  });

  it('leaves the other pages without the parameter', async () => {
    for (const path of ['/dashboard', '/widget/standings']) {
      expect((await request(path)).body, path).not.toContain('view=');
    }
  });

  it('keeps a page on the host it was asked for by', async () => {
    // A browser source on this PC that asks for loopback stays on loopback,
    // for the page bundle and for its socket alike.
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
      const res = await request('/pitwall', { host });

      expect(res.body, host).toContain(
        `src="http://${host}/index-dashboard-view.html?`
      );
      expect(res.body, host).toContain(
        `wsUrl=${encodeURIComponent(`http://${host}`)}`
      );
    }
  });
});

describe('a device that is not this PC', () => {
  const LAN = '192.168.1.50';
  const TABLET = '192.168.1.77';
  const lan = { host: `${LAN}:3000` };
  const cookie = (key: string) => ({ ...lan, cookie: `tearoff_key=${key}` });
  const NEEDS_KEY = /^Forbidden\. This device needs the link with the key/;

  const startOpen = () =>
    startWith({ enableWebServer: true, enableNetworkAccess: true });

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeProxyState.currentDashboard = {
      widgets: [{ id: 'standings', enabled: true }],
    };
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth: [{ family: 'IPv4', internal: false, address: LAN }],
    } as unknown as ReturnType<typeof os.networkInterfaces>);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is refused every route without the key, and learns nothing else', async () => {
    await startOpen();

    for (const path of [
      '/',
      '/dashboard',
      '/dashboard?profile=default',
      '/pitwall',
      '/widget/standings',
      '/component/standings',
      '/components',
      '/api/profiles',
      '/api/server-ip',
      '/health',
      '/index-dashboard-view.html',
      '/assets/index.js',
      '/no-such-route',
    ]) {
      const res = await request(path, lan, TABLET);

      expect(res.statusCode, path).toBe(403);
      expect(res.body, path).toMatch(NEEDS_KEY);
      expect(res.headers['content-type'], path).toContain('text/plain');
      expect(res.headers['set-cookie'], path).toBeUndefined();
      expect(res.headers['location'], path).toBeUndefined();
      // Not the widget list, not a profile name, not the address, not a key.
      for (const secret of ['standings', 'Default', LAN, STORED_KEY]) {
        expect(res.body, path).not.toContain(secret);
      }
    }
  });

  describe('the index page', () => {
    const COPY_FROM = /Copy a link that carries the key in Tearoff on the PC/;

    it('names its widget links by the host it was reached by, never the key', async () => {
      await startOpen();

      // This PC by name: a link that opens on this PC, such as in a VR
      // overlay host. By the network address it would be refused on the
      // device it was copied to, which has not shown the key.
      const here = await request('/');
      expect(here.body).toContain(
        '<code>http://localhost:3000/widget/standings</code>'
      );
      expect(here.body).not.toContain(LAN);
      expect(here.body).toContain('The links on this page open on this PC.');
      expect(here.body).toMatch(COPY_FROM);

      // A device that showed the key: by the address it used, which its
      // browser's cookie opens, and told that nothing else is let in by it.
      const tablet = await request('/', cookie(STORED_KEY), TABLET);
      expect(tablet.body).toContain(
        `<code>http://${LAN}:3000/widget/standings</code>`
      );
      expect(tablet.body).toContain(
        'open in this browser, which has shown the key'
      );
      expect(tablet.body).toMatch(COPY_FROM);

      // The key is written into the page for nobody, this PC included.
      for (const page of [here, tablet]) {
        expect(page.body).not.toContain(STORED_KEY);
        expect(page.body).not.toContain('key=');
      }
    });

    it('says nothing of a key while the server answers this PC only', async () => {
      await startWith({ enableWebServer: true, enableNetworkAccess: false });
      const res = await request('/');

      expect(res.body).toContain(
        '<code>http://localhost:3000/widget/standings</code>'
      );
      expect(res.body).not.toMatch(COPY_FROM);
      expect(res.body).not.toContain('class="note"');
    });
  });

  it('is refused a wrong key, in its link or in its cookie', async () => {
    await startOpen();

    const link = await request(`/pitwall?key=${NEXT_KEY}`, lan, TABLET);
    expect(link.statusCode).toBe(403);
    expect(link.body).toMatch(NEEDS_KEY);
    expect(link.headers['set-cookie']).toBeUndefined();

    const stale = await request('/pitwall', cookie(NEXT_KEY), TABLET);
    expect(stale.statusCode).toBe(403);
    // Its browser is told to drop a cookie that is not the key.
    expect(stale.headers['set-cookie']).toBe(
      'tearoff_key=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
    );
  });

  it('is given the cookie for the key in its link, and sent on without the key', async () => {
    await startOpen();
    const res = await request(
      `/pitwall?profile=race&key=${STORED_KEY}&debug=true`,
      lan,
      TABLET
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBe(
      `tearoff_key=${STORED_KEY}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict`
    );
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toContain('no-store');
    // A page of ours that goes straight to the same page, less the key.
    expect(res.body).toContain(
      '<meta http-equiv="refresh" content="0;url=/pitwall?profile=race&amp;debug=true" />'
    );
    expect(res.body).not.toContain(STORED_KEY);
    expect(res.body).not.toContain('<iframe');
  });

  it('sends every page on that way, and names no other place to go', async () => {
    await startOpen();

    for (const [path, target] of [
      [`/?key=${STORED_KEY}`, '/'],
      [`/dashboard?key=${STORED_KEY}`, '/dashboard'],
      [`/widget/standings?key=${STORED_KEY}`, '/widget/standings'],
      [`/component/standings?key=${STORED_KEY}`, '/component/standings'],
    ]) {
      const res = await request(path, lan, TABLET);

      expect(res.body, path).toContain(`content="0;url=${target}" />`);
    }
  });

  it('is served with the cookie, by the address it asked for', async () => {
    await startOpen();
    const res = await request('/pitwall', cookie(STORED_KEY), TABLET);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(
      `src="http://${LAN}:3000/index-dashboard-view.html?`
    );
    expect(res.body).toContain('view=pitwall');
    expect(res.headers['set-cookie']).toBeUndefined();

    const list = await request('/components', cookie(STORED_KEY), TABLET);
    expect(JSON.parse(list.body).components).toEqual(['standings']);
  });

  it('gets the cookie with anything it asks for by the key; only a page is sent on', async () => {
    await startOpen();
    const res = await request(`/components?key=${STORED_KEY}`, lan, TABLET);

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain(`tearoff_key=${STORED_KEY};`);
    expect(JSON.parse(res.body).components).toEqual(['standings']);
  });

  it('is never shown the key by a page', async () => {
    await startOpen();

    for (const path of ['/', '/dashboard', '/pitwall', '/components']) {
      const res = await request(path, cookie(STORED_KEY), TABLET);

      expect(res.statusCode, path).toBe(200);
      expect(res.body, path).not.toContain(STORED_KEY);
    }
  });

  it('is not let in by its cookie where another site is asking', async () => {
    await startOpen();

    // Host and Origin decide first: the key adds to them and replaces neither.
    const foreign = await request(
      '/components',
      { ...cookie(STORED_KEY), origin: 'https://example.com' },
      TABLET
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body).toBe('Forbidden');

    const rebound = await request(
      `/dashboard?key=${STORED_KEY}`,
      {
        host: 'attacker.example:3000',
        origin: 'http://attacker.example:3000',
        cookie: `tearoff_key=${STORED_KEY}`,
      },
      TABLET
    );
    expect(rebound.statusCode).toBe(403);
    expect(rebound.body).toBe('Forbidden');
    expect(rebound.headers['set-cookie']).toBeUndefined();
  });

  it('is cut off after a few different wrong keys, the right one included', async () => {
    await startOpen();
    for (let guess = 0; guess < 5; guess++) {
      const res = await request(
        `/pitwall?key=wrong-key-${guess}-0123456789abcdef`,
        lan,
        TABLET
      );
      expect(res.statusCode).toBe(403);
    }

    const res = await request(`/pitwall?key=${STORED_KEY}`, lan, TABLET);

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('300');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('Too many wrong keys');
    // Another device, and this machine, are answered as before.
    expect(
      (await request('/pitwall', cookie(STORED_KEY), '192.168.1.78')).statusCode
    ).toBe(200);
    expect((await request('/pitwall')).statusCode).toBe(200);
  });

  it('leaves this machine as it was: no key asked, none set, nowhere sent', async () => {
    await startOpen();

    // By loopback, and by its own address as a link for OBS names it.
    for (const [headers, from] of [
      [{}, '127.0.0.1'],
      [{}, '::1'],
      [lan, '127.0.0.1'],
      [lan, LAN],
      [lan, `::ffff:${LAN}`],
    ] as const) {
      const res = await request('/pitwall?key=anything', headers, from);

      expect(res.statusCode, from).toBe(200);
      expect(res.body, from).toContain('<iframe');
      expect(res.headers['set-cookie'], from).toBeUndefined();
    }
  });

  it('has no key to show while the server answers this PC only', async () => {
    await startWith({ enableWebServer: true, enableNetworkAccess: false });

    // The server is then bound to loopback and no other device reaches it;
    // if one did, by a name this machine has, nothing it shows would do.
    expect(keyStore.opened).toBe(0);
    const res = await request(
      `/dashboard?key=${STORED_KEY}`,
      { host: 'localhost:3000', cookie: `tearoff_key=${STORED_KEY}` },
      TABLET
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(NEEDS_KEY);
  });
});

describe('what the settings window is told', () => {
  const LAN = '192.168.1.50';
  const TABLET = '192.168.1.77';
  const lan = { host: `${LAN}:3000` };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth: [{ family: 'IPv4', internal: false, address: LAN }],
    } as unknown as ReturnType<typeof os.networkInterfaces>);
  });
  afterEach(() => vi.restoreAllMocks());

  it('names the address and the key while the server is open to the network', async () => {
    const server = await startWith({
      enableWebServer: true,
      enableNetworkAccess: true,
    });

    expect(keyStore.opened).toBe(1);
    expect(server.getBrowserAccess()).toEqual({
      listening: true,
      port: 3000,
      networkAccess: true,
      host: LAN,
      key: STORED_KEY,
      devices: 0,
    });
  });

  it('names neither while the server answers this PC only, and makes no key', async () => {
    const server = await startWith({ enableWebServer: true });

    expect(keyStore.opened).toBe(0);
    expect(server.getBrowserAccess()).toEqual({
      listening: true,
      port: 3000,
      networkAccess: false,
      host: null,
      key: null,
      devices: 0,
    });
    await expect(server.replaceDeviceKey()).rejects.toThrow(
      'not open to other devices'
    );
    expect(server.getBrowserAccess().key).toBeNull();
  });

  it('says so when the web server is switched off', async () => {
    const server = await startWith({
      enableWebServer: false,
      enableNetworkAccess: true,
    });

    expect(server.getBrowserAccess()).toMatchObject({
      listening: false,
      networkAccess: false,
      host: null,
      key: null,
    });
    await expect(server.replaceDeviceKey()).rejects.toThrow();
  });

  it('names no address where the network has none to offer', async () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({});
    const server = await startWith({
      enableWebServer: true,
      enableNetworkAccess: true,
    });

    expect(server.getBrowserAccess()).toMatchObject({
      networkAccess: true,
      host: null,
      key: STORED_KEY,
    });
  });

  it('replaces the key, and the old one is refused from the next request', async () => {
    const server = await startWith({
      enableWebServer: true,
      enableNetworkAccess: true,
    });
    const old = { ...lan, cookie: `tearoff_key=${STORED_KEY}` };
    expect((await request('/pitwall', old, TABLET)).statusCode).toBe(200);

    expect((await server.replaceDeviceKey()).key).toBe(NEXT_KEY);

    expect(server.getBrowserAccess().key).toBe(NEXT_KEY);
    expect((await request('/pitwall', old, TABLET)).statusCode).toBe(403);
    expect(
      (await request(`/pitwall?key=${STORED_KEY}`, lan, TABLET)).statusCode
    ).toBe(403);
    expect(
      (await request(`/pitwall?key=${NEXT_KEY}`, lan, TABLET)).headers[
        'set-cookie'
      ]
    ).toContain(`tearoff_key=${NEXT_KEY};`);
  });

  it('keeps the old key when the new one could not be stored', async () => {
    const server = await startWith({
      enableWebServer: true,
      enableNetworkAccess: true,
    });
    keyStore.failReplace = true;

    await expect(server.replaceDeviceKey()).rejects.toThrow('EPERM');

    expect(server.getBrowserAccess().key).toBe(STORED_KEY);
    expect(
      (
        await request(
          '/pitwall',
          { ...lan, cookie: `tearoff_key=${STORED_KEY}` },
          TABLET
        )
      ).statusCode
    ).toBe(200);
  });
});
