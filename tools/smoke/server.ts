import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { badTokens, isNoise, SMOKE_STRANGERS } from './errors.ts';
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

export interface Asked {
  opened: boolean;
  /** The handshake's status when it was refused. */
  status?: number;
  /** What came back under the request's id; absent when nothing did. */
  answer?: { data?: unknown; error?: unknown };
}

const ANSWER_MS = 3000;

/**
 * Opens a connection as `origin`, sends one request, and waits for the
 * answer that carries the request's id. Other messages may come first, as
 * the greeting does.
 *
 * @param answerMs How long an open connection is given to answer.
 */
export function ask(
  port: number,
  origin: string | undefined,
  type: string,
  data: unknown,
  answerMs = ANSWER_MS
): Promise<Asked> {
  return new Promise((resolve) => {
    const requestId = `smoke-${type}`;
    const socket = new WebSocket(`ws://localhost:${port}`, {
      origin,
      handshakeTimeout: TIMEOUT_MS,
    });
    let timer = setTimeout(() => done({ opened: false }), TIMEOUT_MS + 1000);
    const done = (result: Asked) => {
      clearTimeout(timer);
      socket.terminate();
      resolve(result);
    };
    socket.on('unexpected-response', (_request, response) =>
      done({ opened: false, status: response.statusCode })
    );
    socket.on('error', () => done({ opened: false }));
    socket.on('open', () => {
      clearTimeout(timer);
      timer = setTimeout(() => done({ opened: true }), answerMs);
      socket.send(JSON.stringify({ type, requestId, data }));
    });
    socket.on('message', (raw) => {
      try {
        const reply = JSON.parse(raw.toString()) as {
          type?: string;
          requestId?: string;
          data?: unknown;
          error?: unknown;
        };
        if (reply.type !== type || reply.requestId !== requestId) return;
        done({
          opened: true,
          answer: { data: reply.data, error: reply.error },
        });
      } catch {
        // Not JSON, so not the answer.
      }
    });
  });
}

const notOpened = (asked: Asked) =>
  `The connection did not open (status ${asked.status ?? 'none'}).`;

/**
 * Whether a car's laps came back over the socket. On a recording the car
 * may well have none: an empty list is an answer, and a pass.
 */
export function raceHistoryReadVerdict(asked: Asked): {
  passed: boolean;
  detail: string;
} {
  if (!asked.opened) return { passed: false, detail: notOpened(asked) };
  if (!asked.answer) {
    return {
      passed: false,
      detail: 'Opened, but the race history did not answer in three seconds.',
    };
  }
  if (typeof asked.answer.error === 'string') {
    return {
      passed: false,
      detail: `Answered with an error: ${asked.answer.error.slice(0, 120)}`,
    };
  }
  const laps = (asked.answer.data as { laps?: unknown } | null)?.laps;
  if (!Array.isArray(laps)) {
    return {
      passed: false,
      detail: 'Answered with something that is not a car’s laps.',
    };
  }
  return {
    passed: true,
    detail: `Answered with the laps of car 0: ${laps.length} of them.`,
  };
}

/**
 * Whether a request for a car slot there cannot be was refused in words.
 * That it is refused at all is what says the checked bridge is behind the
 * socket, and not the records themselves.
 */
export function raceHistoryRefusalVerdict(asked: Asked): {
  passed: boolean;
  detail: string;
} {
  if (!asked.opened) return { passed: false, detail: notOpened(asked) };
  if (!asked.answer) {
    return {
      passed: false,
      detail: 'Opened, but the request was not answered in three seconds.',
    };
  }
  if (typeof asked.answer.error !== 'string') {
    return {
      passed: false,
      detail: 'It was answered with data, where it had to be refused.',
    };
  }
  return {
    passed: true,
    detail: `Refused: ${asked.answer.error.slice(0, 120)}`,
  };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What `browserPage.cjs` saw of a page it opened as a browser does. */
export interface BrowserPageSeen {
  /** The status the server answered the page with; null where none came. */
  status: number | null;
  /** The page's own element was there, in whichever frame of the page. */
  found: boolean;
  /** That element's `data-` attributes: for the Pit Wall, its layout. */
  attributes: Record<string, string>;
  /** How many characters of text the element drew. */
  drawn: number;
  /** The text of the frame the element was found in. */
  text: string;
  /** The error lines of the page's console. */
  errors: string[];
  /** A picture of the page was written. */
  pictured: boolean;
  /** Why the page could not be opened at all. */
  failure: string | null;
}

const unseen = (failure: string): BrowserPageSeen => ({
  status: null,
  found: false,
  attributes: {},
  drawn: 0,
  text: '',
  errors: [],
  pictured: false,
  failure,
});

const ANSWER_MARK = 'SMOKE_PAGE ';

/**
 * The one line `browserPage.cjs` answers with, out of everything it and the
 * browser under it wrote. Nothing is taken on trust from another process:
 * a field that is not what it should be reads as not seen.
 */
export function readBrowserPageAnswer(
  output: string
): BrowserPageSeen | undefined {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith(ANSWER_MARK));
  if (!line) return undefined;
  let answer: unknown;
  try {
    answer = JSON.parse(line.slice(ANSWER_MARK.length));
  } catch {
    return undefined;
  }
  if (typeof answer !== 'object' || answer === null) return undefined;
  const seen = answer as Record<string, unknown>;
  const attributes =
    typeof seen.attributes === 'object' && seen.attributes !== null
      ? Object.fromEntries(
          Object.entries(seen.attributes).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {};
  return {
    status: typeof seen.status === 'number' ? seen.status : null,
    found: seen.found === true,
    attributes,
    drawn: typeof seen.drawn === 'number' ? seen.drawn : 0,
    text: typeof seen.text === 'string' ? seen.text : '',
    errors: Array.isArray(seen.errors)
      ? seen.errors.filter(
          (entry): entry is string => typeof entry === 'string'
        )
      : [],
    pictured: seen.pictured === true,
    failure: typeof seen.failure === 'string' ? seen.failure : null,
  };
}

/**
 * Whether a browser drew the Pit Wall page. That the server hands the page
 * out is checked by asking for it; this is the page itself, opened as a
 * tablet's browser opens it: it has to appear, with text in it, without
 * anything a page should never show and without an error in its console.
 */
export function browserPageVerdict(seen: BrowserPageSeen): {
  passed: boolean;
  detail: string;
} {
  const picture = seen.pictured ? ' Its picture shows what was there.' : '';
  const fail = (detail: string) => ({ passed: false, detail });
  if (seen.failure) {
    return fail(`A browser could not open the page: ${seen.failure}`);
  }
  if (seen.status !== null && seen.status !== 200) {
    return fail(`A browser was answered ${seen.status}.${picture}`);
  }
  const errors = seen.errors.filter((line) => !isNoise(line));
  const firstError =
    errors.length > 0 ? ` Its console: ${errors[0].slice(0, 200)}` : '';
  if (!seen.found) {
    return fail(
      `A browser loaded the page, but the Pit Wall never appeared in it.${firstError}${picture}`
    );
  }
  if (seen.drawn === 0) {
    return fail(
      `The Pit Wall appeared in a browser and drew nothing.${firstError}${picture}`
    );
  }
  const tokens = badTokens(seen.text);
  if (tokens.length > 0) {
    return fail(`In a browser the page shows ${tokens.join(', ')}.${picture}`);
  }
  if (errors.length > 0) {
    return fail(
      `Drawn in a browser, with ${errors.length === 1 ? 'an error' : `${errors.length} errors`} in its console: ${errors[0].slice(0, 200)}`
    );
  }
  if (!seen.pictured) {
    return fail('Drawn in a browser, but no picture of it could be taken.');
  }
  const layout = seen.attributes['data-layout'];
  return {
    passed: true,
    detail: `Drawn by a browser on this machine${layout ? `, in the ${layout} layout` : ''}: ${seen.drawn} characters of text, no error in its console, and photographed.`,
  };
}

const BROWSER_PAGE_SCRIPT = fileURLToPath(
  new URL('./browserPage.cjs', import.meta.url)
);
/** The helper waits up to 30 s for the page and 4 s more; then it is cut off. */
const BROWSER_PAGE_TIMEOUT_MS = 90_000;

/** The Electron this repository installs: a browser, without the app. */
function repositoryElectron(): string {
  // In Node the package is the path of its executable.
  const found: unknown = createRequire(import.meta.url)('electron');
  if (typeof found !== 'string') throw new Error('no Electron is installed');
  return found;
}

/**
 * Opens a page of the built-in web server in a browser of its own and
 * photographs it. The browser is the repository's Electron running
 * `browserPage.cjs`, not the app: a window that is never shown, with nothing
 * of the app in it and a user-data folder that is removed afterwards.
 */
export function photographBrowserPage(options: {
  url: string;
  /** Where the picture goes. */
  file: string;
}): Promise<BrowserPageSeen> {
  return new Promise((resolve) => {
    let electron: string;
    let userData: string;
    try {
      electron = repositoryElectron();
      userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-smoke-page-'));
    } catch (error) {
      resolve(unseen(message(error)));
      return;
    }
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'ELECTRON_RUN_AS_NODE'
      )
    );
    env.NODE_OPTIONS = '';
    env.SMOKE_PAGE_USER_DATA = userData;
    execFile(
      electron,
      // The address last: Electron does not start with anything after one.
      [BROWSER_PAGE_SCRIPT, options.file, options.url],
      {
        env,
        timeout: BROWSER_PAGE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        try {
          fs.rmSync(userData, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          });
        } catch {
          // A folder left in the temporary folder harms nothing.
        }
        resolve(
          readBrowserPageAnswer(stdout) ??
            unseen(
              error
                ? `the browser gave no answer (${message(error).split('\n')[0]})`
                : 'the browser gave no answer'
            )
        );
      }
    );
  });
}

/** The check that says the server hands the Pit Wall page out. */
const PIT_WALL_SERVED = 'browser page /pitwall';

export async function checkBrowserServer(options: {
  port: number;
  /** A packaged build serves the page bundle itself; in dev Vite does. */
  packaged: boolean;
  /** A fresh profile has the server on; a copied one may have it off. */
  expectListening: boolean;
  /**
   * Where to put a picture of the Pit Wall page as a browser draws it.
   * Left out, the page is asked for and not opened.
   */
  pitWallPicture?: string;
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
  await check(PIT_WALL_SERVED, async () => {
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

  // What the Pit Wall page's panels read in a browser. From this machine,
  // which needs no key; who else is let in is the handshake's, checked above.
  const ownPage = `http://localhost:${port}`;
  await check('the race history is read over the page’s connection', async () =>
    raceHistoryReadVerdict(
      await ask(port, ownPage, 'raceHistory:getCarLaps', [0])
    )
  );
  await check('the race history refuses a car there cannot be', async () =>
    raceHistoryRefusalVerdict(
      // One past the last car slot there is.
      await ask(port, ownPage, 'raceHistory:getCarLaps', [128])
    )
  );

  // Last, so the page's own connection and reads are not in the answers
  // above. A page the server did not hand out is not opened: the check
  // above has said so already.
  const { pitWallPicture } = options;
  const served = checks.some(
    (entry) => entry.name === PIT_WALL_SERVED && entry.passed
  );
  if (pitWallPicture && served) {
    await check('browser page /pitwall drawn in a browser', async () =>
      browserPageVerdict(
        await photographBrowserPage({
          url: `${ownPage}/pitwall`,
          file: pitWallPicture,
        })
      )
    );
  }

  return checks;
}
