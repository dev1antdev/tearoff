// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ask,
  browserPageVerdict,
  raceHistoryReadVerdict,
  raceHistoryRefusalVerdict,
  readBrowserPageAnswer,
  type BrowserPageSeen,
} from './server.ts';

// The smoke run's one question over the page's socket, against a stand-in
// for the app's server: a real socket on a real port, answered as told. What
// the app itself answers is the app's own specs' to say.

interface Received {
  origin: string | undefined;
  message: { type?: string; requestId?: string; data?: unknown };
}

interface Stand {
  /** False refuses the handshake, as the app does a page of another site. */
  letIn?: boolean;
  /** What to send back for a request; nothing sends nothing. */
  reply?: (request: Received['message']) => unknown[];
}

const servers: http.Server[] = [];

async function standIn({ letIn = true, reply = () => [] }: Stand = {}) {
  const received: Received[] = [];
  const server = http.createServer((_request, response) => response.end());
  const sockets = new WebSocketServer({
    server,
    verifyClient: (_info, done) =>
      letIn ? done(true) : done(false, 403, 'Forbidden'),
  });
  sockets.on('connection', (socket, request) => {
    // Other messages come first on the real server too.
    socket.send(JSON.stringify({ type: 'initialState', data: {} }));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Received['message'];
      received.push({ origin: request.headers.origin, message });
      for (const answer of reply(message)) socket.send(JSON.stringify(answer));
    });
  });
  // By name, as the run reaches the app: whichever loopback that is here.
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, received };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

const LAPS = 'raceHistory:getCarLaps';

describe('ask', () => {
  it('sends one request as the page it says it is, and returns the answer under its id', async () => {
    const { port, received } = await standIn({
      reply: (request) => [
        // Not the answer: another read's, and another request's.
        { type: 'raceHistory:getCarStints', requestId: request.requestId },
        { type: request.type, requestId: 'somebody-else', data: 'no' },
        {
          type: request.type,
          requestId: request.requestId,
          data: { laps: [], missingLaps: [], revision: 0 },
        },
      ],
    });

    const asked = await ask(port, `http://localhost:${port}`, LAPS, [0]);

    expect(asked).toEqual({
      opened: true,
      answer: {
        data: { laps: [], missingLaps: [], revision: 0 },
        error: undefined,
      },
    });
    expect(received).toEqual([
      {
        origin: `http://localhost:${port}`,
        message: { type: LAPS, requestId: `smoke-${LAPS}`, data: [0] },
      },
    ]);
  });

  it('returns an error answer as one', async () => {
    const { port } = await standIn({
      reply: (request) => [
        {
          type: request.type,
          requestId: request.requestId,
          error: 'Invalid car for raceHistory:getCarLaps',
        },
      ],
    });

    const asked = await ask(port, `http://localhost:${port}`, LAPS, [128]);

    expect(asked.answer).toEqual({
      data: undefined,
      error: 'Invalid car for raceHistory:getCarLaps',
    });
  });

  it('says the connection opened and nothing came back, when nothing does', async () => {
    const { port } = await standIn();

    expect(await ask(port, undefined, LAPS, [0], 150)).toEqual({
      opened: true,
    });
  });

  it('says the handshake was refused, and with what', async () => {
    const { port, received } = await standIn({ letIn: false });

    expect(await ask(port, 'https://example.com', LAPS, [0])).toEqual({
      opened: false,
      status: 403,
    });
    expect(received).toEqual([]);
  });

  it('says the connection did not open where nothing listens', async () => {
    const { port } = await standIn();
    await new Promise<void>((resolve) => {
      const [server] = servers.splice(0);
      server.closeAllConnections();
      server.close(() => resolve());
    });

    expect(await ask(port, undefined, LAPS, [0])).toEqual({ opened: false });
  });
});

describe('raceHistoryReadVerdict', () => {
  const answered = (data: unknown) => ({ opened: true, answer: { data } });

  it('passes a car’s laps, none of them included', () => {
    expect(
      raceHistoryReadVerdict(
        answered({ laps: [], missingLaps: [], revision: 0 })
      )
    ).toEqual({
      passed: true,
      detail: 'Answered with the laps of car 0: 0 of them.',
    });
    expect(
      raceHistoryReadVerdict(answered({ laps: [{}, {}, {}] })).detail
    ).toBe('Answered with the laps of car 0: 3 of them.');
  });

  it('fails what is not a car’s laps', () => {
    for (const data of [undefined, null, [], 'laps', { laps: 3 }, {}]) {
      expect(raceHistoryReadVerdict(answered(data))).toEqual({
        passed: false,
        detail: 'Answered with something that is not a car’s laps.',
      });
    }
  });

  it('fails an error answer, and says what it was without the whole of it', () => {
    const verdict = raceHistoryReadVerdict({
      opened: true,
      answer: { error: `The race history is unavailable${'!'.repeat(500)}` },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toMatch(
      /^Answered with an error: The race history is unavailable!/
    );
    expect(verdict.detail.length).toBeLessThan(160);
  });

  it('fails a connection that opened and was not answered, or did not open', () => {
    expect(raceHistoryReadVerdict({ opened: true })).toEqual({
      passed: false,
      detail: 'Opened, but the race history did not answer in three seconds.',
    });
    expect(raceHistoryReadVerdict({ opened: false, status: 403 })).toEqual({
      passed: false,
      detail: 'The connection did not open (status 403).',
    });
    expect(raceHistoryReadVerdict({ opened: false }).detail).toBe(
      'The connection did not open (status none).'
    );
  });
});

describe('raceHistoryRefusalVerdict', () => {
  it('passes a refusal in words', () => {
    expect(
      raceHistoryRefusalVerdict({
        opened: true,
        answer: { error: 'Invalid car for raceHistory:getCarLaps' },
      })
    ).toEqual({
      passed: true,
      detail: 'Refused: Invalid car for raceHistory:getCarLaps',
    });
  });

  it('fails data where there had to be a refusal', () => {
    // The records answering for themselves, with no check in front of them.
    expect(
      raceHistoryRefusalVerdict({
        opened: true,
        answer: { data: { laps: [], missingLaps: [], revision: 0 } },
      })
    ).toEqual({
      passed: false,
      detail: 'It was answered with data, where it had to be refused.',
    });
  });

  it('fails silence, and a connection that did not open', () => {
    expect(raceHistoryRefusalVerdict({ opened: true }).passed).toBe(false);
    expect(raceHistoryRefusalVerdict({ opened: false, status: 403 })).toEqual({
      passed: false,
      detail: 'The connection did not open (status 403).',
    });
  });
});

describe('the Pit Wall page as a browser draws it', () => {
  // What the helper says of a page that drew: found in the frame the
  // server's page puts around it, with text, no errors and a picture.
  const drawn: BrowserPageSeen = {
    status: 200,
    found: true,
    attributes: { 'data-layout': 'race', 'data-tab': 'overview' },
    drawn: 1840,
    text: 'Tearoff\nPIT WALL\nLe Mans Ultimate connected\nTIMING TOWER\n#77',
    errors: [],
    pictured: true,
    failure: null,
  };

  it('passes a page that appeared, drew its text and was photographed', () => {
    expect(browserPageVerdict(drawn)).toEqual({
      passed: true,
      detail:
        'Drawn by a browser on this machine, in the race layout: 1840 characters of text, no error in its console, and photographed.',
    });
  });

  it('fails a page the server hands out and a browser cannot draw', () => {
    // What asking the server for the page cannot tell: it answered 200
    // with the page in it, and nothing came of it in a browser.
    const verdict = browserPageVerdict({
      ...drawn,
      found: false,
      attributes: {},
      drawn: 0,
      text: '',
      errors: ['Uncaught TypeError: bridge.connection is undefined'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain('the Pit Wall never appeared in it');
    expect(verdict.detail).toContain('bridge.connection is undefined');
    expect(verdict.detail).toContain('Its picture shows what was there.');
  });

  it('fails a page that appeared and drew nothing', () => {
    const verdict = browserPageVerdict({ ...drawn, drawn: 0, text: '' });

    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain('drew nothing');
  });

  it('fails a page that shows what a page should never show', () => {
    const verdict = browserPageVerdict({
      ...drawn,
      text: `${drawn.text}\nGap NaN`,
    });

    expect(verdict).toEqual({
      passed: false,
      detail:
        'In a browser the page shows NaN. Its picture shows what was there.',
    });
  });

  it('fails a page with an error in its console, and says the first', () => {
    const verdict = browserPageVerdict({
      ...drawn,
      errors: ['The race history could not be read', 'and another'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toBe(
      'Drawn in a browser, with 2 errors in its console: The race history could not be read'
    );
  });

  it('does not count what the browser itself says in the console', () => {
    expect(
      browserPageVerdict({
        ...drawn,
        errors: [
          '%cElectron Security Warning (Insecure Content-Security-Policy)',
        ],
      }).passed
    ).toBe(true);
  });

  it('fails a page the server refused, by its status', () => {
    const verdict = browserPageVerdict({
      ...drawn,
      status: 403,
      found: false,
      drawn: 0,
      text: '',
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain('answered 403');
  });

  it('fails where the browser could not open the page or take its picture', () => {
    expect(
      browserPageVerdict({
        ...drawn,
        found: false,
        pictured: false,
        failure: 'ERR_CONNECTION_REFUSED (-102)',
      })
    ).toEqual({
      passed: false,
      detail:
        'A browser could not open the page: ERR_CONNECTION_REFUSED (-102)',
    });
    expect(browserPageVerdict({ ...drawn, pictured: false }).passed).toBe(
      false
    );
  });

  describe('the answer of the helper', () => {
    const line = `SMOKE_PAGE ${JSON.stringify({ url: 'http://localhost:3000/pitwall', ...drawn, warnings: 2 })}`;

    it('is read out of everything else the browser wrote', () => {
      const output = [
        '',
        '(node:1234) electron: something of its own',
        line,
        '',
      ].join('\r\n');

      expect(readBrowserPageAnswer(output)).toEqual(drawn);
    });

    it('is not there when the browser said nothing, or not in JSON', () => {
      expect(readBrowserPageAnswer('')).toBeUndefined();
      expect(readBrowserPageAnswer('SMOKE_PAGE {"status":')).toBeUndefined();
      expect(readBrowserPageAnswer('SMOKE_PAGE null')).toBeUndefined();
    });

    it('reads a field that is not what it should be as not seen', () => {
      const seen = readBrowserPageAnswer(
        `SMOKE_PAGE ${JSON.stringify({
          status: '200',
          found: 'yes',
          attributes: { 'data-layout': 7, 'data-tab': 'all' },
          drawn: '12',
          text: 5,
          errors: ['one', 2],
          pictured: 1,
          failure: {},
        })}`
      );

      expect(seen).toEqual({
        status: null,
        found: false,
        attributes: { 'data-tab': 'all' },
        drawn: 0,
        text: '',
        errors: ['one'],
        pictured: false,
        failure: null,
      });
      expect(browserPageVerdict(seen as BrowserPageSeen).passed).toBe(false);
    });
  });
});
