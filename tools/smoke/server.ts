import http from 'node:http';
import { WebSocket } from 'ws';
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
      { host: '127.0.0.1', port, path, headers, timeout: TIMEOUT_MS },
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

/** `open` with the first message's type, or the status the handshake got. */
function knock(
  port: number,
  origin: string | undefined
): Promise<{ opened: boolean; status?: number; first?: string }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${port}`, {
      origin,
      handshakeTimeout: TIMEOUT_MS,
    });
    const done = (result: {
      opened: boolean;
      status?: number;
      first?: string;
    }) => {
      clearTimeout(timer);
      socket.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => done({ opened: false }), TIMEOUT_MS + 1000);
    socket.on('unexpected-response', (_request, response) =>
      done({ opened: false, status: response.statusCode })
    );
    socket.on('error', () => done({ opened: false }));
    socket.on('message', (raw) => {
      let first: string | undefined;
      try {
        first = (JSON.parse(raw.toString()) as { type?: string }).type;
      } catch {
        first = undefined;
      }
      done({ opened: true, first });
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
      Origin: 'https://example.com',
    });
    return {
      passed: answer.status === 403,
      detail: `Answered ${answer.status}.`,
    };
  });

  await check('a name pointed at this machine is refused', async () => {
    const answer = await get(port, '/dashboard', {
      Host: `rebound.example:${port}`,
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
    const passed = result.opened && result.first === 'initialState';
    return {
      passed,
      detail: passed
        ? 'Opened and was sent the dashboard.'
        : result.opened
          ? `Opened, but the first message was "${result.first}".`
          : `Did not open (status ${result.status ?? 'none'}).`,
    };
  });

  await check("another site's connection is refused", async () => {
    const result = await knock(port, 'https://example.com');
    return {
      passed: !result.opened && result.status === 403,
      detail: result.opened
        ? 'It opened.'
        : `Refused with status ${result.status ?? 'none'}.`,
    };
  });

  return checks;
}
