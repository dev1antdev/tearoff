import http from 'node:http';
import { WebSocket } from 'ws';
import { SMOKE_STRANGERS } from './errors.ts';
import type { ToggleCheck } from './report.ts';

/**
 * Knocks on the app's built-in web server the way a browser source does, and
 * the way two visitors that must be turned away do.
 *
 * The server is what OBS, a VR overlay host or a tablet reads the overlays
 * from. It must answer its own pages, and refuse a page from another site and
 * a name somebody else pointed at this machine.
 */

interface Answer {
  status: number;
  body: string;
}

const TIMEOUT_MS = 5000;

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      // By name, as a browser source is: the server binds to `localhost`,
      // which on Windows is the IPv6 loopback and not 127.0.0.1.
      { host: 'localhost', port, path, headers, timeout: TIMEOUT_MS },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.on('timeout', () => request.destroy(new Error('no answer in 5 s')));
    request.on('error', reject);
  });
}

interface Knock {
  opened: boolean;
  /** The handshake's status when it was refused. */
  status?: number;
  /** The server sent the dashboard, which it does to every page it lets in. */
  greeted: boolean;
}

const GREETING_MS = 2000;

/** Opens a connection as `origin` and waits for the server's greeting. */
function knock(port: number, origin: string | undefined): Promise<Knock> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${port}`, {
      origin,
      handshakeTimeout: TIMEOUT_MS,
    });
    let timer = setTimeout(
      () => done({ opened: false, greeted: false }),
      TIMEOUT_MS + 1000
    );
    const done = (result: Knock) => {
      clearTimeout(timer);
      socket.terminate();
      resolve(result);
    };
    socket.on('unexpected-response', (_request, response) =>
      done({ opened: false, status: response.statusCode, greeted: false })
    );
    socket.on('error', () => done({ opened: false, greeted: false }));
    socket.on('open', () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => done({ opened: true, greeted: false }),
        GREETING_MS
      );
    });
    // Other messages may come first: the running state does, for the first
    // page to connect.
    socket.on('message', (raw) => {
      try {
        const type = (JSON.parse(raw.toString()) as { type?: string }).type;
        if (type === 'initialState') done({ opened: true, greeted: true });
      } catch {
        // Not JSON, so not the greeting.
      }
    });
  });
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function checkBrowserServer(options: {
  port: number;
  /** A packaged build serves the page bundle itself; in dev Vite does. */
  packaged: boolean;
  /** A fresh profile has the server on; a copied one may have it off. */
  expectListening: boolean;
}): Promise<ToggleCheck[]> {
  const { port } = options;
  const checks: ToggleCheck[] = [];
  const check = async (
    name: string,
    run: () => Promise<{ passed: boolean; detail: string }>
  ) => {
    try {
      checks.push({ name, ...(await run()) });
    } catch (error) {
      checks.push({ name, passed: false, detail: message(error) });
    }
  };

  try {
    await get(port, '/health');
  } catch (error) {
    return [
      {
        name: 'browser source server',
        passed: !options.expectListening,
        detail: options.expectListening
          ? `Nothing answered on port ${port}: ${message(error)}.`
          : `Nothing answered on port ${port}; this profile has the web server switched off, so it was not checked.`,
      },
    ];
  }

  await check('browser page /dashboard', async () => {
    const answer = await get(port, '/dashboard');
    const passed =
      answer.status === 200 &&
      answer.body.includes('index-dashboard-view.html');
    return {
      passed,
      detail: passed
        ? 'Served, and it points at the overlay page.'
        : `Answered ${answer.status} without the overlay page in it.`,
    };
  });

  // The smoke knocks from this machine, which needs no key. What a device
  // that is not this machine is refused is covered by the specs: a run has
  // no second machine to knock from.
  await check('browser page /pitwall', async () => {
    const answer = await get(port, '/pitwall');
    const passed =
      answer.status === 200 &&
      answer.body.includes('index-dashboard-view.html') &&
      answer.body.includes('view=pitwall');
    return {
      passed,
      detail: passed
        ? 'Served to this machine, and it points at the Pit Wall page.'
        : `Answered ${answer.status} without the Pit Wall page in it.`,
    };
  });

  if (options.packaged) {
    await check('overlay page bundle', async () => {
      const answer = await get(port, '/index-dashboard-view.html');
      const passed = answer.status === 200 && answer.body.includes('<script');
      return {
        passed,
        detail: passed ? 'Served.' : `Answered ${answer.status}.`,
      };
    });
  }

  await check('a page from another site is refused', async () => {
    const answer = await get(port, '/components', {
      Origin: SMOKE_STRANGERS.origin,
    });
    return {
      passed: answer.status === 403,
      detail: `Answered ${answer.status}.`,
    };
  });

  await check('a name pointed at this machine is refused', async () => {
    const answer = await get(port, '/dashboard', {
      Host: `${SMOKE_STRANGERS.host}:${port}`,
    });
    return {
      passed: answer.status === 403,
      detail: `Answered ${answer.status}.`,
    };
  });

  await check('the stored configuration is not handed out', async () => {
    const answer = await get(port, '/debug/dashboard');
    // A development run keeps the route, by design.
    const passed = options.packaged ? answer.status === 404 : true;
    return { passed, detail: `Answered ${answer.status}.` };
  });

  await check("the overlay page's own connection opens", async () => {
    const result = await knock(port, `http://localhost:${port}`);
    const passed = result.opened && result.greeted;
    return {
      passed,
      detail: passed
        ? 'Opened and was sent the dashboard.'
        : result.opened
          ? 'Opened, but the dashboard was not sent within two seconds.'
          : `Did not open (status ${result.status ?? 'none'}).`,
    };
  });

  await check("another site's connection is refused", async () => {
    const result = await knock(port, SMOKE_STRANGERS.origin);
    return {
      passed: !result.opened && result.status === 403,
      detail: result.opened
        ? 'It opened.'
        : `Refused with status ${result.status ?? 'none'}.`,
    };
  });

  return checks;
}
